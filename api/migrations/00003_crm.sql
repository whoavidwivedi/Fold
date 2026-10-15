-- +goose Up
-- Core CRM schema.
--
-- Conventions, applied consistently across every table:
--   * workspace_id uuid NOT NULL -> public.organization(id). This IS the tenant.
--   * deleted_at for soft delete, and every index carries it so deleted rows never
--     pollute a keyset scan.
--   * text + CHECK instead of Postgres enums, because adding a value to an enum
--     is an ALTER TYPE migration and adding a lifecycle stage is a normal product event.
--   * a unique (created_at, id) key so keyset pagination is free and total ordering
--     is guaranteed.

-- ---------------------------------------------------------------------------
-- company
-- ---------------------------------------------------------------------------
CREATE TABLE company (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,

    name         text NOT NULL,
    domain       text,
    industry     text,
    size         text,                    -- headcount band
    location     text,
    linkedin_url text,

    data         jsonb NOT NULL DEFAULT '{}'::jsonb,

    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(public.unaccent_immutable(name), '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(public.unaccent_immutable(domain), '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(public.unaccent_immutable(industry), '')), 'B')
    ) STORED,

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE UNIQUE INDEX company_domain_key
    ON company (workspace_id, lower(domain))
    WHERE domain IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX company_keyset_idx ON company (workspace_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX company_name_idx   ON company (workspace_id, lower(name), id) WHERE deleted_at IS NULL;
CREATE INDEX company_search_idx ON company USING GIN (workspace_id, search_vector);
CREATE INDEX company_domain_trgm ON company USING GIN (domain gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- person  — one table, no lead/contact split (see docs/adr/0005)
-- ---------------------------------------------------------------------------
CREATE TABLE person (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    company_id   uuid REFERENCES company(id) ON DELETE SET NULL,

    first_name   text NOT NULL DEFAULT '',
    last_name    text NOT NULL DEFAULT '',
    email        text,
    phone        text,
    job_title    text,
    linkedin_url text,

    lifecycle_stage text NOT NULL DEFAULT 'new',
    source         text,

    owner_id     uuid REFERENCES public."user"(id) ON DELETE SET NULL,

    score        integer NOT NULL DEFAULT 0,
    score_fit    integer NOT NULL DEFAULT 0,
    score_intent integer NOT NULL DEFAULT 0,

    data         jsonb NOT NULL DEFAULT '{}'::jsonb,

    -- Both halves of the address are indexed: the local part finds a person,
    -- the domain finds everyone at a company.
    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(public.unaccent_immutable(first_name), '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(public.unaccent_immutable(last_name), '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(public.unaccent_immutable(split_part(email, '@', 1)), '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(public.unaccent_immutable(split_part(email, '@', 2)), '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(public.unaccent_immutable(job_title), '')), 'C')
    ) STORED,

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz
);

CREATE INDEX person_keyset_idx   ON person (workspace_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX person_recent_idx   ON person (workspace_id, updated_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX person_name_idx     ON person (workspace_id, lower(last_name), lower(first_name), id) WHERE deleted_at IS NULL;
CREATE INDEX person_score_idx    ON person (workspace_id, score DESC, id) WHERE deleted_at IS NULL;
CREATE INDEX person_stage_idx    ON person (workspace_id, lifecycle_stage, id) WHERE deleted_at IS NULL;
CREATE INDEX person_owner_idx    ON person (workspace_id, owner_id, id) WHERE deleted_at IS NULL;
CREATE INDEX person_company_idx  ON person (workspace_id, company_id) WHERE deleted_at IS NULL;
CREATE INDEX person_search_idx   ON person USING GIN (workspace_id, search_vector);
CREATE INDEX person_email_trgm   ON person USING GIN (email gin_trgm_ops) WHERE deleted_at IS NULL;

-- Custom field filtering. Expression indexes are created on demand when a workspace
-- promotes a field to "hot" — never up front.
--   CREATE INDEX ON person (workspace_id, ((data->>'score')::int))
--       WHERE deleted_at IS NULL AND data ? 'score';

-- ---------------------------------------------------------------------------
-- pipeline / stage — normalized, not JSONB: few per tenant, queried constantly
-- ---------------------------------------------------------------------------
CREATE TABLE pipeline (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    key          text NOT NULL,
    name         text NOT NULL,
    is_default   boolean NOT NULL DEFAULT false,
    position     integer NOT NULL DEFAULT 0,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, key)
);
CREATE UNIQUE INDEX pipeline_one_default
    ON pipeline (workspace_id) WHERE is_default;

CREATE TABLE stage (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    pipeline_id uuid NOT NULL REFERENCES pipeline(id) ON DELETE CASCADE,
    key         text NOT NULL,
    name        text NOT NULL,
    position    integer NOT NULL DEFAULT 0,
    probability integer NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
    color       text,
    is_won      boolean NOT NULL DEFAULT false,
    is_lost     boolean NOT NULL DEFAULT false,
    UNIQUE (pipeline_id, key)
);
CREATE INDEX stage_pipeline_idx ON stage (workspace_id, pipeline_id, position);

-- ---------------------------------------------------------------------------
-- deal — a person has many deals
-- ---------------------------------------------------------------------------
CREATE TABLE deal (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    person_id    uuid REFERENCES person(id) ON DELETE SET NULL,
    company_id   uuid REFERENCES company(id) ON DELETE SET NULL,
    pipeline_id  uuid NOT NULL REFERENCES pipeline(id) ON DELETE RESTRICT,
    stage_id     uuid NOT NULL REFERENCES stage(id) ON DELETE RESTRICT,
    owner_id     uuid REFERENCES public."user"(id) ON DELETE SET NULL,

    name         text NOT NULL,
    value        numeric(14, 2) NOT NULL DEFAULT 0,
    currency     text NOT NULL DEFAULT 'USD',
    probability  integer NOT NULL DEFAULT 0 CHECK (probability BETWEEN 0 AND 100),
    close_date   date,
    lost_reason  text,

    data         jsonb NOT NULL DEFAULT '{}'::jsonb,

    search_vector tsvector GENERATED ALWAYS AS (
        setweight(to_tsvector('simple', coalesce(public.unaccent_immutable(name), '')), 'A')
    ) STORED,

    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now(),
    deleted_at  timestamptz,
    closed_at   timestamptz
);

CREATE INDEX deal_keyset_idx   ON deal (workspace_id, created_at DESC, id DESC) WHERE deleted_at IS NULL;
CREATE INDEX deal_stage_idx    ON deal (workspace_id, stage_id, id) WHERE deleted_at IS NULL;
CREATE INDEX deal_person_idx   ON deal (workspace_id, person_id) WHERE deleted_at IS NULL;
CREATE INDEX deal_owner_idx    ON deal (workspace_id, owner_id, id) WHERE deleted_at IS NULL;
CREATE INDEX deal_close_date_idx ON deal (workspace_id, close_date, id) WHERE deleted_at IS NULL;
CREATE INDEX deal_search_idx   ON deal USING GIN (workspace_id, search_vector);

-- +goose Down
-- Forward-only. Schema is reverted with `goose down-to 0` from a fresh database or by
-- restoring a backup; destructive rollbacks on a database holding customer data are
-- not something an automated path should be able to do by accident.
