import type { CandidateLandmark, RejectedRecord } from "./types.js";

function candidatesEqual(a: CandidateLandmark, b: CandidateLandmark): boolean {
  return (
    a.sourceFile === b.sourceFile &&
    a.category === b.category &&
    a.displayName === b.displayName &&
    a.latitude === b.latitude &&
    a.longitude === b.longitude &&
    a.sourceDescription === b.sourceDescription &&
    a.sourceAccessLabel === b.sourceAccessLabel &&
    a.sourceUrl === b.sourceUrl
  );
}

export interface DeduplicationResult {
  /** One entry per unique, non-conflicting source code. */
  accepted: CandidateLandmark[];
  /** Count of extra occurrences beyond the first, for exact-duplicate groups (spec §5.2/§7.4). */
  exactDuplicateOccurrences: number;
  /** Source codes with conflicting attributes across occurrences — excluded from all writes (requirement 5). */
  conflicts: RejectedRecord[];
}

/**
 * Groups accepted candidates (from across all source files) by source code.
 * A group of size 1 passes through unchanged. A group where every member is
 * field-for-field identical is an exact duplicate (spec §5.2): one record is
 * kept, the rest counted as duplicate occurrences. A group with any
 * differing member is a conflict (spec §5.2, requirement 5): excluded
 * entirely from this run's writes and reported for manual review.
 */
export function deduplicateCandidates(candidates: CandidateLandmark[]): DeduplicationResult {
  const groups = new Map<string, CandidateLandmark[]>();
  for (const candidate of candidates) {
    const group = groups.get(candidate.sourceCode);
    if (group) {
      group.push(candidate);
    } else {
      groups.set(candidate.sourceCode, [candidate]);
    }
  }

  const accepted: CandidateLandmark[] = [];
  const conflicts: RejectedRecord[] = [];
  let exactDuplicateOccurrences = 0;

  for (const [sourceCode, group] of groups) {
    if (group.length === 1) {
      accepted.push(group[0]!);
      continue;
    }

    const [first, ...rest] = group;
    const allIdentical = rest.every((candidate) => candidatesEqual(first!, candidate));
    if (allIdentical) {
      accepted.push(first!);
      exactDuplicateOccurrences += rest.length;
    } else {
      conflicts.push({
        sourceFile: group.map((c) => c.sourceFile).join(", "),
        sourceCode,
        kind: "conflict",
        reason: `${group.length} occurrences of source code ${sourceCode} have conflicting attributes; none applied this run`,
      });
    }
  }

  return { accepted, exactDuplicateOccurrences, conflicts };
}
