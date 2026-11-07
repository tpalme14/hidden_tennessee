import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ParsedDataset } from "./parse-dataset.js";
import type { ApprovalCategory, PreflightDiff } from "./preflight.js";

export interface PreviewArtifact {
  generatedAt: string;
  gpxFingerprint: string;
  dbBaselineFingerprint: string;
  previewHash: string;
  requiredApprovals: ApprovalCategory[];
  isComplete: boolean;
  summary: {
    totalInputOccurrences: number;
    exactDuplicateOccurrences: number;
    rejectedRecords: number;
    acceptedUniqueRecords: number;
    newInsertions: number;
    updatedRecords: number;
    reactivatedRecords: number;
    retiredRecords: number;
    unchangedRecords: number;
    geographicWarnings: number;
  };
  files: ParsedDataset["files"];
  rejected: ParsedDataset["rejected"];
  geographicWarnings: { sourceCode: string; latitude: number; longitude: number }[];
  retirements: { sourceCode: string; sourceFile: string }[];
}

export function buildPreviewArtifact(dataset: ParsedDataset, diff: PreflightDiff): PreviewArtifact {
  const totalInputOccurrences = dataset.files.reduce((sum, f) => sum + f.acceptedCount + f.rejectedCount, 0);
  return {
    generatedAt: new Date().toISOString(),
    gpxFingerprint: diff.gpxFingerprint,
    dbBaselineFingerprint: diff.dbBaselineFingerprint,
    previewHash: diff.previewHash,
    requiredApprovals: diff.requiredApprovals,
    isComplete: diff.isComplete,
    summary: {
      totalInputOccurrences,
      exactDuplicateOccurrences: dataset.exactDuplicateOccurrences,
      rejectedRecords: dataset.rejected.length,
      acceptedUniqueRecords: dataset.accepted.length,
      newInsertions: diff.inserts.length,
      updatedRecords: diff.updates.length,
      reactivatedRecords: diff.reactivations.length,
      retiredRecords: diff.retirements.length,
      unchangedRecords: diff.unchanged.length,
      geographicWarnings: diff.geographicWarnings.length,
    },
    files: dataset.files,
    rejected: dataset.rejected,
    geographicWarnings: diff.geographicWarnings.map((c) => ({
      sourceCode: c.sourceCode,
      latitude: c.latitude,
      longitude: c.longitude,
    })),
    retirements: diff.retirements.map((r) => ({ sourceCode: r.sourceCode, sourceFile: r.sourceFile })),
  };
}

export function writePreviewFile(artifact: PreviewArtifact, outDir: string): string {
  mkdirSync(outDir, { recursive: true });
  const filename = `import-preview-${artifact.generatedAt.replace(/[:.]/g, "-")}.json`;
  const path = join(outDir, filename);
  writeFileSync(path, JSON.stringify(artifact, null, 2), "utf-8");
  return path;
}

export function readPreviewFile(path: string): PreviewArtifact {
  return JSON.parse(readFileSync(path, "utf-8")) as PreviewArtifact;
}
