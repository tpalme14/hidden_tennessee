import { fileURLToPath } from "node:url";
import { prisma } from "../db/prisma.js";
import { applyImport } from "./apply.js";
import type { ApprovalCategory } from "./preflight.js";
import { runPreflight } from "./preview.js";
import { readPreviewFile } from "./preview-file.js";

const DEFAULT_COORDINATES_DIR = fileURLToPath(new URL("../../../coordinates", import.meta.url));
const DEFAULT_OUT_DIR = fileURLToPath(new URL("../../import-previews", import.meta.url));

function parseArgs(argv: string[]) {
  const apply = argv.includes("--apply");
  const approvals = new Set<ApprovalCategory>();
  let previewPath: string | undefined;
  let coordinatesDir = DEFAULT_COORDINATES_DIR;
  let outDir = DEFAULT_OUT_DIR;

  for (const arg of argv) {
    if (arg === "--approve-retirements") approvals.add("retirements");
    else if (arg === "--approve-insertions") approvals.add("insertions");
    else if (arg === "--approve-coordinate-shifts") approvals.add("coordinate-shifts");
    else if (arg.startsWith("--preview=")) previewPath = arg.slice("--preview=".length);
    else if (arg.startsWith("--coordinates-dir=")) coordinatesDir = arg.slice("--coordinates-dir=".length);
    else if (arg.startsWith("--out-dir=")) outDir = arg.slice("--out-dir=".length);
  }

  return { apply, approvals, previewPath, coordinatesDir, outDir };
}

async function main(): Promise<void> {
  const { apply, approvals, previewPath, coordinatesDir, outDir } = parseArgs(process.argv.slice(2));

  if (!apply) {
    const { artifact, path } = await runPreflight(prisma, coordinatesDir, outDir);
    console.log(`Preflight complete. Preview written to: ${path}`);
    console.log(JSON.stringify(artifact.summary, null, 2));
    if (artifact.requiredApprovals.length > 0) {
      console.log(
        `\nThis import requires explicit approval for: ${artifact.requiredApprovals.join(", ")}.\n` +
          `Re-run with --apply --preview=${path} and the matching --approve-* flag(s).`,
      );
    } else {
      console.log(`\nNo large-change thresholds triggered. Re-run with --apply --preview=${path} to apply.`);
    }
    return;
  }

  if (!previewPath) {
    throw new Error("--apply requires --preview=<path to a preflight preview file>");
  }
  const preview = readPreviewFile(previewPath);
  const result = await applyImport(prisma, coordinatesDir, preview, approvals);
  console.log("Import applied successfully:");
  console.log(JSON.stringify(result, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
