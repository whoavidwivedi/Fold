-- +goose Up
-- Extensions and search helpers.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "unaccent";    -- diacritic-insensitive search
CREATE EXTENSION IF NOT EXISTS "btree_gin";   -- composite GIN: (workspace_id, search_vector)
CREATE EXTENSION IF NOT EXISTS "pg_trgm";     -- fuzzy match on email / domain

-- unaccent() is STABLE, not IMMUTABLE, so it cannot be used in a generated column
-- or an index expression. This wrapper pins the dictionary and is safe for both.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.unaccent_immutable(text)
RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
-- +goose StatementEnd

-- The GUC that carries the current workspace. Every RLS policy reads it.
-- Never `current_user`: that is a role, not a tenant, and roles get pooled.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.current_workspace()
RETURNS uuid
LANGUAGE sql STABLE
AS $$ SELECT NULLIF(current_setting('app.workspace_id', TRUE), '')::uuid $$;
-- +goose StatementEnd

-- +goose Down
-- Forward-only. Schema is reverted with `goose down-to 0` from a fresh database or by
-- restoring a backup; destructive rollbacks on a database holding customer data are
-- not something an automated path should be able to do by accident.
