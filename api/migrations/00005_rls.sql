-- +goose Up
-- Row Level Security.
--
-- Tenancy is enforced by Postgres, not by remembering a WHERE clause. A missing
-- policy is an error, not a leak. See docs/adr/0002.
--
-- Two parts:
--   1. an event trigger that applies RLS to any new table carrying workspace_id,
--      so nobody can forget;
--   2. an assertion at the end that fails the migration if any workspace table is
--      still unprotected, because (1) must never be the only thing standing between
--      a bug and a cross-tenant data leak.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.apply_tenant_rls() RETURNS event_trigger
LANGUAGE plpgsql AS $$
DECLARE
    target regclass;
BEGIN
    -- NEW.objid is the OID of the relation the triggering statement touched.
    target := NEW.objid::regclass;

    IF EXISTS (
        SELECT 1 FROM pg_attribute
        WHERE attrelid = target AND attname = 'workspace_id' AND attisdropped = false
    ) THEN
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', target);
        -- FORCE so the policy applies to the table owner too. Superusers still bypass;
        -- the application connects as a non-superuser role (see api/docker/init.sql).
        EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', target);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %s
                 USING (workspace_id = public.current_workspace())
                 WITH CHECK (workspace_id = public.current_workspace())',
            target
        );
    END IF;
    RETURN;
END;
$$;
-- +goose StatementEnd

DROP EVENT TRIGGER IF EXISTS apply_tenant_rls;
CREATE EVENT TRIGGER apply_tenant_rls
    ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE')
    EXECUTE FUNCTION public.apply_tenant_rls();

-- Catch-up pass for tables created before this migration existed.
-- +goose StatementBegin
DO $$
DECLARE
    t record;
BEGIN
    FOR t IN
        SELECT c.oid::regclass AS tbl
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname = 'public'
          AND EXISTS (
              SELECT 1 FROM pg_attribute
              WHERE attrelid = c.oid AND attname = 'workspace_id' AND NOT attisdropped
          )
    LOOP
        EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', t.tbl);
        EXECUTE format('ALTER TABLE %s FORCE ROW LEVEL SECURITY', t.tbl);
        EXECUTE format(
            'CREATE POLICY tenant_isolation ON %s
                 USING (workspace_id = public.current_workspace())
                 WITH CHECK (workspace_id = public.current_workspace())',
            t.tbl
        );
    END LOOP;
END $$;
-- +goose StatementEnd

-- ---------------------------------------------------------------------------
-- Verification. This runs last on every migration that adds a table.
-- If someone adds workspace_id without RLS, the deployment fails loudly here.
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
DO $$
DECLARE
    unprotected text;
BEGIN
    SELECT string_agg(c.oid::regclass::text, ', ' ORDER BY c.oid::regclass::text)
    INTO unprotected
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relkind = 'r'
      AND n.nspname = 'public'
      AND NOT c.relrowsecurity
      AND EXISTS (
          SELECT 1 FROM pg_attribute
          WHERE attrelid = c.oid AND attname = 'workspace_id' AND NOT attisdropped
      );

    IF unprotected IS NOT NULL THEN
        RAISE EXCEPTION
            'Row Level Security is not enabled on: % — every workspace_id table must be protected before this migration can succeed.',
            unprotected;
    END IF;
END $$;
-- +goose StatementEnd

-- ---------------------------------------------------------------------------
-- Privileges.
--
-- ALTER DEFAULT PRIVILEGES only covers tables created *after* it runs, and only those
-- created by the role that ran it. Migrations run as the superuser (CREATE EVENT
-- TRIGGER requires one), so grant explicitly on everything that exists now.
--
-- fold_app is deliberately NOT the table owner and NOT a superuser — Postgres bypasses
-- RLS for both, which would make every policy above decorative.
-- ---------------------------------------------------------------------------
-- +goose StatementBegin
DO $$
DECLARE
    t record;
BEGIN
    FOR t IN
        SELECT c.oid::regclass AS tbl
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname = 'public'
    LOOP
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO fold_app', t.tbl);
    END LOOP;

    -- event.id is a bigint identity, which needs sequence usage to be insertable.
    FOR t IN
        SELECT c.oid::regclass AS seq
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'S'
          AND n.nspname = 'public'
    LOOP
        EXECUTE format('GRANT USAGE, SELECT ON SEQUENCE %s TO fold_app', t.seq);
    END LOOP;
END $$;
-- +goose StatementEnd

GRANT USAGE ON SCHEMA public TO fold_app;

-- +goose Down
-- Forward-only. Schema is reverted with `goose down-to 0` from a fresh database or by
-- restoring a backup; destructive rollbacks on a database holding customer data are
-- not something an automated path should be able to do by accident.
