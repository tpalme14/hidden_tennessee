import { getJson } from "./client";
import { parseLandmarkProfile } from "./landmarkProfileValidation";
import type { LandmarkCollectionResponse, LandmarkProfile } from "./types";

export type LandmarkGeoMode =
  | { mode: "bbox"; bbox: string }
  | { mode: "near"; near: string; radius: number };

export interface LandmarkGeoMarkerQuery {
  q: string;
  categories: string[];
  geo: LandmarkGeoMode;
}

/**
 * Geographic (map-marker) fetch — `bbox` or `near`+`radius`, never both (M02-T07).
 * Per M01-T05, both query shapes are restricted server-side to active
 * `PUBLIC` landmarks only, so this is the only module that ever requests
 * coordinates. Shares the same committed `q`/`categories` as the plain-mode
 * list search (`searchLandmarks`), per the M02-T07 shared-filter decision,
 * but always fetches a single page (`page=1`, `limit=200`) — markers have no
 * pagination control, so `is_truncated` alone (not `has_more`) drives any
 * "zoom in or refine filters" messaging. Never call this with a plain
 * name/category-only query (no `bbox`/`near`) for marker purposes — that
 * would return non-`PUBLIC` records without coordinates, which is not a
 * valid marker response shape.
 */
export function getLandmarkGeoMarkers(query: LandmarkGeoMarkerQuery): Promise<LandmarkCollectionResponse> {
  const params = new URLSearchParams();
  if (query.q) params.set("q", query.q);
  if (query.categories.length > 0) params.set("categories", query.categories.join(","));
  if (query.geo.mode === "bbox") {
    params.set("bbox", query.geo.bbox);
  } else {
    params.set("near", query.geo.near);
    params.set("radius", String(query.geo.radius));
  }
  params.set("page", "1");
  params.set("limit", "200");
  return getJson<LandmarkCollectionResponse>(`/api/v1/landmarks?${params.toString()}`);
}

export interface LandmarkSearchQuery {
  q: string;
  categories: string[];
  page: number;
  limit: number;
}

/**
 * Plain name/category-search mode (no `bbox`/`near`) — may return
 * `UNREVIEWED`/`SENSITIVE` records by name/category (never with coordinates
 * for those), per M01-T05's "permitted non-location discovery" design.
 * Independent of `getLandmarkMarkers`'s `bbox`-only rule; never mix the two
 * query shapes. `categories` is omitted entirely when empty — an absent
 * `categories` param means "all categories" server-side (M01-T05), not an
 * empty-string value. `URLSearchParams` only handles HTTP encoding — the
 * literal substring match (including `%`/`_`/`\`) is already implemented
 * server-side; this module must never duplicate that escaping itself.
 */
export function searchLandmarks(query: LandmarkSearchQuery): Promise<LandmarkCollectionResponse> {
  const params = new URLSearchParams({ q: query.q, page: String(query.page), limit: String(query.limit) });
  if (query.categories.length > 0) {
    params.set("categories", query.categories.join(","));
  }
  return getJson<LandmarkCollectionResponse>(`/api/v1/landmarks?${params.toString()}`);
}

/** Thrown when a 200 response's body doesn't match either approved profile shape exactly — treated identically to "unavailable" by the profile page, never rendered partially. */
export class MalformedLandmarkProfileError extends Error {
  constructor() {
    super("Received an unexpected landmark profile response shape.");
    this.name = "MalformedLandmarkProfileError";
  }
}

export async function getLandmarkProfile(id: string): Promise<LandmarkProfile> {
  const raw = await getJson<unknown>(`/api/v1/landmarks/${encodeURIComponent(id)}`);
  const profile = parseLandmarkProfile(raw);
  if (!profile) {
    throw new MalformedLandmarkProfileError();
  }
  return profile;
}
