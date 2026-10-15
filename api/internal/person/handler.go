// Package person implements the person resource — the core record of the CRM.
//
// One table serves leads and contacts; qualification is the lifecycle_stage field.
// See docs/adr/0005 for why there is no separate lead table.
package person

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/google/uuid"

	"fold/api/internal/activity"
	"fold/api/internal/auth"
	"fold/api/internal/dbstore"
	"fold/api/internal/platform"
)

// Person is the wire representation of a person. Mirrors the column list in
// queries/person.sql; sqlc keeps the two in sync.
//
// Named Person rather than Body because Huma output types must be a struct containing a
// field literally called Body — see PersonOutput below.
type Person struct {
	ID             uuid.UUID       `json:"id" doc:"Stable identifier"`
	CompanyID      *uuid.UUID      `json:"companyId,omitempty"`
	FirstName      string          `json:"firstName"`
	LastName       string          `json:"lastName"`
	Email          *string         `json:"email,omitempty"`
	Phone          *string         `json:"phone,omitempty"`
	JobTitle       *string         `json:"jobTitle,omitempty"`
	LifecycleStage string          `json:"lifecycleStage" doc:"new | contacted | qualified | customer | disqualified"`
	Source         *string         `json:"source,omitempty"`
	OwnerID        *uuid.UUID      `json:"ownerId,omitempty"`
	Score          int32           `json:"score" doc:"Composite of fit and intent, 0-100"`
	ScoreFit       int32           `json:"scoreFit"`
	ScoreIntent    int32           `json:"scoreIntent"`
	Data           json.RawMessage `json:"data" doc:"Custom field values, keyed by field_definition.key"`
	CreatedAt      time.Time       `json:"createdAt"`
	UpdatedAt      time.Time       `json:"updatedAt"`
}

func fromRow(r dbstore.ListPersonsRow) *Person {
	return &Person{
		ID:             r.ID,
		CompanyID:      uuidPtr(r.CompanyID),
		FirstName:      r.FirstName,
		LastName:       r.LastName,
		Email:          strPtr(r.Email),
		Phone:          strPtr(r.Phone),
		JobTitle:       strPtr(r.JobTitle),
		LifecycleStage: r.LifecycleStage,
		Source:         strPtr(r.Source),
		OwnerID:        uuidPtr(r.OwnerID),
		Score:          r.Score,
		ScoreFit:       r.ScoreFit,
		ScoreIntent:    r.ScoreIntent,
		Data:           r.Data,
		CreatedAt:      r.CreatedAt,
		UpdatedAt:      r.UpdatedAt,
	}
}

func fromCreateRow(r dbstore.CreatePersonRow) *Person {
	return &Person{
		ID:             r.ID,
		CompanyID:      uuidPtr(r.CompanyID),
		FirstName:      r.FirstName,
		LastName:       r.LastName,
		Email:          strPtr(r.Email),
		Phone:          strPtr(r.Phone),
		JobTitle:       strPtr(r.JobTitle),
		LifecycleStage: r.LifecycleStage,
		Source:         strPtr(r.Source),
		OwnerID:        uuidPtr(r.OwnerID),
		Score:          r.Score,
		ScoreFit:       r.ScoreFit,
		ScoreIntent:    r.ScoreIntent,
		Data:           r.Data,
		CreatedAt:      r.CreatedAt,
		UpdatedAt:      r.UpdatedAt,
	}
}

func fromUpdateRow(r dbstore.UpdatePersonRow) *Person {
	return &Person{
		ID:             r.ID,
		CompanyID:      uuidPtr(r.CompanyID),
		FirstName:      r.FirstName,
		LastName:       r.LastName,
		Email:          strPtr(r.Email),
		Phone:          strPtr(r.Phone),
		JobTitle:       strPtr(r.JobTitle),
		LifecycleStage: r.LifecycleStage,
		Source:         strPtr(r.Source),
		OwnerID:        uuidPtr(r.OwnerID),
		Score:          r.Score,
		ScoreFit:       r.ScoreFit,
		ScoreIntent:    r.ScoreIntent,
		Data:           r.Data,
		CreatedAt:      r.CreatedAt,
		UpdatedAt:      r.UpdatedAt,
	}
}

func fromGetRow(r dbstore.GetPersonRow) *Person {
	return &Person{
		ID:             r.ID,
		CompanyID:      uuidPtr(r.CompanyID),
		FirstName:      r.FirstName,
		LastName:       r.LastName,
		Email:          strPtr(r.Email),
		Phone:          strPtr(r.Phone),
		JobTitle:       strPtr(r.JobTitle),
		LifecycleStage: r.LifecycleStage,
		Source:         strPtr(r.Source),
		OwnerID:        uuidPtr(r.OwnerID),
		Score:          r.Score,
		ScoreFit:       r.ScoreFit,
		ScoreIntent:    r.ScoreIntent,
		Data:           r.Data,
		CreatedAt:      r.CreatedAt,
		UpdatedAt:      r.UpdatedAt,
	}
}

// ListInput drives the list endpoint. Every filter is optional and means "no filter" —
// a dynamic WHERE built by a query builder produces a different plan per combination,
// whereas explicit nullable params let Postgres reuse one prepared plan.
//
// Huma does not allow pointer types on query parameters, so optional uuids are
// uuid.UUID with the nil UUID meaning "unset".
type ListInput struct {
	LifecycleStage string    `query:"lifecycleStage" doc:"Filter by qualification stage"`
	OwnerID        uuid.UUID `query:"ownerId" doc:"Filter by assigned rep"`
	CompanyID      uuid.UUID `query:"companyId"`
	Search         string    `query:"search" doc:"Full-text search across name, email local part and email domain"`
	Cursor         string    `query:"cursor" doc:"Opaque keyset cursor from nextCursor. Leave empty for the first page."`
	Limit          int       `query:"limit" default:"50" minimum:"1" maximum:"200" doc:"Page size"`
}

type ListPersonsBody struct {
	Items      []Person `json:"items"`
	NextCursor string   `json:"nextCursor,omitempty" doc:"Pass back as ?cursor= for the next page. Absent means the last page."`
	Total      int64    `json:"total" doc:"Total matching rows, so the UI count matches the list"`
}

// Huma output convention: a struct with a field literally named Body. Returning the
// payload directly produces a 204 with the fields leaking into response headers.
type ListPersonsOutput struct {
	Body ListPersonsBody
}

type PersonOutput struct {
	Body Person
}

type CreateInput struct {
	Body CreateBody
}

type CreateBody struct {
	CompanyID      *uuid.UUID      `json:"companyId,omitempty"`
	FirstName      string          `json:"firstName" maxLength:"120"`
	LastName       string          `json:"lastName" maxLength:"120"`
	Email          *string         `json:"email,omitempty" format:"email"`
	Phone          *string         `json:"phone,omitempty"`
	JobTitle       *string         `json:"jobTitle,omitempty"`
	LifecycleStage string          `json:"lifecycleStage,omitempty" default:"new" enum:"new,contacted,qualified,customer,disqualified"`
	Source         *string         `json:"source,omitempty"`
	Data           json.RawMessage `json:"data,omitempty" doc:"Custom field values"`
}

type UpdateInput struct {
	ID   uuid.UUID `path:"id" doc:"Person id"`
	Body UpdateBody
}

type UpdateBody struct {
	FirstName *string `json:"firstName,omitempty" maxLength:"120"`
	LastName  *string `json:"lastName,omitempty" maxLength:"120"`
	// No `format:"email"` here, unlike CreateBody. Huma validates whatever is present,
	// and an empty string is present — so a client clearing a field got a 422 before this
	// handler ever ran, which made email the one field on the record that could be set
	// but never removed. The check moved to the handler, which skips the empty string and
	// rejects everything else that is not RFC 5322.
	Email          *string         `json:"email,omitempty"`
	Phone          *string         `json:"phone,omitempty"`
	JobTitle       *string         `json:"jobTitle,omitempty"`
	LifecycleStage *string         `json:"lifecycleStage,omitempty" enum:"new,contacted,qualified,customer,disqualified"`
	Source         *string         `json:"source,omitempty"`
	OwnerID        *uuid.UUID      `json:"ownerId,omitempty"`
	CompanyID      *uuid.UUID      `json:"companyId,omitempty"`
	Data           json.RawMessage `json:"data,omitempty" doc:"Merged into existing custom values, not replaced"`
}

type GetInput struct {
	ID uuid.UUID `path:"id" doc:"Person id"`
}

type DeleteInput struct {
	ID uuid.UUID `path:"id" doc:"Person id"`
}

// errNoPerson distinguishes "not in this workspace" from a real failure, so the handler
// can answer 404 instead of 500.
var errNoPerson = errors.New("person not found in workspace")

// Register wires the person routes onto the API.
func Register(api huma.API, db *platform.DB, mw func(huma.Context, func(huma.Context))) {
	queries := dbstore.New(db.DB)
	middlewares := huma.Middlewares{mw}

	huma.Register(api, huma.Operation{
		OperationID: "list-persons",
		Method:      http.MethodGet,
		Path:        "/v1/persons",
		Summary:     "List people",
		Description: "Keyset-paginated. Pass nextCursor back as ?cursor= to page forward. " +
			"Counts are computed under the same filters, so the UI count always matches the list.",
		Tags:        []string{"people"},
		Middlewares: middlewares,
	}, func(ctx context.Context, in *ListInput) (*ListPersonsOutput, error) {
		p, workspaceID, err := principal(ctx)
		if err != nil {
			return nil, err
		}

		cursorAt, cursorID, err := platform.DecodeCursor(in.Cursor)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid cursor")
		}

		var out ListPersonsBody

		err = db.Tenant(ctx, p.WorkspaceID, func(tx *sql.Tx) error {
			qtx := queries.WithTx(tx)

			rows, err := qtx.ListPersons(ctx, dbstore.ListPersonsParams{
				WorkspaceID:    workspaceID,
				LifecycleStage: optString(in.LifecycleStage),
				OwnerID:        optUUID(&in.OwnerID),
				CompanyID:      optUUID(&in.CompanyID),
				Search:         optString(in.Search),
				CursorAt:       optTime(cursorAt),
				CursorID:       optUUID(cursorID),
				PageLimit:      int32(in.Limit),
			})
			if err != nil {
				return err
			}

			total, err := qtx.CountPersons(ctx, dbstore.CountPersonsParams{
				WorkspaceID:    workspaceID,
				LifecycleStage: optString(in.LifecycleStage),
				OwnerID:        optUUID(&in.OwnerID),
				CompanyID:      optUUID(&in.CompanyID),
				Search:         optString(in.Search),
			})
			if err != nil {
				return err
			}

			out.Items = make([]Person, 0, len(rows))
			for _, r := range rows {
				out.Items = append(out.Items, *fromRow(r))
			}
			out.Total = total

			// A short page means we reached the end. A full page might still have more.
			if len(rows) == in.Limit && len(rows) > 0 {
				last := rows[len(rows)-1]
				out.NextCursor = platform.EncodeCursor(last.CreatedAt, last.ID)
			}
			return nil
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("could not list people", err)
		}

		return &ListPersonsOutput{Body: out}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "create-person",
		Method:        http.MethodPost,
		Path:          "/v1/persons",
		Summary:       "Create a person",
		DefaultStatus: http.StatusCreated,
		Tags:          []string{"people"},
		Middlewares:   middlewares,
	}, func(ctx context.Context, in *CreateInput) (*PersonOutput, error) {
		p, workspaceID, err := principal(ctx)
		if err != nil {
			return nil, err
		}
		userID, err := uuid.Parse(p.UserID)
		if err != nil {
			return nil, huma.Error500InternalServerError("malformed user id in token")
		}

		stage := in.Body.LifecycleStage
		if stage == "" {
			stage = "new"
		}

		var created dbstore.CreatePersonRow

		err = db.Tenant(ctx, p.WorkspaceID, func(tx *sql.Tx) error {
			qtx := queries.WithTx(tx)

			created, err = qtx.CreatePerson(ctx, dbstore.CreatePersonParams{
				WorkspaceID:    workspaceID,
				CompanyID:      optUUID(in.Body.CompanyID),
				FirstName:      in.Body.FirstName,
				LastName:       in.Body.LastName,
				Email:          optStringPtr(in.Body.Email),
				Phone:          optStringPtr(in.Body.Phone),
				JobTitle:       optStringPtr(in.Body.JobTitle),
				LifecycleStage: stage,
				Source:         optStringPtr(in.Body.Source),
				OwnerID:        reqUUID(userID),
				Data:           jsonArg(in.Body.Data),
			})
			if err != nil {
				return err
			}

			// The append-only event log is what makes cohort and funnel reporting
			// possible later. Written in the same transaction as the record.
			stageJSON, _ := json.Marshal(map[string]string{"lifecycleStage": stage})
			if _, err := qtx.RecordEvent(ctx, dbstore.RecordEventParams{
				WorkspaceID: workspaceID,
				Event:       "person.created",
				UserID:      reqUUID(userID),
				EntityType:  reqString("person"),
				EntityID:    reqUUID(created.ID),
				Properties:  stageJSON,
			}); err != nil {
				return err
			}

			return platform.Notify(ctx, tx, workspaceID, platform.Event{
				Entity: "person",
				ID:     created.ID.String(),
			})
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("could not create person", err)
		}

		return &PersonOutput{Body: *fromCreateRow(created)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "get-person",
		Method:      http.MethodGet,
		Path:        "/v1/persons/{id}",
		Summary:     "Fetch one person",
		Tags:        []string{"people"},
		Middlewares: middlewares,
	}, func(ctx context.Context, in *GetInput) (*PersonOutput, error) {
		p, workspaceID, err := principal(ctx)
		if err != nil {
			return nil, err
		}

		var found dbstore.GetPersonRow
		err = db.Tenant(ctx, p.WorkspaceID, func(tx *sql.Tx) error {
			row, err := queries.WithTx(tx).GetPerson(ctx, dbstore.GetPersonParams{
				WorkspaceID: workspaceID,
				PersonID:    in.ID,
			})
			if err != nil {
				return err
			}
			found = row
			return nil
		})
		if err != nil {
			return nil, huma.Error404NotFound("person not found")
		}

		return &PersonOutput{Body: *fromGetRow(found)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "update-person",
		Method:      http.MethodPatch,
		Path:        "/v1/persons/{id}",
		Summary:     "Update a person",
		Description: "Omitted nullable fields are left alone. Custom values in `data` are merged, not replaced.",
		Tags:        []string{"people"},
		Middlewares: middlewares,
	}, func(ctx context.Context, in *UpdateInput) (*PersonOutput, error) {
		p, workspaceID, err := principal(ctx)
		if err != nil {
			return nil, err
		}

		// The email check lives here rather than on the struct tag — see UpdateBody.
		// Empty means "clear it", which is a legitimate PATCH; anything else must parse.
		if in.Body.Email != nil && *in.Body.Email != "" {
			if _, err := mail.ParseAddress(*in.Body.Email); err != nil {
				return nil, huma.Error422UnprocessableEntity("email is not a valid address")
			}
		}

		var updated dbstore.UpdatePersonRow
		err = db.Tenant(ctx, p.WorkspaceID, func(tx *sql.Tx) error {
			qtx := queries.WithTx(tx)

			// Read the stage the person is in *before* the update. Postgres 17 cannot
			// return OLD from RETURNING, so this is the only way to tell whether the
			// stage actually moved — and it costs nothing when the caller did not send
			// one, which is the common case.
			var fromStage string
			if in.Body.LifecycleStage != nil {
				row, err := qtx.GetPersonSummary(ctx, dbstore.GetPersonSummaryParams{
					WorkspaceID: workspaceID,
					PersonID:    in.ID,
				})
				if err != nil {
					if errors.Is(err, sql.ErrNoRows) {
						return errNoPerson
					}
					return err
				}
				fromStage = row.LifecycleStage
			}

			row, err := qtx.UpdatePerson(ctx, dbstore.UpdatePersonParams{
				WorkspaceID:    workspaceID,
				PersonID:       in.ID,
				CompanyID:      optUUID(in.Body.CompanyID),
				FirstName:      derefString(in.Body.FirstName),
				LastName:       derefString(in.Body.LastName),
				Email:          optStringPtr(in.Body.Email),
				Phone:          optStringPtr(in.Body.Phone),
				JobTitle:       optStringPtr(in.Body.JobTitle),
				LifecycleStage: derefString(in.Body.LifecycleStage),
				Source:         optStringPtr(in.Body.Source),
				OwnerID:        optUUID(in.Body.OwnerID),
				Data:           jsonArg(in.Body.Data),
			})
			if err != nil {
				return err
			}
			updated = row

			// A stage move is the single most important thing that happens to a lead, and
			// the timeline is where a rep looks for it. Without this the feed silently
			// omits every qualification decision, which is the whole point of the log.
			if fromStage != "" && fromStage != *in.Body.LifecycleStage {
				payload, err := json.Marshal(map[string]any{
					"fromStage": fromStage,
					"toStage":   *in.Body.LifecycleStage,
				})
				if err != nil {
					return err
				}
				userID, err := uuid.Parse(p.UserID)
				if err != nil {
					return huma.Error500InternalServerError("malformed user id in token")
				}
				name := activity.JoinName(row.FirstName, row.LastName)
				if _, err := (activity.Log{
					WorkspaceID: workspaceID,
					PersonID:    in.ID,
					RecordName:  name,
					Kind:        activity.KindStage,
					ActorID:     &userID,
					HappensAt:   time.Now().UTC(),
					Properties:  payload,
				}).Write(ctx, qtx); err != nil {
					return err
				}
			}

			if _, err := qtx.RecordEvent(ctx, dbstore.RecordEventParams{
				WorkspaceID: workspaceID,
				Event:       "person.updated",
				EntityType:  reqString("person"),
				EntityID:    reqUUID(in.ID),
				Properties:  json.RawMessage(`{}`),
			}); err != nil {
				return err
			}

			return platform.Notify(ctx, tx, workspaceID, platform.Event{
				Entity: "person",
				ID:     in.ID.String(),
			})
		})
		if errors.Is(err, errNoPerson) {
			return nil, huma.Error404NotFound("person not found")
		}
		if err != nil {
			return nil, huma.Error500InternalServerError("could not update person", err)
		}

		return &PersonOutput{Body: *fromUpdateRow(updated)}, nil
	})

	huma.Register(api, huma.Operation{
		OperationID:   "delete-person",
		Method:        http.MethodDelete,
		Path:          "/v1/persons/{id}",
		Summary:       "Soft-delete a person",
		Description:   "Sets deleted_at. Sales data gets deleted by accident; this is recoverable.",
		DefaultStatus: http.StatusNoContent,
		Tags:          []string{"people"},
		Middlewares:   middlewares,
	}, func(ctx context.Context, in *DeleteInput) (*struct{}, error) {
		p, workspaceID, err := principal(ctx)
		if err != nil {
			return nil, err
		}

		err = db.Tenant(ctx, p.WorkspaceID, func(tx *sql.Tx) error {
			qtx := queries.WithTx(tx)
			if _, err := qtx.DeletePerson(ctx, dbstore.DeletePersonParams{
				WorkspaceID: workspaceID,
				PersonID:    in.ID,
			}); err != nil {
				return err
			}
			return platform.Notify(ctx, tx, workspaceID, platform.Event{
				Entity: "person",
				ID:     in.ID.String(),
			})
		})
		if err != nil {
			return nil, huma.Error404NotFound("person not found")
		}
		return &struct{}{}, nil
	})
}

// principal extracts the caller and parses their workspace and user ids once, so every
// handler does not repeat the same three lines of error handling.
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

func ptr[T any](v T) *T { return &v }

// The query parameters below map Go pointers onto sql.Null* types, where a nil pointer
// means "no filter" — which is exactly what the SQL's `IS NULL` branches test.

func uuidPtr(v uuid.NullUUID) *uuid.UUID {
	if !v.Valid {
		return nil
	}
	id := v.UUID
	return &id
}

func strPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}

func optString(s string) sql.NullString {
	if s == "" {
		return sql.NullString{}
	}
	return sql.NullString{String: s, Valid: true}
}

func optStringPtr(s *string) sql.NullString {
	if s == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *s, Valid: true}
}

func optUUID(u *uuid.UUID) uuid.NullUUID {
	if u == nil || *u == uuid.Nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *u, Valid: true}
}

func reqUUID(u uuid.UUID) uuid.NullUUID {
	return uuid.NullUUID{UUID: u, Valid: true}
}

func optTime(t *time.Time) sql.NullTime {
	if t == nil {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: *t, Valid: true}
}

func reqString(s string) sql.NullString {
	return sql.NullString{String: s, Valid: true}
}

// jsonArg normalises a possibly-absent jsonb body to an empty object, so
// `person.data || '{}'::jsonb` never yields NULL.
func jsonArg(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 {
		return json.RawMessage(`{}`)
	}
	return raw
}
