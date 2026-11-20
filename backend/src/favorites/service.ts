import type { PrismaClient } from "@prisma/client";
import {
  toCollectionItem,
  toDetailResult,
  type LandmarkCollectionItem,
  type MinimalLandmarkProfile,
} from "../landmarks/redaction.js";
import type { LandmarkRow } from "../landmarks/repository.js";
import {
  addFavorite as addFavoriteRow,
  listFavorites as listFavoriteRows,
  removeFavorite as removeFavoriteRow,
  type AddFavoriteResult,
  type FavoriteListRow,
} from "./repository.js";
import type { FavoritesListQuery } from "./request-schema.js";

/**
 * Favorites business logic (M03-T05 Increment 2). Callers pass the
 * authenticated user ID (from `authenticatedUserId`) and already-validated
 * request values (request-schema.ts). HTTP status codes and envelopes are the
 * router's job (Increment 3, decision E7).
 */

export type AddOutcomeKind = "created" | "existing" | "not_found";

export interface AddOutcome {
  kind: AddOutcomeKind;
  landmarkId: string;
}

/**
 * - not eligible → `not_found`, even when a saved row exists (decision D2);
 * - eligible and inserted → `created`;
 * - eligible, not inserted (already present) → `existing`.
 */
export function toAddOutcomeKind(result: AddFavoriteResult): AddOutcomeKind {
  if (!result.eligible) return "not_found";
  return result.created ? "created" : "existing";
}

export async function addFavorite(
  prisma: PrismaClient,
  userId: string,
  landmarkId: string,
): Promise<AddOutcome> {
  const result = await addFavoriteRow(prisma, userId, landmarkId);
  return { kind: toAddOutcomeKind(result), landmarkId };
}

export async function removeFavorite(
  prisma: PrismaClient,
  userId: string,
  landmarkId: string,
): Promise<{ kind: "removed"; landmarkId: string }> {
  await removeFavoriteRow(prisma, userId, landmarkId);
  return { kind: "removed", landmarkId };
}

export type FavoriteEntry =
  | { landmark_id: string; availability: "available"; landmark: LandmarkCollectionItem }
  | { landmark_id: string; availability: "redacted"; landmark: MinimalLandmarkProfile }
  | { landmark_id: string; availability: "unavailable" };

/**
 * Shapes one saved favorite. What a caller may see of the landmark is decided
 * by the central redaction module (`toDetailResult` / `toCollectionItem`), not
 * re-implemented here:
 *  - retired → "unavailable": the landmark ID only — no name, category,
 *    coordinates, or source data (decision D3);
 *  - active, not PUBLIC → "redacted": exactly the §9.4a minimal profile (D4);
 *  - active PUBLIC → "available": the public collection item.
 * Source fields are never selected; they are null here, and distance does not
 * apply.
 */
export function toFavoriteEntry(row: FavoriteListRow): FavoriteEntry {
  const unavailable: FavoriteEntry = {
    landmark_id: row.landmarkId,
    availability: "unavailable",
  };
  if (!row.isActive) return unavailable;

  const landmarkRow: LandmarkRow = {
    id: row.landmarkId,
    displayName: row.displayName,
    category: row.category,
    sensitivityStatus: row.sensitivityStatus,
    isActive: row.isActive,
    latitude: row.latitude,
    longitude: row.longitude,
    sourceDescription: null,
    sourceAccessLabel: null,
    sourceUrl: null,
    distanceMiles: null,
  };

  const detail = toDetailResult(landmarkRow);
  switch (detail.kind) {
    case "minimal":
      return { landmark_id: row.landmarkId, availability: "redacted", landmark: detail.body };
    case "full":
      return {
        landmark_id: row.landmarkId,
        availability: "available",
        landmark: toCollectionItem(landmarkRow),
      };
    default:
      // Not reachable for an active row; fail closed.
      return unavailable;
  }
}

export interface FavoritesListResponse {
  favorites: FavoriteEntry[];
  page: number;
  limit: number;
  has_more: boolean;
}

export async function listFavorites(
  prisma: PrismaClient,
  userId: string,
  query: FavoritesListQuery,
): Promise<FavoritesListResponse> {
  const { rows, hasMore } = await listFavoriteRows(prisma, userId, query);
  return {
    favorites: rows.map(toFavoriteEntry),
    page: query.page,
    limit: query.limit,
    has_more: hasMore,
  };
}
