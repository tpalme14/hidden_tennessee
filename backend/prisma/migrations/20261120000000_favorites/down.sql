-- RECOVERY ARTIFACT ONLY — NOT EXECUTED BY PRISMA, NOT EXECUTED BY ANY SCRIPT.
--
-- Manually reviewed reverse of 20261120000000_favorites (M03-T05 Increment 1).
-- Prisma Migrate has no down migrations; this file records a reviewed rollback
-- path, following the identity migration's down.sql and ADR-010.
--
-- RULES:
--   * Destructive rollback is permitted ONLY while "favorites" holds no rows.
--     The guard block below refuses to run otherwise.
--   * Once any favorite exists, running this file is PROHIBITED without a
--     separately approved data-preservation strategy.
--   * Never reset a database or delete a volume to "simplify" a rollback.
--   * If this file is ever run (after explicit developer approval), the
--     migration's row must then be removed from "_prisma_migrations" by hand
--     (`DELETE FROM "_prisma_migrations" WHERE migration_name =
--     '20261120000000_favorites'`), and the `Favorite` model and its two
--     back-relation fields removed from schema.prisma, so `prisma migrate
--     status` is consistent.
--
-- This file touches NOTHING on "landmarks", "users", or any identity table;
-- dropping "favorites" drops only its own indexes and foreign-key constraints.

DO $$
DECLARE
  n_favorites bigint;
BEGIN
  SELECT count(*) INTO n_favorites FROM "favorites";
  IF n_favorites > 0 THEN
    RAISE EXCEPTION 'Refusing destructive rollback: favorites contains % row(s). A separately approved data-preservation strategy is required.',
      n_favorites;
  END IF;
END
$$;

DROP TABLE IF EXISTS "favorites";
