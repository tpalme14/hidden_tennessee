import { readFileSync } from "node:fs";

/**
 * The shared trip-name corpus (M05-T03 Increment 1; decision T3-5), read from
 * its single source, `frontend/src/trips/testdata/tripNameCorpus.json`, and
 * decoded with the backend's own copy of the segment rules (the same format
 * as the review corpus). The frontend parity test (M05-T04) must pin the same
 * fingerprint, so the two decoders cannot drift apart unnoticed. Test data
 * only.
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

export const TRIP_NAME_CORPUS_URL = new URL(
  "../../../frontend/src/trips/testdata/tripNameCorpus.json",
  import.meta.url,
);

const CODE_POINT = /^U\+([0-9A-F]{4,6})$/;

function decode(segments: readonly Segment[]): string {
  let out = "";
  for (const segment of segments) {
    if (typeof segment === "string") {
      const match = CODE_POINT.exec(segment);
      if (!match) throw new Error(`Bad code point segment: ${segment}`);
      out += String.fromCodePoint(Number.parseInt(match[1]!, 16));
    } else if ("text" in segment) {
      out += segment.text;
    } else {
      out += decode(segment.of).repeat(segment.repeat);
    }
  }
  return out;
}

export function loadTripNameCorpus(): TripNameCase[] {
  const raw = JSON.parse(readFileSync(TRIP_NAME_CORPUS_URL, "utf8")) as { cases: RawCase[] };
  return raw.cases.map((c) => ({
    id: c.id,
    group: c.group,
    input: decode(c.input),
    expect: c.expect.kind === "name" ? { kind: "name", value: decode(c.expect.value) } : c.expect,
  }));
}

/** Number of cases and the total UTF-16 length of inputs and expected names. */
export function tripNameCorpusFingerprint(cases: readonly TripNameCase[]): string {
  const units = cases.reduce(
    (sum, c) => sum + c.input.length + (c.expect.kind === "name" ? c.expect.value.length : 0),
    0,
  );
  return `${cases.length}:${units}`;
}
