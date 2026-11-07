import type { PrismaClient } from "@prisma/client";
import { CATEGORY_DEFINITIONS } from "./categories.js";
import { InvalidQueryError, parseLandmarkCollectionQuery } from "./query-schema.js";
import { fetchLandmarkCollection, findLandmarkById } from "./repository.js";
import { toCollectionItem, toDetailResult } from "./redaction.js";

export { InvalidQueryError };

export interface LandmarkCollectionResponse {
  items: ReturnType<typeof toCollectionItem>[];
  page: number;
  limit: number;
  has_more: boolean;
  is_truncated: boolean;
}

export async function getLandmarkCollection(
  prisma: PrismaClient,
  rawQuery: Record<string, unknown>,
): Promise<LandmarkCollectionResponse> {
  const query = parseLandmarkCollectionQuery(rawQuery);
  const { rows, hasMore, isTruncated } = await fetchLandmarkCollection(prisma, query);

  return {
    items: rows.map(toCollectionItem),
    page: query.page,
    limit: query.limit,
    has_more: hasMore,
    is_truncated: isTruncated,
  };
}

export type LandmarkDetailOutcome = { status: 200; body: unknown } | { status: 404 };

export async function getLandmarkDetail(prisma: PrismaClient, id: string): Promise<LandmarkDetailOutcome> {
  const row = await findLandmarkById(prisma, id);
  const result = toDetailResult(row);

  if (result.kind === "not_found") {
    return { status: 404 };
  }
  return { status: 200, body: result.body };
}

export function getCategories() {
  return CATEGORY_DEFINITIONS.map(({ slug, label }) => ({ slug, label }));
}
