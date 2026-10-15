package platform

import (
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// Keyset cursors, used by every list endpoint.
//
// One implementation because there were already two byte-identical copies — person and
// activity each grew their own, and company would have been the third. A codec that
// drifts between endpoints is a paging bug nobody can reproduce, because the bug lives
// in whichever endpoint drifted.
//
// The cursor is an opaque base64 of "<unixMicros>|<uuid>". Clients must treat it as
// opaque: it encodes a sort key, and exposing that invites callers to construct their
// own, which silently breaks if the sort ever changes.

// EncodeCursor packs a sort key into an opaque cursor.
func EncodeCursor(at time.Time, id uuid.UUID) string {
	raw := fmt.Sprintf("%d|%s", at.UnixMicro(), id.String())
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// DecodeCursor unpacks a cursor. An empty cursor returns (nil, nil, nil), which is what
// makes the SQL's "IS NULL OR ..." branch skip the keyset predicate entirely on page one.
//
// A malformed cursor is an error rather than "start from the beginning": silently
// ignoring it would leave a caller asking for the first page forever.
func DecodeCursor(cursor string) (*time.Time, *uuid.UUID, error) {
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

	// Microseconds, not seconds: happens_at and created_at carry sub-second precision,
	// and a cursor that rounds it makes consecutive pages overlap or skip rows.
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
