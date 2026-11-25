// The import attribute lets Playwright's native ES-module loader read the JSON too.
import corpus from "./tripNameCorpus.json" with { type: "json" };

/**
 * Decoder for the shared trip-name corpus (M05-T04 Increment 1; M05-T03
 * decision T3-5). TEST DATA ONLY — never imported by application code. The
 * backend decodes the same JSON file with its own copy of these rules
 * (`backend/tests/helpers/trip-name-corpus.ts`), and both sides pin the same
 * fingerprint, so the two decoders cannot drift apart unnoticed.
 */

type Segment = string | { text: string } | { repeat: number; of: Segment[] };

export type TripNameExpectation =
  | { kind: "name"; value: string }
  | { kind: "reject"; reason: "characters" | "noVisible" | "tooLong" };

export interface TripNameCase {
  id: string;
  group: string;
  input: string;
  expect: TripNameExpectation;
}

interface RawCase {
  id: string;
  group: string;
  input: Segment[];
  expect:
    | { kind: "name"; value: Segment[] }
    | { kind: "reject"; reason: "characters" | "noVisible" | "tooLong" };
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

export const TRIP_NAME_CASES: readonly TripNameCase[] = (corpus.cases as unknown as RawCase[]).map(
  (raw) => ({
    id: raw.id,
    group: raw.group,
    input: decodeSegments(raw.input),
    expect:
      raw.expect.kind === "name"
        ? { kind: "name", value: decodeSegments(raw.expect.value) }
        : raw.expect,
  }),
);

/** Number of cases and the total UTF-16 length of inputs and expected names (same formula as the backend). */
export function tripNameCorpusFingerprint(cases: readonly TripNameCase[]): string {
  const units = cases.reduce(
    (sum, c) => sum + c.input.length + (c.expect.kind === "name" ? c.expect.value.length : 0),
    0,
  );
  return `${cases.length}:${units}`;
}
