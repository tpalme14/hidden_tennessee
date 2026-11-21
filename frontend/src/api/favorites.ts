import { ApiError, deleteJson, getJson, putJson } from "./client";

/**
 * Typed wrappers over the favorites API (M03-T06 Increment 1), mirroring the
 * contract implemented and verified in M03-T05 (see the M03-T05 record in
 * docs/IMPLEMENTATION_PLAN.md and backend/src/favorites/). The session cookie
 * identifies the user; no user ID is ever sent.
 *
 * Every response is checked before it reaches the UI. Entries are REBUILT
 * from their allowed fields only, so nothing outside the documented shapes —
 * in particular no coordinates on a redacted or unavailable entry — can pass
 * through. A structurally malformed response is an `INVALID_RESPONSE`
 * `ApiError`, never a partial result. An entry whose `availability` is a
 * string this client does not know is shown as `unavailable` (fail closed).
 *
 * Errors from the server keep the existing `ApiError` contract (status, code,
 * message, `retryAfterSeconds` on 429), so callers handle 400/401/403/404/
 * 429/5xx exactly as the backend reports them.
 */

const FAVORITES_PATH = "/api/v1/favorites";

/** Any 8-4-4-4-12 hexadecimal string, any case — the syntax the backend accepts (M03-T05 E2). */
const UUID_SYNTAX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An active, PUBLIC landmark: the public collection item (no distance for favorites). */
export interface FavoriteAvailableLandmark {
  id: string;
  display_name: string;
  category: string;
  latitude: number;
  longitude: number;
}

/** An active, non-PUBLIC landmark: exactly the Spec 2 §9.4a minimal profile — no coordinates. */
export interface FavoriteRedactedLandmark {
  id: string;
  display_name: string;
  category: string;
  redacted: true;
}

export type FavoriteEntry =
  | { landmark_id: string; availability: "available"; landmark: FavoriteAvailableLandmark }
  | { landmark_id: string; availability: "redacted"; landmark: FavoriteRedactedLandmark }
  | { landmark_id: string; availability: "unavailable" };

export interface FavoritesPage {
  favorites: FavoriteEntry[];
  page: number;
  limit: number;
  has_more: boolean;
}

export interface FavoritesQuery {
  /** Positive integer; the server's default is 1. */
  page?: number;
  /** 1–100; the server's default is 50. */
  limit?: number;
}

export const DEFAULT_FAVORITES_PAGE = 1;
export const DEFAULT_FAVORITES_LIMIT = 50;
export const MAX_FAVORITES_LIMIT = 100;

function invalidResponse(status: number): ApiError {
  return new ApiError(status, "INVALID_RESPONSE", "The server returned an unexpected response.");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

/** Lower-case UUID string, or null when `value` is not one. */
function parseLandmarkId(value: unknown): string | null {
  return typeof value === "string" && UUID_SYNTAX.test(value) ? value.toLowerCase() : null;
}

/**
 * One validated entry rebuilt from its allowed fields, or null when the entry
 * is structurally malformed (which fails the whole response).
 */
function parseEntry(raw: unknown): FavoriteEntry | null {
  if (!isRecord(raw)) return null;
  const landmarkId = parseLandmarkId(raw.landmark_id);
  if (landmarkId === null || typeof raw.availability !== "string") return null;

  if (raw.availability === "available" || raw.availability === "redacted") {
    const landmark = raw.landmark;
    if (!isRecord(landmark)) return null;
    if (parseLandmarkId(landmark.id) !== landmarkId) return null;
    if (!isNonEmptyString(landmark.display_name) || !isNonEmptyString(landmark.category)) {
      return null;
    }

    if (raw.availability === "redacted") {
      if (landmark.redacted !== true) return null;
      // Coordinates are never copied for a redacted entry, even if present.
      return {
        landmark_id: landmarkId,
        availability: "redacted",
        landmark: {
          id: landmarkId,
          display_name: landmark.display_name,
          category: landmark.category,
          redacted: true,
        },
      };
    }

    if (!isLatitude(landmark.latitude) || !isLongitude(landmark.longitude)) return null;
    return {
      landmark_id: landmarkId,
      availability: "available",
      landmark: {
        id: landmarkId,
        display_name: landmark.display_name,
        category: landmark.category,
        latitude: landmark.latitude,
        longitude: landmark.longitude,
      },
    };
  }

  // "unavailable", or a value this client does not recognise: the landmark ID
  // only — no name, category, or location is ever carried forward.
  return { landmark_id: landmarkId, availability: "unavailable" };
}

/** A validated favorites page, or null when the body is malformed or does not match the request. */
export function parseFavoritesPage(
  raw: unknown,
  expected: { page: number; limit: number },
): FavoritesPage | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.favorites) || typeof raw.has_more !== "boolean") return null;
  if (!isPositiveInteger(raw.page) || !isPositiveInteger(raw.limit)) return null;
  if (raw.page !== expected.page || raw.limit !== expected.limit) return null;
  if (raw.favorites.length > raw.limit) return null;

  const favorites: FavoriteEntry[] = [];
  const seen = new Set<string>();
  for (const item of raw.favorites) {
    const entry = parseEntry(item);
    if (entry === null || seen.has(entry.landmark_id)) return null;
    seen.add(entry.landmark_id);
    favorites.push(entry);
  }
  return { favorites, page: raw.page, limit: raw.limit, has_more: raw.has_more };
}

function assertQuery(page: number, limit: number): void {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("favorites page must be a positive integer");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_FAVORITES_LIMIT) {
    throw new RangeError(
      `favorites limit must be an integer from 1 through ${MAX_FAVORITES_LIMIT}`,
    );
  }
}

/** `GET /api/v1/favorites` — one page of the signed-in user's favorites, newest first. */
export async function listFavorites(query: FavoritesQuery = {}): Promise<FavoritesPage> {
  const page = query.page ?? DEFAULT_FAVORITES_PAGE;
  const limit = query.limit ?? DEFAULT_FAVORITES_LIMIT;
  assertQuery(page, limit);

  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const raw = await getJson<unknown>(`${FAVORITES_PATH}?${params.toString()}`);
  const parsed = parseFavoritesPage(raw, { page, limit });
  if (parsed === null) throw invalidResponse(200);
  return parsed;
}

/** Checks a mutation body: `{ success: true, landmark_id }` naming the requested landmark. */
function confirmedLandmarkId(body: unknown, requested: string): string | null {
  if (!isRecord(body) || body.success !== true) return null;
  const echoed = parseLandmarkId(body.landmark_id);
  return echoed !== null && echoed === requested.toLowerCase() ? echoed : null;
}

function mutationPath(landmarkId: string): string {
  return `${FAVORITES_PATH}/${encodeURIComponent(landmarkId)}`;
}

export interface AddFavoriteResult {
  landmarkId: string;
  /** True when this request saved it (201); false when it was already saved (200). */
  created: boolean;
}

/**
 * `PUT /api/v1/favorites/:landmarkId` — ensures the landmark is saved. 201 →
 * newly saved; 200 → already saved. A landmark that cannot be saved (unknown,
 * retired, or not public) is a 404 `ApiError` from the server.
 */
export async function addFavorite(landmarkId: string): Promise<AddFavoriteResult> {
  const { status, body } = await putJson<unknown>(mutationPath(landmarkId));
  const confirmed = confirmedLandmarkId(body, landmarkId);
  if (confirmed === null || (status !== 201 && status !== 200)) throw invalidResponse(status);
  return { landmarkId: confirmed, created: status === 201 };
}

/** `DELETE /api/v1/favorites/:landmarkId` — ensures the landmark is not saved (200, idempotent). */
export async function removeFavorite(landmarkId: string): Promise<{ landmarkId: string }> {
  const { status, body } = await deleteJson<unknown>(mutationPath(landmarkId));
  const confirmed = confirmedLandmarkId(body, landmarkId);
  if (confirmed === null || status !== 200) throw invalidResponse(status);
  return { landmarkId: confirmed };
}
