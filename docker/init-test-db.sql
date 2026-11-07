-- Creates a dedicated test database alongside landmarks_dev on the same local
-- Postgres/PostGIS instance, per ADR-009's requirement for isolated,
-- test-specific database credentials and configuration. The testing
-- framework itself (Vitest/Supertest) is configured separately in M00-T05.
CREATE DATABASE landmarks_test;
\connect landmarks_test
CREATE EXTENSION IF NOT EXISTS postgis;
