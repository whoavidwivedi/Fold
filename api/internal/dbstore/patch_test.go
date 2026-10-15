package dbstore_test

import (
	"context"
	"database/sql"
	"os"
	"testing"

	"github.com/google/uuid"
	_ "github.com/jackc/pgx/v5/stdlib"

	"fold/api/internal/dbstore"
	"fold/api/internal/platform"
)

// TestPatchClearsFields is the guard against the bug class that cost the most.
//
// A PATCH written as `col = COALESCE(narg(col), col)` has only two states: NULL means
// "leave alone", so there is no way to remove a value. The UI then either cannot clear a
// field or stores an empty string, which is not the same thing — the read path renders
// NULL as "—" and "" as a blank link.
//
// The first version of the lead form shipped exactly this: every field could be set and
// none could be cleared. Both endpoints are covered here so the next form cannot
// reintroduce it on a different table.
//
// Requires TEST_DATABASE_URL pointing at a Postgres where migrations have run.
func TestPatchClearsFields(t *testing.T) {
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		t.Skip("TEST_DATABASE_URL not set")
	}
	if err := platform.Migrate(url); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	adminURL := os.Getenv("MIGRATION_DATABASE_URL")
	if adminURL == "" {
		adminURL = url
	}
	admin := mustOpen(t, adminURL)
	defer admin.Close()

	ctx := context.Background()
	workspaceID := seedWorkspace(t, admin)
	q := dbstore.New(admin)

	// ---- person -------------------------------------------------------------
	person, err := q.CreatePerson(ctx, dbstore.CreatePersonParams{
		WorkspaceID:    workspaceID,
		LifecycleStage: "new",
		FirstName:      "Clear",
		LastName:       "Test",
		Email:          sql.NullString{String: "clear@test.local", Valid: true},
		Phone:          sql.NullString{String: "555-0100", Valid: true},
		JobTitle:       sql.NullString{String: "Rep", Valid: true},
		Data:           []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("create person: %v", err)
	}

	// An omitted field is left alone.
	updated, err := q.UpdatePerson(ctx, dbstore.UpdatePersonParams{
		WorkspaceID: workspaceID,
		PersonID:    person.ID,
		JobTitle:    sql.NullString{String: "Manager", Valid: true},
		Data:        []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("update person: %v", err)
	}
	if updated.JobTitle.String != "Manager" {
		t.Errorf("omitted fields must be left alone: job_title = %q", updated.JobTitle.String)
	}
	if updated.Email.String != "clear@test.local" {
		t.Errorf("omitted email was modified: %q", updated.Email.String)
	}

	// An empty string clears — to NULL, not to "".
	empty := ""
	updated, err = q.UpdatePerson(ctx, dbstore.UpdatePersonParams{
		WorkspaceID: workspaceID,
		PersonID:    person.ID,
		Email:       sql.NullString{String: empty, Valid: true},
		Phone:       sql.NullString{String: empty, Valid: true},
		Data:        []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("clear person: %v", err)
	}
	if updated.Email.Valid {
		t.Errorf("clearing email stored %q instead of NULL", updated.Email.String)
	}
	if updated.Phone.Valid {
		t.Errorf("clearing phone stored %q instead of NULL", updated.Phone.String)
	}
	if !updated.JobTitle.Valid || updated.JobTitle.String != "Manager" {
		t.Errorf("clearing one field disturbed another: %+v", updated.JobTitle)
	}

	// The zero uuid unassigns a company. Omitting it means "leave alone".
	company, err := q.CreateCompany(ctx, dbstore.CreateCompanyParams{
		WorkspaceID: workspaceID,
		Name:        "Acme",
		Data:        []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("create company: %v", err)
	}
	updated, err = q.UpdatePerson(ctx, dbstore.UpdatePersonParams{
		WorkspaceID: workspaceID,
		PersonID:    person.ID,
		CompanyID:   uuid.NullUUID{UUID: company.ID, Valid: true},
		Data:        []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("assign company: %v", err)
	}
	if !updated.CompanyID.Valid || updated.CompanyID.UUID != company.ID {
		t.Fatalf("assigning a company did not stick: got %+v, want %s", updated.CompanyID, company.ID)
	}

	updated, err = q.UpdatePerson(ctx, dbstore.UpdatePersonParams{
		WorkspaceID: workspaceID,
		PersonID:    person.ID,
		CompanyID:   uuid.NullUUID{UUID: uuid.Nil, Valid: true},
		Data:        []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("unassign company: %v", err)
	}
	if updated.CompanyID.Valid {
		t.Errorf("the zero uuid did not unassign the company: %+v", updated.CompanyID)
	}

	// A partial PATCH must not touch the fields it omits. This is not theoretical: the
	// drawer attaches a company with `{"companyId": ...}` and nothing else, and a bare
	// `first_name = $1` wrote an empty string for the omitted name. Real leads ended up
	// rendering as "Unnamed" with their email still attached.
	if updated.FirstName != "Clear" || updated.LastName != "Test" {
		t.Errorf("a partial PATCH overwrote the name: %q %q", updated.FirstName, updated.LastName)
	}
	if updated.LifecycleStage != "new" {
		t.Errorf("a partial PATCH overwrote the stage: %q", updated.LifecycleStage)
	}

	// And a real change to one of them still lands.
	renamed := "Renamed"
	updated, err = q.UpdatePerson(ctx, dbstore.UpdatePersonParams{
		WorkspaceID: workspaceID,
		PersonID:    person.ID,
		FirstName:   sql.NullString{String: renamed, Valid: true},
		Data:        []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("rename: %v", err)
	}
	if updated.FirstName != renamed {
		t.Errorf("renaming did not take: %q", updated.FirstName)
	}
	if updated.LastName != "Test" {
		t.Errorf("renaming disturbed the last name: %q", updated.LastName)
	}

	// ---- company ------------------------------------------------------------
	target, err := q.CreateCompany(ctx, dbstore.CreateCompanyParams{
		WorkspaceID: workspaceID,
		Name:        "Target",
		Domain:      sql.NullString{String: "target.test", Valid: true},
		Industry:    sql.NullString{String: "Roofing", Valid: true},
		Data:        []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("create target company: %v", err)
	}

	updatedCompany, err := q.UpdateCompany(ctx, dbstore.UpdateCompanyParams{
		WorkspaceID: workspaceID,
		CompanyID:   target.ID,
		Name:        "Target Co",
		Industry:    sql.NullString{String: "Contracting", Valid: true},
		Data:        []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("update company: %v", err)
	}
	if updatedCompany.Domain.String != "target.test" {
		t.Errorf("omitted domain was modified: %q", updatedCompany.Domain.String)
	}

	updatedCompany, err = q.UpdateCompany(ctx, dbstore.UpdateCompanyParams{
		WorkspaceID: workspaceID,
		CompanyID:   target.ID,
		Name:        "Target Co",
		Domain:      sql.NullString{String: empty, Valid: true},
		Data:        []byte(`{}`),
	})
	if err != nil {
		t.Fatalf("clear company domain: %v", err)
	}
	if updatedCompany.Domain.Valid {
		t.Errorf("clearing domain stored %q instead of NULL", updatedCompany.Domain.String)
	}
	if !updatedCompany.Industry.Valid || updatedCompany.Industry.String != "Contracting" {
		t.Errorf("clearing one field disturbed another: %+v", updatedCompany.Industry)
	}
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

func seedWorkspace(t *testing.T, admin *sql.DB) uuid.UUID {
	t.Helper()
	var id uuid.UUID
	if err := admin.QueryRow(
		`INSERT INTO organization (name, slug) VALUES ('Clear Test', $1) RETURNING id`,
		"clear-test-"+uuid.NewString()[:8],
	).Scan(&id); err != nil {
		t.Fatalf("seed workspace: %v", err)
	}
	return id
}
