import type { Express } from "express";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { MESSAGES } from "../src/reviews/request-schema.js";
import { anonymous, asUser, createSignedInUser, type TestUser } from "./helpers/test-users.js";
import {
  UNICODE_CORPUS_FINGERPRINT,
  corpusFingerprint,
  loadUnicodeReviewCorpus,
} from "./helpers/unicode-review-corpus.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M04-T04 Increment 2 — the shared Unicode corpus through the REAL API, JSON
 * transport, and PostgreSQL (spec v1.1 section 4.1; ADR-013 decision 8;
 * decision D1). For every case: create and edit give the corpus outcome; what
 * PostgreSQL stores is byte-for-byte the expected text; its `char_length`
 * (code points in a UTF-8 database) equals the API's code-point count; and the
 * public list returns it unchanged. Verification only.
 *
 * The real reviews limiter (20 mutations per user per minute, counted before
 * validation) is respected by moving to a fresh account before the limit.
 */

const CASES = loadUnicodeReviewCorpus();
const REASON_MESSAGE = {
  characters: MESSAGES.bodyCharacters,
  tooLong: MESSAGES.bodyTooLong,
} as const;

let sequence = 0;
async function createLandmark(): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `UNI${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNSINKS",
      category: "SINK",
      displayName: `Unicode Test Sink ${sequence}`,
      latitude: 35.9,
      longitude: -85.3,
      sensitivityStatus: "PUBLIC",
    },
  });
  return landmark.id;
}

function mutationBudget(app: Express, landmarkId: string, perUser = 18) {
  let current: { user: TestUser; reviewId: string } | null = null;
  let used = 0;
  return async () => {
    if (current === null || used >= perUser) {
      const user = await createSignedInUser(app, "unicode");
      const created = await asUser(app, user)
        .post("/api/v1/reviews")
        .send({ landmark_id: landmarkId, rating: 3, body: "seed" });
      expect(created.status).toBe(201);
      current = { user, reviewId: created.body.id as string };
      used = 1;
    }
    used += 1;
    return current;
  };
}

/** What PostgreSQL holds for a review: the text and its own code-point count. */
async function stored(id: string): Promise<{ body: string | null; length: number | null }> {
  const rows = await prisma.$queryRaw<{ body: string | null; length: number | null }[]>`
    SELECT body, char_length(body)::int AS length FROM reviews WHERE id = ${id}::uuid`;
  return rows[0]!;
}

describe("shared Unicode corpus through the API and database (M04-T04 Increment 2)", () => {
  const app = createApp();

  afterEach(async () => {
    await resetTestDatabase();
  });

  it("uses the same decoded corpus as the frontend suite", () => {
    expect(corpusFingerprint(CASES)).toBe(UNICODE_CORPUS_FINGERPRINT);
  });

  it("create and edit store exactly the corpus outcome; PostgreSQL counts the same code points; the list returns it unchanged", async () => {
    const seedLandmark = await createLandmark();
    const take = mutationBudget(app, seedLandmark, 17);
    for (const testCase of CASES) {
      const label = testCase.id;
      const { user, reviewId } = await take();
      await take(); // reserve the second mutation of this case
      const target = await createLandmark();
      const before = await stored(reviewId);
      const created = await asUser(app, user)
        .post("/api/v1/reviews")
        .send({ landmark_id: target, rating: 4, body: testCase.input });
      const edited = await asUser(app, user).patch(`/api/v1/reviews/${reviewId}`).send({
        body: testCase.input,
      });

      if (testCase.expect.kind === "reject") {
        const message = REASON_MESSAGE[testCase.expect.reason];
        for (const response of [created, edited]) {
          expect(response.status, label).toBe(400);
          expect(response.body, label).toEqual({ error: { code: "INVALID_REQUEST", message } });
        }
        expect(await prisma.review.count({ where: { landmarkId: target } }), label).toBe(0);
        expect(await stored(reviewId), label).toEqual(before); // unchanged by the refused edit
        continue;
      }

      const expected = testCase.expect.kind === "text" ? testCase.expect.value : null;
      const length = expected === null ? null : Array.from(expected).length;
      expect(created.status, label).toBe(201);
      expect(edited.status, label).toBe(200);
      expect(created.body.body, label).toBe(expected);
      expect(edited.body.body, label).toBe(expected);
      expect(await stored(created.body.id as string), label).toEqual({ body: expected, length });
      expect(await stored(reviewId), label).toEqual({ body: expected, length });

      const list = await anonymous(app).get(`/api/v1/landmarks/${target}/reviews`);
      expect(list.status, label).toBe(200);
      expect(list.body.reviews, label).toHaveLength(1);
      expect(list.body.reviews[0].body, label).toBe(expected);
    }
  });

  it("D1: zero-width-only text is published like any other text (lookup and list)", async () => {
    const landmark = await createLandmark();
    const user = await createSignedInUser(app);
    const zeroWidth = CASES.find((c) => c.id === "zw-space-only")!.input;
    const created = await asUser(app, user)
      .post("/api/v1/reviews")
      .send({ landmark_id: landmark, rating: 5, body: zeroWidth });
    expect(created.status).toBe(201);
    const lookup = await asUser(app, user).get(`/api/v1/reviews?landmark_id=${landmark}`);
    expect(lookup.body.review.body).toBe(zeroWidth);
    const list = await anonymous(app).get(`/api/v1/landmarks/${landmark}/reviews`);
    expect(list.body.reviews[0].body).toBe(zeroWidth);
    expect(list.body.aggregate).toEqual({ average_rating: 5, rating_count: 1 });
  });
});
