package platform

import (
	"fmt"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/jackc/pgx/v5/stdlib"
	"github.com/pressly/goose/v3"

	"fold/api/migrations"
)

// Migrate runs every pending migration.
//
// It connects with MIGRATION_DATABASE_URL when set, falling back to DATABASE_URL. The
// split matters: CREATE EVENT TRIGGER requires a superuser, but the runtime connection
// must NOT be a superuser — Postgres bypasses row level security for superusers and
// table owners, which would make every tenant policy decorative.
//
// In production, set MIGRATION_DATABASE_URL to a privileged role and run migrations as
// a deploy step, or grant the app role the ability to create event triggers.
func Migrate(databaseURL string) error {
	url := databaseURL
	if admin := os.Getenv("MIGRATION_DATABASE_URL"); admin != "" {
		url = admin
	}

	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return fmt.Errorf("parse migration database url: %w", err)
	}
	// goose speaks database/sql; pgx's stdlib shim bridges it without a new dependency.
	db := stdlib.OpenDB(*cfg.ConnConfig)
	defer db.Close()

	goose.SetBaseFS(migrations.FS)
	goose.SetLogger(goose.NopLogger())

	if err := goose.SetDialect("postgres"); err != nil {
		return fmt.Errorf("set dialect: %w", err)
	}
	if err := goose.Up(db, "."); err != nil {
		return fmt.Errorf("migrate: %w", err)
	}
	return nil
}
