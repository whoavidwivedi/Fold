package person

// derefString maps an omitted PATCH field to the empty string, which UpdatePerson
// writes as-is. Safe only because first_name, last_name and lifecycle_stage are NOT NULL
// with empty-string defaults — nullable columns go through dbstore.TextArg instead.
func derefString(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}
