import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { applyImport } from "../src/import/apply.js";
import { runPreflight } from "../src/import/preview.js";
import { buildGpxXml, createGpxFixtureDir, type FixtureWaypoint } from "./helpers/gpx-fixtures.js";
import { asUser, createTwoUsers, type TestUser } from "./helpers/test-users.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T05 Increment 4 — favorites through the landmark lifecycle over real
 * HTTP with two real accounts (spec §9.2 tests #9, #10, #15): PUBLIC →
 * UNREVIEWED/SENSITIVE reclassification, retirement and reactivation, and
 * preservation through the REAL GPX import pipeline (runPreflight →
 * applyImport). Favorites responses are cross-checked against the public
 * landmark endpoint so they can never show more than an anonymous visitor.
 *
 * Import safety (developer refinement 3): imports run ONLY against
 * landmarks_test (asserted live before each import) and ONLY from generated
 * temporary GPX fixture directories (asserted to be under the OS temp
 * directory and outside the repository's coordinates/). Any retirement
 * approval applies to that synthetic dataset alone.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_COORDINATES_DIR = path.resolve(__dirname, "../../coordinates");
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Resource not found." } };

type Status = "UNREVIEWED" | "PUBLIC" | "SENSITIVE";
let sequence = 0;

async function createLandmark(name: string, status: Status = "PUBLIC"): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `ROC${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNROCKS",
      category: "ROCK",
      displayName: name,
      latitude: 36.1,
      longitude: -84.7,
      sourceDescription: "restricted description",
      sourceAccessLabel: "restricted access",
      sourceUrl: "https://example.com/restricted",
      sensitivityStatus: status,
    },
  });
  return landmark.id;
}

const favPath = (landmarkId: string) => `/api/v1/favorites/${landmarkId}`;

type Entry = { landmark_id: string; availability: string; landmark?: Record<string, unknown> };

async function entryFor(
  app: ReturnType<typeof createApp>,
  user: TestUser,
  landmarkId: string,
): Promise<Entry | undefined> {
  const response = await asUser(app, user).get("/api/v1/favorites");
  expect(response.status).toBe(200);
  return (response.body.favorites as Entry[]).find((e) => e.landmark_id === landmarkId);
}

async function rowsOf(userId: string) {
  return prisma.favorite.findMany({ where: { userId }, orderBy: { id: "asc" } });
}

/**
 * G2: a favorites entry never shows more than the public detail endpoint
 * shows an anonymous visitor for the same landmark.
 */
async function expectNoMoreThanPublic(app: ReturnType<typeof createApp>, entry: Entry) {
  const publicDetail = await request(app).get(`/api/v1/landmarks/${entry.landmark_id}`);
  if (entry.availability === "unavailable") {
    expect(publicDetail.status).toBe(404);
    expect(publicDetail.body).toEqual(NOT_FOUND);
    expect(entry).toEqual({ landmark_id: entry.landmark_id, availability: "unavailable" });
    return;
  }
  expect(publicDetail.status).toBe(200);
  if (entry.availability === "redacted") {
    // Exactly the §9.4a minimal profile the public endpoint returns.
    expect(entry.landmark).toEqual(publicDetail.body);
    return;
  }
  // available: every field and value is one the public profile also returns.
  for (const [key, value] of Object.entries(entry.landmark ?? {})) {
    expect(publicDetail.body).toHaveProperty(key, value);
  }
}

describe("favorites lifecycle (integration, M03-T05 Increment 4)", () => {
  const app = createApp();

  afterEach(async () => {
    await resetTestDatabase();
  });

  describe("reclassification PUBLIC → UNREVIEWED / SENSITIVE (spec #10)", () => {
    it.each(["SENSITIVE", "UNREVIEWED"] as const)(
      "to %s: both users see it redacted, PUT 404 for both, DELETE works; restored → PUT 200 and available",
      async (status) => {
        const [a, b] = await createTwoUsers(app);
        const landmark = await createLandmark(`Reclassified ${status}`);
        expect((await asUser(app, a).put(favPath(landmark))).status).toBe(201);
        expect((await asUser(app, b).put(favPath(landmark))).status).toBe(201);
        const bRows = await rowsOf(b.userId);

        await prisma.landmark.update({
          where: { id: landmark },
          data: { sensitivityStatus: status },
        });
        for (const user of [a, b]) {
          const entry = await entryFor(app, user, landmark);
          expect(entry).toEqual({
            landmark_id: landmark,
            availability: "redacted",
            landmark: {
              id: landmark,
              display_name: `Reclassified ${status}`,
              category: "rock",
              redacted: true,
            },
          });
          await expectNoMoreThanPublic(app, entry!);
          const put = await asUser(app, user).put(favPath(landmark));
          expect(put.status).toBe(404);
          expect(put.body).toEqual(NOT_FOUND);
        }
        expect(await rowsOf(b.userId)).toEqual(bRows);

        expect((await asUser(app, a).delete(favPath(landmark))).status).toBe(200);
        expect(await rowsOf(a.userId)).toEqual([]);

        await prisma.landmark.update({
          where: { id: landmark },
          data: { sensitivityStatus: "PUBLIC" },
        });
        expect((await asUser(app, b).put(favPath(landmark))).status).toBe(200);
        expect(await rowsOf(b.userId)).toEqual(bRows);
        const restored = await entryFor(app, b, landmark);
        expect(restored?.availability).toBe("available");
        await expectNoMoreThanPublic(app, restored!);
        // A removed theirs while it was restricted; adding again now creates it.
        expect((await asUser(app, a).put(favPath(landmark))).status).toBe(201);
      },
    );

    it("an available entry never shows more than the public full profile, and never source metadata", async () => {
      const [a] = await createTwoUsers(app);
      const landmark = await createLandmark("Plain Public");
      await asUser(app, a).put(favPath(landmark));
      const entry = await entryFor(app, a, landmark);
      expect(entry?.availability).toBe("available");
      await expectNoMoreThanPublic(app, entry!);
      expect(JSON.stringify(entry)).not.toMatch(/restricted|source_/);
    });
  });

  describe("retirement and reactivation (spec #9, #15)", () => {
    it("retired: unavailable placeholder for both (public 404 agrees), PUT 404, idempotent DELETE; reactivated: survivor available with same row", async () => {
      const [a, b] = await createTwoUsers(app);
      const landmark = await createLandmark("Retiring Rock");
      await asUser(app, a).put(favPath(landmark));
      await asUser(app, b).put(favPath(landmark));
      const [bRow] = await rowsOf(b.userId);

      await prisma.landmark.update({ where: { id: landmark }, data: { isActive: false } });
      for (const user of [a, b]) {
        const entry = await entryFor(app, user, landmark);
        expect(entry).toEqual({ landmark_id: landmark, availability: "unavailable" });
        await expectNoMoreThanPublic(app, entry!);
        expect((await asUser(app, user).put(favPath(landmark))).status).toBe(404);
      }
      const listing = await asUser(app, a).get("/api/v1/favorites");
      expect(listing.text).not.toMatch(/Retiring Rock|rock|36\.1|84\.7|restricted/);

      for (let i = 0; i < 2; i += 1) {
        const del = await asUser(app, a).delete(favPath(landmark));
        expect(del.status).toBe(200);
        expect(del.body).toEqual({ success: true, landmark_id: landmark });
      }
      expect(await rowsOf(a.userId)).toEqual([]);
      expect(await rowsOf(b.userId)).toEqual([bRow]);

      await prisma.landmark.update({ where: { id: landmark }, data: { isActive: true } });
      expect(await rowsOf(b.userId)).toEqual([bRow]); // same id and created_at
      const revived = await entryFor(app, b, landmark);
      expect(revived?.availability).toBe("available");
      await expectNoMoreThanPublic(app, revived!);
      expect(await entryFor(app, a, landmark)).toBeUndefined();
      expect((await asUser(app, a).put(favPath(landmark))).status).toBe(201);
    });
  });

  describe("GPX re-import preserves favorites (spec #9; real import pipeline)", () => {
    function fixture(arches: FixtureWaypoint[]) {
      return createGpxFixtureDir({ "tnarches.gpx": buildGpxXml(arches) });
    }
    const ARC001 = (cmt: string, desc = "Anderson", lat = 36.2174): FixtureWaypoint => ({
      lat,
      lon: -84.12754,
      name: "ARC001",
      cmt,
      desc,
    });
    /**
     * Step 2's metadata change also shifts ARC001 by 0.0001° latitude (≈11 m)
     * so the EXISTING import update path runs. A metadata-only change (same
     * coordinates and source file) is currently classified "unchanged" and not
     * persisted — an open M01-T04 defect accepted by the developer as a
     * separate follow-up (M03-T05 Increment 4), NOT as correct behaviour.
     */
    const RENAMED = ["Renamed Arch", "Campbell", 36.2175] as const;
    const ARC002: FixtureWaypoint = {
      lat: 36.3,
      lon: -84.2,
      name: "ARC002",
      cmt: "Second Arch",
      desc: "Anderson",
    };

    /** Refinement 3: live database identity and fixture location checked before every import. */
    async function importSynthetic(dir: string) {
      const [{ db }] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
      expect(db).toBe("landmarks_test");
      const realDir = realpathSync(dir);
      expect(realDir.startsWith(realpathSync(tmpdir()))).toBe(true);
      expect(path.relative(REAL_COORDINATES_DIR, realDir).startsWith("..")).toBe(true);

      const { artifact } = await runPreflight(prisma, dir, dir);
      // Approvals come from THIS synthetic preview only.
      const result = await applyImport(prisma, dir, artifact, new Set(artifact.requiredApprovals));
      return { summary: artifact.summary, result };
    }

    it("metadata update, retirement, and reactivation through re-import keep the same landmark IDs and favorite rows; sensitivity is preserved", async () => {
      const [a, b] = await createTwoUsers(app);

      // 1. First import creates both landmarks (UNREVIEWED by default).
      const first = fixture([ARC001("Original Arch"), ARC002]);
      try {
        expect((await importSynthetic(first.dir)).result).toEqual({
          inserted: 2,
          updated: 0,
          reactivated: 0,
          retired: 0,
        });
      } finally {
        first.cleanup();
      }
      const arc1 = await prisma.landmark.findUniqueOrThrow({ where: { sourceCode: "ARC001" } });
      const arc2 = await prisma.landmark.findUniqueOrThrow({ where: { sourceCode: "ARC002" } });
      expect(arc1.sensitivityStatus).toBe("UNREVIEWED");
      // Unreviewed landmarks are not favoritable (D1)…
      expect((await asUser(app, a).put(favPath(arc1.id))).status).toBe(404);
      // …so classify them PUBLIC (test-only) and save.
      await prisma.landmark.updateMany({
        where: { id: { in: [arc1.id, arc2.id] } },
        data: { sensitivityStatus: "PUBLIC" },
      });
      for (const user of [a, b]) {
        expect((await asUser(app, user).put(favPath(arc1.id))).status).toBe(201);
        expect((await asUser(app, user).put(favPath(arc2.id))).status).toBe(201);
      }
      const aRows = await rowsOf(a.userId);
      const bRows = await rowsOf(b.userId);

      // 2. Metadata update + slight coordinate shift via re-import (the existing
      //    update path): same landmark id, same favorite rows, new metadata, still PUBLIC.
      const renamed = fixture([ARC001(...RENAMED), ARC002]);
      try {
        const { summary, result } = await importSynthetic(renamed.dir);
        // The preview classifies ARC001 as updated (ARC002 is unchanged).
        expect(summary).toMatchObject({
          newInsertions: 0,
          updatedRecords: 1,
          unchangedRecords: 1,
          reactivatedRecords: 0,
          retiredRecords: 0,
        });
        expect(result).toEqual({ inserted: 0, updated: 1, reactivated: 0, retired: 0 });
      } finally {
        renamed.cleanup();
      }
      const arc1After = await prisma.landmark.findUniqueOrThrow({
        where: { sourceCode: "ARC001" },
      });
      expect(arc1After.id).toBe(arc1.id); // internal UUID unchanged
      expect(arc1After.displayName).toBe("Renamed Arch"); // name persisted
      expect(arc1After.sourceDescription).toBe("Campbell"); // description persisted
      expect(arc1After.latitude).toBe(36.2175);
      expect(arc1After.sensitivityStatus).toBe("PUBLIC");
      // Both users' rows intact: same row IDs, landmark IDs, and created_at.
      expect(await rowsOf(a.userId)).toEqual(aRows);
      expect(await rowsOf(b.userId)).toEqual(bRows);
      // The favorites API returns the updated metadata, for both users.
      for (const user of [a, b]) {
        const renamedEntry = await entryFor(app, user, arc1.id);
        expect(renamedEntry).toEqual({
          landmark_id: arc1.id,
          availability: "available",
          landmark: {
            id: arc1.id,
            display_name: "Renamed Arch",
            category: "arch",
            latitude: 36.2175,
            longitude: -84.12754,
          },
        });
        await expectNoMoreThanPublic(app, renamedEntry!);
      }

      // 3. Retirement via re-import: a complete synthetic set without ARC002.
      const withoutArc2 = fixture([ARC001(...RENAMED)]);
      try {
        expect((await importSynthetic(withoutArc2.dir)).result.retired).toBe(1);
      } finally {
        withoutArc2.cleanup();
      }
      const arc2Retired = await prisma.landmark.findUniqueOrThrow({ where: { id: arc2.id } });
      expect(arc2Retired.isActive).toBe(false);
      expect(arc2Retired.sensitivityStatus).toBe("PUBLIC");
      expect(await rowsOf(a.userId)).toEqual(aRows);
      expect(await rowsOf(b.userId)).toEqual(bRows);
      for (const user of [a, b]) {
        const entry = await entryFor(app, user, arc2.id);
        expect(entry).toEqual({ landmark_id: arc2.id, availability: "unavailable" });
        await expectNoMoreThanPublic(app, entry!);
      }
      // A removes the retired favorite; B keeps it.
      expect((await asUser(app, a).delete(favPath(arc2.id))).status).toBe(200);
      expect((await rowsOf(a.userId)).map((r) => r.landmarkId)).toEqual([arc1.id]);

      // 4. Reactivation via re-import: same id, active, PUBLIC preserved, B's row intact.
      const restored = fixture([ARC001(...RENAMED), ARC002]);
      try {
        expect((await importSynthetic(restored.dir)).result.reactivated).toBe(1);
      } finally {
        restored.cleanup();
      }
      const arc2Back = await prisma.landmark.findUniqueOrThrow({ where: { sourceCode: "ARC002" } });
      expect(arc2Back.id).toBe(arc2.id);
      expect(arc2Back.isActive).toBe(true);
      expect(arc2Back.sensitivityStatus).toBe("PUBLIC");
      expect(await rowsOf(b.userId)).toEqual(bRows);
      const backEntry = await entryFor(app, b, arc2.id);
      expect(backEntry?.availability).toBe("available");
      await expectNoMoreThanPublic(app, backEntry!);
      expect(await entryFor(app, a, arc2.id)).toBeUndefined();

      // The relationship key is the internal UUID throughout, never source_code.
      const allRows = await prisma.favorite.findMany();
      expect(allRows.every((r) => [arc1.id, arc2.id].includes(r.landmarkId))).toBe(true);
    });
  });
});
