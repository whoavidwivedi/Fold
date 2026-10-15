// Package platform holds the wiring every other package depends on: configuration,
// the connection pool, tenant-scoped transactions, and the realtime notification bus.
package platform

import (
	"fmt"
	"os"
	"strconv"
)

// Config is read from the environment once at boot. Kept flat and small on purpose —
// if this grows past ~20 fields, reach for caarlos0/env rather than adding getters here.
type Config struct {
	Addr        string
	DatabaseURL string
	LogLevel    string

	// Auth
	AuthBaseURL string
	JWKSURL     string

	// CORS_ORIGINS is a comma-separated allow-list of browser origins. Needed in
	// development because Next runs on :3000 and the API on :8080. Leave it empty in
	// production, where one reverse proxy serves both from a single origin.
	CORSOrigins string

	// StreamTokenSecret signs short-lived SSE tokens. EventSource cannot send an
	// Authorization header, so the browser exchanges its JWT for one of these.
	StreamTokenSecret []byte
}

func Load() (*Config, error) {
	c := &Config{
		Addr:        env("ADDR", ":8080"),
		DatabaseURL: os.Getenv("DATABASE_URL"),
		LogLevel:    env("LOG_LEVEL", "info"),

		AuthBaseURL: os.Getenv("AUTH_BASE_URL"),
		JWKSURL:     os.Getenv("JWKS_URL"),

		CORSOrigins: env("CORS_ORIGINS", "http://localhost:3000"),

		StreamTokenSecret: []byte(os.Getenv("STREAM_TOKEN_SECRET")),
	}

	if c.DatabaseURL == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	return c, nil
}

// ValidateAuth checks the settings only the serving path needs, so `--migrate-only`
// does not require an auth server that is not running yet.
func (c *Config) ValidateAuth() error {
	if c.JWKSURL == "" {
		return fmt.Errorf("JWKS_URL is required (e.g. %s/api/auth/jwks)", c.AuthBaseURL)
	}
	if len(c.StreamTokenSecret) < 32 {
		return fmt.Errorf("STREAM_TOKEN_SECRET must be at least 32 bytes")
	}
	return nil
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return fallback
}
