import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  MAX_TRIP_NAME_CODE_POINTS,
  isForbiddenNameCodePoint,
  validateTripName,
} from "../src/trips/name-rule.js";
import {
  TRIP_NAME_CORPUS_URL,
  loadTripNameCorpus,
  tripNameCorpusFingerprint,
} from "./helpers/trip-name-corpus.js";

/**
 * M05-T03 Increment 1 — the trip-name rule (specs/TRIP_PLANNING_SPEC.md v1.1
 * §5.1.1; ADR-014 decision 5) against the shared corpus, plus the cases the
 * corpus cannot express (non-string values) and the forbidden-code-point
 * boundaries.
 */

const cases = loadTripNameCorpus();

/** Pinned; the frontend parity test (M05-T04) must pin the same value. */
const TRIP_NAME_CORPUS_FINGERPRINT = "59:1682";

describe("shared trip-name corpus", () => {
  it("is ASCII-only, has unique case IDs, and matches the pinned fingerprint", () => {
    const text = readFileSync(TRIP_NAME_CORPUS_URL, "utf8");
    expect([...text].every((ch) => ch.codePointAt(0)! <= 0x7e || ch === "\n" || ch === "\r")).toBe(
      true,
    );
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
    expect(tripNameCorpusFingerprint(cases)).toBe(TRIP_NAME_CORPUS_FINGERPRINT);
  });

  it("covers every outcome", () => {
    const outcomes = new Set(
      cases.map((c) => (c.expect.kind === "name" ? "name" : `reject:${c.expect.reason}`)),
    );
    expect([...outcomes].sort()).toEqual([
      "name",
      "reject:characters",
      "reject:noVisible",
      "reject:tooLong",
    ]);
  });

  it.each(cases.map((c) => [c.id, c] as const))("%s", (_id, c) => {
    const result = validateTripName(c.input);
    if (c.expect.kind === "name") {
      expect(result).toEqual({ ok: true, value: c.expect.value });
      expect(Array.from(c.expect.value).length).toBeLessThanOrEqual(MAX_TRIP_NAME_CODE_POINTS);
    } else {
      expect(result).toEqual({ ok: false, reason: c.expect.reason });
    }
  });
});

describe("trip-name rule outside the corpus", () => {
  it("rejects every non-string value as 'type'", () => {
    for (const value of [undefined, null, 0, 1, true, false, [], ["a"], {}, { name: "a" }]) {
      expect(validateTripName(value)).toEqual({ ok: false, reason: "type" });
    }
  });

  it("returns exactly the trimmed input, with no normalization", () => {
    const decomposed = `Cafe${String.fromCodePoint(0x301)}`;
    const precomposed = `Caf${String.fromCodePoint(0xe9)}`;
    expect(validateTripName(`  ${decomposed}  `)).toEqual({ ok: true, value: decomposed });
    expect(validateTripName(precomposed)).toEqual({ ok: true, value: precomposed });
  });

  it("forbids exactly U+0000-U+001F, U+007F-U+009F, U+2028, and U+2029", () => {
    const forbidden: number[] = [];
    for (let cp = 0; cp <= 0x10ffff; cp += 1) {
      if (isForbiddenNameCodePoint(cp)) forbidden.push(cp);
    }
    const expected = [
      ...Array.from({ length: 0x20 }, (_, i) => i),
      ...Array.from({ length: 0x21 }, (_, i) => 0x7f + i),
      0x2028,
      0x2029,
    ];
    expect(forbidden).toEqual(expected);
  });

  it("rejects each forbidden code point inside a name, and accepts the neighbouring code points", () => {
    for (const cp of [0x00, 0x09, 0x0a, 0x0d, 0x1f, 0x7f, 0x85, 0x9f, 0x2028, 0x2029]) {
      expect(validateTripName(`a${String.fromCodePoint(cp)}b`), cp.toString(16)).toEqual({
        ok: false,
        reason: "characters",
      });
    }
    for (const cp of [0x20, 0x7e, 0xa0, 0x2027, 0x202a]) {
      expect(validateTripName(`a${String.fromCodePoint(cp)}b`).ok, cp.toString(16)).toBe(true);
    }
  });
});
