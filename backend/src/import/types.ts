import type { LandmarkCategory, LandmarkSourceFile } from "@prisma/client";

// Raw shape produced by the XML parser for a single <wpt>. Every field is
// `unknown` deliberately: nothing about the parser's output is trusted until
// explicitly validated in landmark-mapper.ts / validation.ts.
export interface RawWaypoint {
  "@_lat"?: unknown;
  "@_lon"?: unknown;
  name?: unknown;
  cmt?: unknown;
  desc?: unknown;
  link?: { "@_href"?: unknown; text?: unknown } | string;
  sym?: unknown;
}

export type FileStatus =
  | { status: "ok" }
  | { status: "missing" }
  | { status: "unreadable"; error: string }
  | { status: "malformed"; error: string };

export interface CandidateLandmark {
  sourceCode: string;
  sourceFile: LandmarkSourceFile;
  category: LandmarkCategory;
  displayName: string;
  latitude: number;
  longitude: number;
  sourceDescription: string | null;
  sourceAccessLabel: string | null;
  sourceUrl: string | null;
}

// `sourceCode` is null when the record cannot be reliably identified at all
// (missing/malformed <name>) — see RejectionKind.
export type RejectionKind = "unidentifiable" | "invalid" | "conflict";

export interface RejectedRecord {
  sourceFile: string; // GPX filename, e.g. "tnfalls.gpx"
  sourceCode: string | null;
  kind: RejectionKind;
  reason: string;
}

export interface ParsedFileResult {
  filename: string;
  fileStatus: FileStatus;
  accepted: CandidateLandmark[];
  rejected: RejectedRecord[];
  /** true if this file had at least one unidentifiable record, per spec requirement to
   * conservatively disable retirement for the affected file. */
  retirementDisabled: boolean;
}
