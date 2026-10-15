// Package migrations embeds the SQL migrations into the binary so a single file can
// deploy and self-migrate on boot. goose takes an advisory lock, so running this from
// every replica at once is safe.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
