-- +goose Up
-- Better Auth owns these tables. Next.js runs the auth server; Postgres still hosts the
-- tables, and `workspace_id` in the CRM tables foreign-keys public.organization(id).
--
-- These live in `public` deliberately, not a dedicated `auth` schema. Better Auth's
-- Kysely adapter resolves its models through the connection's search_path, and forcing a
-- non-default schema there is fragile in 1.7.9: both `search_path=auth` and
-- `schemaName: "auth"` were tested and both break — one ignores the mapping, the other
-- mis-binds query parameters ("invalid input syntax for type bigint"). `public` is the
-- Postgres default, and these table names are distinct from the CRM ones, so they
-- coexist without collision.
--
-- Column names are snake_case to match lib/db/auth-schema.ts, the Drizzle schema the
-- auth server actually queries through. They must not drift: a mismatch fails at
-- request time with a raw SQL error, not at build time.
--
-- Ids are uuid columns, not text, which requires the auth server to be configured with
-- `advanced.database.generateId: "uuid"` — see lib/auth.ts. Postgres has no foreign key
-- from uuid to text, so without this the CRM tables cannot reference the tenant at all.
--
-- Mirrors better-auth@1.7.9: user, session, account, verification (core) plus the
-- organization plugin and the jwt plugin. Regenerate with:
--   cd .. && bunx @better-auth/cli generate
-- and diff it against this file whenever the auth plugin list changes.

CREATE TABLE public."user" (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name           text NOT NULL,
    email          text NOT NULL UNIQUE,
    email_verified boolean NOT NULL DEFAULT false,
    image          text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

-- organization plugin: the tenant. This id IS the workspace_id used everywhere else.
CREATE TABLE public.organization (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name       text NOT NULL,
    slug       text NOT NULL UNIQUE,
    logo       text,
    metadata   text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.member (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    role            text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX member_org_user_idx  ON public.member (organization_id, user_id);
CREATE INDEX member_user_idx      ON public.member (user_id);

CREATE TABLE public.invitation (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id uuid NOT NULL REFERENCES public.organization(id) ON DELETE CASCADE,
    email           text NOT NULL,
    role            text,
    status          text NOT NULL,
    inviter_id     uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    expires_at      timestamptz NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX invitation_org_idx ON public.invitation (organization_id, status);

CREATE TABLE public.session (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    token                  text NOT NULL UNIQUE,
    user_id               uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    expires_at             timestamptz NOT NULL,
    ip_address             text,
    user_agent             text,
    active_organization_id uuid REFERENCES public.organization(id) ON DELETE CASCADE,
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_user_idx ON public.session (user_id);

CREATE TABLE public.account (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id              text NOT NULL,
    provider_id             text NOT NULL,
    user_id                 uuid NOT NULL REFERENCES public."user"(id) ON DELETE CASCADE,
    access_token            text,
    refresh_token           text,
    id_token                text,
    access_token_expires_at timestamptz,
    refresh_token_expires_at timestamptz,
    scope                   text,
    password                text,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX account_user_idx ON public.account (user_id);

CREATE TABLE public.verification (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    identifier text NOT NULL,
    value      text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON public.verification (identifier);

-- jwt plugin. Go reads the public half of this to verify bearer tokens offline.
-- alg and crv let a verifier reject a key it cannot use; expires_at lets an old key be
-- rotated out rather than lingering. All three are required by Better Auth 1.7.9 and
-- must stay in step with lib/db/auth-schema.ts.
CREATE TABLE public.jwks (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    public_key text NOT NULL,
    private_key text NOT NULL,
    alg        text NOT NULL,
    crv        text NOT NULL,
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- +goose Down
-- Forward-only. Schema is reverted with `goose down-to 0` from a fresh database or by
-- restoring a backup; destructive rollbacks on a database holding customer data are
-- not something an automated path should be able to do by accident.
