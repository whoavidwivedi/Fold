-- +goose Up
-- Search fixes found by using it.
--
-- The generated tsvector indexes whole lexemes, so searching "northside" did not match
-- an email of marcus@northside.test — the vector holds 'northside.test' as one lexeme.
-- That is correct Postgres behaviour and wrong for a CRM search box, where people type
-- a fragment and expect substring matching on names and domains.
--
-- Fix: keep tsvector for relevance-ranked word matches, and OR it with pg_trgm
-- substring matching. Both are index-backed, so this stays fast rather than becoming a
-- sequential ILIKE scan.

CREATE INDEX person_first_name_trgm ON person USING GIN (first_name gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX person_last_name_trgm  ON person USING GIN (last_name  gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX person_job_title_trgm  ON person USING GIN (job_title  gin_trgm_ops) WHERE deleted_at IS NULL;

-- +goose Down
-- Forward-only. Drop these by hand if they are ever a problem:
--   DROP INDEX person_first_name_trgm;