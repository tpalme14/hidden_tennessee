import { isOutsideWarningEnvelope } from "./validation.js";
import { dbBaselineFingerprintInput, fetchDbBaseline, type BaselineRow, type QueryExecutor } from "./db-baseline.js";
import { canonicalHash } from "./fingerprint.js";
import type { ParsedDataset } from "./parse-dataset.js";
import type { CandidateLandmark } from "./types.js";

export type ApprovalCategory = "retirements" | "insertions" | "coordinate-shifts";

const COORDINATE_SHIFT_THRESHOLD_METERS = 100;
const RETIREMENT_PERCENT_THRESHOLD = 0.02;
const RETIREMENT_COUNT_THRESHOLD = 35;
const COORDINATE_SHIFT_PERCENT_THRESHOLD = 0.1;
const INSERTION_PERCENT_THRESHOLD = 0.05;

export interface MatchedRecord {
  candidate: CandidateLandmark;
  previous: BaselineRow;
  shiftedMeters: number;
}

export interface PreflightDiff {
  inserts: CandidateLandmark[];
  updates: MatchedRecord[];
  reactivations: MatchedRecord[];
  unchanged: MatchedRecord[];
  retirements: BaselineRow[];
  geographicWarnings: CandidateLandmark[];
  activeBaselineCount: number;
  matchedCount: number;
  coordinateShiftCount: number;
  requiredApprovals: ApprovalCategory[];
  isComplete: boolean;
  gpxFingerprint: string;
  dbBaselineFingerprint: string;
  previewHash: string;
}

function candidateChanged(candidate: CandidateLandmark, previous: BaselineRow, shiftedMeters: number): boolean {
  return (
    shiftedMeters > 0 ||
    candidate.sourceFile !== previous.sourceFile
    // displayName/category/description/etc. are not in BaselineRow (we only snapshot identity/coords/active-state
    // for diffing purposes); any accepted candidate for a matched source_code is always re-written on apply
    // regardless of whether every field changed, since recomputing field-level diffs for non-coordinate,
    // non-indexed columns provides no additional safety and would only add complexity.
  );
}

export function computeGpxFingerprint(dataset: ParsedDataset): string {
  return canonicalHash({
    isComplete: dataset.isComplete,
    files: dataset.files
      .map((f) => ({ filename: f.filename, status: f.status, retirementDisabled: f.retirementDisabled }))
      .sort((a, b) => a.filename.localeCompare(b.filename)),
    accepted: dataset.accepted
      .map((c) => ({ ...c }))
      .sort((a, b) => a.sourceCode.localeCompare(b.sourceCode)),
    rejected: dataset.rejected
      .map((r) => ({ ...r }))
      .sort((a, b) => (a.sourceCode ?? "").localeCompare(b.sourceCode ?? "") || a.reason.localeCompare(b.reason)),
    exactDuplicateOccurrences: dataset.exactDuplicateOccurrences,
  });
}

/**
 * Computes the full preflight diff (inserts/updates/reactivations/unchanged/
 * retirements), the large-change thresholds (spec §6.5, M01-T04 decision 1
 * for the zero-baseline edge case), and the fingerprints that bind this
 * preview to both the parsed GPX state and the database baseline it was
 * computed against (requirement 4).
 */
export async function computePreflightDiff(db: QueryExecutor, dataset: ParsedDataset): Promise<PreflightDiff> {
  const baseline = await fetchDbBaseline(db);
  const activeBaselineCount = [...baseline.values()].filter((row) => row.isActive).length;

  const inserts: CandidateLandmark[] = [];
  const matchedCandidateBySourceCode = new Map<string, CandidateLandmark>();
  for (const candidate of dataset.accepted) {
    const previous = baseline.get(candidate.sourceCode);
    if (!previous) {
      inserts.push(candidate);
    } else {
      matchedCandidateBySourceCode.set(candidate.sourceCode, candidate);
    }
  }

  const matchedEntries = [...matchedCandidateBySourceCode.entries()];
  const shiftsByCode = await computeCoordinateShifts(db, matchedEntries, baseline);

  const updates: MatchedRecord[] = [];
  const reactivations: MatchedRecord[] = [];
  const unchanged: MatchedRecord[] = [];
  let coordinateShiftCount = 0;

  for (const [sourceCode, candidate] of matchedEntries) {
    const previous = baseline.get(sourceCode)!;
    const shiftedMeters = shiftsByCode.get(sourceCode) ?? 0;
    if (shiftedMeters > COORDINATE_SHIFT_THRESHOLD_METERS) coordinateShiftCount += 1;

    const record: MatchedRecord = { candidate, previous, shiftedMeters };
    if (!previous.isActive) {
      reactivations.push(record);
    } else if (candidateChanged(candidate, previous, shiftedMeters)) {
      updates.push(record);
    } else {
      unchanged.push(record);
    }
  }

  const retirements: BaselineRow[] = [];
  if (dataset.isComplete) {
    for (const row of baseline.values()) {
      if (!row.isActive) continue;
      if (matchedCandidateBySourceCode.has(row.sourceCode)) continue;
      if (dataset.protectedSourceCodes.has(row.sourceCode)) continue;
      if (dataset.filesWithRetirementDisabled.has(row.sourceFile)) continue;
      retirements.push(row);
    }
  }

  const geographicWarnings = dataset.accepted.filter((c) => isOutsideWarningEnvelope(c.latitude, c.longitude));

  const requiredApprovals: ApprovalCategory[] = [];
  const retirementsTriggered =
    retirements.length > RETIREMENT_COUNT_THRESHOLD ||
    (activeBaselineCount > 0 && retirements.length > RETIREMENT_PERCENT_THRESHOLD * activeBaselineCount);
  if (retirementsTriggered) requiredApprovals.push("retirements");

  // M01-T04 decision 1: with zero active landmarks, any insertion volume triggers the gate.
  const insertionsTriggered =
    inserts.length > 0 && (activeBaselineCount === 0 || inserts.length > INSERTION_PERCENT_THRESHOLD * activeBaselineCount);
  if (insertionsTriggered) requiredApprovals.push("insertions");

  const matchedCount = matchedEntries.length;
  const coordinateShiftsTriggered =
    matchedCount > 0 && coordinateShiftCount > COORDINATE_SHIFT_PERCENT_THRESHOLD * matchedCount;
  if (coordinateShiftsTriggered) requiredApprovals.push("coordinate-shifts");

  const gpxFingerprint = computeGpxFingerprint(dataset);
  const dbBaselineFingerprint = canonicalHash(dbBaselineFingerprintInput(baseline));
  const previewHash = canonicalHash({
    gpxFingerprint,
    dbBaselineFingerprint,
    requiredApprovals: [...requiredApprovals].sort(),
  });

  return {
    inserts,
    updates,
    reactivations,
    unchanged,
    retirements,
    geographicWarnings,
    activeBaselineCount,
    matchedCount,
    coordinateShiftCount,
    requiredApprovals,
    isComplete: dataset.isComplete,
    gpxFingerprint,
    dbBaselineFingerprint,
    previewHash,
  };
}

async function computeCoordinateShifts(
  db: QueryExecutor,
  matchedEntries: [string, CandidateLandmark][],
  baseline: Map<string, BaselineRow>,
): Promise<Map<string, number>> {
  const shifts = new Map<string, number>();
  if (matchedEntries.length === 0) return shifts;

  const oldLons: number[] = [];
  const oldLats: number[] = [];
  const newLons: number[] = [];
  const newLats: number[] = [];
  const codes: string[] = [];
  for (const [sourceCode, candidate] of matchedEntries) {
    const previous = baseline.get(sourceCode)!;
    codes.push(sourceCode);
    oldLons.push(previous.longitude);
    oldLats.push(previous.latitude);
    newLons.push(candidate.longitude);
    newLats.push(candidate.latitude);
  }

  const rows = await db.$queryRaw<{ idx: bigint; distance_meters: number }[]>`
    SELECT t.idx, ST_Distance(
      ST_SetSRID(ST_MakePoint(t.old_lon, t.old_lat), 4326)::geography,
      ST_SetSRID(ST_MakePoint(t.new_lon, t.new_lat), 4326)::geography
    ) AS distance_meters
    FROM unnest(${oldLons}::float8[], ${oldLats}::float8[], ${newLons}::float8[], ${newLats}::float8[])
      WITH ORDINALITY AS t(old_lon, old_lat, new_lon, new_lat, idx)
  `;

  for (const row of rows) {
    const index = Number(row.idx) - 1;
    const sourceCode = codes[index];
    if (sourceCode) shifts.set(sourceCode, row.distance_meters);
  }
  return shifts;
}
