// Package migrations embeds the SQL migrations into the binary so a single file can
// deploy and self-migrate on boot.
//
// Concurrent runs are safe because platform.Migrate takes a Postgres advisory lock first
// — goose v3.29 does not take one itself. Do not remove that lock.
package migrations

import "embed"

//go:embed *.sql
var FS embed.FS
