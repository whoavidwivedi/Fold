-- +goose Up
-- Tenant-scope the trigram indexes.
--
-- Every trigram index so far was GIN (column gin_trgm_ops) with no workspace_id. That is
-- correct — RLS still filters the rows — but it means a search trigram-scans across ALL
-- tenants and discards most of what it touched. Cost scaled with total table size rather
-- than with this workspace's size, which is the wrong curve for a product sold per
-- workspace: the first big customer pays for everyone else's rows.
--
-- person_search_idx already did this right (GIN (workspace_id, search_vector)), so this
-- brings the trigram paths in line with it rather than inventing a second convention.
--
-- btree_gin is already installed by 00001, which is what makes workspace_id legal in a
-- GIN index at all.

DROP INDEX IF EXISTS person_email_trgm;
DROP INDEX IF EXISTS person_first_name_trgm;
DROP INDEX IF EXISTS person_last_name_trgm;
DROP INDEX IF EXISTS person_job_title_trgm;
DROP INDEX IF EXISTS company_domain_trgm;

CREATE INDEX person_email_trgm     ON person USING GIN (workspace_id, email gin_trgm_ops)      WHERE deleted_at IS NULL;
CREATE INDEX person_first_name_trgm ON person USING GIN (workspace_id, first_name gin_trgm_ops) WHERE deleted_at IS NULL;
CREATE INDEX person_last_name_trgm  ON person USING GIN (workspace_id, last_name gin_trgm_ops)  WHERE deleted_at IS NULL;
CREATE INDEX person_job_title_trgm  ON person USING GIN (workspace_id, job_title gin_trgm_ops)  WHERE deleted_at IS NULL;

-- company has the same soft-delete column, and every company query filters it, so the
-- partial predicate matches person above rather than the old unfiltered index.
CREATE INDEX company_domain_trgm ON company USING GIN (workspace_id, domain gin_trgm_ops)
    WHERE deleted_at IS NULL AND domain IS NOT NULL;

-- +goose Down
-- Forward-only: going back re-widens the indexes, and the old ones are dropped above.
-- Recreate them by hand if you ever need to:
--   CREATE INDEX person_email_trgm ON person USING GIN (email gin_trgm_ops) WHERE deleted_at IS NULL;