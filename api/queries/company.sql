-- Company queries.
--
-- Same shape as person.sql on purpose. Two lists that behave differently is a bug
-- waiting to happen, and the differences between a person and a company are fields, not
-- behaviour: both are workspace-scoped, keyset-paginated, soft-deleted, searchable, and
-- carry custom fields in JSONB.
--
-- Every statement is called from inside platform.Tenant. See docs/adr/0005.

-- name: ListCompanies :many
SELECT
    c.id, c.name, c.domain, c.industry, c.size, c.location, c.linkedin_url,
    c.data, c.created_at, c.updated_at,
    -- A count per row, not a second query. The workspace is repeated on purpose: this
    -- subquery is the one place a person row is reached without the outer FROM scoping
    -- it, and RLS covers it, but naming the workspace keeps it honest if that ever
    -- changes.
    (SELECT count(*) FROM person p
      WHERE p.workspace_id = c.workspace_id
        AND p.company_id = c.id
        AND p.deleted_at IS NULL) AS people_count
FROM company c
WHERE c.workspace_id = sqlc.arg(workspace_id)
  AND c.deleted_at IS NULL
  AND (
      sqlc.narg(industry)::text IS NULL
      OR c.industry = sqlc.narg(industry)
  )
  -- Two search paths OR'd, same reason as person: the vector ranks whole words, the
  -- trigram matches the fragments people actually type into a company box ("north").
  AND (
      sqlc.narg(search)::text IS NULL
      OR c.search_vector @@ websearch_to_tsquery('simple', public.unaccent_immutable(sqlc.narg(search)))
      OR c.name ILIKE '%' || sqlc.narg(search) || '%'
      OR c.domain ILIKE '%' || sqlc.narg(search) || '%'
  )
  AND (
      sqlc.narg(cursor_at)::timestamptz IS NULL
      OR (c.created_at, c.id) < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::uuid)
  )
ORDER BY c.created_at DESC, c.id DESC
LIMIT sqlc.arg(page_limit);

-- name: CountCompanies :one
SELECT count(*)
FROM company
WHERE workspace_id = sqlc.arg(workspace_id)
  AND deleted_at IS NULL
  AND (
      sqlc.narg(industry)::text IS NULL
      OR industry = sqlc.narg(industry)
  )
  AND (
      sqlc.narg(search)::text IS NULL
      OR search_vector @@ websearch_to_tsquery('simple', public.unaccent_immutable(sqlc.narg(search)))
      OR name ILIKE '%' || sqlc.narg(search) || '%'
      OR domain ILIKE '%' || sqlc.narg(search) || '%'
  );

-- name: GetCompany :one
SELECT
    id, name, domain, industry, size, location, linkedin_url,
    data, created_at, updated_at
FROM company
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id = sqlc.arg(company_id)
  AND deleted_at IS NULL;

-- name: CreateCompany :one
INSERT INTO company (workspace_id, name, domain, industry, size, location, linkedin_url, data)
VALUES (
    sqlc.arg(workspace_id), sqlc.arg(name), sqlc.narg(domain), sqlc.narg(industry),
    sqlc.narg(size), sqlc.narg(location), sqlc.narg(linkedin_url), sqlc.arg(data)
)
RETURNING
    id, name, domain, industry, size, location, linkedin_url, data, created_at, updated_at;

-- name: UpdateCompany :one
UPDATE company
SET
    name         = sqlc.arg(name),
    -- NULLIF so an empty string clears the column instead of storing "". See the note on
    -- UpdatePerson: COALESCE alone makes a field impossible to clear.
    domain       = NULLIF(COALESCE(sqlc.narg(domain), domain), ''),
    industry     = NULLIF(COALESCE(sqlc.narg(industry), industry), ''),
    size         = NULLIF(COALESCE(sqlc.narg(size), size), ''),
    location     = NULLIF(COALESCE(sqlc.narg(location), location), ''),
    linkedin_url = NULLIF(COALESCE(sqlc.narg(linkedin_url), linkedin_url), ''),
    data         = company.data || sqlc.arg(data)::jsonb,
    updated_at   = now()
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id = sqlc.arg(company_id)
  AND deleted_at IS NULL
RETURNING
    id, name, domain, industry, size, location, linkedin_url, data, created_at, updated_at;

-- name: DetachCompanyPeople :exec
-- Soft-deleting a company must detach its contacts, not leave them pointing at a record
-- nothing can resolve. A hard delete already does this (person.company_id is
-- ON DELETE SET NULL); a soft delete that skipped it would leave every contact holding a
-- company_id that renders nowhere — the same dangling reference this API exists to
-- remove. The contacts themselves, and all their history, are untouched.
UPDATE person
SET company_id = NULL, updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id)
  AND company_id = sqlc.arg(company_id)
  AND deleted_at IS NULL;

-- name: SoftDeleteCompany :one
UPDATE company
SET deleted_at = now(), updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id = sqlc.arg(company_id)
  AND deleted_at IS NULL
RETURNING id;

-- name: CountCompanyPeople :one
SELECT count(*) FROM person
WHERE workspace_id = sqlc.arg(workspace_id)
  AND company_id = sqlc.arg(company_id)
  AND deleted_at IS NULL;