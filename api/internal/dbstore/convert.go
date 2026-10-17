package dbstore

import (
	"database/sql"
	"time"

	"github.com/google/uuid"
)

// Conversions between sqlc's database/sql null wrappers and plain Go types.
//
// sqlc emits sql.NullString / uuid.NullUUID for nullable columns and query parameters.
// Handlers should not juggle those, so they are converted here — once — rather than at
// every call site.

// UUID converts a nullable uuid column to *uuid.UUID, where NULL is nil.
func UUID(v uuid.NullUUID) *uuid.UUID {
	if !v.Valid {
		return nil
	}
	id := v.UUID
	return &id
}

// UUIDArg converts a *uuid.UUID into the form a query parameter expects.
// A nil pointer means "no filter", which is what the SQL's IS NULL branches test.
func UUIDArg(v *uuid.UUID) uuid.NullUUID {
	if v == nil {
		return uuid.NullUUID{}
	}
	return uuid.NullUUID{UUID: *v, Valid: true}
}

// Text converts a nullable text column to *string, where NULL is nil.
func Text(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}

// TextArg converts a *string into the form a query parameter expects.
func TextArg(v *string) sql.NullString {
	if v == nil {
		return sql.NullString{}
	}
	return sql.NullString{String: *v, Valid: true}
}

// IntArg converts a *int32 into the form a query parameter expects. Same contract as
// TextArg: an invalid value is NULL, which every COALESCE in the queries reads as
// "leave this column alone".
func IntArg(v *int32) sql.NullInt32 {
	if v == nil {
		return sql.NullInt32{}
	}
	return sql.NullInt32{Int32: *v, Valid: true}
}

// TimeArg converts a *time.Time into the form a query parameter expects.
func TimeArg(v *time.Time) sql.NullTime {
	if v == nil {
		return sql.NullTime{}
	}
	return sql.NullTime{Time: *v, Valid: true}
}
