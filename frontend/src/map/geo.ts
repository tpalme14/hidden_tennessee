import { TENNESSEE_BOUNDS } from "./tile-config";

/**
 * Shared geographic constants/helpers for geographic discovery (M02-T07),
 * mirroring the validation rules already enforced server-side in
 * `backend/src/landmarks/query-schema.ts` — duplicated here rather than
 * imported, consistent with this project's existing frontend/backend
 * separate-workspaces precedent (see `TENNESSEE_BOUNDS` in `tile-config.ts`).
 */

export interface GeoBbox {
  minLng: number;
  minLat: number;
  maxLng: number;
  maxLat: number;
}

export interface GeoOrigin {
  lat: number;
  lng: number;
}

export const ALLOWED_RADII_MILES = [5, 10, 25, 50, 100] as const;
export type AllowedRadiusMiles = (typeof ALLOWED_RADII_MILES)[number];
export const DEFAULT_RADIUS_MILES: AllowedRadiusMiles = 25;

const MILES_TO_KM = 1.609344;

export function milesToKm(miles: number): number {
  return miles * MILES_TO_KM;
}

export function isAllowedRadius(value: number): value is AllowedRadiusMiles {
  return (ALLOWED_RADII_MILES as readonly number[]).includes(value);
}

export function isValidLatitude(value: number): boolean {
  return Number.isFinite(value) && value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isValidBbox(bbox: GeoBbox): boolean {
  return (
    isValidLongitude(bbox.minLng) &&
    isValidLongitude(bbox.maxLng) &&
    isValidLatitude(bbox.minLat) &&
    isValidLatitude(bbox.maxLat) &&
    bbox.minLng < bbox.maxLng &&
    bbox.minLat < bbox.maxLat
  );
}

export function isValidOrigin(origin: GeoOrigin): boolean {
  return isValidLatitude(origin.lat) && isValidLongitude(origin.lng);
}

const [[TN_MIN_LAT, TN_MIN_LNG], [TN_MAX_LAT, TN_MAX_LNG]] = TENNESSEE_BOUNDS as [
  [number, number],
  [number, number],
];

/** The Tennessee-wide default bounding box, matching the initial map viewport (M02-T02). */
export const DEFAULT_BBOX: GeoBbox = {
  minLng: TN_MIN_LNG,
  minLat: TN_MIN_LAT,
  maxLng: TN_MAX_LNG,
  maxLat: TN_MAX_LAT,
};

/** `minLng,minLat,maxLng,maxLat` — the backend's `bbox` query-parameter order. */
export function formatBboxParam(bbox: GeoBbox): string {
  return `${bbox.minLng},${bbox.minLat},${bbox.maxLng},${bbox.maxLat}`;
}

export function parseBboxParam(raw: string | null): GeoBbox | null {
  if (raw === null) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  const bbox: GeoBbox = { minLng, minLat, maxLng, maxLat };
  return isValidBbox(bbox) ? bbox : null;
}

/** `lat,lng` — the backend's `near` query-parameter order (note: lat first, unlike `bbox`'s lng-first order). */
export function formatNearParam(origin: GeoOrigin): string {
  return `${origin.lat},${origin.lng}`;
}

export function parseNearParam(raw: string | null): GeoOrigin | null {
  if (raw === null) return null;
  const parts = raw.split(",").map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) return null;
  const [lat, lng] = parts as [number, number];
  const origin: GeoOrigin = { lat, lng };
  return isValidOrigin(origin) ? origin : null;
}

export function parseRadiusParam(raw: string | null): AllowedRadiusMiles | null {
  if (raw === null) return null;
  const value = Number(raw);
  return isAllowedRadius(value) ? value : null;
}

export function boundsEqual(a: GeoBbox, b: GeoBbox): boolean {
  return a.minLng === b.minLng && a.minLat === b.minLat && a.maxLng === b.maxLng && a.maxLat === b.maxLat;
}

export function bboxCenter(bbox: GeoBbox): [number, number] {
  return [(bbox.minLat + bbox.maxLat) / 2, (bbox.minLng + bbox.maxLng) / 2];
}
