-- M03-T05 Increment 1 — favorites table (docs/IMPLEMENTATION_PLAN.md M03-T01
-- `Favorite` row and M03-T05; docs/DECISIONS.md ADR-011 decisions 7, 8, 10;
-- specs/AUTHENTICATION_FAVORITES_SPEC.md v0.3 §6.1). Authored per ADR-010:
-- hand-written, then cross-checked against read-only `prisma migrate diff`
-- output, and applied only via `prisma migrate deploy` — to landmarks_test
-- first, then landmarks_dev.
--
-- This migration creates ONE new table and touches NOTHING else: no column,
-- index, constraint, trigger, or row on `landmarks` (including the generated
-- `location` column and its GiST index), `users`, or any identity table. The
-- two foreign keys below add constraints on `favorites` only.

-- CreateTable
-- One row per (user, landmark). Rows are never updated, so there is no
-- `updated_at`. `landmark_id` is the internal landmark UUID, never `source_code`.
CREATE TABLE "favorites" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "landmark_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Spec §6.1: at most one favorite per (user, landmark). Also the conflict
-- target that makes add-if-absent a single atomic statement.
CREATE UNIQUE INDEX "favorites_user_id_landmark_id_key" ON "favorites"("user_id", "landmark_id");

-- CreateIndex
-- Newest-first paginated listing with a stable tie-break (spec §7; approved
-- ordering `created_at DESC, id ASC`, decision D5).
CREATE INDEX "favorites_user_id_created_at_id_idx" ON "favorites"("user_id", "created_at" DESC, "id");

-- AddForeignKey
-- RESTRICT: no user deletion can silently remove application data
-- (ADR-011 decision 7; spec §10.2.6).
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
-- RESTRICT: retirement (is_active = false) keeps favorites; the import never
-- deletes landmarks (spec §6.1).
ALTER TABLE "favorites" ADD CONSTRAINT "favorites_landmark_id_fkey" FOREIGN KEY ("landmark_id") REFERENCES "landmarks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
