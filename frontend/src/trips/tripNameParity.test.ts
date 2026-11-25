import { describe, expect, it } from "vitest";
import { TRIP_NAME_CASES, tripNameCorpusFingerprint } from "./testdata/tripNameCorpus";
import {
  MAX_TRIP_NAME_CODE_POINTS,
  TRIP_NAME_MESSAGES,
  isForbiddenNameCodePoint,
  validateTripName,
} from "./tripNameRule";

/**
 * M05-T04 Increment 1 — frontend half of the trip-name parity check (spec
 * v1.1 §5.1.1; M05-T03 decision T3-5). The same corpus
 * (testdata/tripNameCorpus.json) runs through the server's rule in
 * backend/tests/trips-name-rule.test.ts; both suites assert the SAME expected
 * outcome for every case and pin the SAME fingerprint, so they agree exactly.
 */

/** Pinned identically in backend/tests/trips-name-rule.test.ts. */
const FINGERPRINT = "59:1682";

describe("shared trip-name corpus (frontend rule)", () => {
  it("decodes to the pinned fingerprint, with unique case IDs", () => {
    expect(tripNameCorpusFingerprint(TRIP_NAME_CASES)).toBe(FINGERPRINT);
    expect(new Set(TRIP_NAME_CASES.map((c) => c.id)).size).toBe(TRIP_NAME_CASES.length);
  });

  it("covers every outcome the rule can produce from a string", () => {
    const outcomes = new Set(
      TRIP_NAME_CASES.map((c) => (c.expect.kind === "name" ? "name" : c.expect.reason)),
    );
    expect([...outcomes].sort()).toEqual(["characters", "name", "noVisible", "tooLong"]);
  });

  it.each(TRIP_NAME_CASES.map((c) => [c.id, c] as const))(
    "%s gives the corpus outcome",
    (_id, testCase) => {
      const result = validateTripName(testCase.input);
      if (testCase.expect.kind === "name") {
        expect(result).toEqual({ ok: true, value: testCase.expect.value });
      } else {
        expect(result).toEqual({
          ok: false,
          reason: testCase.expect.reason,
          message: TRIP_NAME_MESSAGES[testCase.expect.reason],
        });
      }
    },
  );
});

describe("validateTripName — outside the corpus", () => {
  it("rejects non-strings with the type message", () => {
    for (const value of [undefined, null, 5, ["Trip"], { name: "Trip" }]) {
      expect(validateTripName(value)).toEqual({
        ok: false,
        reason: "type",
        message: TRIP_NAME_MESSAGES.type,
      });
    }
  });

  it("uses the server's fixed messages word for word", () => {
    expect(TRIP_NAME_MESSAGES).toEqual({
      type: "name is required and must be text.",
      characters: "name contains characters that are not allowed.",
      noVisible: "name must contain at least one letter, number, punctuation mark, or symbol.",
      tooLong: "name must be at most 100 characters.",
    });
  });

  it("counts code points, not UTF-16 units, at the 100 boundary", () => {
    const astral = String.fromCodePoint(0x1f3de);
    expect(validateTripName(astral.repeat(MAX_TRIP_NAME_CODE_POINTS))).toEqual({
      ok: true,
      value: astral.repeat(100),
    });
    expect(validateTripName(astral.repeat(101))).toMatchObject({ ok: false, reason: "tooLong" });
  });

  it("forbids exactly the C0, DEL, C1, U+2028, and U+2029 code points", () => {
    const forbidden = [0x00, 0x09, 0x1f, 0x7f, 0x85, 0x9f, 0x2028, 0x2029];
    const allowed = [0x20, 0x7e, 0xa0, 0x200d, 0x2027, 0x202a, 0xfeff];
    for (const cp of forbidden) expect(isForbiddenNameCodePoint(cp), cp.toString(16)).toBe(true);
    for (const cp of allowed) expect(isForbiddenNameCodePoint(cp), cp.toString(16)).toBe(false);
  });
});
