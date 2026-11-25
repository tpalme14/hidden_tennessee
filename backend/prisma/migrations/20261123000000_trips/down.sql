-- RECOVERY ARTIFACT ONLY — NOT EXECUTED BY PRISMA, NOT EXECUTED BY ANY SCRIPT.
--
-- Manually reviewed reverse of 20261123000000_trips (M05-T02 Increment 1).
-- Prisma Migrate has no down migrations; this file records a reviewed rollback
-- path, following the identity, favorites, and reviews migrations' down.sql
-- and ADR-010.
--
-- RULES:
--   * Destructive rollback is permitted ONLY while "trips" and "trip_stops"
--     both hold no rows. The guard block below refuses to run otherwise.
--   * Once any trip or stop exists, running this file is PROHIBITED without a
--     separately approved data-preservation strategy.
--   * Never reset a database or delete a volume to "simplify" a rollback.
--   * If this file is ever run (after explicit developer approval), the
--     migration's row must then be removed from "_prisma_migrations" by hand
--     (`DELETE FROM "_prisma_migrations" WHERE migration_name =
--     '20261123000000_trips'`), and the `Trip` and `TripStop` models and
--     their back-relation fields (`User.trips`, `Landmark.tripStops`) removed
--     from schema.prisma, so `prisma migrate status` is consistent.
--
-- This file touches NOTHING on "landmarks", "users", "favorites", "reviews",
-- or any identity table; dropping the two tables drops only their own
-- indexes and their foreign-key, unique, and CHECK constraints.
-- "trip_stops" is dropped first because it references "trips".

DO $$
DECLARE
  n_trips bigint;
  n_stops bigint;
BEGIN
  SELECT count(*) INTO n_trips FROM "trips";
  SELECT count(*) INTO n_stops FROM "trip_stops";
  IF n_trips > 0 OR n_stops > 0 THEN
    RAISE EXCEPTION 'Refusing destructive rollback: trips contains % row(s) and trip_stops contains % row(s). A separately approved data-preservation strategy is required.',
      n_trips, n_stops;
  END IF;
END
$$;

DROP TABLE IF EXISTS "trip_stops";
DROP TABLE IF EXISTS "trips";
