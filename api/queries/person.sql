-- Person queries. See docs/adr/0005 — one person table, no lead/contact split.
--
-- Every statement is called from inside platform.Tenant, which sets app.workspace_id.
-- RLS filters the rows regardless, so a forgotten WHERE clause yields zero rows rather
-- than another tenant's data. workspace_id is still passed explicitly because it keeps
-- the index prefix intact.
--
-- Parameters are named with sqlc.arg() rather than positionally, so the generated Go
-- struct has readable fields instead of Column2, Column3.
--
-- Pagination is keyset, never OFFSET: OFFSET degrades linearly and skips or duplicates
-- rows when the underlying set changes between page requests.

-- name: ListPersons :many
SELECT
    id, company_id, first_name, last_name, email, phone, job_title,
    lifecycle_stage, source, owner_id, score, score_fit, score_intent,
    data, created_at, updated_at
FROM person
WHERE workspace_id = sqlc.arg(workspace_id)
  AND deleted_at IS NULL
  AND (
      sqlc.narg(lifecycle_stage)::text IS NULL          -- no filter when NULL
      OR lifecycle_stage = sqlc.narg(lifecycle_stage)
  )
  AND (
      sqlc.narg(owner_id)::uuid IS NULL
      OR owner_id = sqlc.narg(owner_id)
  )
  AND (
      sqlc.narg(company_id)::uuid IS NULL
      OR company_id = sqlc.narg(company_id)
  )
  -- Search is two paths OR'd together, because they answer different questions.
  --   tsvector  relevance-ranked word matches ("delgado", "northside.test")
  --   pg_trgm   substring fragments people actually type ("north", "marcus@")
  -- A tsvector-only search fails on "northside" because the vector stores the whole
  -- domain as one lexeme. An ILIKE-only search has no ranking. Both paths are indexed.
  AND (
      sqlc.narg(search)::text IS NULL
      OR search_vector @@ websearch_to_tsquery('simple', public.unaccent_immutable(sqlc.narg(search)))
      OR email ILIKE '%' || sqlc.narg(search) || '%'
      OR first_name ILIKE '%' || sqlc.narg(search) || '%'
      OR last_name ILIKE '%' || sqlc.narg(search) || '%'
  )
  -- Keyset cursor. Both halves are required: id alone would force a full sort.
  AND (
      sqlc.narg(cursor_at)::timestamptz IS NULL
      OR (created_at, id) < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::uuid)
  )
ORDER BY created_at DESC, id DESC
LIMIT sqlc.arg(page_limit);

-- name: CountPersons :one
SELECT count(*)
FROM person
WHERE workspace_id = sqlc.arg(workspace_id)
  AND deleted_at IS NULL
  AND (
      sqlc.narg(lifecycle_stage)::text IS NULL OR lifecycle_stage = sqlc.narg(lifecycle_stage)
  )
  AND (
      sqlc.narg(owner_id)::uuid IS NULL OR owner_id = sqlc.narg(owner_id)
  )
  AND (
      sqlc.narg(company_id)::uuid IS NULL OR company_id = sqlc.narg(company_id)
  )
  -- Search is two paths OR'd together, because they answer different questions.
  --   tsvector  relevance-ranked word matches ("delgado", "northside.test")
  --   pg_trgm   substring fragments people actually type ("north", "marcus@")
  -- A tsvector-only search fails on "northside" because the vector stores the whole
  -- domain as one lexeme. An ILIKE-only search has no ranking. Both paths are indexed.
  AND (
      sqlc.narg(search)::text IS NULL
      OR search_vector @@ websearch_to_tsquery('simple', public.unaccent_immutable(sqlc.narg(search)))
      OR email ILIKE '%' || sqlc.narg(search) || '%'
      OR first_name ILIKE '%' || sqlc.narg(search) || '%'
      OR last_name ILIKE '%' || sqlc.narg(search) || '%'
  );

-- name: GetPerson :one
SELECT
    id, company_id, first_name, last_name, email, phone, job_title,
    lifecycle_stage, source, owner_id, score, score_fit, score_intent,
    data, created_at, updated_at
FROM person
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id = sqlc.arg(person_id)
  AND deleted_at IS NULL;

-- name: CreatePerson :one
INSERT INTO person (
    workspace_id, company_id, first_name, last_name, email, phone, job_title,
    lifecycle_stage, source, owner_id, data
)
VALUES (
    sqlc.arg(workspace_id), sqlc.narg(company_id), sqlc.arg(first_name), sqlc.arg(last_name),
    sqlc.narg(email), sqlc.narg(phone), sqlc.narg(job_title), sqlc.arg(lifecycle_stage),
    sqlc.narg(source), sqlc.narg(owner_id), sqlc.arg(data)
)
RETURNING
    id, company_id, first_name, last_name, email, phone, job_title,
    lifecycle_stage, source, owner_id, score, score_fit, score_intent,
    data, created_at, updated_at;

-- name: UpdatePerson :one
UPDATE person
SET
    -- The zero uuid means "unassign". A uuid column has no empty string, so clearing a
    -- company had no expressible value: omitting the key means "leave alone" and "" is
    -- rejected as a malformed uuid before this statement runs. A sentinel is the cheapest
    -- way to give PATCH three states instead of two.
    company_id       = CASE
                            WHEN sqlc.narg(company_id) = '00000000-0000-0000-0000-000000000000'::uuid
                            THEN NULL
                            ELSE COALESCE(sqlc.narg(company_id), company_id)
                        END,
    -- COALESCE, not a bare assignment. A bare `first_name = $1` means a PATCH that omits
    -- the name writes an empty string, so `{"lifecycleStage": "customer"}` silently
    -- erased the lead's name — and the drawer does exactly that when you attach a company.
    -- The read path renders an empty name as "Unnamed", which is how it reached a customer
    -- record with a real email and no person attached to it.
    --
    -- These three cannot be cleared, deliberately: first_name, last_name and
    -- lifecycle_stage are NOT NULL, and a lead with no name cannot be found again.
    first_name       = COALESCE(sqlc.narg(first_name), first_name),
    last_name        = COALESCE(sqlc.narg(last_name), last_name),
    -- NULLIF turns "" into NULL after the COALESCE, which is what makes clearing a field
    -- possible at all. Without it the statement has only two states — NULL means "leave
    -- alone", so a rep who cleared a phone number could only ever store an empty string,
    -- never remove it. Sending "" now stores NULL, which is also the value the read path
    -- renders as "—".
    email            = NULLIF(COALESCE(sqlc.narg(email), email), ''),
    phone            = NULLIF(COALESCE(sqlc.narg(phone), phone), ''),
    job_title        = NULLIF(COALESCE(sqlc.narg(job_title), job_title), ''),
    lifecycle_stage  = COALESCE(sqlc.narg(lifecycle_stage), lifecycle_stage),
    source           = NULLIF(COALESCE(sqlc.narg(source), source), ''),
    owner_id         = COALESCE(sqlc.narg(owner_id), owner_id),
    -- Score was three columns every handler read and nothing wrote, so a 20k-row list
    -- rendered a column of nothing. These are NOT NULL DEFAULT 0, so COALESCE is the
    -- whole story: NULL means "leave alone" and there is no clearing case to solve.
    score            = COALESCE(sqlc.narg(score), score),
    score_fit        = COALESCE(sqlc.narg(score_fit), score_fit),
    score_intent     = COALESCE(sqlc.narg(score_intent), score_intent),
    data             = person.data || sqlc.arg(data)::jsonb,
    updated_at       = now()
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id = sqlc.arg(person_id)
  AND deleted_at IS NULL
RETURNING
    id, company_id, first_name, last_name, email, phone, job_title,
    lifecycle_stage, source, owner_id, score, score_fit, score_intent,
    data, created_at, updated_at;

-- name: DeletePerson :one
UPDATE person
SET deleted_at = now(), updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id = sqlc.arg(person_id)
  AND deleted_at IS NULL
RETURNING id;

-- name: RecordEvent :one
INSERT INTO event (workspace_id, event, user_id, entity_type, entity_id, properties)
VALUES (
    sqlc.arg(workspace_id), sqlc.arg(event), sqlc.narg(user_id),
    sqlc.narg(entity_type), sqlc.narg(entity_id), sqlc.arg(properties)
)
RETURNING id, occurred_at;