import { readFileSync } from "node:fs";

/**
 * The shared Unicode review corpus (M04-T04 Increment 2), read from its single
 * source, `frontend/src/reviews/testdata/unicodeReviewCorpus.json`, and decoded
 * with the backend's own copy of the segment rules. The frontend decoder pins
 * the same fingerprint (`frontend/src/reviews/unicodeParity.test.ts`), so the
 * two copies cannot drift apart unnoticed. Test data only.
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

interface RawCase {
  id: string;
  group: string;
  input: Segment[];
  expect:
    | { kind: "text"; value: Segment[] }
    | { kind: "null" }
    | { kind: "reject"; reason: "characters" | "tooLong" };
}

const CORPUS_URL = new URL(
  "../../../frontend/src/reviews/testdata/unicodeReviewCorpus.json",
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

export function loadUnicodeReviewCorpus(): UnicodeCase[] {
  const raw = JSON.parse(readFileSync(CORPUS_URL, "utf8")) as { cases: RawCase[] };
  return raw.cases.map((c) => ({
    id: c.id,
    group: c.group,
    input: decode(c.input),
    expect: c.expect.kind === "text" ? { kind: "text", value: decode(c.expect.value) } : c.expect,
  }));
}

/** Number of cases and the total UTF-16 length of inputs and expected values. */
export function corpusFingerprint(cases: readonly UnicodeCase[]): string {
  const units = cases.reduce(
    (sum, c) => sum + c.input.length + (c.expect.kind === "text" ? c.expect.value.length : 0),
    0,
  );
  return `${cases.length}:${units}`;
}

/** Pinned identically in the frontend parity test. */
export const UNICODE_CORPUS_FINGERPRINT = "43:38346";
