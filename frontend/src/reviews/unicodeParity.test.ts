import { afterEach, describe, expect, it } from "vitest";
import { UNICODE_REVIEW_CASES, corpusFingerprint } from "./testdata/unicodeReviewCorpus";
import {
  MAX_BODY_CODE_POINTS,
  REVIEW_MESSAGES,
  countCodePoints,
  isWellFormedText,
  normalizeReviewBody,
  validateReviewDraft,
  validateReviewPatch,
} from "./validation";

/**
 * M04-T04 Increment 2 — frontend half of the frontend/server validation
 * parity check. The same explicitly defined corpus
 * (testdata/unicodeReviewCorpus.json) is run through the server's validator
 * in backend/tests/reviews-unicode.test.ts; both suites assert the SAME
 * expected outcome for every case, so they agree with each other exactly.
 * Decision D1: zero-width-only text is valid text (pinned below).
 */

/** Pinned in both suites, so the frontend and backend decoders cannot drift. */
const FINGERPRINT = "43:38346";

const REASON_MESSAGE = {
  characters: REVIEW_MESSAGES.bodyCharacters,
  tooLong: REVIEW_MESSAGES.bodyTooLong,
} as const;

describe("shared Unicode corpus (frontend validator; M04-T04 Increment 2)", () => {
  it("decodes to the pinned fingerprint", () => {
    expect(corpusFingerprint(UNICODE_REVIEW_CASES)).toBe(FINGERPRINT);
  });

  describe.each(UNICODE_REVIEW_CASES.map((c) => [c.id, c] as const))("%s", (_id, testCase) => {
    it("normalizeReviewBody gives the corpus outcome", () => {
      const result = normalizeReviewBody(testCase.input);
      switch (testCase.expect.kind) {
        case "text":
          expect(result).toEqual({ ok: true, value: testCase.expect.value });
          if (result.ok && result.value !== null) {
            expect(countCodePoints(result.value)).toBeLessThanOrEqual(MAX_BODY_CODE_POINTS);
          }
          break;
        case "null":
          expect(result).toEqual({ ok: true, value: null });
          break;
        case "reject":
          expect(result).toEqual({ ok: false, message: REASON_MESSAGE[testCase.expect.reason] });
      }
    });

    it("create and edit validation agree with it", () => {
      const draft = validateReviewDraft({ rating: 3, body: testCase.input });
      const patch = validateReviewPatch({ body: testCase.input });
      if (testCase.expect.kind === "reject") {
        const message = REASON_MESSAGE[testCase.expect.reason];
        expect(draft).toEqual({ ok: false, errors: { body: message } });
        expect(patch).toEqual({ ok: false, errors: { body: message } });
      } else {
        const body = testCase.expect.kind === "text" ? testCase.expect.value : null;
        expect(draft).toEqual({ ok: true, value: { rating: 3, body } });
        // An edit always keeps the body key: null clears the text (spec section 4.2).
        expect(patch).toEqual({ ok: true, value: { body } });
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
      const testCase = UNICODE_REVIEW_CASES.find((c) => c.id === id)!;
      expect(normalizeReviewBody(testCase.input)).toEqual({ ok: true, value: testCase.input });
    }
  });
});

describe("the well-formedness fallback (browsers without String.prototype.isWellFormed)", () => {
  const proto = String.prototype as unknown as { isWellFormed?: () => boolean };
  const native = proto.isWellFormed;

  afterEach(() => {
    if (native) proto.isWellFormed = native;
  });

  it("gives the same outcome as the native check for every corpus case", () => {
    expect(typeof native).toBe("function");
    const nativeResults = UNICODE_REVIEW_CASES.map((c) => isWellFormedText(c.input));
    delete proto.isWellFormed;
    expect("isWellFormed" in String.prototype).toBe(false);
    const fallbackResults = UNICODE_REVIEW_CASES.map((c) => isWellFormedText(c.input));
    expect(fallbackResults).toEqual(nativeResults);
    for (const testCase of UNICODE_REVIEW_CASES) {
      const result = normalizeReviewBody(testCase.input);
      if (testCase.expect.kind === "reject") {
        expect(result, testCase.id).toEqual({
          ok: false,
          message: REASON_MESSAGE[testCase.expect.reason],
        });
      } else {
        expect(result.ok, testCase.id).toBe(true);
      }
    }
  });
});
