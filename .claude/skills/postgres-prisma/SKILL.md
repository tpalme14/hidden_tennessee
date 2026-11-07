---
name: postgres-prisma
description: Guide PostgreSQL/PostGIS schema, Prisma migrations, spatial queries, and safe GPX landmark imports while preserving stable IDs and privacy.
---

# PostgreSQL, PostGIS, and Prisma

Use this skill for schema, migration, query, and GPX-import tasks.

- Follow ADR-003: PostgreSQL with PostGIS; Prisma is the schema/migration authority. Isolate spatial SQL where Prisma lacks native support; use parameterized queries only.
- Per ADR-010: apply migrations in this repository only via `prisma migrate deploy`; never use `prisma migrate dev` to apply or auto-accept schema changes. Author new migrations from reviewed `migrate dev --create-only`/diff output or carefully hand-authored SQL, preserving the full migration history. Prisma's shadow-database diffing cannot correctly reconcile the hand-written `GENERATED ALWAYS AS ... STORED` `location` column and its GiST index against the `Unsupported`-typed field — a known tooling limitation, not schema drift — so never automatically accept a diff that drops, recreates, or alters `location` or its index without explicit developer review. Verify every new migration against `landmarks_test` before applying it to `landmarks_dev`. Never reset a database, delete a volume, or discard data to resolve apparent drift; stop and request approval if a migration cannot be generated or applied safely.
- Propose schema and migration effects before editing, including constraints, indexes, rollback/recovery considerations, and preservation of existing user data.
- Follow ADR-005 and the approved import spec: standalone TypeScript CLI, `fast-xml-parser`, Zod validation, immutable GPX inputs, and `source_code` identity. Preserve stable internal landmark IDs and related favorites/reviews/trips across re-imports.
- Validate and preview complete import changes before applying. For a complete import of all 8 GPX source files, enforce one global PostgreSQL transaction spanning the entire batch (all-or-nothing rollback); do not commit per file. Do not retire landmarks from partial imports; honor threshold and concurrency safety rules in the approved spec.
- Enforce strict WGS84 coordinate ordering for PostGIS geometry construction and spatial queries: longitude first, latitude second (for example, `ST_MakePoint(longitude, latitude)`), with SRID 4326 where applicable.
- Never reset manually governed `sensitivity_status` classifications (`UNREVIEWED`, `PUBLIC`, or `SENSITIVE`) during GPX re-import; preserve whichever value already exists in all cases. Public disclosure rules are separate from imported source metadata.
- Enforce composite unique constraints on `Favorites(user_id, landmark_id)`, `Reviews(user_id, landmark_id)`, and `TripStops(trip_id, landmark_id)`; enforce ownership and foreign-key integrity in the database rather than relying on UI checks.
- Use a server-managed integer `version` field on `Trips` for optimistic concurrency on reorder and other version-checked trip updates. Increment it atomically on successful changes and reject stale versions with the approved conflict response.
- Test real PostGIS behavior against a test database for spatial correctness and migration compatibility. Do not claim a migration or restore is verified without executing it.
- Verify production PostGIS availability and database recovery capabilities against the actual selected Render plan before deployment; do not assume a tier's features.
