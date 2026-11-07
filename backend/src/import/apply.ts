import type { PrismaClient } from "@prisma/client";
import { ConcurrentImportError, MissingApprovalError, StalePreviewError } from "./errors.js";
import { parseDataset } from "./parse-dataset.js";
import { computePreflightDiff, type ApprovalCategory } from "./preflight.js";
import type { PreviewArtifact } from "./preview-file.js";

// Arbitrary fixed key identifying "the GPX landmark import" for PostgreSQL's
// session/transaction advisory lock namespace (spec/requirement: fail-fast
// concurrency protection, per ADR-010's sibling decision for M01-T04).
const IMPORT_ADVISORY_LOCK_KEY = 837_465_123;

export interface ApplyResult {
  inserted: number;
  updated: number;
  reactivated: number;
  retired: number;
}

/**
 * Re-validates a preview against the live GPX source files and database
 * state, then applies it within a single all-or-nothing transaction.
 *
 * Never trusts the preview file's own numbers for anything except as the
 * value to compare against a freshly recomputed diff — the actual write set
 * always comes from that fresh recomputation, not from the (potentially
 * stale) preview artifact.
 */
export async function applyImport(
  prisma: PrismaClient,
  coordinatesDir: string,
  preview: PreviewArtifact,
  approvals: Set<ApprovalCategory>,
): Promise<ApplyResult> {
  return prisma.$transaction(
    async (tx) => {
      const [lockRow] = await tx.$queryRaw<{ pg_try_advisory_xact_lock: boolean }[]>`
        SELECT pg_try_advisory_xact_lock(${IMPORT_ADVISORY_LOCK_KEY})
      `;
      if (!lockRow?.pg_try_advisory_xact_lock) {
        throw new ConcurrentImportError();
      }

      const freshDataset = parseDataset(coordinatesDir);
      const freshDiff = await computePreflightDiff(tx, freshDataset);

      if (freshDiff.previewHash !== preview.previewHash) {
        throw new StalePreviewError({
          gpxChanged: freshDiff.gpxFingerprint !== preview.gpxFingerprint,
          dbChanged: freshDiff.dbBaselineFingerprint !== preview.dbBaselineFingerprint,
        });
      }

      const missing = freshDiff.requiredApprovals.filter((category) => !approvals.has(category));
      if (missing.length > 0) {
        throw new MissingApprovalError(missing);
      }

      for (const candidate of freshDiff.inserts) {
        await tx.landmark.create({
          data: {
            sourceCode: candidate.sourceCode,
            sourceFile: candidate.sourceFile,
            category: candidate.category,
            displayName: candidate.displayName,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            sourceDescription: candidate.sourceDescription,
            sourceAccessLabel: candidate.sourceAccessLabel,
            sourceUrl: candidate.sourceUrl,
            // isActive defaults to true, sensitivityStatus defaults to UNREVIEWED — neither is set explicitly here.
          },
        });
      }

      // Updates and reactivations share identical write logic: upsert-in-place by source_code,
      // force isActive true, and never touch sensitivityStatus (requirement 6).
      for (const { candidate } of [...freshDiff.updates, ...freshDiff.reactivations]) {
        await tx.landmark.update({
          where: { sourceCode: candidate.sourceCode },
          data: {
            sourceFile: candidate.sourceFile,
            category: candidate.category,
            displayName: candidate.displayName,
            latitude: candidate.latitude,
            longitude: candidate.longitude,
            sourceDescription: candidate.sourceDescription,
            sourceAccessLabel: candidate.sourceAccessLabel,
            sourceUrl: candidate.sourceUrl,
            isActive: true,
          },
        });
      }

      for (const row of freshDiff.retirements) {
        await tx.landmark.update({ where: { id: row.id }, data: { isActive: false } });
      }

      return {
        inserted: freshDiff.inserts.length,
        updated: freshDiff.updates.length,
        reactivated: freshDiff.reactivations.length,
        retired: freshDiff.retirements.length,
      };
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}
