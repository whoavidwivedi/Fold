package platform_test

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"

	"fold/api/internal/platform"
)

// TestTenantIsolation is the most important test in this repository.
//
// One bug here leaks one customer's lead list to another, and nothing else in the test
// suite would catch it. Every assertion below is about RLS, not about Go code — the
// queries are deliberately plain, because the protection has to live in the database.
//
// Requires TEST_DATABASE_URL pointing at a Postgres where migrations have run. Skipped
// otherwise, so `go test ./...` stays useful without a database.
func TestTenantIsolation(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}

	if err := platform.Migrate(url); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	ctx := context.Background()

	// Seeding and verification go through the admin connection. The app connection is
	// subject to RLS by design — seeding through it would be blocked, which is itself
	// the first sign the policies are live.
	adminURL := os.Getenv("MIGRATION_DATABASE_URL")
	if adminURL == "" {
		adminURL = url
	}
	admin := mustOpen(t, adminURL)
	defer admin.Close()

	// Two tenants. The org rows live in the auth schema that Better Auth owns, so the
	// test inserts them directly.
	orgA := seedOrg(t, admin, "acme")
	orgB := seedOrg(t, admin, "globex")

	personA := seedPerson(t, admin, orgA, "Alice", "alice@acme.test")
	seedPerson(t, admin, orgB, "Bob", "bob@globex.test")

	app := platform.DB{DB: mustOpen(t, url)}
	defer app.Close()

	t.Run("sees only its own rows", func(t *testing.T) {
		var names []string
		err := app.Tenant(ctx, orgA.String(), func(tx *sql.Tx) error {
			rows, err := tx.QueryContext(ctx,
				`SELECT first_name FROM person WHERE workspace_id = $1 AND deleted_at IS NULL`,
				orgA)
			if err != nil {
				return err
			}
			defer rows.Close()
			for rows.Next() {
				var n string
				if err := rows.Scan(&n); err != nil {
					return err
				}
				names = append(names, n)
			}
			return rows.Err()
		})
		if err != nil {
			t.Fatalf("tenant query: %v", err)
		}

		if len(names) != 1 || names[0] != "Alice" {
			t.Fatalf("org A should see exactly [Alice], got %v", names)
		}
	})

	// The one that actually matters. A query that forgot platform.Tenant has no GUC set,
	// and RLS must return nothing rather than everything.
	t.Run("fails closed with no workspace set", func(t *testing.T) {
		var n int
		if err := app.DB.QueryRowContext(ctx, `SELECT count(*) FROM person`).Scan(&n); err != nil {
			t.Fatalf("count: %v", err)
		}
		if n != 0 {
			t.Fatalf("without app.workspace_id RLS must return 0 rows, got %d. "+
				"This usually means the connection is a superuser or the table owner — both bypass RLS.", n)
		}
	})

	// WITH CHECK, not just USING. Without it a caller could insert into another
	// tenant's workspace by supplying their id.
	t.Run("refuses a cross-tenant insert", func(t *testing.T) {
		err := app.Tenant(ctx, orgA.String(), func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx,
				`INSERT INTO person (workspace_id, first_name, last_name)
				 VALUES ($1, 'Mallory', 'Intruder')`, orgB)
			return err
		})
		if err == nil {
			t.Fatal("inserting into another workspace must be rejected by the WITH CHECK policy")
		}
	})

	t.Run("refuses a cross-tenant update", func(t *testing.T) {
		err := app.Tenant(ctx, orgB.String(), func(tx *sql.Tx) error {
			_, err := tx.ExecContext(ctx,
				`UPDATE person SET first_name = 'Owned' WHERE workspace_id = $1 AND id = $2`,
				orgA, personA)
			return err
		})
		if err != nil {
			// A row count of 0 rather than an error is also acceptable: RLS filtered the
			// row out. What must never happen is a successful write.
			t.Logf("update rejected outright (expected): %v", err)
		}

		var name string
		if err := admin.QueryRowContext(ctx,
			`SELECT first_name FROM person WHERE id = $1`, personA).Scan(&name); err != nil {
			t.Fatalf("verify: %v", err)
		}
		if name != "Alice" {
			t.Fatalf("cross-tenant update went through: first_name is now %q", name)
		}
	})

	t.Run("soft-deleted rows stay invisible", func(t *testing.T) {
		if _, err := admin.ExecContext(ctx,
			`UPDATE person SET deleted_at = now() WHERE id = $1`, personA); err != nil {
			t.Fatalf("soft delete: %v", err)
		}
		t.Cleanup(func() {
			_, _ = admin.ExecContext(ctx, `UPDATE person SET deleted_at = NULL WHERE id = $1`, personA)
		})

		var n int
		err := app.Tenant(ctx, orgA.String(), func(tx *sql.Tx) error {
			return tx.QueryRowContext(ctx,
				`SELECT count(*) FROM person WHERE deleted_at IS NULL`).Scan(&n)
		})
		if err != nil {
			t.Fatalf("count: %v", err)
		}
		if n != 0 {
			t.Fatalf("soft-deleted row still visible: %d rows", n)
		}
	})
}

func mustOpen(t *testing.T, url string) *sql.DB {
	t.Helper()
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("ping: %v", err)
	}
	return db
}

func seedOrg(t *testing.T, db *sql.DB, slug string) uuid.UUID {
	t.Helper()
	// Unique per run so repeated runs against the same database do not collide.
	slug = slug + "-" + uuid.NewString()[:8]
	id := uuid.New()
	_, err := db.ExecContext(context.Background(),
		`INSERT INTO public.organization (id, name, slug) VALUES ($1, $2, $3)`,
		id.String(), slug, slug)
	if err != nil {
		t.Fatalf("seed org %s: %v", slug, err)
	}
	return id
}

func seedPerson(t *testing.T, db *sql.DB, org uuid.UUID, first, email string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	_, err := db.ExecContext(context.Background(),
		`INSERT INTO person (id, workspace_id, first_name, email) VALUES ($1, $2, $3, $4)`,
		id.String(), org.String(), first, email)
	if err != nil {
		t.Fatalf("seed person %s: %v", first, err)
	}
	return id
}
