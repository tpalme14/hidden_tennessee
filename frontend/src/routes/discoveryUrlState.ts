import {
  DEFAULT_BBOX,
  isValidLatitude,
  isValidLongitude,
  parseBboxParam,
  parseNearParam,
  parseRadiusParam,
  type AllowedRadiusMiles,
  type GeoBbox,
  type GeoOrigin,
} from "../map/geo";

export type DiscoveryMode = "bbox" | "near";

const MAX_QUERY_LENGTH = 100;
const MIN_ZOOM = 0;
const MAX_ZOOM = 22;

export interface DiscoveryViewport {
  center: [number, number];
  zoom: number;
}

export interface DiscoveryUrlState {
  q: string;
  categories: string[];
  mode: DiscoveryMode;
  /** Always a valid committed bbox — defaulted to the Tennessee-wide extent when absent or invalid. */
  bbox: GeoBbox;
  /** Populated only when `mode` is `"near"` and both `near`/`radius` parsed validly. */
  near: GeoOrigin | null;
  radius: AllowedRadiusMiles | null;
  /** `null` means "no explicit camera position" — the map falls back to its default Tennessee-bounds fit. */
  viewport: DiscoveryViewport | null;
  /**
   * True only when a query-affecting param (`mode`/`bbox`/`near`/`radius`) was
   * PRESENT but invalid and had to be corrected to a safe default — never
   * true merely because a param was absent (e.g. a fresh, param-less first
   * visit), per spec §9.6's "normalize malformed or unsupported values to
   * safe defaults with an accessible notice."
   */
  wasNormalized: boolean;
}

function normalizeQ(raw: string | null): string {
  if (raw === null) return "";
  return raw.trim().slice(0, MAX_QUERY_LENGTH);
}

function parseCategories(raw: string | null): string[] {
  if (raw === null || raw.trim().length === 0) return [];
  const seen = new Set<string>();
  for (const slug of raw.split(",").map((s) => s.trim())) {
    if (slug.length > 0) seen.add(slug);
  }
  return [...seen].sort();
}

function parseViewport(params: URLSearchParams): DiscoveryViewport | null {
  const lat = params.get("lat");
  const lng = params.get("lng");
  const zoom = params.get("zoom");
  if (lat === null || lng === null || zoom === null) return null;

  const latNum = Number(lat);
  const lngNum = Number(lng);
  const zoomNum = Number(zoom);
  if (!isValidLatitude(latNum) || !isValidLongitude(lngNum)) return null;
  if (!Number.isFinite(zoomNum) || zoomNum < MIN_ZOOM || zoomNum > MAX_ZOOM) return null;

  return { center: [latNum, lngNum], zoom: zoomNum };
}

/**
 * Parses and validates the discovery route's canonical URL query parameters
 * (spec §9.6) into committed discovery state. Pure and Router-independent —
 * `useDiscoveryUrlState` is the only caller that needs an actual Router.
 */
export function parseDiscoveryParams(params: URLSearchParams): DiscoveryUrlState {
  const q = normalizeQ(params.get("q"));
  const categories = parseCategories(params.get("categories"));
  const viewport = parseViewport(params);

  const rawBbox = params.get("bbox");
  const parsedBbox = parseBboxParam(rawBbox);
  const bbox = parsedBbox ?? DEFAULT_BBOX;
  const bboxWasInvalid = rawBbox !== null && parsedBbox === null;

  const rawMode = params.get("mode");
  const rawNear = params.get("near");
  const rawRadius = params.get("radius");
  const parsedNear = parseNearParam(rawNear);
  const parsedRadius = parseRadiusParam(rawRadius);

  const modeRequestsNear = rawMode === "near";
  const nearIsComplete = parsedNear !== null && parsedRadius !== null;
  const nearWasInvalid = modeRequestsNear && !nearIsComplete;

  const mode: DiscoveryMode = modeRequestsNear && nearIsComplete ? "near" : "bbox";
  const near = mode === "near" ? parsedNear : null;
  const radius = mode === "near" ? parsedRadius : null;

  return {
    q,
    categories,
    mode,
    bbox,
    near,
    radius,
    viewport,
    wasNormalized: bboxWasInvalid || nearWasInvalid,
  };
}
