package activity

import (
	"testing"
	"time"

	"github.com/google/uuid"
)

func TestCursorRoundTrip(t *testing.T) {
	// Sub-second precision matters: happens_at carries microseconds, and a cursor that
	// rounds them off makes the next page overlap or skip entries at a page boundary.
	at := time.Date(2026, 10, 15, 19, 48, 1, 189959000, time.UTC)
	id := uuid.MustParse("781565d7-65c3-4642-a853-99102c9f2d52")

	gotAt, gotID, err := decodeCursor(encodeCursor(at, id))
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !gotAt.Equal(at) {
		t.Errorf("timestamp: got %v, want %v", gotAt, at)
	}
	if *gotID != id {
		t.Errorf("id: got %v, want %v", gotID, id)
	}
}

func TestCursorEmptyMeansNoFilter(t *testing.T) {
	// The empty cursor is the first page. Returning (nil, nil, nil) is what makes the
	// SQL's "IS NULL OR ..." branch skip the keyset predicate entirely.
	at, id, err := decodeCursor("")
	if err != nil || at != nil || id != nil {
		t.Fatalf("got (%v, %v, %v), want (nil, nil, nil)", at, id, err)
	}
}

func TestCursorRejectsGarbage(t *testing.T) {
	// A bad cursor must error rather than silently return page one: the caller would
	// loop forever asking for the first page again.
	for _, bad := range []string{"!!!not-base64", "bm9waXBl", "MTIzf", "MTIzfHw"} {
		if _, _, err := decodeCursor(bad); err == nil {
			t.Errorf("decodeCursor(%q) accepted garbage, want error", bad)
		}
	}
}

func TestJoinName(t *testing.T) {
	cases := []struct{ first, last, want string }{
		{"Ada", "Lovelace", "Ada Lovelace"},
		{"Ada", "", "Ada"},
		{"", "Lovelace", "Lovelace"},
		{"", "", "Unnamed"},
	}
	for _, c := range cases {
		if got := joinName(c.first, c.last); got != c.want {
			t.Errorf("joinName(%q, %q) = %q, want %q", c.first, c.last, got, c.want)
		}
	}
}
