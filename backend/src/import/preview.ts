import type { PrismaClient } from "@prisma/client";
import { parseDataset } from "./parse-dataset.js";
import { computePreflightDiff } from "./preflight.js";
import { buildPreviewArtifact, writePreviewFile, type PreviewArtifact } from "./preview-file.js";

export async function runPreflight(
  prisma: PrismaClient,
  coordinatesDir: string,
  outDir: string,
): Promise<{ artifact: PreviewArtifact; path: string }> {
  const dataset = parseDataset(coordinatesDir);
  const diff = await computePreflightDiff(prisma, dataset);
  const artifact = buildPreviewArtifact(dataset, diff);
  const path = writePreviewFile(artifact, outDir);
  return { artifact, path };
}
