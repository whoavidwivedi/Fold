// Package activity implements the activity log and the timeline a rep reads.
//
// Every logged interaction — a note, a call, an email — writes three rows: the
// authoritative activity, its target, and a denormalized timeline entry. Two writes per
// interaction in exchange for a feed that renders without joins. See docs/adr/0004.
package activity

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

// Kinds a rep can log. Constrained here rather than left free-form so the timeline can
// pick an icon and a tone without falling back to a default for typos.
const (
	KindNote  = "note"
	KindCall  = "call"
	KindEmail = "email"
	KindStage = "stage_change"
)

// Kinds is exported to the frontend through the OpenAPI description rather than a second
// endpoint — one source of truth.
var validKinds = map[string]bool{
	KindNote:  true,
	KindCall:  true,
	KindEmail: true,
	KindStage: true,
}

type Entry struct {
	ID         uuid.UUID       `json:"id" doc:"Activity id"`
	HappensAt  time.Time       `json:"happensAt" doc:"When the interaction occurred"`
	Kind       string          `json:"kind" doc:"note | call | email | stage_change"`
	ActorID    *uuid.UUID      `json:"actorId,omitempty"`
	ActorName  *string         `json:"actorName,omitempty"`
	Properties json.RawMessage `json:"properties" doc:"Kind-specific payload, e.g. { body, direction, fromStage, toStage }"`
}

type LogBody struct {
	Kind string `json:"kind" required:"true" enum:"note,call,email,stage_change" doc:"What was logged"`
	// Body is required for notes and the summary for calls; direction for emails.
	Body      string     `json:"body,omitempty" maxLength:"5000" doc:"Note text, or what was said on a call"`
	Direction string     `json:"direction,omitempty" enum:"inbound,outbound" doc:"Email direction"`
	HappensAt *time.Time `json:"happensAt,omitempty" doc:"Defaults to now. Set it when logging something that happened earlier."`
}

type LogInput struct {
	PersonID uuid.UUID `path:"id" doc:"Person this activity belongs to"`
	Body     LogBody
}

// No Status field: DefaultStatus on the Operation sets 201. A zero-valued `status` tag
// field overrides it with 0, which net/http rejects — "invalid WriteHeader code 0".
type LogOutput struct {
	Body struct {
		Entry Entry `json:"entry"`
	}
}

type TimelineInput struct {
	// Path and query cannot coexist on one field. A stray `query:""` tag here made Huma
	// treat the person id as a query parameter with an empty name and silently drop it
	// from the OpenAPI document, which orval then rejected as invalid.
	PersonID uuid.UUID `path:"id" doc:"Person whose timeline to read"`
	Cursor   string    `query:"cursor" doc:"Opaque keyset cursor from nextCursor"`
	Limit    int       `query:"limit" default:"50" minimum:"1" maximum:"200"`
}

type TimelineOutput struct {
	Body struct {
		Entries    []Entry `json:"entries"`
		NextCursor string  `json:"nextCursor,omitempty"`
		Total      int64   `json:"total"`
	}
}

// Register wires the activity routes.
func Register(api huma.API, db *platform.DB, mw func(huma.Context, func(huma.Context))) {
	queries := dbstore.New(db.DB)
	middlewares := huma.Middlewares{mw}

	huma.Register(api, huma.Operation{
		OperationID: "log-activity",
		Method:      http.MethodPost,
		Path:        "/v1/persons/{id}/activities",
		Summary:     "Log an interaction against a person",
		Description: "Writes the activity, its target and a timeline entry in one transaction, then " +
			"notifies the workspace so other viewers see it without refreshing.",
		DefaultStatus: http.StatusCreated,
		Tags:          []string{"activity"},
		Middlewares:   middlewares,
	}, func(ctx context.Context, in *LogInput) (*LogOutput, error) {
		p, workspaceID, err := principal(ctx)
		if err != nil {
			return nil, err
		}
		userID, err := uuid.Parse(p.UserID)
		if err != nil {
			return nil, huma.Error500InternalServerError("malformed user id in token")
		}

		if !validKinds[in.Body.Kind] {
			return nil, huma.Error400BadRequest("unknown activity kind")
		}
		if in.Body.Kind == KindEmail && in.Body.Direction == "" {
			return nil, huma.Error400BadRequest("email activities require a direction")
		}

		actor := dbstore.UUIDArg(&userID)
		happensAt := in.Body.HappensAt
		if happensAt == nil {
			now := time.Now().UTC()
			happensAt = &now
		}

		// Built once, before the transaction, and returned verbatim in the 201 so the
		// client sees exactly the row that was written. Hand-assembling a second copy
		// here would let the two drift.
		payload, err := json.Marshal(map[string]any{
			"body":      in.Body.Body,
			"direction": in.Body.Direction,
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("could not encode activity", err)
		}

		var entryID uuid.UUID
		// Distinguishes "no such person in this workspace" from a real failure, so the
		// caller gets a 404 instead of a 500.
		var missing bool

		err = db.Tenant(ctx, p.WorkspaceID, func(tx *sql.Tx) error {
			qtx := queries.WithTx(tx)

			// The existence check MUST run inside this transaction. Queried through the
			// pool it has no app.workspace_id set, RLS matches nothing, and the handler
			// reports 404 for a person that demonstrably exists.
			summary, err := qtx.GetPersonSummary(ctx, dbstore.GetPersonSummaryParams{
				WorkspaceID: workspaceID,
				PersonID:    in.PersonID,
			})
			if errors.Is(err, sql.ErrNoRows) {
				missing = true
				return nil
			}
			if err != nil {
				return err
			}

			activity, err := qtx.CreateActivity(ctx, dbstore.CreateActivityParams{
				WorkspaceID: workspaceID,
				Kind:        in.Body.Kind,
				ActorID:     actor,
				Payload:     payload,
				HappenedAt:  sql.NullTime{Time: *happensAt, Valid: true},
			})
			if err != nil {
				return err
			}

			if _, err := qtx.LinkActivityToPerson(ctx, dbstore.LinkActivityToPersonParams{
				ActivityID:  activity.ID,
				WorkspaceID: workspaceID,
				PersonID:    dbstore.UUIDArg(&in.PersonID),
			}); err != nil {
				return err
			}

			name := joinName(summary.FirstName, summary.LastName)

			// RETURNING only the id, so sqlc collapses this to a bare uuid.UUID.
			inserted, err := qtx.InsertTimelineEntry(ctx, dbstore.InsertTimelineEntryParams{
				WorkspaceID:            workspaceID,
				ActivityID:             activity.ID,
				HappensAt:              *happensAt,
				Kind:                   in.Body.Kind,
				LinkedRecordID:         dbstore.UUIDArg(&in.PersonID),
				LinkedObjectMetadata:   "person",
				LinkedRecordCachedName: dbstore.TextArg(&name),
				TypeSnapshot:           json.RawMessage(`{"label":"` + in.Body.Kind + `"}`),
				Properties:             payload,
				ActorID:                actor,
			})
			if err != nil {
				return err
			}
			entryID = inserted

			if _, err := qtx.RecordEvent(ctx, dbstore.RecordEventParams{
				WorkspaceID: workspaceID,
				Event:       "activity." + in.Body.Kind,
				UserID:      actor,
				EntityType:  reqText("person"),
				EntityID:    dbstore.UUIDArg(&in.PersonID),
				Properties:  payload,
			}); err != nil {
				return err
			}

			return platform.Notify(ctx, tx, workspaceID, platform.Event{
				Entity: "person",
				ID:     in.PersonID.String(),
			})
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("could not log activity", err)
		}
		if missing {
			return nil, huma.Error404NotFound("person not found")
		}

		var out LogOutput
		out.Body.Entry = Entry{
			ID:         entryID,
			HappensAt:  *happensAt,
			Kind:       in.Body.Kind,
			ActorID:    &userID,
			Properties: payload,
		}
		return &out, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "list-timeline",
		Method:      http.MethodGet,
		Path:        "/v1/persons/{id}/timeline",
		Summary:     "Read a person's timeline",
		Description: "Newest first. Keyset-paginated — pass nextCursor back as ?cursor=.",
		Tags:        []string{"activity"},
		Middlewares: middlewares,
	}, func(ctx context.Context, in *TimelineInput) (*TimelineOutput, error) {
		p, workspaceID, err := principal(ctx)
		if err != nil {
			return nil, err
		}

		cursorAt, cursorID, err := decodeCursor(in.Cursor)
		if err != nil {
			return nil, huma.Error400BadRequest("invalid cursor")
		}

		var out TimelineOutput

		err = db.Tenant(ctx, p.WorkspaceID, func(tx *sql.Tx) error {
			qtx := queries.WithTx(tx)

			rows, err := qtx.ListTimeline(ctx, dbstore.ListTimelineParams{
				WorkspaceID: workspaceID,
				RecordID:    dbstore.UUIDArg(&in.PersonID),
				CursorAt:    dbstore.TimeArg(cursorAt),
				CursorID:    dbstore.UUIDArg(cursorID),
				PageLimit:   int32(in.Limit),
			})
			if err != nil {
				return err
			}

			total, err := qtx.CountTimeline(ctx, dbstore.CountTimelineParams{
				WorkspaceID: workspaceID,
				RecordID:    dbstore.UUIDArg(&in.PersonID),
			})
			if err != nil {
				return err
			}

			out.Body.Entries = make([]Entry, 0, len(rows))
			for _, r := range rows {
				out.Body.Entries = append(out.Body.Entries, Entry{
					ID:         r.ID,
					HappensAt:  r.HappensAt,
					Kind:       r.Kind,
					ActorID:    dbstore.UUID(r.ActorID),
					ActorName:  dbstore.Text(r.ActorName),
					Properties: r.Properties,
				})
			}
			out.Body.Total = total

			if len(rows) == in.Limit && len(rows) > 0 {
				last := rows[len(rows)-1]
				out.Body.NextCursor = encodeCursor(last.HappensAt, last.ID)
			}
			return nil
		})
		if err != nil {
			return nil, huma.Error500InternalServerError("could not read timeline", err)
		}

		return &out, nil
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

func joinName(first, last string) string {
	switch {
	case first == "" && last == "":
		return "Unnamed"
	case last == "":
		return first
	case first == "":
		return last
	default:
		return first + " " + last
	}
}

func reqText(s string) sql.NullString {
	return sql.NullString{String: s, Valid: true}
}
