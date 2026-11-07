import { join } from "node:path";
import type { LandmarkSourceFile } from "@prisma/client";
import { deduplicateCandidates } from "./duplicates.js";
import { GpxFileMissingError, GpxFileUnreadableError, GpxMalformedError, parseGpxFile } from "./gpx-parser.js";
import { mapWaypointToCandidate } from "./landmark-mapper.js";
import { EXPECTED_GPX_FILENAMES, SOURCE_FILE_CATEGORY_MAP } from "./source-files.js";
import type { CandidateLandmark, FileStatus, RejectedRecord } from "./types.js";

export interface FileSummary {
  filename: string;
  status: FileStatus;
  acceptedCount: number;
  rejectedCount: number;
  retirementDisabled: boolean;
}

export interface ParsedDataset {
  files: FileSummary[];
  accepted: CandidateLandmark[];
  rejected: RejectedRecord[];
  exactDuplicateOccurrences: number;
  /** All 8 expected files present, readable, and structurally parseable (spec §5.3/§8.4, M01-T04 decision 3). */
  isComplete: boolean;
  /** Source files for which retirement must be disabled this run (unidentifiable records found), per requirement 5. */
  filesWithRetirementDisabled: Set<LandmarkSourceFile>;
  /** Source codes that must never be retired this run (identifiable but invalid, or conflicting), per requirement 5. */
  protectedSourceCodes: Set<string>;
}

/**
 * Parses and validates every expected GPX source file in `coordinatesDir`,
 * producing the full accepted/rejected record set this import run would
 * apply. Performs no database access and no writes — this is pure parsing
 * and validation, consumed by preflight.ts to compute the diff against the
 * database.
 */
export function parseDataset(coordinatesDir: string): ParsedDataset {
  const files: FileSummary[] = [];
  const allAccepted: CandidateLandmark[] = [];
  const allRejected: RejectedRecord[] = [];
  const filesWithRetirementDisabled = new Set<LandmarkSourceFile>();
  let anyFileNotOk = false;

  for (const filename of EXPECTED_GPX_FILENAMES) {
    const { sourceFile, category } = SOURCE_FILE_CATEGORY_MAP[filename]!;
    const filePath = join(coordinatesDir, filename);

    let waypoints;
    try {
      waypoints = parseGpxFile(filePath);
    } catch (error) {
      anyFileNotOk = true;
      const status: FileStatus =
        error instanceof GpxFileMissingError
          ? { status: "missing" }
          : error instanceof GpxFileUnreadableError
            ? { status: "unreadable", error: error.message }
            : error instanceof GpxMalformedError
              ? { status: "malformed", error: error.message }
              : { status: "malformed", error: error instanceof Error ? error.message : String(error) };
      files.push({ filename, status, acceptedCount: 0, rejectedCount: 0, retirementDisabled: true });
      filesWithRetirementDisabled.add(sourceFile);
      continue;
    }

    let fileRetirementDisabled = false;
    let fileAcceptedCount = 0;
    let fileRejectedCount = 0;

    for (const raw of waypoints) {
      const result = mapWaypointToCandidate(raw, { filename, sourceFile, category });
      if (result.kind === "accepted") {
        allAccepted.push(result.record);
        fileAcceptedCount += 1;
      } else {
        allRejected.push(result.record);
        fileRejectedCount += 1;
        if (result.record.kind === "unidentifiable") {
          fileRetirementDisabled = true;
        }
      }
    }

    if (fileRetirementDisabled) {
      filesWithRetirementDisabled.add(sourceFile);
    }
    files.push({
      filename,
      status: { status: "ok" },
      acceptedCount: fileAcceptedCount,
      rejectedCount: fileRejectedCount,
      retirementDisabled: fileRetirementDisabled,
    });
  }

  const { accepted, exactDuplicateOccurrences, conflicts } = deduplicateCandidates(allAccepted);
  const rejected = [...allRejected, ...conflicts];

  const protectedSourceCodes = new Set<string>();
  for (const record of rejected) {
    if (record.sourceCode && (record.kind === "invalid" || record.kind === "conflict")) {
      protectedSourceCodes.add(record.sourceCode);
    }
  }

  return {
    files,
    accepted,
    rejected,
    exactDuplicateOccurrences,
    isComplete: !anyFileNotOk,
    filesWithRetirementDisabled,
    protectedSourceCodes,
  };
}
