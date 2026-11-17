-- RECOVERY ARTIFACT ONLY — NOT EXECUTED BY PRISMA, NOT EXECUTED BY ANY SCRIPT.
--
-- Manually reviewed reverse of 20261107230000_identity_schema (M03-T02
-- Increment 1). Prisma Migrate has no down migrations; this file exists so a
-- reviewed rollback path is recorded, per the developer's Increment 1
-- safeguards and ADR-010.
--
-- RULES (developer-approved, 2026-11-07):
--   * Destructive rollback is permitted ONLY while every identity table holds
--     no user data. The guard block below refuses to run otherwise.
--   * Once any real identity data exists, running this file is PROHIBITED
--     without a separately approved data-preservation strategy.
--   * Never reset a database or delete a volume to "simplify" a rollback.
--   * If this file is ever run (after explicit developer approval), the
--     migration's row must then be removed from "_prisma_migrations" by hand
--     (`DELETE FROM "_prisma_migrations" WHERE migration_name =
--     '20261107230000_identity_schema'`), and the corresponding Prisma models
--     removed from schema.prisma, so `prisma migrate status` is consistent.
--
-- This file touches NOTHING on "landmarks".

DO $$
DECLARE
  n_users bigint;
  n_sessions bigint;
  n_accounts bigint;
  n_verifications bigint;
BEGIN
  SELECT count(*) INTO n_users FROM "users";
  SELECT count(*) INTO n_sessions FROM "sessions";
  SELECT count(*) INTO n_accounts FROM "accounts";
  SELECT count(*) INTO n_verifications FROM "verifications";
  IF n_users > 0 OR n_sessions > 0 OR n_accounts > 0 OR n_verifications > 0 THEN
    RAISE EXCEPTION 'Refusing destructive rollback: identity tables contain data (users=%, sessions=%, accounts=%, verifications=%). A separately approved data-preservation strategy is required.',
      n_users, n_sessions, n_accounts, n_verifications;
  END IF;
END
$$;

-- Dependents first (their foreign keys and indexes drop with them).
DROP TABLE IF EXISTS "sessions";
DROP TABLE IF EXISTS "accounts";
DROP TABLE IF EXISTS "verifications";
DROP TABLE IF EXISTS "rate_limits";
DROP TABLE IF EXISTS "users";
