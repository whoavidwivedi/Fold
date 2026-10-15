package platform

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
)

// DB owns the connection pool and the one entry point for tenant-scoped work.
//
// The pool is database/sql, opened through pgx's stdlib connector — so the wire
// protocol and pooling are still pgx, while generated query code uses the stdlib
// interfaces. See the note in sqlc.yaml.
type DB struct {
	DB *sql.DB
}

// Open connects and verifies.
func Open(ctx context.Context, cfg *Config) (*DB, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	poolCfg.MaxConns = int32(envInt("DB_MAX_CONNS", 10))
	poolCfg.MinConns = int32(envInt("DB_MIN_CONNS", 2))

	db := sql.OpenDB(stdlib.GetConnector(*poolCfg.ConnConfig))
	if err := db.PingContext(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping: %w", err)
	}
	return &DB{DB: db}, nil
}

// Tenant runs fn inside a transaction with app.workspace_id set for the duration.
//
// This is the ONLY way to query tenant data. Every RLS policy reads that GUC, so a
// query that forgets it sees zero rows rather than another customer's records — it fails
// closed. The whole request lives in one transaction on purpose: that is what prevents a
// pooled connection from carrying the previous request's workspace id into the next one.
// See docs/adr/0002.
func (d *DB) Tenant(ctx context.Context, workspaceID string, fn func(*sql.Tx) error) error {
	if workspaceID == "" {
		return errors.New("workspace id is required")
	}

	tx, err := d.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin: %w", err)
	}
	defer tx.Rollback() //nolint:errcheck // no-op once committed

	// set_config with is_local=true scopes the value to this transaction, so the GUC is
	// gone the moment the tx ends no matter which pooled connection gets reused next.
	if _, err := tx.ExecContext(ctx, `SELECT set_config('app.workspace_id', $1, true)`, workspaceID); err != nil {
		return fmt.Errorf("set workspace: %w", err)
	}

	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

// Close releases the pool.
func (d *DB) Close() {
	if d.DB != nil {
		_ = d.DB.Close()
	}
}

// DSN renders the pool URL without its password, for logs.
func DSN(raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return "unparseable"
	}
	return u.Host + u.Path
}
