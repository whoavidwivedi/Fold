// Command api is the Fold data service: a single binary that self-migrates, serves the
// REST API, and streams realtime events.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/danielgtaylor/huma/v2/adapters/humago"

	"fold/api/internal/activity"
	"fold/api/internal/auth"
	"fold/api/internal/company"
	"fold/api/internal/person"
	"fold/api/internal/platform"
	"fold/api/internal/realtime"
)

var (
	migrateOnly  = flag.Bool("migrate-only", false, "run pending migrations and exit")
	printOpenAPI = flag.Bool("print-openapi", false, "write the OpenAPI document to stdout and exit")
)

func main() {
	flag.Parse()
	if err := run(); err != nil {
		slog.Error("fatal", "err", err)
		os.Exit(1)
	}
}

func run() error {
	// `--print-openapi` runs before config is even read: the spec is a pure function of
	// the route definitions, so generating it needs no database, no listener and no auth
	// server. That is what lets orval run offline in CI against a committed file.
	if *printOpenAPI {
		api, err := buildAPI(http.NewServeMux(), nil, nil, nil, nil)
		if err != nil {
			return err
		}
		// MarshalJSON is the same serialisation the live /openapi.json endpoint uses, so
		// the committed file and the served document cannot drift.
		spec, err := api.OpenAPI().MarshalJSON()
		if err != nil {
			return fmt.Errorf("marshal openapi: %w", err)
		}
		var pretty bytes.Buffer
		if err := json.Indent(&pretty, spec, "", "  "); err != nil {
			return err
		}
		_, err = os.Stdout.Write(pretty.Bytes())
		return err
	}

	cfg, err := platform.Load()
	if err != nil {
		return err
	}

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: parseLevel(cfg.LogLevel),
	})))

	// `--migrate-only` runs migrations and exits. Used by the compose `migrate` profile
	// and by CI, so the migration step never depends on the server booting successfully.
	if *migrateOnly {
		if err := platform.Migrate(cfg.DatabaseURL); err != nil {
			return err
		}
		slog.Info("migrations up to date")
		return nil
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := cfg.ValidateAuth(); err != nil {
		return err
	}

	if err := platform.Migrate(cfg.DatabaseURL); err != nil {
		return err
	}
	slog.Info("migrations up to date")

	db, err := platform.Open(ctx, cfg)
	if err != nil {
		return err
	}
	defer db.Close()

	hub := platform.NewHub()
	go func() {
		if err := hub.Run(ctx, cfg.DatabaseURL); err != nil && ctx.Err() == nil {
			slog.Error("realtime listener stopped", "err", err)
		}
	}()

	mux := http.NewServeMux()
	if _, err := buildAPI(mux, db, hub, auth.NewVerifier(cfg.JWKSURL, cfg.AuthBaseURL), cfg); err != nil {
		return err
	}

	// WriteTimeout must stay 0 or SSE streams are severed mid-flight. ReadHeaderTimeout
	// is the real protection against slowloris.
	srv := &http.Server{
		Addr: cfg.Addr,
		// Wrapped outermost so preflight requests never reach a route that would reject
		// them with a 405 before the browser can read the headers it needs.
		Handler:           platform.NewCORS(cfg.CORSOrigins).Middleware(mux),
		ReadHeaderTimeout: 10 * time.Second,
		WriteTimeout:      0,
		IdleTimeout:       120 * time.Second,
	}

	errCh := make(chan error, 1)
	go func() {
		slog.Info("listening", "addr", cfg.Addr, "db", platform.DSN(cfg.DatabaseURL))
		if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
			errCh <- err
		}
	}()

	select {
	case err := <-errCh:
		return err
	case <-ctx.Done():
		slog.Info("shutting down")
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		return srv.Shutdown(shutdownCtx)
	}
}

// buildAPI registers every route. It is the single place the surface is defined, so the
// served API and the generated openapi.json can never drift apart.
//
// db, hub and verifier may be nil when only the spec is wanted — Huma only reads the
// route metadata in that case.
func buildAPI(
	mux *http.ServeMux,
	db *platform.DB,
	hub *platform.Hub,
	verifier *auth.Verifier,
	appCfg *platform.Config,
) (huma.API, error) {
	// DefaultConfig, not a bare Config literal: it registers the JSON content
	// negotiation format. Without it every response fails with "unknown content type".
	apiCfg := huma.DefaultConfig("Fold API", "1.0.0")
	apiCfg.OpenAPI.Info.Description = "Lead management CRM API. Multi-tenant by workspace; every query is Row Level " +
		"Security enforced. Auth is a Better Auth JWT, verified offline against the JWKS endpoint."
	// Extension-less: Huma appends .json / .yaml itself, so the spec is served at
	// /openapi.json, /openapi.yaml and /openapi-3.0.json for 3.0 consumers.
	apiCfg.OpenAPIPath = "/openapi"
	// /docs serves Scalar against the OpenAPI document. It is the contract an AI agent
	// reads, and humans debugging integration. Never behind auth.
	apiCfg.DocsPath = "/docs"

	api := humago.New(mux, apiCfg)

	huma.Register(api, huma.Operation{
		OperationID: "health",
		Method:      http.MethodGet,
		Path:        "/health",
		Summary:     "Liveness probe",
		Description: "Unauthenticated on purpose so load balancers and uptime monitors do not need a token.",
	}, func(context.Context, *struct{}) (*struct{}, error) {
		return &struct{}{}, nil
	})

	// Every route is registered unconditionally. In --print-openapi mode the
	// dependencies are stand-ins: the spec is a pure function of route definitions, so
	// the committed document and the served document are always the same set of
	// operations. The nil values are never dereferenced because no request is served.
	if db == nil {
		db = &platform.DB{}
	}
	if hub == nil {
		hub = platform.NewHub()
	}
	var secret []byte
	if appCfg != nil {
		secret = appCfg.StreamTokenSecret
	}

	var authenticate func(huma.Context, func(huma.Context))
	if verifier != nil {
		authenticate = auth.Middleware(verifier)
	}

	realtime.Register(api, hub, secret, authenticate)
	person.Register(api, db, authenticate)
	company.Register(api, db, authenticate)
	activity.Register(api, db, authenticate)

	return api, nil
}

func parseLevel(s string) slog.Level {
	switch s {
	case "debug":
		return slog.LevelDebug
	case "warn":
		return slog.LevelWarn
	case "error":
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}
