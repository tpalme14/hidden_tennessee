-- Hand-edited per M01-T02/M01-T03 (docs/IMPLEMENTATION_PLAN.md): Prisma's
-- schema language has no declarative syntax for the PostGIS extension, a
-- GENERATED ALWAYS AS ... STORED column, CHECK constraints, a GiST index, or
-- a partial index, so each is added here as raw SQL. The base CREATE TYPE /
-- CREATE TABLE / CREATE UNIQUE INDEX statements below are Prisma-generated
-- and unmodified except for the `location` column definition.

-- Enable PostGIS before any `geography` type is referenced.
CREATE EXTENSION IF NOT EXISTS postgis;

-- CreateEnum
CREATE TYPE "LandmarkCategory" AS ENUM ('ARCH', 'BALD', 'FALLS', 'LAKE', 'OTHER', 'PEAK', 'ROCK', 'SINK');

-- CreateEnum
CREATE TYPE "LandmarkSourceFile" AS ENUM ('TNARCHES', 'TNBALDS', 'TNFALLS', 'TNLAKES', 'TNOTHER', 'TNPEAKS', 'TNROCKS', 'TNSINKS');

-- CreateEnum
CREATE TYPE "SensitivityReviewStatus" AS ENUM ('UNREVIEWED', 'PUBLIC', 'SENSITIVE');

-- CreateTable
-- `location` is a database-generated column derived from latitude/longitude
-- (verified in an isolated rollback-only transaction against landmarks_test
-- before this migration was created — see M01-T03 verification results in
-- docs/IMPLEMENTATION_PLAN.md) so the two representations can never diverge
-- and no application code path can write to `location` directly.
CREATE TABLE "landmarks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_code" TEXT NOT NULL,
    "source_file" "LandmarkSourceFile" NOT NULL,
    "category" "LandmarkCategory" NOT NULL,
    "display_name" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "location" geography(Point,4326) GENERATED ALWAYS AS (
        ST_SetSRID(ST_MakePoint("longitude", "latitude"), 4326)::geography
    ) STORED NOT NULL,
    "source_description" TEXT,
    "source_access_label" TEXT,
    "source_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sensitivity_status" "SensitivityReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "landmarks_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "latitude_range_check" CHECK ("latitude" >= -90 AND "latitude" <= 90),
    CONSTRAINT "longitude_range_check" CHECK ("longitude" >= -180 AND "longitude" <= 180),
    CONSTRAINT "source_code_format_check" CHECK ("source_code" ~ '^[A-Z]{3}[0-9]{3}$')
);

-- CreateIndex
CREATE UNIQUE INDEX "landmarks_source_code_key" ON "landmarks"("source_code");

-- CreateIndex
-- GiST index required for ST_DWithin/ST_MakeEnvelope performance (FR-06);
-- Prisma has no declarative syntax for a spatial index on an Unsupported column.
CREATE INDEX "landmarks_location_gist_idx" ON "landmarks" USING GIST ("location");

-- CreateIndex
-- Partial index tuned to the dominant FR-02/FR-04 discovery query pattern
-- (filter by category among active landmarks); Prisma has no declarative
-- syntax for a partial/filtered index.
CREATE INDEX "landmarks_category_active_idx" ON "landmarks" ("category") WHERE "is_active" = true;
