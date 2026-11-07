import { categoryValueToSlug } from "./categories.js";
import type { LandmarkRow } from "./repository.js";

/**
 * The single, centralized point deciding what a public caller may see of a
 * landmark. Reused by both the collection and detail endpoints (and meant to
 * be reused by any future favorites/reviews/trip view, per the
 * fullstack-typescript skill's "centrally, not only in map rendering"
 * guardrail) — not duplicated per route.
 *
 * `UNREVIEWED` and `SENSITIVE` receive identical protection throughout this
 * module: neither is ever treated as safe to disclose. Classification
 * criteria themselves remain unresolved and release-blocking (spec §9.5);
 * this module only implements the already-approved redaction mechanics.
 */

export interface LandmarkCollectionItem {
  id: string;
  display_name: string;
  category: string;
  latitude?: number;
  longitude?: number;
  distance_miles?: number;
}

/**
 * Collection items always include id/display_name/category (the approved
 * "permitted non-location discovery" fields, spec §4.1/§4.2/§9.4a). Coordinates
 * and distance are included only for `PUBLIC` landmarks — the row itself is
 * never present here at all unless it already passed the repository's own
 * is_active/sensitivity_status filtering for the query mode in question.
 */
export function toCollectionItem(row: LandmarkRow): LandmarkCollectionItem {
  const base: LandmarkCollectionItem = {
    id: row.id,
    display_name: row.displayName,
    category: categoryValueToSlug(row.category),
  };

  if (row.sensitivityStatus !== "PUBLIC") {
    return base;
  }

  return {
    ...base,
    latitude: row.latitude,
    longitude: row.longitude,
    ...(row.distanceMiles !== null ? { distance_miles: row.distanceMiles } : {}),
  };
}

export interface FullLandmarkProfile {
  id: string;
  display_name: string;
  category: string;
  latitude: number;
  longitude: number;
  source_description: string | null;
  source_access_label: string | null;
  source_url: string | null;
}

/** Spec §9.4a's exact allowlist — no other field may ever appear here. */
export interface MinimalLandmarkProfile {
  id: string;
  display_name: string;
  category: string;
  redacted: true;
}

export type LandmarkDetailResult =
  | { kind: "full"; body: FullLandmarkProfile }
  | { kind: "minimal"; body: MinimalLandmarkProfile }
  | { kind: "not_found" };

export function toDetailResult(row: LandmarkRow | null): LandmarkDetailResult {
  if (!row || !row.isActive) {
    return { kind: "not_found" };
  }

  if (row.sensitivityStatus === "PUBLIC") {
    return {
      kind: "full",
      body: {
        id: row.id,
        display_name: row.displayName,
        category: categoryValueToSlug(row.category),
        latitude: row.latitude,
        longitude: row.longitude,
        source_description: row.sourceDescription,
        source_access_label: row.sourceAccessLabel,
        source_url: row.sourceUrl,
      },
    };
  }

  // UNREVIEWED or SENSITIVE, active: minimal redacted profile (spec §9.4a).
  return {
    kind: "minimal",
    body: {
      id: row.id,
      display_name: row.displayName,
      category: categoryValueToSlug(row.category),
      redacted: true,
    },
  };
}
