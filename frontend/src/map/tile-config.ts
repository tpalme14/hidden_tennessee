import type { LatLngBoundsExpression } from "leaflet";

/**
 * Tennessee-wide initial viewport (M02-T02). Mirrors the bounding envelope
 * already established and verified in `backend/src/import/validation.ts`
 * (`TN_WARNING_ENVELOPE`, confirmed against all 1,693 real GPX records in
 * M01-T01: a generous Tennessee-wide extent covering every real landmark,
 * including the 3 near-border out-of-state ones, with margin). The value is
 * duplicated here rather than imported — the frontend and backend are
 * separate workspaces/runtimes, and this is a small, stable geographic
 * constant, not shared application logic.
 */
export const TENNESSEE_BOUNDS: LatLngBoundsExpression = [
  [34.8, -90.3], // southwest: [minLat, minLng]
  [36.7, -81.6], // northeast: [maxLat, maxLng]
];

/**
 * TEMPORARY tile source (M02-T02), for local development and demonstration
 * only — NOT approved for public production deployment. Per ADR-004, the
 * final offline-capable tile provider remains a separate, unresolved
 * decision for M00-T06/M06-T01 (see docs/DECISIONS.md ADR-004 and
 * docs/IMPLEMENTATION_PLAN.md's M02-T02 Verification Results). OpenStreetMap's
 * standard tile service permits low-volume development use under its tile
 * usage policy but explicitly disallows heavy/production traffic and grants
 * no offline-caching right — consistent with this task doing neither.
 */
export const TEMPORARY_DEV_TILE_URL = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
export const TEMPORARY_DEV_TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
