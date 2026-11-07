import type { LandmarkCategory, LandmarkSourceFile } from "@prisma/client";
import type { CandidateLandmark, RawWaypoint, RejectedRecord } from "./types.js";
import {
  isFiniteCoordinate,
  isValidLatitude,
  isValidLongitude,
  isValidSourceCode,
  parseValidUrl,
  trimToNonEmpty,
  trimToNullable,
} from "./validation.js";

export type MapResult = { kind: "accepted"; record: CandidateLandmark } | { kind: "rejected"; record: RejectedRecord };

function coerceCoordinate(value: unknown): number | null {
  if (isFiniteCoordinate(value)) return value;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.length === 0) return null;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Maps one raw <wpt> to either an accepted candidate landmark or a rejected
 * record, per spec §4 (mapping rules) and §6.1/§6.2 (Tier-1 validation).
 *
 * `kind: "unidentifiable"` (missing/malformed <name>) vs `kind: "invalid"`
 * (identifiable source code, but another field fails) is the distinction
 * requirement 5 (M01-T04 approval) depends on for retirement protection:
 * unidentifiable records disable retirement for the whole file; invalid
 * records only protect their own, known source code.
 */
export function mapWaypointToCandidate(
  raw: RawWaypoint,
  context: { filename: string; sourceFile: LandmarkSourceFile; category: LandmarkCategory },
): MapResult {
  const rawName = trimToNonEmpty(raw.name);
  if (!rawName || !isValidSourceCode(rawName)) {
    return {
      kind: "rejected",
      record: {
        sourceFile: context.filename,
        sourceCode: null,
        kind: "unidentifiable",
        reason: rawName
          ? `<name> "${rawName}" does not match the required [A-Z]{3}[0-9]{3} format`
          : "missing or empty <name>",
      },
    };
  }
  const sourceCode = rawName;

  const latitude = coerceCoordinate(raw["@_lat"]);
  const longitude = coerceCoordinate(raw["@_lon"]);
  if (latitude === null || !isValidLatitude(latitude)) {
    return {
      kind: "rejected",
      record: {
        sourceFile: context.filename,
        sourceCode,
        kind: "invalid",
        reason: `invalid or out-of-range latitude: ${String(raw["@_lat"])}`,
      },
    };
  }
  if (longitude === null || !isValidLongitude(longitude)) {
    return {
      kind: "rejected",
      record: {
        sourceFile: context.filename,
        sourceCode,
        kind: "invalid",
        reason: `invalid or out-of-range longitude: ${String(raw["@_lon"])}`,
      },
    };
  }

  const displayName = trimToNonEmpty(raw.cmt) ?? sourceCode;
  const sourceDescription = trimToNullable(raw.desc);

  let sourceAccessLabel: string | null = null;
  let sourceUrl: string | null = null;
  if (raw.link && typeof raw.link === "object") {
    sourceAccessLabel = trimToNullable(raw.link.text);
    sourceUrl = parseValidUrl(raw.link["@_href"]);
  }

  return {
    kind: "accepted",
    record: {
      sourceCode,
      sourceFile: context.sourceFile,
      category: context.category,
      displayName,
      latitude,
      longitude,
      sourceDescription,
      sourceAccessLabel,
      sourceUrl,
    },
  };
}
