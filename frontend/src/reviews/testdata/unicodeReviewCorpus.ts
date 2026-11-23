// The import attribute lets Playwright's native ES-module loader read the JSON too.
import corpus from "./unicodeReviewCorpus.json" with { type: "json" };

/**
 * Decoder for the shared Unicode review corpus (M04-T04 Increment 2). TEST
 * DATA ONLY: used by the frontend parity tests and the Playwright checks; the
 * backend tests decode the same JSON file with their own copy of these rules
 * and both sides pin the same fingerprint, so the two decoders cannot drift.
 */

type Segment = string | { text: string } | { repeat: number; of: Segment[] };

export type UnicodeExpectation =
  | { kind: "text"; value: string }
  | { kind: "null" }
  | { kind: "reject"; reason: "characters" | "tooLong" };

export interface UnicodeCase {
  id: string;
  group: string;
  input: string;
  expect: UnicodeExpectation;
}

const CODE_POINT = /^U\+([0-9A-F]{4,6})$/;

/** Builds a string from segments; "U+XXXX" may name a lone surrogate on purpose. */
export function decodeSegments(segments: readonly Segment[]): string {
  let out = "";
  for (const segment of segments) {
    if (typeof segment === "string") {
      const match = CODE_POINT.exec(segment);
      if (!match) throw new Error(`Bad code point segment: ${segment}`);
      out += String.fromCodePoint(Number.parseInt(match[1]!, 16));
    } else if ("text" in segment) {
      out += segment.text;
    } else {
      out += decodeSegments(segment.of).repeat(segment.repeat);
    }
  }
  return out;
}

interface RawCase {
  id: string;
  group: string;
  input: Segment[];
  expect:
    | { kind: "text"; value: Segment[] }
    | { kind: "null" }
    | { kind: "reject"; reason: "characters" | "tooLong" };
}

export const UNICODE_REVIEW_CASES: readonly UnicodeCase[] = (
  corpus.cases as unknown as RawCase[]
).map((raw) => ({
  id: raw.id,
  group: raw.group,
  input: decodeSegments(raw.input),
  expect:
    raw.expect.kind === "text"
      ? { kind: "text", value: decodeSegments(raw.expect.value) }
      : raw.expect,
}));

/**
 * A decoder fingerprint both test suites pin: the number of cases and the
 * total UTF-16 length of every decoded input and expected value.
 */
export function corpusFingerprint(cases: readonly UnicodeCase[]): string {
  const units = cases.reduce(
    (sum, c) => sum + c.input.length + (c.expect.kind === "text" ? c.expect.value.length : 0),
    0,
  );
  return `${cases.length}:${units}`;
}
