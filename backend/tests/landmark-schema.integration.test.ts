import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

// By the time this file's imports run, tests/setup/vitest.setup.integration.ts
// has already verified and pointed DATABASE_URL at landmarks_test (see
// health.integration.test.ts for the same pattern). Verifies the M01-T03
// landmarks schema against a real PostGIS instance, per ADR-009 — none of
// this is mockable, since the behavior under test is the database's own
// generated column, CHECK constraints, and spatial index.
describe("Landmark schema (integration)", () => {
  afterEach(async () => {
    await resetTestDatabase();
  });

  it("computes `location` from latitude/longitude via the generated column", async () => {
    const landmark = await prisma.landmark.create({
      data: {
        sourceCode: "ARC001",
        sourceFile: "TNARCHES",
        category: "ARCH",
        displayName: "Test Arch",
        latitude: 35.1869,
        longitude: -85.6103,
      },
    });

    const rows = await prisma.$queryRaw<{ wkt: string; srid: number }[]>`
      SELECT ST_AsText(location::geometry) AS wkt, ST_SRID(location::geometry) AS srid
      FROM landmarks WHERE id = ${landmark.id}::uuid
    `;

    expect(rows[0]?.wkt).toBe("POINT(-85.6103 35.1869)");
    expect(rows[0]?.srid).toBe(4326);
  });

  it("keeps `location` consistent after latitude/longitude are updated", async () => {
    const landmark = await prisma.landmark.create({
      data: {
        sourceCode: "ARC002",
        sourceFile: "TNARCHES",
        category: "ARCH",
        displayName: "Test Arch 2",
        latitude: 35.0,
        longitude: -85.0,
      },
    });

    await prisma.landmark.update({
      where: { id: landmark.id },
      data: { latitude: 36.0, longitude: -86.0 },
    });

    const rows = await prisma.$queryRaw<{ wkt: string }[]>`
      SELECT ST_AsText(location::geometry) AS wkt FROM landmarks WHERE id = ${landmark.id}::uuid
    `;
    expect(rows[0]?.wkt).toBe("POINT(-86 36)");
  });

  it("rejects direct writes to the generated `location` column", async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO landmarks (source_code, source_file, category, display_name, latitude, longitude, location)
        VALUES ('BAD001', 'TNARCHES', 'ARCH', 'Bad Direct Write', 35, -85, ST_SetSRID(ST_MakePoint(-85, 35), 4326)::geography)
      `,
    ).rejects.toThrow();
  });

  it("rejects latitude/longitude outside valid WGS84 ranges via CHECK constraints", async () => {
    await expect(
      prisma.landmark.create({
        data: {
          sourceCode: "ARC003",
          sourceFile: "TNARCHES",
          category: "ARCH",
          displayName: "Bad Latitude",
          latitude: 95,
          longitude: -85,
        },
      }),
    ).rejects.toThrow();

    await expect(
      prisma.landmark.create({
        data: {
          sourceCode: "ARC004",
          sourceFile: "TNARCHES",
          category: "ARCH",
          displayName: "Bad Longitude",
          latitude: 35,
          longitude: -185,
        },
      }),
    ).rejects.toThrow();
  });

  it("rejects source codes that don't match the verified [A-Z]{3}[0-9]{3} format", async () => {
    await expect(
      prisma.landmark.create({
        data: {
          sourceCode: "bad-code",
          sourceFile: "TNARCHES",
          category: "ARCH",
          displayName: "Bad Source Code",
          latitude: 35,
          longitude: -85,
        },
      }),
    ).rejects.toThrow();
  });

  it("enforces source_code uniqueness", async () => {
    await prisma.landmark.create({
      data: {
        sourceCode: "ARC005",
        sourceFile: "TNARCHES",
        category: "ARCH",
        displayName: "First",
        latitude: 35,
        longitude: -85,
      },
    });

    await expect(
      prisma.landmark.create({
        data: {
          sourceCode: "ARC005",
          sourceFile: "TNARCHES",
          category: "ARCH",
          displayName: "Duplicate",
          latitude: 35.1,
          longitude: -85.1,
        },
      }),
    ).rejects.toThrow();
  });

  it("defaults sensitivityStatus to UNREVIEWED and isActive to true", async () => {
    const landmark = await prisma.landmark.create({
      data: {
        sourceCode: "ARC006",
        sourceFile: "TNARCHES",
        category: "ARCH",
        displayName: "Default Flags",
        latitude: 35,
        longitude: -85,
      },
    });

    expect(landmark.sensitivityStatus).toBe("UNREVIEWED");
    expect(landmark.isActive).toBe(true);
  });

  it("creates a valid GiST spatial index on `location`", async () => {
    const rows = await prisma.$queryRaw<{ indexname: string; indisvalid: boolean }[]>`
      SELECT indexname, indisvalid
      FROM pg_indexes
      JOIN pg_class ON pg_class.relname = pg_indexes.indexname
      JOIN pg_index ON pg_index.indexrelid = pg_class.oid
      WHERE tablename = 'landmarks' AND indexname = 'landmarks_location_gist_idx'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.indisvalid).toBe(true);
  });

  it("computes ST_DWithin proximity correctly against real stored rows", async () => {
    await prisma.landmark.create({
      data: {
        sourceCode: "FAL001",
        sourceFile: "TNFALLS",
        category: "FALLS",
        displayName: "Near Falls",
        latitude: 35.1869,
        longitude: -85.6103,
      },
    });
    await prisma.landmark.create({
      data: {
        sourceCode: "FAL002",
        sourceFile: "TNFALLS",
        category: "FALLS",
        displayName: "Far Falls",
        latitude: 36.5,
        longitude: -84.0,
      },
    });

    const nearby = await prisma.$queryRaw<{ source_code: string }[]>`
      SELECT source_code FROM landmarks
      WHERE ST_DWithin(location, ST_SetSRID(ST_MakePoint(-85.6, 35.19), 4326)::geography, 50000)
      ORDER BY source_code
    `;

    expect(nearby.map((r) => r.source_code)).toEqual(["FAL001"]);
  });

  it("computes bounding-box queries correctly against real stored rows", async () => {
    await prisma.landmark.create({
      data: {
        sourceCode: "PEK001",
        sourceFile: "TNPEAKS",
        category: "PEAK",
        displayName: "Inside Box",
        latitude: 35.5,
        longitude: -85.0,
      },
    });
    await prisma.landmark.create({
      data: {
        sourceCode: "PEK002",
        sourceFile: "TNPEAKS",
        category: "PEAK",
        displayName: "Outside Box",
        latitude: 37.0,
        longitude: -82.0,
      },
    });

    const inBox = await prisma.$queryRaw<{ source_code: string }[]>`
      SELECT source_code FROM landmarks
      WHERE location::geometry && ST_MakeEnvelope(-86, 35, -84, 36, 4326)
      ORDER BY source_code
    `;

    expect(inBox.map((r) => r.source_code)).toEqual(["PEK001"]);
  });
});
