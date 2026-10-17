-- Deal and pipeline queries.
--
-- Same shape as person.sql and company.sql on purpose: workspace-scoped, soft-deleted,
-- searchable, and queried only from inside platform.Tenant. See docs/adr/0005.
--
-- Three rules that live in SQL rather than Go, because the database is the only place they
-- cannot be forgotten:
--
--  1. A deal's probability follows its stage. CreateDeal and UpdateDeal both read it from
--     the stage row, so no client can put a deal in "Closed won" at 25%. The column stays
--     NOT NULL and denormalised because every forecast is a weighted sum over it, and
--     these two statements are its only writers.
--  2. closed_at follows the stage — set on won/lost, cleared otherwise. A reopened deal
--     must not keep the timestamp that said it was closed, or "time to close" counts it as
--     closed since March.
--  3. Stage aggregates are counted in ListStages, not by a second query and not by the
--     client. The number on a column header is then the same sum over the same rows as
--     the cards under it, so it cannot be one refresh behind them.

-- name: ListPipelines :many
SELECT
    p.id, p.key, p.name, p.is_default, p.position, p.created_at, p.updated_at,
    (SELECT count(*)::int FROM stage s
      WHERE s.workspace_id = p.workspace_id AND s.pipeline_id = p.id) AS stage_count,
    (SELECT count(*)::int FROM deal d
      WHERE d.workspace_id = p.workspace_id AND d.pipeline_id = p.id
        AND d.deleted_at IS NULL) AS deal_count
FROM pipeline p
WHERE p.workspace_id = sqlc.arg(workspace_id)
ORDER BY p.position, p.created_at;

-- name: ListStages :many
SELECT
    s.id, s.pipeline_id, s.key, s.name, s.position, s.probability, s.color,
    s.is_won, s.is_lost,
    coalesce(agg.deal_count, 0)::int AS deal_count,
    coalesce(agg.total_value, 0)::float8 AS total_value,
    coalesce(agg.weighted_value, 0)::float8 AS weighted_value
FROM stage s
LEFT JOIN (
    SELECT
        d.stage_id,
        count(*) AS deal_count,
        sum(value) AS total_value,
        -- Weighted value is the forecast every CRM shows: each deal counted at its own
        -- probability, not the stage's. `probability` is redundant with the stage, so
        -- this stays correct when a stage's probability is retuned after deals land in it.
        sum(value * probability / 100.0) AS weighted_value
    FROM deal d
    WHERE d.workspace_id = sqlc.arg(workspace_id)
      AND d.deleted_at IS NULL
      AND d.pipeline_id = sqlc.arg(pipeline_id)
    GROUP BY d.stage_id
) agg ON agg.stage_id = s.id
WHERE s.workspace_id = sqlc.arg(workspace_id)
  AND s.pipeline_id = sqlc.arg(pipeline_id)
ORDER BY s.position;

-- name: ListDeals :many
--
-- The board payload: a deal plus the four names a card prints, joined rather than
-- stitched by four more round trips from the client.
SELECT
    d.id, d.name, d.value::float8 AS value, d.currency, d.probability,
    d.close_date, d.lost_reason, d.closed_at, d.data, d.created_at, d.updated_at,
    d.person_id, d.company_id, d.owner_id, d.pipeline_id, d.stage_id,
    s.name AS stage_name, s.position AS stage_position, s.is_won, s.is_lost,
    c.name AS company_name,
    NULLIF(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')::text AS person_name,
    u.name AS owner_name
FROM deal d
JOIN stage s ON s.id = d.stage_id AND s.workspace_id = d.workspace_id
LEFT JOIN company c ON c.id = d.company_id AND c.workspace_id = d.workspace_id
LEFT JOIN person p ON p.id = d.person_id AND p.workspace_id = d.workspace_id
LEFT JOIN "user" u ON u.id = d.owner_id
WHERE d.workspace_id = sqlc.arg(workspace_id)
  AND d.deleted_at IS NULL
  AND (
      sqlc.narg(pipeline_id)::uuid IS NULL
      OR d.pipeline_id = sqlc.narg(pipeline_id)
  )
  AND (
      sqlc.narg(stage_id)::uuid IS NULL
      OR d.stage_id = sqlc.narg(stage_id)
  )
  AND (
      sqlc.narg(person_id)::uuid IS NULL
      OR d.person_id = sqlc.narg(person_id)
  )
  AND (
      sqlc.narg(company_id)::uuid IS NULL
      OR d.company_id = sqlc.narg(company_id)
  )
  -- The zero uuid is the same sentinel person uses for NO_COMPANY. ownerId cannot be
  -- cleared by omitting the key — omission already means "leave it alone" — so an explicit
  -- zero uuid is how a client unassigns. Without the IS DISTINCT FROM this is a
  -- foreign-key violation, which is a 500 for what is a user action.
  AND (
      sqlc.narg(owner_id)::uuid IS NULL
      OR d.owner_id IS DISTINCT FROM
         NULLIF(sqlc.narg(owner_id), '00000000-0000-0000-0000-000000000000'::uuid)
  )
  AND (
      sqlc.narg(open_only)::boolean IS NULL
      OR (sqlc.narg(open_only) AND s.is_won = false AND s.is_lost = false)
      OR (NOT sqlc.narg(open_only) AND (s.is_won OR s.is_lost))
  )
  AND (
      sqlc.narg(search)::text IS NULL
      OR d.search_vector @@ websearch_to_tsquery('simple', public.unaccent_immutable(sqlc.narg(search)))
      OR d.name ILIKE '%' || sqlc.narg(search) || '%'
      OR c.name ILIKE '%' || sqlc.narg(search) || '%'
  )
  AND (
      sqlc.narg(cursor_at)::timestamptz IS NULL
      OR (d.created_at, d.id) < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::uuid)
  )
ORDER BY d.created_at DESC, d.id DESC
LIMIT sqlc.arg(page_limit);

-- name: CountDeals :one
SELECT count(*)
FROM deal d
JOIN stage s ON s.id = d.stage_id AND s.workspace_id = d.workspace_id
LEFT JOIN company c ON c.id = d.company_id AND c.workspace_id = d.workspace_id
WHERE d.workspace_id = sqlc.arg(workspace_id)
  AND d.deleted_at IS NULL
  AND (
      sqlc.narg(pipeline_id)::uuid IS NULL
      OR d.pipeline_id = sqlc.narg(pipeline_id)
  )
  AND (
      sqlc.narg(person_id)::uuid IS NULL
      OR d.person_id = sqlc.narg(person_id)
  )
  AND (
      sqlc.narg(company_id)::uuid IS NULL
      OR d.company_id = sqlc.narg(company_id)
  )
  AND (
      sqlc.narg(owner_id)::uuid IS NULL
      OR d.owner_id IS DISTINCT FROM
         NULLIF(sqlc.narg(owner_id), '00000000-0000-0000-0000-000000000000'::uuid)
  )
  AND (
      sqlc.narg(open_only)::boolean IS NULL
      OR (sqlc.narg(open_only) AND s.is_won = false AND s.is_lost = false)
      OR (NOT sqlc.narg(open_only) AND (s.is_won OR s.is_lost))
  )
  AND (
      sqlc.narg(search)::text IS NULL
      OR d.search_vector @@ websearch_to_tsquery('simple', public.unaccent_immutable(sqlc.narg(search)))
      OR d.name ILIKE '%' || sqlc.narg(search) || '%'
      OR c.name ILIKE '%' || sqlc.narg(search) || '%'
  );

-- name: GetDeal :one
SELECT
    d.id, d.name, d.value::float8 AS value, d.currency, d.probability,
    d.close_date, d.lost_reason, d.closed_at, d.data, d.created_at, d.updated_at,
    d.person_id, d.company_id, d.owner_id, d.pipeline_id, d.stage_id,
    s.name AS stage_name, s.position AS stage_position, s.is_won, s.is_lost,
    c.name AS company_name,
    NULLIF(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')::text AS person_name,
    u.name AS owner_name
FROM deal d
JOIN stage s ON s.id = d.stage_id AND s.workspace_id = d.workspace_id
LEFT JOIN company c ON c.id = d.company_id AND c.workspace_id = d.workspace_id
LEFT JOIN person p ON p.id = d.person_id AND p.workspace_id = d.workspace_id
LEFT JOIN "user" u ON u.id = d.owner_id
WHERE d.workspace_id = sqlc.arg(workspace_id)
  AND d.id = sqlc.arg(deal_id)
  AND d.deleted_at IS NULL;

-- name: CreateDeal :one
INSERT INTO deal (
    workspace_id, person_id, company_id, pipeline_id, stage_id, owner_id,
    name, value, currency, probability, close_date, lost_reason, data
)
SELECT
    sqlc.arg(workspace_id), sqlc.narg(person_id), sqlc.narg(company_id),
    sqlc.arg(pipeline_id), sqlc.arg(stage_id), sqlc.narg(owner_id),
    sqlc.arg(name), sqlc.arg(value)::numeric, sqlc.arg(currency),
    -- Rule 1: taken from the stage, never from the request.
    s.probability,
    sqlc.narg(close_date), sqlc.narg(lost_reason), sqlc.narg(data),
    s.is_won OR s.is_lost
FROM stage s
WHERE s.workspace_id = sqlc.arg(workspace_id)
  AND s.id = sqlc.arg(stage_id)
  AND s.pipeline_id = sqlc.arg(pipeline_id)
RETURNING id, name, value::float8 AS value, currency, probability, close_date,
          lost_reason, closed_at, data, created_at, updated_at,
          person_id, company_id, owner_id, pipeline_id, stage_id;

-- name: UpdateDeal :one
--
-- Every column is COALESCE'd, so an omitted key leaves it alone. probability and closed_at
-- are the exceptions: neither is writable here, because both follow stage_id in this same
-- statement.
UPDATE deal d
SET name       = COALESCE(sqlc.narg(name), d.name),
    value      = COALESCE(sqlc.narg(value)::numeric, d.value),
    currency   = COALESCE(sqlc.narg(currency), d.currency),
    -- NULLIF because COALESCE reads NULL as "leave it alone", and clearing the close date
    -- is the one case where a client means "no date".
    close_date = CASE
                   WHEN sqlc.narg(close_date)::date IS NULL THEN d.close_date
                   ELSE NULLIF(sqlc.narg(close_date), 'null'::text)::date
               END,
    person_id  = CASE
                   WHEN sqlc.narg(person_id)::uuid IS NULL THEN d.person_id
                   ELSE NULLIF(sqlc.narg(person_id),
                               '00000000-0000-0000-0000-000000000000'::uuid)
               END,
    company_id = CASE
                   WHEN sqlc.narg(company_id)::uuid IS NULL THEN d.company_id
                   ELSE NULLIF(sqlc.narg(company_id),
                               '00000000-0000-0000-0000-000000000000'::uuid)
               END,
    owner_id   = CASE
                   WHEN sqlc.narg(owner_id)::uuid IS NULL THEN d.owner_id
                   ELSE NULLIF(sqlc.narg(owner_id),
                               '00000000-0000-0000-0000-000000000000'::uuid)
               END,
    lost_reason = CASE
                   WHEN sqlc.narg(lost_reason)::text IS NULL THEN d.lost_reason
                   ELSE NULLIF(sqlc.narg(lost_reason), '')
                 END,
    stage_id    = COALESCE(sqlc.narg(stage_id), d.stage_id),
    pipeline_id = COALESCE(sqlc.narg(pipeline_id), d.pipeline_id),
    -- Rule 1. Run on every update rather than only when stage_id is sent, deliberately:
    -- a stage's probability can be retuned after deals are already sitting in it, and the
    -- forecast should follow the retune instead of keeping the old numbers.
    probability = (SELECT s.probability FROM stage s
                   WHERE s.workspace_id = d.workspace_id
                     AND s.id = COALESCE(sqlc.narg(stage_id), d.stage_id)),
    -- Rule 2.
    closed_at   = CASE
                   WHEN (SELECT s.is_won OR s.is_lost FROM stage s
                          WHERE s.workspace_id = d.workspace_id
                            AND s.id = COALESCE(sqlc.narg(stage_id), d.stage_id))
                   THEN COALESCE(d.closed_at, now())
                   ELSE NULL
                 END,
    data        = d.data || sqlc.narg(data),
    updated_at  = now()
WHERE d.workspace_id = sqlc.arg(workspace_id)
  AND d.id = sqlc.arg(deal_id)
  AND d.deleted_at IS NULL
RETURNING id, name, value::float8 AS value, currency, probability, close_date,
          lost_reason, closed_at, data, created_at, updated_at,
          person_id, company_id, owner_id, pipeline_id, stage_id;

-- name: DeleteDeal :exec
UPDATE deal
SET deleted_at = now(), updated_at = now()
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id = sqlc.arg(deal_id)
  AND deleted_at IS NULL;
