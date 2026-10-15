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
// migrationLockID is an arbitrary constant. Any process running migrations takes the
// same one, which is what serialises them.
//
// This exists because goose v3.29 does NOT take an advisory lock on its own — verified in
// its source, the only mention is a comment about adding one someday. Every replica of
// the API calls Migrate on boot, so without this they race: two processes read
// goose_db_version at version 0, both try to CREATE TABLE, and one dies with
// "duplicate key value violates unique constraint pg_type_typname_nsp_index". It showed up
// first in CI, where two test packages migrate the same database concurrently, but the
// failure mode is identical in production.
const migrationLockID int64 = 0x0F01D

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

	// One connection, so the session advisory lock below is guaranteed to be held by the
	// same session that runs the migrations. With a pool, the lock could sit on an idle
	// connection while goose ran on another one and the lock would guard nothing.
	db.SetMaxOpenConns(1)

	if _, err := db.Exec("SELECT pg_advisory_lock($1)", migrationLockID); err != nil {
		return fmt.Errorf("acquire migration lock: %w", err)
	}
	defer db.Exec("SELECT pg_advisory_unlock($1)", migrationLockID)

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
