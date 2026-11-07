import type { LandmarkCategory, LandmarkSourceFile } from "@prisma/client";

// Filename -> (sourceFile, category) mapping, per spec §2/§4.1. Categories are
// derived from the source filename, never from GPX <sym> values.
export const SOURCE_FILE_CATEGORY_MAP: Record<
  string,
  { sourceFile: LandmarkSourceFile; category: LandmarkCategory }
> = {
  "tnarches.gpx": { sourceFile: "TNARCHES", category: "ARCH" },
  "tnbalds.gpx": { sourceFile: "TNBALDS", category: "BALD" },
  "tnfalls.gpx": { sourceFile: "TNFALLS", category: "FALLS" },
  "tnlakes.gpx": { sourceFile: "TNLAKES", category: "LAKE" },
  "tnother.gpx": { sourceFile: "TNOTHER", category: "OTHER" },
  "tnpeaks.gpx": { sourceFile: "TNPEAKS", category: "PEAK" },
  "tnrocks.gpx": { sourceFile: "TNROCKS", category: "ROCK" },
  "tnsinks.gpx": { sourceFile: "TNSINKS", category: "SINK" },
};

export const EXPECTED_GPX_FILENAMES: readonly string[] = Object.keys(SOURCE_FILE_CATEGORY_MAP);
