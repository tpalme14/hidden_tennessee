import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { applyImport } from "../src/import/apply.js";
import { runPreflight } from "../src/import/preview.js";
import { buildGpxXml, createGpxFixtureDir, type FixtureWaypoint } from "./helpers/gpx-fixtures.js";
import {
  anonymous,
  asUser,
  createSignedInUser,
  createTwoUsers,
  signOut,
  type TestUser,
} from "./helpers/test-users.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M04-T02 Increment 4 — reviews through their whole lifecycle over real HTTP
 * with real accounts (spec v1.1 §9 tests #2, #5, #7, #8, #11, #12, #13):
 * the complete create → lookup → list → edit → delete journey with aggregates
 * at every step; reclassification and retirement hiding reviews without
 * losing them; and preservation through the REAL GPX import pipeline
 * (runPreflight → applyImport).
 *
 * Import safety (same rules as the favorites lifecycle suite): imports run
 * ONLY against landmarks_test (asserted live before each import) and ONLY
 * from generated temporary GPX fixture directories (asserted to be under the
 * OS temp directory and outside the repository's coordinates/).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REAL_COORDINATES_DIR = path.resolve(__dirname, "../../coordinates");
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Resource not found." } };
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

let sequence = 0;
async function createLandmark(): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `BAL${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNBALDS",
      category: "BALD",
      displayName: `Restricted Bald ${sequence}`,
      latitude: 35.6,
      longitude: -83.9,
      sourceDescription: "restricted description",
      sensitivityStatus: "PUBLIC",
    },
  });
  return landmark.id;
}

const reviewPath = (id: string) => `/api/v1/reviews/${id}`;
const lookupPath = (landmarkId: string) => `/api/v1/reviews?landmark_id=${landmarkId}`;
const listPath = (landmarkId: string) => `/api/v1/landmarks/${landmarkId}/reviews`;
const reviewRows = (landmarkId: string) =>
  prisma.review.findMany({ where: { landmarkId }, orderBy: { id: "asc" } });

async function list(app: Express, landmarkId: string) {
  const response = await anonymous(app).get(listPath(landmarkId));
  return { status: response.status, body: response.body };
}

async function expectHidden(app: Express, landmarkId: string, owner: TestUser, reviewId: string) {
  expect(await list(app, landmarkId)).toEqual({ status: 404, body: NOT_FOUND });
  const lookup = await asUser(app, owner).get(lookupPath(landmarkId));
  expect(lookup.status).toBe(404);
  expect(lookup.body).toEqual(NOT_FOUND);
  const edit = await asUser(app, owner).patch(reviewPath(reviewId)).send({ rating: 1 });
  expect(edit.status).toBe(404);
  expect(edit.body).toEqual(NOT_FOUND);
}

describe("reviews lifecycle (integration, M04-T02 Increment 4)", () => {
  const app = createApp();

  afterEach(async () => {
    await resetTestDatabase();
  });

  it("the complete journey: create, duplicate, lookup, list, edit, delete — with correct aggregates at every step", async () => {
    const [a, b] = await createTwoUsers(app);
    const landmark = await createLandmark();

    // Empty landmark: no reviews, null average (not a misleading zero).
    expect((await list(app, landmark)).body).toEqual({
      reviews: [],
      aggregate: { average_rating: null, rating_count: 0 },
      page: 1,
      limit: 20,
      has_more: false,
    });
    expect((await asUser(app, a).get(lookupPath(landmark))).body).toEqual({ review: null });

    // A: rating-only. B: rating with text.
    const aCreated = await asUser(app, a)
      .post("/api/v1/reviews")
      .send({ landmark_id: landmark, rating: 2 });
    expect(aCreated.status).toBe(201);
    expect(aCreated.body).toMatchObject({
      rating: 2,
      body: null,
      created_at: expect.stringMatching(ISO_UTC_MS),
    });
    const bCreated = await asUser(app, b)
      .post("/api/v1/reviews")
      .send({ landmark_id: landmark, rating: 5, body: "Wide open views.\nWorth the climb." });
    expect(bCreated.status).toBe(201);
    expect((await list(app, landmark)).body.aggregate).toEqual({
      average_rating: 3.5,
      rating_count: 2,
    });

    // Duplicate create is refused and changes nothing.
    const duplicate = await asUser(app, a)
      .post("/api/v1/reviews")
      .send({ landmark_id: landmark, rating: 5 });
    expect(duplicate.status).toBe(409);
    expect((await list(app, landmark)).body.aggregate).toEqual({
      average_rating: 3.5,
      rating_count: 2,
    });

    // Each user's lookup returns their own review only.
    expect((await asUser(app, a).get(lookupPath(landmark))).body.review).toEqual(aCreated.body);
    expect((await asUser(app, b).get(lookupPath(landmark))).body.review).toEqual(bCreated.body);

    // The public list shows both, newest first, in the safe representation.
    const listed = (await list(app, landmark)).body;
    expect(listed.reviews.map((r: { id: string }) => r.id)).toEqual(
      [aCreated.body, bCreated.body]
        .sort((x, y) =>
          x.created_at === y.created_at
            ? x.id < y.id
              ? 1
              : -1
            : x.created_at < y.created_at
              ? 1
              : -1,
        )
        .map((r) => r.id),
    );

    // A edits: rating up, text added; ID and created_at stable.
    const edited = await asUser(app, a)
      .patch(reviewPath(aCreated.body.id))
      .send({ rating: 4, body: "Better on a clear day." });
    expect(edited.status).toBe(200);
    expect(edited.body).toMatchObject({
      id: aCreated.body.id,
      rating: 4,
      body: "Better on a clear day.",
      created_at: aCreated.body.created_at,
    });
    expect((await list(app, landmark)).body.aggregate).toEqual({
      average_rating: 4.5,
      rating_count: 2,
    });

    // B deletes: row gone, aggregate recomputed, repeat is 404.
    expect((await asUser(app, b).delete(reviewPath(bCreated.body.id))).body).toEqual({
      success: true,
    });
    expect(await reviewRows(landmark)).toHaveLength(1);
    expect((await list(app, landmark)).body.aggregate).toEqual({
      average_rating: 4,
      rating_count: 1,
    });
    expect((await asUser(app, b).delete(reviewPath(bCreated.body.id))).status).toBe(404);
    expect((await asUser(app, b).get(lookupPath(landmark))).body).toEqual({ review: null });

    // B may now review again (a new row with a new ID).
    const again = await asUser(app, b)
      .post("/api/v1/reviews")
      .send({ landmark_id: landmark, rating: 1 });
    expect(again.status).toBe(201);
    expect(again.body.id).not.toBe(bCreated.body.id);

    // A deletes: back to the empty state.
    await asUser(app, a).delete(reviewPath(aCreated.body.id));
    await asUser(app, b).delete(reviewPath(again.body.id));
    expect((await list(app, landmark)).body.aggregate).toEqual({
      average_rating: null,
      rating_count: 0,
    });
    expect(await prisma.review.count()).toBe(0);
  });

  it("reviews persist across sign-out and a new sign-in (same row, same timestamps)", async () => {
    const user = await createSignedInUser(app, "returning");
    const landmark = await createLandmark();
    const created = await asUser(app, user)
      .post("/api/v1/reviews")
      .send({ landmark_id: landmark, rating: 3, body: "kept" });
    await signOut(app, user);
    const fresh = await createSignedInUser(app, "other");
    expect((await asUser(app, fresh).get(lookupPath(landmark))).body).toEqual({ review: null });
    const signIn = await anonymous(app)
      .post("/api/auth/sign-in/email")
      .send({ email: user.email, password: "test-only-password-not-a-secret" });
    const cookie = (signIn.headers["set-cookie"] as unknown as string[])
      .find((c) => c.startsWith("better-auth.session_token="))!
      .split(";")[0]!;
    expect((await asUser(app, { ...user, cookie }).get(lookupPath(landmark))).body).toEqual({
      review: created.body,
    });
  });

  describe("reclassification and retirement hide reviews without losing them (spec #11, #12)", () => {
    it.each([
      ["SENSITIVE", { sensitivityStatus: "SENSITIVE" as const }],
      ["UNREVIEWED", { sensitivityStatus: "UNREVIEWED" as const }],
      ["retired", { isActive: false }],
    ])(
      "while %s: hidden everywhere, rows preserved, owner may delete; restored: visible again unchanged",
      async (_l, change) => {
        const [a, b] = await createTwoUsers(app);
        const landmark = await createLandmark();
        const aId = (
          await asUser(app, a).post("/api/v1/reviews").send({ landmark_id: landmark, rating: 2 })
        ).body.id;
        const bId = (
          await asUser(app, b)
            .post("/api/v1/reviews")
            .send({ landmark_id: landmark, rating: 4, body: "b" })
        ).body.id;
        const before = await reviewRows(landmark);
        const listedBefore = (await list(app, landmark)).body;

        await prisma.landmark.update({ where: { id: landmark }, data: change });
        await expectHidden(app, landmark, a, aId);
        await expectHidden(app, landmark, b, bId);
        expect(
          (await asUser(app, a).post("/api/v1/reviews").send({ landmark_id: landmark, rating: 5 }))
            .status,
        ).toBe(404);
        expect(await reviewRows(landmark)).toEqual(before);

        // A deletes their review while hidden; B keeps theirs.
        const deleted = await asUser(app, a).delete(reviewPath(aId));
        expect(deleted.status).toBe(200);
        expect(deleted.body).toEqual({ success: true });

        await prisma.landmark.update({
          where: { id: landmark },
          data: { sensitivityStatus: "PUBLIC", isActive: true },
        });
        const after = (await list(app, landmark)).body;
        expect(after.reviews).toEqual(
          listedBefore.reviews.filter((r: { id: string }) => r.id === bId),
        );
        expect(after.aggregate).toEqual({ average_rating: 4, rating_count: 1 });
        expect(await reviewRows(landmark)).toEqual(before.filter((r) => r.id === bId));
      },
    );
  });

  describe("GPX re-import preserves reviews (spec #12; real import pipeline)", () => {
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
     * The update step also shifts ARC001 by 0.0001° latitude so the EXISTING
     * import update path runs: a metadata-only change is currently classified
     * "unchanged" (the open M01-T04 defect), as in the favorites lifecycle suite.
     */
    const RENAMED = ["Renamed Arch", "Campbell", 36.2175] as const;
    const ARC002: FixtureWaypoint = {
      lat: 36.3,
      lon: -84.2,
      name: "ARC002",
      cmt: "Second Arch",
      desc: "Anderson",
    };

    async function importSynthetic(dir: string) {
      const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
      expect(row!.db).toBe("landmarks_test");
      const realDir = realpathSync(dir);
      expect(realDir.startsWith(realpathSync(tmpdir()))).toBe(true);
      expect(path.relative(REAL_COORDINATES_DIR, realDir).startsWith("..")).toBe(true);
      const { artifact } = await runPreflight(prisma, dir, dir);
      return applyImport(prisma, dir, artifact, new Set(artifact.requiredApprovals));
    }

    async function runImport(arches: FixtureWaypoint[]) {
      const dir = fixture(arches);
      try {
        return await importSynthetic(dir.dir);
      } finally {
        dir.cleanup();
      }
    }

    it("update, retirement, and reactivation keep landmark IDs and review rows; reviews hide and return with the landmark", async () => {
      const [a, b] = await createTwoUsers(app);
      expect(await runImport([ARC001("Original Arch"), ARC002])).toEqual({
        inserted: 2,
        updated: 0,
        reactivated: 0,
        retired: 0,
      });
      const arc1 = await prisma.landmark.findUniqueOrThrow({ where: { sourceCode: "ARC001" } });
      const arc2 = await prisma.landmark.findUniqueOrThrow({ where: { sourceCode: "ARC002" } });
      // Imported landmarks are UNREVIEWED and cannot be reviewed…
      expect(
        (await asUser(app, a).post("/api/v1/reviews").send({ landmark_id: arc1.id, rating: 3 }))
          .status,
      ).toBe(404);
      // …so classify them PUBLIC (test-only) and review both.
      await prisma.landmark.updateMany({
        where: { id: { in: [arc1.id, arc2.id] } },
        data: { sensitivityStatus: "PUBLIC" },
      });
      const ids: Record<string, string> = {};
      for (const [user, rating] of [
        [a, 2],
        [b, 5],
      ] as const) {
        for (const landmark of [arc1, arc2]) {
          const created = await asUser(app, user)
            .post("/api/v1/reviews")
            .send({ landmark_id: landmark.id, rating });
          expect(created.status).toBe(201);
          ids[`${user.userId}:${landmark.sourceCode}`] = created.body.id;
        }
      }
      const rows1 = await reviewRows(arc1.id);
      const rows2 = await reviewRows(arc2.id);
      const list1 = (await list(app, arc1.id)).body;

      // 1. Update through re-import: same landmark ID, same review rows and list.
      expect(await runImport([ARC001(...RENAMED), ARC002])).toEqual({
        inserted: 0,
        updated: 1,
        reactivated: 0,
        retired: 0,
      });
      const arc1After = await prisma.landmark.findUniqueOrThrow({
        where: { sourceCode: "ARC001" },
      });
      expect(arc1After.id).toBe(arc1.id);
      expect(arc1After.displayName).toBe("Renamed Arch");
      expect(arc1After.sensitivityStatus).toBe("PUBLIC");
      expect(await reviewRows(arc1.id)).toEqual(rows1);
      expect((await list(app, arc1.id)).body).toEqual(list1);

      // 2. Retirement through re-import: ARC002 hidden everywhere; rows preserved.
      expect((await runImport([ARC001(...RENAMED)])).retired).toBe(1);
      const arc2Retired = await prisma.landmark.findUniqueOrThrow({ where: { id: arc2.id } });
      expect(arc2Retired.isActive).toBe(false);
      expect(await reviewRows(arc2.id)).toEqual(rows2);
      await expectHidden(app, arc2.id, a, ids[`${a.userId}:ARC002`]!);
      await expectHidden(app, arc2.id, b, ids[`${b.userId}:ARC002`]!);
      // A deletes their review of the retired landmark; B keeps theirs.
      expect((await asUser(app, a).delete(reviewPath(ids[`${a.userId}:ARC002`]!))).status).toBe(
        200,
      );
      // ARC001 is unaffected.
      expect((await list(app, arc1.id)).body.aggregate).toEqual({
        average_rating: 3.5,
        rating_count: 2,
      });

      // 3. Reactivation through re-import: same ID; B's review returns unchanged.
      expect((await runImport([ARC001(...RENAMED), ARC002])).reactivated).toBe(1);
      const arc2Back = await prisma.landmark.findUniqueOrThrow({ where: { sourceCode: "ARC002" } });
      expect(arc2Back.id).toBe(arc2.id);
      expect(arc2Back.isActive).toBe(true);
      expect(arc2Back.sensitivityStatus).toBe("PUBLIC");
      expect(await reviewRows(arc2.id)).toEqual(rows2.filter((r) => r.userId === b.userId));
      const back = (await list(app, arc2.id)).body;
      expect(back.reviews.map((r: { id: string }) => r.id)).toEqual([ids[`${b.userId}:ARC002`]]);
      expect(back.aggregate).toEqual({ average_rating: 5, rating_count: 1 });
      expect((await asUser(app, a).get(lookupPath(arc2.id))).body).toEqual({ review: null });

      // Reviews reference the internal landmark UUID throughout, never source_code.
      const all = await prisma.review.findMany();
      expect(all.every((r) => [arc1.id, arc2.id].includes(r.landmarkId))).toBe(true);
    });
  });
});
