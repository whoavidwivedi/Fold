package activity

import "testing"

// The cursor checks moved to internal/platform: there is one codec now, not one per
// package, and the tests belong next to the code they cover.

func TestJoinName(t *testing.T) {
	cases := []struct{ first, last, want string }{
		{"Ada", "Lovelace", "Ada Lovelace"},
		{"Ada", "", "Ada"},
		{"", "Lovelace", "Lovelace"},
		{"", "", "Unnamed"},
	}
	for _, c := range cases {
		if got := JoinName(c.first, c.last); got != c.want {
			t.Errorf("JoinName(%q, %q) = %q, want %q", c.first, c.last, got, c.want)
		}
	}
}
