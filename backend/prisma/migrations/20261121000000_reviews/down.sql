-- RECOVERY ARTIFACT ONLY — NOT EXECUTED BY PRISMA, NOT EXECUTED BY ANY SCRIPT.
--
-- Manually reviewed reverse of 20261121000000_reviews (M04-T02 Increment 1).
-- Prisma Migrate has no down migrations; this file records a reviewed rollback
-- path, following the identity and favorites migrations' down.sql and ADR-010.
--
-- RULES:
--   * Destructive rollback is permitted ONLY while "reviews" holds no rows.
--     The guard block below refuses to run otherwise.
--   * Once any review exists, running this file is PROHIBITED without a
--     separately approved data-preservation strategy.
--   * Never reset a database or delete a volume to "simplify" a rollback.
--   * If this file is ever run (after explicit developer approval), the
--     migration's row must then be removed from "_prisma_migrations" by hand
--     (`DELETE FROM "_prisma_migrations" WHERE migration_name =
--     '20261121000000_reviews'`), and the `Review` model and its two
--     back-relation fields removed from schema.prisma, so `prisma migrate
--     status` is consistent.
--
-- This file touches NOTHING on "landmarks", "users", "favorites", or any
-- identity table; dropping "reviews" drops only its own indexes and its
-- foreign-key and CHECK constraints.

DO $$
DECLARE
  n_reviews bigint;
BEGIN
  SELECT count(*) INTO n_reviews FROM "reviews";
  IF n_reviews > 0 THEN
    RAISE EXCEPTION 'Refusing destructive rollback: reviews contains % row(s). A separately approved data-preservation strategy is required.',
      n_reviews;
  END IF;
END
$$;

DROP TABLE IF EXISTS "reviews";
