package activity

import (
	"encoding/base64"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

// The timeline is keyset-paginated on (happens_at, id), so the cursor carries both.
// Opaque to clients: they must not construct one, because the sort key is an internal
// detail that will change.
func encodeCursor(at time.Time, id uuid.UUID) string {
	return base64.RawURLEncoding.EncodeToString(
		[]byte(fmt.Sprintf("%d|%s", at.UnixMicro(), id.String())),
	)
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
		return nil, nil, fmt.Errorf("malformed cursor")
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
