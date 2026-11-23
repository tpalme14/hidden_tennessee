import { describe, expect, it } from "vitest";
import {
  MAX_BODY_CODE_POINTS,
  MESSAGES,
  ReviewsRequestError,
  countCodePoints,
  normalizeReviewBody,
  parseCreateBody,
  parsePatchBody,
} from "../src/reviews/request-schema.js";
import {
  UNICODE_CORPUS_FINGERPRINT,
  corpusFingerprint,
  loadUnicodeReviewCorpus,
} from "./helpers/unicode-review-corpus.js";

/**
 * M04-T04 Increment 2 — server half of the frontend/server validation parity
 * check (spec v1.1 section 4.1; ADR-013 decision 8; decision D1). The SAME
 * corpus and expectations are asserted against the frontend validator in
 * frontend/src/reviews/unicodeParity.test.ts. Verification only.
 */

const CASES = loadUnicodeReviewCorpus();
const LANDMARK = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const REASON_MESSAGE = {
  characters: MESSAGES.bodyCharacters,
  tooLong: MESSAGES.bodyTooLong,
} as const;

function outcome(run: () => unknown): { ok: true; value: unknown } | { ok: false; error: unknown } {
  try {
    return { ok: true, value: run() };
  } catch (error) {
    return { ok: false, error };
  }
}

describe("shared Unicode corpus (server validator; M04-T04 Increment 2)", () => {
  it("decodes to the fingerprint pinned by the frontend suite", () => {
    expect(corpusFingerprint(CASES)).toBe(UNICODE_CORPUS_FINGERPRINT);
  });

  describe.each(CASES.map((c) => [c.id, c] as const))("%s", (_id, testCase) => {
    it("normalizeReviewBody, create, and edit give the corpus outcome", () => {
      const results = [
        outcome(() => normalizeReviewBody(testCase.input)),
        outcome(
          () => parseCreateBody({ landmark_id: LANDMARK, rating: 3, body: testCase.input }).body,
        ),
        outcome(() => parsePatchBody({ body: testCase.input }).body),
      ];
      for (const result of results) {
        if (testCase.expect.kind === "reject") {
          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.error).toBeInstanceOf(ReviewsRequestError);
            expect((result.error as ReviewsRequestError).code).toBe("INVALID_REQUEST");
            expect((result.error as ReviewsRequestError).message).toBe(
              REASON_MESSAGE[testCase.expect.reason],
            );
          }
        } else {
          const expected = testCase.expect.kind === "text" ? testCase.expect.value : null;
          expect(result).toEqual({ ok: true, value: expected });
          if (typeof expected === "string") {
            expect(countCodePoints(expected)).toBeLessThanOrEqual(MAX_BODY_CODE_POINTS);
          }
        }
      }
    });
  });

  it("D1: zero-width-only text is valid and kept exactly (no rejection rule, no normalization)", () => {
    for (const id of [
      "zw-space-only",
      "zw-non-joiner-only",
      "zw-joiner-only",
      "word-joiner-only",
    ]) {
      const testCase = CASES.find((c) => c.id === id)!;
      expect(normalizeReviewBody(testCase.input)).toBe(testCase.input);
    }
  });
});
