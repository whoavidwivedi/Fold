-- +goose Up
-- Activity, metadata, and the analytics event log.
--
-- Activity is two-layered on purpose (docs/adr/0004 and the Twenty CRM pattern):
--   WRITE side  activity + activity_target  — normalized, real FKs, cascades
--   READ  side  timeline_activity           — denormalized, renders with zero joins
-- One activity write, two inserts. Cheap read, honest writes.

-- ---------------------------------------------------------------------------
-- activity — one append-only row per thing that happened
-- ---------------------------------------------------------------------------
CREATE TABLE activity (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    kind         text NOT NULL,              -- note | email | call | task | stage_change | field_change | …
    actor_id     uuid REFERENCES public."user"(id) ON DELETE SET NULL,
    payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
    happened_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_keyset_idx ON activity (workspace_id, happened_at DESC, id DESC);

-- Polymorphic target, Twenty-style: explicit nullable FKs rather than an
-- (object_type, object_id) pair. We get real referential integrity, real cascades,
-- and cheap single-column indexes instead of a discriminator on every query.
-- Cost: a migration whenever a new targetable object type is introduced.
CREATE TABLE activity_target (
    activity_id          uuid NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
    workspace_id         uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    discriminator        text NOT NULL,
    target_person_id     uuid REFERENCES person(id) ON DELETE CASCADE,
    target_company_id    uuid REFERENCES company(id) ON DELETE CASCADE,
    target_deal_id       uuid REFERENCES deal(id) ON DELETE CASCADE,
    PRIMARY KEY (activity_id, discriminator)
);

CREATE INDEX activity_target_person_idx  ON activity_target (workspace_id, target_person_id)  WHERE target_person_id IS NOT NULL;
CREATE INDEX activity_target_company_idx ON activity_target (workspace_id, target_company_id) WHERE target_company_id IS NOT NULL;
CREATE INDEX activity_target_deal_idx    ON activity_target (workspace_id, target_deal_id)    WHERE target_deal_id IS NOT NULL;

-- The read model. linked_record_cached_name is denormalized precisely so rendering a
-- timeline needs no join — that is the whole reason this table exists.
CREATE TABLE timeline_activity (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id            uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    activity_id             uuid NOT NULL REFERENCES activity(id) ON DELETE CASCADE,
    happens_at              timestamptz NOT NULL,
    kind                    text NOT NULL,
    linked_record_id        uuid,
    linked_object_metadata  text NOT NULL,
    linked_record_cached_name text,
    type_snapshot           jsonb NOT NULL DEFAULT '{}'::jsonb,
    properties              jsonb NOT NULL DEFAULT '{}'::jsonb,
    actor_id                uuid REFERENCES public."user"(id) ON DELETE SET NULL
);
CREATE INDEX timeline_activity_keyset_idx ON timeline_activity (workspace_id, happens_at DESC, id DESC);
CREATE INDEX timeline_activity_record_idx  ON timeline_activity (workspace_id, linked_record_id, happens_at DESC);
CREATE INDEX timeline_activity_actor_idx   ON timeline_activity (workspace_id, actor_id, happens_at DESC);

-- ---------------------------------------------------------------------------
-- event — the analytics and AI substrate.
--
-- Shape borrowed from Twenty's ClickHouse stream, kept in Postgres because we are
-- nowhere near the scale that justifies a second engine. workspace_id is FIRST in
-- the sort key so every tenant-scoped query is a prefix scan.
--
-- A current-state table cannot answer "funnel for leads created in March". An
-- append-only event log can. Build it now, before there is history to backfill.
-- ---------------------------------------------------------------------------
CREATE TABLE event (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    event        text NOT NULL,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    user_id      uuid REFERENCES public."user"(id) ON DELETE SET NULL,
    entity_type  text,
    entity_id    uuid,
    properties   jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX event_keyset_idx ON event (workspace_id, occurred_at DESC, id DESC);
CREATE INDEX event_name_idx    ON event (workspace_id, event, occurred_at DESC);
CREATE INDEX event_entity_idx  ON event (workspace_id, entity_type, entity_id, occurred_at DESC);
CREATE INDEX event_props_idx   ON event USING GIN (properties);

-- ---------------------------------------------------------------------------
-- field_definition — metadata ABOUT fields, including the fixed physical ones.
-- Renaming a label, reordering, hiding from a role: all a row update, never DDL.
-- ---------------------------------------------------------------------------
CREATE TABLE field_definition (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    object_type  text NOT NULL,            -- person | company | deal | <custom object key>
    key          text NOT NULL,
    label        text NOT NULL,
    data_type    text NOT NULL,            -- text | textarea | number | currency | date | select |
                                           -- multi_select | checkbox | user | company | url | phone | rating
    options      jsonb NOT NULL DEFAULT '[]'::jsonb,
    group_name   text,
    position     integer NOT NULL DEFAULT 0,
    required     boolean NOT NULL DEFAULT false,
    hidden_roles text[] NOT NULL DEFAULT '{}',
    is_promoted  boolean NOT NULL DEFAULT false,  -- true once it has a real column or index
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, object_type, key)
);
CREATE INDEX field_definition_order_idx ON field_definition (workspace_id, object_type, position);

-- ---------------------------------------------------------------------------
-- object_definition — runtime custom objects, reusing the same JSONB machinery
-- ---------------------------------------------------------------------------
CREATE TABLE object_definition (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    key          text NOT NULL,
    name_singular text NOT NULL,
    name_plural  text NOT NULL,
    description  text,
    icon         text,
    position     integer NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, key)
);

CREATE TABLE object_record (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id  uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    object_key    text NOT NULL,
    name          text NOT NULL,
    data          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    deleted_at    timestamptz
);
CREATE INDEX object_record_keyset_idx ON object_record (workspace_id, object_key, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX object_record_data_idx   ON object_record USING GIN (data);

-- ---------------------------------------------------------------------------
-- saved_view — a user's filter/sort/column preset for a list. Per-user, not
-- per-workspace: two reps want different columns out of the same pipeline.
-- ---------------------------------------------------------------------------
CREATE TABLE saved_view (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    user_id      uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    object_type  text NOT NULL,
    name         text NOT NULL,
    is_default   boolean NOT NULL DEFAULT false,
    filters      jsonb NOT NULL DEFAULT '[]'::jsonb,
    sorts        jsonb NOT NULL DEFAULT '[]'::jsonb,
    columns      jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, user_id, object_type, name)
);
CREATE INDEX saved_view_list_idx ON saved_view (workspace_id, user_id, object_type);

-- +goose Down
-- Forward-only. Schema is reverted with `goose down-to 0` from a fresh database or by
-- restoring a backup; destructive rollbacks on a database holding customer data are
-- not something an automated path should be able to do by accident.
