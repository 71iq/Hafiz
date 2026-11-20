-- Migration history for hafiz-promote. Run once as supabase_admin on the production database,
-- then record every file already applied by hand, before installing a hafiz-promote that applies
-- migrations (docs/hetzner-migration.md, Automatic releases). Safe to run again.
CREATE SCHEMA IF NOT EXISTS hafiz_deploy AUTHORIZATION postgres;
REVOKE ALL ON SCHEMA hafiz_deploy FROM PUBLIC;

CREATE TABLE IF NOT EXISTS hafiz_deploy.migrations (
  file text PRIMARY KEY CHECK (file ~ '^[0-9]{3}([0-9]{11})?_[a-z0-9_]+\.sql$'),
  git_blob text NOT NULL CHECK (git_blob ~ '^[0-9a-f]{40}$'),
  applied_at timestamptz NOT NULL DEFAULT now(),
  note text
);
ALTER TABLE hafiz_deploy.migrations OWNER TO postgres;
REVOKE ALL ON hafiz_deploy.migrations FROM PUBLIC, anon, authenticated, service_role;
