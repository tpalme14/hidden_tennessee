import type { LandmarkCategory } from "@prisma/client";
import { categorySlugToValue, isCategorySlug } from "./categories.js";

/**
 * Hand-written validation functions, not Zod chains, for this module —
 * consistent with the existing precedent in `src/import/validation.ts`
 * (which also validates GPX input without Zod despite ADR-005 naming it).
 * Keeping each field's parsing as a small, directly unit-testable function
 * is simpler to verify than reverse-engineering Zod v4's exact
 * transform/issue-reporting behavior for this many interacting fields.
 */
export class InvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQueryError";
  }
}

function fail(message: string): never {
  throw new InvalidQueryError(message);
}

const ALLOWED_RADII = [5, 10, 25, 50, 100] as const;
type AllowedRadiusMiles = (typeof ALLOWED_RADII)[number];

const KNOWN_PARAM_NAMES = new Set(["q", "categories", "bbox", "near", "radius", "page", "limit"]);

export interface LandmarkCollectionQuery {
  q: string | null;
  categories: LandmarkCategory[] | null;
  bbox: { minLng: number; minLat: number; maxLng: number; maxLat: number } | null;
  near: { lat: number; lng: number } | null;
  radiusMiles: AllowedRadiusMiles | null;
  page: number;
  limit: number;
}

function parseQ(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 100) fail("q must be at most 100 characters after trimming");
  return trimmed;
}

function parseCategories(raw: string | undefined): LandmarkCategory[] | null {
  if (raw === undefined) return null;
  if (raw.trim().length === 0) return null;
  const slugs = raw.split(",").map((s) => s.trim());
  const seen = new Set<string>();
  const values: LandmarkCategory[] = [];
  for (const slug of slugs) {
    if (!isCategorySlug(slug)) fail(`Unknown category: ${slug}`);
    if (seen.has(slug)) fail(`Duplicate category: ${slug}`);
    seen.add(slug);
    values.push(categorySlugToValue(slug));
  }
  return values;
}

function parseFiniteNumber(raw: string, field: string): number {
  const value = Number(raw);
  if (raw.trim().length === 0 || !Number.isFinite(value)) fail(`${field} must be a finite number`);
  return value;
}

function parseBbox(raw: string | undefined): LandmarkCollectionQuery["bbox"] {
  if (raw === undefined) return null;
  const parts = raw.split(",");
  if (parts.length !== 4) fail("bbox must have exactly 4 comma-separated values: minLng,minLat,maxLng,maxLat");
  const minLng = parseFiniteNumber(parts[0]!, "minLng");
  const minLat = parseFiniteNumber(parts[1]!, "minLat");
  const maxLng = parseFiniteNumber(parts[2]!, "maxLng");
  const maxLat = parseFiniteNumber(parts[3]!, "maxLat");

  if (minLng < -180 || minLng > 180 || maxLng < -180 || maxLng > 180) {
    fail("bbox longitude values must be within -180..180");
  }
  if (minLat < -90 || minLat > 90 || maxLat < -90 || maxLat > 90) {
    fail("bbox latitude values must be within -90..90");
  }
  // Requiring minLng < maxLng (rather than permitting wraparound) is how
  // antimeridian-crossing boxes are rejected in this version (spec §5.1/§7.1).
  if (!(minLng < maxLng)) fail("bbox minLng must be less than maxLng (antimeridian-crossing boxes are rejected)");
  if (!(minLat < maxLat)) fail("bbox minLat must be less than maxLat");

  return { minLng, minLat, maxLng, maxLat };
}

function parseNear(raw: string | undefined): LandmarkCollectionQuery["near"] {
  if (raw === undefined) return null;
  const parts = raw.split(",");
  if (parts.length !== 2) fail("near must have exactly 2 comma-separated values: lat,lng");
  const [lat, lng] = [parseFiniteNumber(parts[0]!, "lat"), parseFiniteNumber(parts[1]!, "lng")];
  if (lat < -90 || lat > 90) fail("near latitude must be within -90..90");
  if (lng < -180 || lng > 180) fail("near longitude must be within -180..180");
  return { lat, lng };
}

function parseRadius(raw: string | undefined): AllowedRadiusMiles | null {
  if (raw === undefined) return null;
  const value = Number(raw);
  if (!ALLOWED_RADII.includes(value as AllowedRadiusMiles)) {
    fail(`radius must be one of ${ALLOWED_RADII.join(", ")}`);
  }
  return value as AllowedRadiusMiles;
}

function parsePage(raw: string | undefined): number {
  if (raw === undefined) return 1;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) fail("page must be a positive integer");
  return value;
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return 200;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 200) fail("limit must be an integer from 1 through 200");
  return value;
}

export function parseLandmarkCollectionQuery(rawQuery: Record<string, unknown>): LandmarkCollectionQuery {
  for (const key of Object.keys(rawQuery)) {
    if (!KNOWN_PARAM_NAMES.has(key)) fail(`Unknown query parameter: ${key}`);
  }
  for (const [key, value] of Object.entries(rawQuery)) {
    if (value !== undefined && typeof value !== "string") {
      fail(`Query parameter ${key} must be a single value`);
    }
  }

  const q = parseQ(rawQuery.q as string | undefined);
  const categories = parseCategories(rawQuery.categories as string | undefined);
  const bbox = parseBbox(rawQuery.bbox as string | undefined);
  const near = parseNear(rawQuery.near as string | undefined);
  const radiusMiles = parseRadius(rawQuery.radius as string | undefined);
  const page = parsePage(rawQuery.page as string | undefined);
  const limit = parseLimit(rawQuery.limit as string | undefined);

  if (bbox && near) fail("near and bbox cannot be combined");
  if (near && radiusMiles === null) fail("radius is required with near");
  if (radiusMiles !== null && !near) fail("radius requires near");

  return { q, categories, bbox, near, radiusMiles, page, limit };
}
