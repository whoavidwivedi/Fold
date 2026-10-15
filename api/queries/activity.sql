-- Activity queries.
--
-- Two layers, deliberately (see docs/adr/0004 and the Twenty CRM pattern):
--   activity + activity_target   the authoritative record, with real foreign keys
--   timeline_activity           the read model the feed renders from, denormalized
--
-- One log call writes three rows. That buys an O(1) feed read with no joins, which is
-- what a timeline is: the same handful of rows, over and over, while someone works.

-- name: CreateActivity :one
INSERT INTO activity (workspace_id, kind, actor_id, payload, happened_at)
VALUES (
    sqlc.arg(workspace_id),
    sqlc.arg(kind),
    sqlc.narg(actor_id),
    sqlc.arg(payload),
    COALESCE(sqlc.narg(happened_at)::timestamptz, now())
)
RETURNING id, kind, payload, happened_at;

-- name: LinkActivityToPerson :one
INSERT INTO activity_target (activity_id, workspace_id, discriminator, target_person_id)
VALUES (sqlc.arg(activity_id), sqlc.arg(workspace_id), 'person', sqlc.arg(person_id))
ON CONFLICT DO NOTHING
RETURNING activity_id;

-- name: InsertTimelineEntry :one
INSERT INTO timeline_activity (
    workspace_id, activity_id, happens_at, kind,
    linked_record_id, linked_object_metadata, linked_record_cached_name,
    type_snapshot, properties, actor_id
)
VALUES (
    sqlc.arg(workspace_id), sqlc.arg(activity_id), sqlc.arg(happens_at), sqlc.arg(kind),
    sqlc.arg(linked_record_id), sqlc.arg(linked_object_metadata),
    sqlc.arg(linked_record_cached_name), sqlc.arg(type_snapshot),
    sqlc.arg(properties), sqlc.narg(actor_id)
)
RETURNING id;

-- name: ListTimeline :many
-- The feed read. Denormalized on purpose: linked_record_cached_name exists so a timeline
-- row renders with no join onto the record, and the LEFT JOIN onto auth."user" only adds
-- the actor's display name for a row already scoped to this workspace.
SELECT
    t.id,
    t.happens_at,
    t.kind,
    t.linked_record_id,
    t.linked_object_metadata,
    t.linked_record_cached_name,
    t.properties,
    t.actor_id,
    u.name AS actor_name,
    u.image AS actor_image
FROM timeline_activity t
LEFT JOIN "user" u ON u.id = t.actor_id
WHERE t.workspace_id = sqlc.arg(workspace_id)
  AND t.linked_record_id = sqlc.arg(record_id)
  AND (sqlc.narg(cursor_at)::timestamptz IS NULL
       OR (t.happens_at, t.id) < (sqlc.narg(cursor_at)::timestamptz, sqlc.narg(cursor_id)::uuid))
ORDER BY t.happens_at DESC, t.id DESC
LIMIT sqlc.arg(page_limit);

-- name: CountTimeline :one
SELECT count(*)
FROM timeline_activity
WHERE workspace_id = sqlc.arg(workspace_id)
  AND linked_record_id = sqlc.arg(record_id);

-- name: GetPersonSummary :one
-- Exists so the drawer can title itself without a second round trip, and so a stage change
-- can be logged with the name it had before the edit.
SELECT first_name, last_name, lifecycle_stage
FROM person
WHERE workspace_id = sqlc.arg(workspace_id)
  AND id = sqlc.arg(person_id)
  AND deleted_at IS NULL;