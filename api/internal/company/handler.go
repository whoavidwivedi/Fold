// Package company implements company CRUD.
//
// Deliberately the same shape as internal/person: same tenancy, same keyset
// pagination, same soft delete, same JSONB custom fields. Two lists that behave
// differently is a bug waiting to happen — the difference between a person and a company
// is fields, not behaviour.
package company

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"fold/api/internal/auth"
	"fold/api/internal/dbstore"
	"fold/api/internal/platform"
)

type Company struct {
	ID          uuid.UUID       `json:"id" doc:"Stable identifier"`
	Name        string          `json:"name" doc:"Legal or trading name"`
	Domain      *string         `json:"domain,omitempty" doc:"Primary web domain, e.g. northwind.test"`
	Industry    *string         `json:"industry,omitempty"`
	Size        *string         `json:"size,omitempty" doc:"Headcount band"`
	Location    *string         `json:"location,omitempty"`
	LinkedinURL *string         `json:"linkedinUrl,omitempty" format:"uri"`
	Data        json.RawMessage `json:"data" doc:"Custom field values, keyed by field_definition.key"`
	CreatedAt   time.Time       `json:"createdAt"`
	UpdatedAt   time.Time       `json:"updatedAt"`
	// Set only on the list, where the row count is known for free. A pointer so it is
	// absent rather than a misleading 0 on a single-record response, which has no count.
	PeopleCount *int64 `json:"peopleCount,omitempty" doc:"Contacts linked to this company. Present on list responses only."`
}

type CompanyListInput struct {
	Search   string `query:"search" doc:"Matches name or domain, whole words or fragments"`
	Industry string `query:"industry" doc:"Exact industry match"`
	Cursor   string `query:"cursor" doc:"Opaque keyset cursor from nextCursor"`
	Limit    int    `query:"limit" default:"50" minimum:"1" maximum:"200"`
}

type CompanyListOutput struct {
	Body struct {
		Items      []Company `json:"items"`
		Total      int64     `json:"total"`
		NextCursor string    `json:"nextCursor,omitempty"`
	}
}

type CompanyCreateInput struct {
	Body CompanyCreateBody
}

type CompanyCreateBody struct {
	Name        string          `json:"name" required:"true" maxLength:"200"`
	Domain      *string         `json:"domain,omitempty" maxLength:"255"`
	Industry    *string         `json:"industry,omitempty"`
	Size        *string         `json:"size,omitempty"`
	Location    *string         `json:"location,omitempty"`
	LinkedinURL *string         `json:"linkedinUrl,omitempty" format:"uri"`
	Data        json.RawMessage `json:"data,omitempty"`
}

type CompanyUpdateInput struct {
	ID   uuid.UUID `path:"id"`
	Body CompanyUpdateBody
}

type CompanyUpdateBody struct {
	// Name is a pointer like every other field, but the SQL assigns it outright rather
	// than COALESCE-ing, so omitting it renames the company to "". Callers must send it;
	// the UI always does, because it renders a full record.
	Name        *string         `json:"name,omitempty" maxLength:"200"`
	Domain      *string         `json:"domain,omitempty" maxLength:"255"`
	Industry    *string         `json:"industry,omitempty"`
	Size        *string         `json:"size,omitempty"`
	Location    *string         `json:"location,omitempty"`
	LinkedinURL *string         `json:"linkedinUrl,omitempty" format:"uri"`
	Data        json.RawMessage `json:"data,omitempty" doc:"Merged into existing custom values, not replaced"`
}

type CompanyGetInput struct {
	ID uuid.UUID `path:"id"`
}

type CompanyGetOutput struct {
	Body struct {
		Company Company `json:"company"`
		// Counted in the same transaction as the read, so the drawer can warn about
		// orphaning contacts without a second round trip.
		PeopleCount int64 `json:"peopleCount"`
	}
}

type CompanyUpdateOutput struct {
	Body struct {
		Company Company `json:"company"`
	}
}

type CompanyCreateOutput struct {
	Body struct {
		Company Company `json:"company"`
	}
}

// Register wires the company routes.
func Register(api huma.API, db *platform.DB, mw func(huma.Context, func(huma.Context))) {
	queries := dbstore.New(db.DB)
	middlewares := huma.Middlewares{mw}

	huma.Register(api, huma.Operation{
		OperationID: "list-companies",
		Method:      http.MethodGet,
		Path:        "/v1/companies",
		Summary:     "List companies",
		Description: "Newest first. Keyset-paginated — pass nextCursor back as ?cursor=.",
		Tags:        []string{"companies"},
		Middlewares: middlewares,
	}, func(ctx context.Context, in *CompanyListInput) (*CompanyListOutput, error) {
		_, workspaceID, err := principal(ctx)
		if err != nil {
			return nil, err
		}

		cursorAt, cursorID, err := platform.DecodeCursor(in.Cursor)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid cursor")
		}

		var out CompanyListOutput
		err = db.Tenant(ctx, workspaceID.String(), func(tx *sql.Tx) error {
			qtx := queries.WithTx(tx)

			rows, err := qtx.ListCompanies(ctx, dbstore.ListCompaniesParams{
				WorkspaceID: workspaceID,
				Search:      optString(in.Search),
				Industry:    optString(in.Industry),
				CursorAt:    dbstore.TimeArg(cursorAt),
				CursorID:    dbstore.UUIDArg(cursorID),
				PageLimit:   int32(in.Limit),
			})
			if err != nil {
				return err
			}

			total, err := qtx.CountCompanies(ctx, dbstore.CountCompaniesParams{
				WorkspaceID: workspaceID,
				Search:      optString(in.Search),
				Industry:    optString(in.Industry),
			})
			if err != nil {
				return err
			}

			out.Body.Items = make([]Company, 0, len(rows))
			for _, r := range rows {
				out.Body.Items = append(out.Body.Items, fromRow(r))
			}
			out.Body.Total = total

			if len(rows) == in.Limit && len(rows) > 0 {
				last := rows[len(rows)-1]
				out.Body.NextCursor = platform.EncodeCursor(last.CreatedAt, last.ID)
			}
			return nil
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("could not list companies", err)
		}
		return &out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "create-company",
		Method:        http.MethodPost,
		Path:          "/v1/companies",
		Summary:       "Create a company",
		DefaultStatus: http.StatusCreated,
		Tags:          []string{"companies"},
		Middlewares:   middlewares,
	}, func(ctx context.Context, in *CompanyCreateInput) (*CompanyCreateOutput, error) {
		_, workspaceID, err := principal(ctx)
		if err != nil {
			return nil, err
		}

		data, err := jsonArg(in.Body.Data)
		if err != nil {
			return nil, huma.Error400BadRequest("data must be a JSON object")
		}

		var created dbstore.CreateCompanyRow
		err = db.Tenant(ctx, workspaceID.String(), func(tx *sql.Tx) error {
			qtx := queries.WithTx(tx)

			row, err := qtx.CreateCompany(ctx, dbstore.CreateCompanyParams{
				WorkspaceID: workspaceID,
				Name:        in.Body.Name,
				Domain:      dbstore.TextArg(in.Body.Domain),
				Industry:    dbstore.TextArg(in.Body.Industry),
				Size:        dbstore.TextArg(in.Body.Size),
				Location:    dbstore.TextArg(in.Body.Location),
				LinkedinUrl: dbstore.TextArg(in.Body.LinkedinURL),
				Data:        data,
			})
			if err != nil {
				return err
			}
			created = row

			if _, err := qtx.RecordEvent(ctx, dbstore.RecordEventParams{
				WorkspaceID: workspaceID,
				Event:       "company.created",
				EntityType:  reqString("company"),
				EntityID:    dbstore.UUIDArg(&row.ID),
				Properties:  json.RawMessage(`{}`),
			}); err != nil {
				return err
			}

			return platform.Notify(ctx, tx, workspaceID, platform.Event{
				Entity: "company",
				ID:     row.ID.String(),
			})
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("could not create company", err)
		}

		var out CompanyCreateOutput
		out.Body.Company = fromCreateRow(created)
		return &out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-company",
		Method:      http.MethodGet,
		Path:        "/v1/companies/{id}",
		Summary:     "Fetch one company",
		Tags:        []string{"companies"},
		Middlewares: middlewares,
	}, func(ctx context.Context, in *CompanyGetInput) (*CompanyGetOutput, error) {
		_, workspaceID, err := principal(ctx)
		if err != nil {
			return nil, err
		}

		var out CompanyGetOutput
		err = db.Tenant(ctx, workspaceID.String(), func(tx *sql.Tx) error {
			qtx := queries.WithTx(tx)

			row, err := qtx.GetCompany(ctx, dbstore.GetCompanyParams{
				WorkspaceID: workspaceID,
				CompanyID:   in.ID,
			})
			if errors.Is(err, sql.ErrNoRows) {
				return errNoCompany
			}
			if err != nil {
				return err
			}

			count, err := qtx.CountCompanyPeople(ctx, dbstore.CountCompanyPeopleParams{
				WorkspaceID: workspaceID,
				CompanyID:   dbstore.UUIDArg(&in.ID),
			})
			if err != nil {
				return err
			}

			out.Body.Company = fromGetRow(row)
			out.Body.PeopleCount = count
			return nil
		})
		if errors.Is(err, errNoCompany) {
			return nil, huma.Error404NotFound("company not found")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("could not load company", err)
		}
		return &out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-company",
		Method:      http.MethodPatch,
		Path:        "/v1/companies/{id}",
		Summary:     "Update a company",
		Description: "Omitted nullable fields are left alone. Custom values in `data` are merged, not replaced.",
		Tags:        []string{"companies"},
		Middlewares: middlewares,
	}, func(ctx context.Context, in *CompanyUpdateInput) (*CompanyUpdateOutput, error) {
		_, workspaceID, err := principal(ctx)
		if err != nil {
			return nil, err
		}

		data, err := jsonArg(in.Body.Data)
		if err != nil {
			return nil, huma.Error400BadRequest("data must be a JSON object")
		}

		// A PATCH that omits the name would otherwise blank it, because the SQL assigns
		// this column outright. Rejecting is better than silently renaming a company to
		// nothing.
		if in.Body.Name == nil || *in.Body.Name == "" {
			return nil, huma.Error400BadRequest("name is required and cannot be empty")
		}

		var updated dbstore.UpdateCompanyRow
		err = db.Tenant(ctx, workspaceID.String(), func(tx *sql.Tx) error {
			qtx := queries.WithTx(tx)

			row, err := qtx.UpdateCompany(ctx, dbstore.UpdateCompanyParams{
				WorkspaceID: workspaceID,
				CompanyID:   in.ID,
				Name:        *in.Body.Name,
				Domain:      dbstore.TextArg(in.Body.Domain),
				Industry:    dbstore.TextArg(in.Body.Industry),
				Size:        dbstore.TextArg(in.Body.Size),
				Location:    dbstore.TextArg(in.Body.Location),
				LinkedinUrl: dbstore.TextArg(in.Body.LinkedinURL),
				Data:        data,
			})
			if errors.Is(err, sql.ErrNoRows) {
				return errNoCompany
			}
			if err != nil {
				return err
			}
			updated = row

			if _, err := qtx.RecordEvent(ctx, dbstore.RecordEventParams{
				WorkspaceID: workspaceID,
				Event:       "company.updated",
				EntityType:  reqString("company"),
				EntityID:    dbstore.UUIDArg(&in.ID),
				Properties:  json.RawMessage(`{}`),
			}); err != nil {
				return err
			}

			return platform.Notify(ctx, tx, workspaceID, platform.Event{
				Entity: "company",
				ID:     in.ID.String(),
			})
		})
		if errors.Is(err, errNoCompany) {
			return nil, huma.Error404NotFound("company not found")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("could not update company", err)
		}

		var out CompanyUpdateOutput
		out.Body.Company = fromUpdateRow(updated)
		return &out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "delete-company",
		Method:      http.MethodDelete,
		Path:        "/v1/companies/{id}",
		Summary:     "Soft-delete a company",
		Description: "Hides the company and detaches its contacts, matching what a hard delete " +
			"would do. The contacts and their history survive; they simply stop belonging to a company.",
		DefaultStatus: http.StatusNoContent,
		Tags:          []string{"companies"},
		Middlewares:   middlewares,
	}, func(ctx context.Context, in *CompanyGetInput) (*struct{}, error) {
		_, workspaceID, err := principal(ctx)
		if err != nil {
			return nil, err
		}

		err = db.Tenant(ctx, workspaceID.String(), func(tx *sql.Tx) error {
			qtx := queries.WithTx(tx)

			if _, err := qtx.SoftDeleteCompany(ctx, dbstore.SoftDeleteCompanyParams{
				WorkspaceID: workspaceID,
				CompanyID:   in.ID,
			}); err != nil {
				if errors.Is(err, sql.ErrNoRows) {
					return errNoCompany
				}
				return err
			}

			// Detach first. Order matters only for the reader — both are in one
			// transaction, so a reader sees both or neither.
			if err := qtx.DetachCompanyPeople(ctx, dbstore.DetachCompanyPeopleParams{
				WorkspaceID: workspaceID,
				CompanyID:   dbstore.UUIDArg(&in.ID),
			}); err != nil {
				return err
			}

			if _, err := qtx.RecordEvent(ctx, dbstore.RecordEventParams{
				WorkspaceID: workspaceID,
				Event:       "company.deleted",
				EntityType:  reqString("company"),
				EntityID:    dbstore.UUIDArg(&in.ID),
				Properties:  json.RawMessage(`{}`),
			}); err != nil {
				return err
			}

			return platform.Notify(ctx, tx, workspaceID, platform.Event{
				Entity: "company",
				ID:     in.ID.String(),
			})
		})
		if errors.Is(err, errNoCompany) {
			return nil, huma.Error404NotFound("company not found")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("could not delete company", err)
		}
		return nil, nil
	})
}

func principal(ctx context.Context) (*auth.Principal, uuid.UUID, error) {
	p := auth.PrincipalFrom(ctx)
	if p == nil {
		return nil, uuid.Nil, huma.Error401Unauthorized("unauthenticated")
	}
	workspaceID, err := uuid.Parse(p.WorkspaceID)
	if err != nil {
		return nil, uuid.Nil, huma.Error500InternalServerError("malformed workspace id in token")
	}
	return p, workspaceID, nil
}

func fromRow(r dbstore.ListCompaniesRow) Company {
	count := r.PeopleCount
	return Company{
		ID:          r.ID,
		Name:        r.Name,
		Domain:      dbstore.Text(r.Domain),
		Industry:    dbstore.Text(r.Industry),
		Size:        dbstore.Text(r.Size),
		Location:    dbstore.Text(r.Location),
		LinkedinURL: dbstore.Text(r.LinkedinUrl),
		Data:        r.Data,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
		PeopleCount: &count,
	}
}

func fromGetRow(r dbstore.GetCompanyRow) Company {
	return Company{
		ID:          r.ID,
		Name:        r.Name,
		Domain:      dbstore.Text(r.Domain),
		Industry:    dbstore.Text(r.Industry),
		Size:        dbstore.Text(r.Size),
		Location:    dbstore.Text(r.Location),
		LinkedinURL: dbstore.Text(r.LinkedinUrl),
		Data:        r.Data,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

func fromCreateRow(r dbstore.CreateCompanyRow) Company {
	return Company{
		ID:          r.ID,
		Name:        r.Name,
		Domain:      dbstore.Text(r.Domain),
		Industry:    dbstore.Text(r.Industry),
		Size:        dbstore.Text(r.Size),
		Location:    dbstore.Text(r.Location),
		LinkedinURL: dbstore.Text(r.LinkedinUrl),
		Data:        r.Data,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

func fromUpdateRow(r dbstore.UpdateCompanyRow) Company {
	return Company{
		ID:          r.ID,
		Name:        r.Name,
		Domain:      dbstore.Text(r.Domain),
		Industry:    dbstore.Text(r.Industry),
		Size:        dbstore.Text(r.Size),
		Location:    dbstore.Text(r.Location),
		LinkedinURL: dbstore.Text(r.LinkedinUrl),
		Data:        r.Data,
		CreatedAt:   r.CreatedAt,
		UpdatedAt:   r.UpdatedAt,
	}
}

// optString maps "" to NULL so the SQL's "IS NULL OR ..." branch skips the filter. An
// empty query string is not a filter for "the empty string".
func optString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

// jsonArg defaults to an empty object. A NULL would make `data || $1` null, wiping every
// custom field on an update that only meant to change the phone number.
func jsonArg(raw json.RawMessage) (json.RawMessage, error) {
	if len(raw) == 0 {
		return json.RawMessage(`{}`), nil
	}
	if !json.Valid(raw) {
		return nil, errors.New("invalid json")
	}
	return raw, nil
}

func reqString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: true}
}

var errNoCompany = errors.New("company not found in workspace")
