-- Runs once, on first container start.
--
-- The application role must NOT be a superuser and must NOT own the tables, because
-- Postgres bypasses row level security for both. Getting this wrong silently disables
-- every tenant isolation policy in the database, which is why the app role is created
-- here rather than by hand.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fold_app') THEN
        CREATE ROLE fold_app LOGIN PASSWORD 'fold_app';
    END IF;
END $$;

-- DDL belongs to the migration role. The app only ever reads and writes rows.
GRANT CONNECT ON DATABASE postgres TO fold_app;
GRANT USAGE ON SCHEMA public TO fold_app;

-- Grant on tables/sequences is re-applied after every migration; see the end of
-- api/migrations/00005_rls.sql for why that matters.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO fold_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO fold_app;