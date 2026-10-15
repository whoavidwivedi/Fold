package person

import (
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// The keyset cursor is an opaque base64 of "<unixMicros>|<uuid>". Clients must treat it
// as opaque — it encodes a sort key, and exposing that invites callers to construct
// their own, which silently breaks if the sort ever changes.

func encodeCursor(at time.Time, id uuid.UUID) string {
	raw := fmt.Sprintf("%d|%s", at.UnixMicro(), id.String())
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeCursor(cursor string) (*time.Time, *uuid.UUID, error) {
	if cursor == "" {
		return nil, nil, nil
	}

	raw, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return nil, nil, err
	}

	micros, idStr, ok := strings.Cut(string(raw), "|")
	if !ok {
		return nil, nil, fmt.Errorf("malformed cursor payload")
	}

	var microsN int64
	if _, err := fmt.Sscanf(micros, "%d", &microsN); err != nil {
		return nil, nil, fmt.Errorf("malformed cursor timestamp")
	}

	id, err := uuid.Parse(idStr)
	if err != nil {
		return nil, nil, fmt.Errorf("malformed cursor id")
	}

	at := time.UnixMicro(microsN).UTC()
	return &at, &id, nil
}

// derefString maps an omitted PATCH field to the empty string, which UpdatePerson
// writes as-is. Safe only because first_name, last_name and lifecycle_stage are NOT NULL
// with empty-string defaults — nullable columns go through dbstore.TextArg instead.
func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
