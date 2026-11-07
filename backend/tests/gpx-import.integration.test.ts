import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { applyImport } from "../src/import/apply.js";
import { ConcurrentImportError, MissingApprovalError, StalePreviewError } from "../src/import/errors.js";
import { runPreflight } from "../src/import/preview.js";
import { buildGpxXml, createGpxFixtureDir } from "./helpers/gpx-fixtures.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

const IMPORT_ADVISORY_LOCK_KEY = 837_465_123;

// By the time this file's imports run, tests/setup/vitest.setup.integration.ts
// has already pointed DATABASE_URL at landmarks_test (same pattern as
// health.integration.test.ts and landmark-schema.integration.test.ts).
describe("GPX import (integration)", () => {
  afterEach(async () => {
    await resetTestDatabase();
  });

  it("applies a straightforward complete import: inserts, matches, and reactivates correctly", async () => {
    // Simulate a landmark from a prior import: one that will be reactivated,
    // and one that is genuinely absent this run (eligible for retirement).
    await prisma.landmark.create({
      data: {
        sourceCode: "ARC001",
        sourceFile: "TNARCHES",
        category: "ARCH",
        displayName: "Old Name",
        latitude: 1,
        longitude: 1,
        isActive: false,
      },
    });
    await prisma.landmark.create({
      data: {
        sourceCode: "ARC999",
        sourceFile: "TNARCHES",
        category: "ARCH",
        displayName: "Should Be Retired",
        latitude: 2,
        longitude: 2,
        isActive: true,
      },
    });

    const { dir, cleanup } = createGpxFixtureDir({
      "tnarches.gpx": buildGpxXml([
        { lat: 36.2174, lon: -84.12754, name: "ARC001", cmt: "Coal Creek Arches 4x5", desc: "Anderson" },
        { lat: 36.3, lon: -84.2, name: "ARC002", cmt: "New Arch", desc: "Anderson" },
      ]),
    });

    try {
      const { artifact, path } = await runPreflight(prisma, dir, dir);
      expect(artifact.summary.newInsertions).toBe(1);
      expect(artifact.summary.reactivatedRecords).toBe(1);
      expect(artifact.summary.retiredRecords).toBe(1);
      expect(artifact.requiredApprovals).toContain("insertions"); // zero-baseline edge case (decision 1) does not
      // apply here since baseline has active landmarks already, but insertion % of a tiny baseline still exceeds 5%.

      const result = await applyImport(prisma, dir, artifact, new Set(artifact.requiredApprovals));
      expect(result).toEqual({ inserted: 1, updated: 0, reactivated: 1, retired: 1 });

      const reactivated = await prisma.landmark.findUniqueOrThrow({ where: { sourceCode: "ARC001" } });
      expect(reactivated.isActive).toBe(true);
      expect(reactivated.displayName).toBe("Coal Creek Arches 4x5");

      const retired = await prisma.landmark.findUniqueOrThrow({ where: { sourceCode: "ARC999" } });
      expect(retired.isActive).toBe(false);

      void path;
    } finally {
      cleanup();
    }
  });

  it("preserves sensitivityStatus on update/reactivation and defaults new records to UNREVIEWED", async () => {
    await prisma.landmark.create({
      data: {
        sourceCode: "ARC001",
        sourceFile: "TNARCHES",
        category: "ARCH",
        displayName: "Old Name",
        latitude: 1,
        longitude: 1,
        isActive: true,
        sensitivityStatus: "SENSITIVE",
      },
    });

    const { dir, cleanup } = createGpxFixtureDir({
      "tnarches.gpx": buildGpxXml([{ lat: 36.2174, lon: -84.12754, name: "ARC001", cmt: "Updated Name" }]),
    });
    try {
      const { artifact } = await runPreflight(prisma, dir, dir);
      await applyImport(prisma, dir, artifact, new Set(artifact.requiredApprovals));

      const updated = await prisma.landmark.findUniqueOrThrow({ where: { sourceCode: "ARC001" } });
      expect(updated.sensitivityStatus).toBe("SENSITIVE");
      expect(updated.displayName).toBe("Updated Name");
    } finally {
      cleanup();
    }
  });

  it("rejects a stale preview when the GPX source files change after preflight", async () => {
    const { dir, cleanup } = createGpxFixtureDir({
      "tnarches.gpx": buildGpxXml([{ lat: 36, lon: -84, name: "ARC001" }]),
    });
    try {
      const { artifact } = await runPreflight(prisma, dir, dir);

      // Mutate the source file after the preview was generated.
      const fs = await import("node:fs");
      const { join } = await import("node:path");
      fs.writeFileSync(
        join(dir, "tnarches.gpx"),
        buildGpxXml([{ lat: 36, lon: -84, name: "ARC001", cmt: "Changed after preview" }]),
        "utf-8",
      );

      await expect(applyImport(prisma, dir, artifact, new Set(artifact.requiredApprovals))).rejects.toThrow(
        StalePreviewError,
      );
    } finally {
      cleanup();
    }
  });

  it("rejects a stale preview when the database baseline changes after preflight", async () => {
    const { dir, cleanup } = createGpxFixtureDir({
      "tnarches.gpx": buildGpxXml([{ lat: 36, lon: -84, name: "ARC001" }]),
    });
    try {
      const { artifact } = await runPreflight(prisma, dir, dir);

      // Simulate a concurrent change to the database after the preview was generated.
      await prisma.landmark.create({
        data: {
          sourceCode: "ARC999",
          sourceFile: "TNARCHES",
          category: "ARCH",
          displayName: "Unexpected Concurrent Insert",
          latitude: 5,
          longitude: 5,
        },
      });

      await expect(applyImport(prisma, dir, artifact, new Set(artifact.requiredApprovals))).rejects.toThrow(
        StalePreviewError,
      );
    } finally {
      cleanup();
    }
  });

  it("rejects apply when a triggered threshold lacks its matching approval", async () => {
    const { dir, cleanup } = createGpxFixtureDir({
      "tnarches.gpx": buildGpxXml([{ lat: 36, lon: -84, name: "ARC001" }]),
    });
    try {
      const { artifact } = await runPreflight(prisma, dir, dir);
      expect(artifact.requiredApprovals).toContain("insertions");

      await expect(applyImport(prisma, dir, artifact, new Set())).rejects.toThrow(MissingApprovalError);

      const count = await prisma.landmark.count();
      expect(count).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("disables retirement for a whole file when it contains an unidentifiable record, protecting other landmarks from that file", async () => {
    await prisma.landmark.create({
      data: {
        sourceCode: "FAL500",
        sourceFile: "TNFALLS",
        category: "FALLS",
        displayName: "Existing Falls Landmark",
        latitude: 35,
        longitude: -85,
        isActive: true,
      },
    });

    const { dir, cleanup } = createGpxFixtureDir({
      // tnfalls.gpx has a record with no <name> at all — unidentifiable.
      "tnfalls.gpx": buildGpxXml([{ lat: 35.1, lon: -85.1, omitName: true, cmt: "Mystery Falls" }]),
    });
    try {
      const { artifact } = await runPreflight(prisma, dir, dir);
      expect(artifact.summary.rejectedRecords).toBe(1);
      expect(artifact.summary.retiredRecords).toBe(0); // FAL500 must NOT appear as a retirement candidate.

      const approvals = new Set(artifact.requiredApprovals);
      await applyImport(prisma, dir, artifact, approvals);

      const stillActive = await prisma.landmark.findUniqueOrThrow({ where: { sourceCode: "FAL500" } });
      expect(stillActive.isActive).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("protects an identifiable-but-invalid source code from retirement without disabling the rest of the file", async () => {
    await prisma.landmark.create({
      data: {
        sourceCode: "ARC001",
        sourceFile: "TNARCHES",
        category: "ARCH",
        displayName: "Protected (invalid coords this run)",
        latitude: 1,
        longitude: 1,
        isActive: true,
      },
    });
    await prisma.landmark.create({
      data: {
        sourceCode: "ARC999",
        sourceFile: "TNARCHES",
        category: "ARCH",
        displayName: "Genuinely absent this run",
        latitude: 2,
        longitude: 2,
        isActive: true,
      },
    });

    const { dir, cleanup } = createGpxFixtureDir({
      "tnarches.gpx": buildGpxXml([
        { lat: 999, lon: -84, name: "ARC001" }, // identifiable, but Tier-1 invalid coordinates.
        { lat: 36, lon: -84, name: "ARC002" }, // an unrelated valid new record.
      ]),
    });
    try {
      const { artifact } = await runPreflight(prisma, dir, dir);
      expect(artifact.rejected).toContainEqual(
        expect.objectContaining({ sourceCode: "ARC001", kind: "invalid" }),
      );
      expect(artifact.retirements.map((r) => r.sourceCode)).toEqual(["ARC999"]);

      await applyImport(prisma, dir, artifact, new Set(artifact.requiredApprovals));

      const protectedLandmark = await prisma.landmark.findUniqueOrThrow({ where: { sourceCode: "ARC001" } });
      expect(protectedLandmark.isActive).toBe(true); // protected, not retired, despite being "absent" from accepted set.

      const retired = await prisma.landmark.findUniqueOrThrow({ where: { sourceCode: "ARC999" } });
      expect(retired.isActive).toBe(false);
    } finally {
      cleanup();
    }
  });

  it("excludes conflicting duplicate source codes from every write", async () => {
    const { dir, cleanup } = createGpxFixtureDir({
      "tnarches.gpx": buildGpxXml([
        { lat: 36, lon: -84, name: "ARC001", cmt: "Version A" },
        { lat: 36.01, lon: -84.01, name: "ARC001", cmt: "Version B" },
      ]),
    });
    try {
      const { artifact } = await runPreflight(prisma, dir, dir);
      expect(artifact.rejected).toContainEqual(expect.objectContaining({ sourceCode: "ARC001", kind: "conflict" }));
      expect(artifact.summary.acceptedUniqueRecords).toBe(0);

      await applyImport(prisma, dir, artifact, new Set(artifact.requiredApprovals));

      const count = await prisma.landmark.count({ where: { sourceCode: "ARC001" } });
      expect(count).toBe(0);
    } finally {
      cleanup();
    }
  });

  it("rolls back the entire transaction if a later write fails, leaving earlier writes uncommitted", async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.landmark.create({
          data: {
            sourceCode: "ARC001",
            sourceFile: "TNARCHES",
            category: "ARCH",
            displayName: "Should not survive rollback",
            latitude: 36,
            longitude: -84,
          },
        });
        // Deliberately violates the latitude_range_check CHECK constraint, bypassing
        // app-level validation, to simulate a genuine Tier-2 database failure
        // partway through an otherwise-successful transaction (spec §7.7).
        await tx.$executeRaw`
          INSERT INTO landmarks (source_code, source_file, category, display_name, latitude, longitude)
          VALUES ('ARC002', 'TNARCHES', 'ARCH', 'Bad Row', 999, -84)
        `;
      }),
    ).rejects.toThrow();

    const count = await prisma.landmark.count();
    expect(count).toBe(0);
  });

  it("fails fast on a concurrent apply attempt rather than waiting", async () => {
    const holder = new Client({ connectionString: process.env.DATABASE_URL_TEST });
    await holder.connect();
    try {
      await holder.query("BEGIN");
      await holder.query("SELECT pg_advisory_xact_lock($1)", [IMPORT_ADVISORY_LOCK_KEY]);

      const { dir, cleanup } = createGpxFixtureDir({
        "tnarches.gpx": buildGpxXml([{ lat: 36, lon: -84, name: "ARC001" }]),
      });
      try {
        const { artifact } = await runPreflight(prisma, dir, dir);
        await expect(
          applyImport(prisma, dir, artifact, new Set(artifact.requiredApprovals)),
        ).rejects.toThrow(ConcurrentImportError);
      } finally {
        cleanup();
      }
    } finally {
      await holder.query("ROLLBACK");
      await holder.end();
    }
  });
});
