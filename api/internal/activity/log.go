package activity

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	"fold/api/internal/dbstore"
)

// Log is the single writer for the activity log.
//
// Both the explicit endpoint and the implicit system events (a stage moved, a field
// edited) go through here. There is exactly one place that knows an activity is three
// rows; a second copy would drift, and the feed is only trustworthy if all of it lands
// the same way.
//
// It must be called from inside platform.Tenant — the caller owns the transaction, which
// is what lets this share the caller's atomicity: a stage change and its timeline entry
// commit together or not at all.
type Log struct {
	WorkspaceID uuid.UUID
	PersonID    uuid.UUID
	// RecordName is denormalized onto the timeline row so the feed renders without
	// joining back onto person.
	RecordName string
	Kind       string
	ActorID    *uuid.UUID
	HappensAt  time.Time
	Properties json.RawMessage
}

// Write inserts the activity, its target and the timeline entry.
func (l Log) Write(ctx context.Context, qtx *dbstore.Queries) (uuid.UUID, error) {
	actor := dbstore.UUIDArg(l.ActorID)

	row, err := qtx.CreateActivity(ctx, dbstore.CreateActivityParams{
		WorkspaceID: l.WorkspaceID,
		Kind:        l.Kind,
		ActorID:     actor,
		Payload:     l.Properties,
		HappenedAt:  sql.NullTime{Time: l.HappensAt, Valid: true},
	})
	if err != nil {
		return uuid.Nil, err
	}

	if _, err := qtx.LinkActivityToPerson(ctx, dbstore.LinkActivityToPersonParams{
		ActivityID:  row.ID,
		WorkspaceID: l.WorkspaceID,
		PersonID:    dbstore.UUIDArg(&l.PersonID),
	}); err != nil {
		return uuid.Nil, err
	}

	name := l.RecordName
	entryID, err := qtx.InsertTimelineEntry(ctx, dbstore.InsertTimelineEntryParams{
		WorkspaceID:            l.WorkspaceID,
		ActivityID:             row.ID,
		HappensAt:              l.HappensAt,
		Kind:                   l.Kind,
		LinkedRecordID:         dbstore.UUIDArg(&l.PersonID),
		LinkedObjectMetadata:   "person",
		LinkedRecordCachedName: dbstore.TextArg(&name),
		TypeSnapshot:           json.RawMessage(`{"label":"` + l.Kind + `"}`),
		Properties:             l.Properties,
		ActorID:                actor,
	})
	if err != nil {
		return uuid.Nil, err
	}

	return entryID, nil
}
