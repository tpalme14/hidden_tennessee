import type { LandmarkSourceFile, PrismaClient } from "@prisma/client";

export interface BaselineRow {
  id: string;
  sourceCode: string;
  sourceFile: LandmarkSourceFile;
  isActive: boolean;
  latitude: number;
  longitude: number;
}

/** Executor accepted here is either the shared PrismaClient or an interactive `$transaction` callback's `tx`. */
export type QueryExecutor = Pick<PrismaClient, "$queryRaw">;

export async function fetchDbBaseline(db: QueryExecutor): Promise<Map<string, BaselineRow>> {
  const rows = await db.$queryRaw<
    {
      id: string;
      source_code: string;
      source_file: LandmarkSourceFile;
      is_active: boolean;
      latitude: number;
      longitude: number;
    }[]
  >`SELECT id, source_code, source_file, is_active, latitude, longitude FROM landmarks`;

  const baseline = new Map<string, BaselineRow>();
  for (const row of rows) {
    baseline.set(row.source_code, {
      id: row.id,
      sourceCode: row.source_code,
      sourceFile: row.source_file,
      isActive: row.is_active,
      latitude: row.latitude,
      longitude: row.longitude,
    });
  }
  return baseline;
}

export function dbBaselineFingerprintInput(baseline: Map<string, BaselineRow>): unknown[] {
  return [...baseline.values()]
    .map((row) => ({
      sourceCode: row.sourceCode,
      isActive: row.isActive,
      latitude: row.latitude,
      longitude: row.longitude,
    }))
    .sort((a, b) => a.sourceCode.localeCompare(b.sourceCode));
}
