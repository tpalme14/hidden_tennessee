/**
 * Runtime validation of trips API responses (M05-T04 Increment 1;
 * specs/TRIP_PLANNING_SPEC.md v1.1 §§4, 5.6, 7.2; ADR-014 decisions 6, 7).
 *
 * TypeScript types describe what the compiler expects, not what the network
 * returned, so every trips response is checked here and REBUILT from its
 * approved fields only — nothing else in a response can reach the interface.
 * Hand-written like `landmarkProfileValidation.ts` and the reviews parsers.
 *
 * Fail-closed rules:
 * - A structurally invalid response (trip, list, or stop wrapper: IDs,
 *   positions, keys, types, counts) is `null`, which callers turn into an
 *   `INVALID_RESPONSE` error — never a partial result.
 * - Landmark data is trusted only for a stop that is `is_available: true`
 *   with EXACTLY the five safe fields (`id`, `display_name`, `category`,
 *   `latitude`, `longitude`), all valid. Every other stop — including one
 *   whose landmark object is malformed or carries extra fields — is rebuilt
 *   as the unavailable placeholder `{ id, is_available: false }` with no
 *   distance, keeping only the landmark ID. The extra data is not copied, so
 *   it is never rendered or retained.
 * - A distance is kept only when the stop and the stop before it are both
 *   available (a distance touching an unavailable stop could reveal where it
 *   is); otherwise it becomes `null`.
 * - When any stop or distance was downgraded, `distance_summary` is
 *   recomputed from the kept distances; otherwise the server's summary must
 *   agree with the stops exactly (counts) and to within rounding (total).
 */

import { validateTripName } from "../trips/tripNameRule";

export const MAX_TRIP_STOPS = 25;
const MAX_TRIP_NAME_CODE_POINTS = 100;
/** The largest `version` a trip can have (PostgreSQL `INTEGER`). */
export const MAX_VERSION = 2_147_483_647;

/** Any 8-4-4-4-12 hexadecimal string, any case — the syntax the backend accepts. */
const UUID_SYNTAX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** The exact timestamp form the backend produces (`Date#toISOString`). */
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Discovery category slugs are lower-case words (for example `falls`, `arch`). */
const CATEGORY_SLUG = /^[a-z][a-z0-9-]*$/;

export interface TripLandmark {
  id: string;
  display_name: string;
  category: string;
  latitude: number;
  longitude: number;
}

export interface AvailableTripStop {
  id: string;
  position: number;
  is_available: true;
  distance_from_previous_miles: number | null;
  landmark: TripLandmark;
}

export interface UnavailableTripStop {
  id: string;
  position: number;
  is_available: false;
  distance_from_previous_miles: null;
  landmark: { id: string; is_available: false };
}

export type TripStop = AvailableTripStop | UnavailableTripStop;

export interface DistanceSummary {
  total_miles: number | null;
  measured_legs: number;
  total_legs: number;
}

export interface OwnerTrip {
  id: string;
  name: string;
  version: number;
  created_at: string;
  updated_at: string;
  is_shared: boolean;
  sharing_enabled: boolean;
  stops: TripStop[];
  distance_summary: DistanceSummary;
}

export interface TripListItem {
  id: string;
  name: string;
  stop_count: number;
  updated_at: string;
  is_shared: boolean;
}

export interface TripListPage {
  trips: TripListItem[];
  page: number;
  limit: number;
  has_more: boolean;
}

/** The add-stop `201` stop: exactly these keys — no distance (spec §7.2). */
export interface AddedTripStop {
  id: string;
  position: number;
  is_available: true;
  landmark: TripLandmark;
}

const TRIP_KEYS = [
  "id",
  "name",
  "version",
  "created_at",
  "updated_at",
  "is_shared",
  "sharing_enabled",
  "stops",
  "distance_summary",
];
const STOP_KEYS = ["id", "position", "is_available", "distance_from_previous_miles", "landmark"];
const ADDED_STOP_KEYS = ["id", "position", "is_available", "landmark"];
const LANDMARK_KEYS = ["id", "display_name", "category", "latitude", "longitude"];
const SUMMARY_KEYS = ["total_miles", "measured_legs", "total_legs"];
const LIST_KEYS = ["trips", "page", "limit", "has_more"];
const LIST_ITEM_KEYS = ["id", "name", "stop_count", "updated_at", "is_shared"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Exactly these keys: none missing, none extra. */
function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

/** A UUID in canonical lower case, or null. */
export function parseUuid(value: unknown): string | null {
  return typeof value === "string" && UUID_SYNTAX.test(value) ? value.toLowerCase() : null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && ISO_UTC_MS.test(value) && !Number.isNaN(Date.parse(value));
}

function isNonNegativeInteger(value: unknown, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** A trip name as the server stores it: non-empty text of at most 100 code points. */
function isTripName(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  return Array.from(value).length <= MAX_TRIP_NAME_CODE_POINTS;
}

/** The five safe fields, exactly and validly — otherwise null (never partially trusted). */
export function parseTripLandmark(raw: unknown): TripLandmark | null {
  if (!isRecord(raw) || !hasExactKeys(raw, LANDMARK_KEYS)) return null;
  const id = parseUuid(raw.id);
  const { display_name, category, latitude, longitude } = raw;
  if (id === null) return null;
  if (typeof display_name !== "string" || display_name.length === 0) return null;
  if (typeof category !== "string" || !CATEGORY_SLUG.test(category)) return null;
  if (typeof latitude !== "number" || !Number.isFinite(latitude)) return null;
  if (latitude < -90 || latitude > 90) return null;
  if (typeof longitude !== "number" || !Number.isFinite(longitude)) return null;
  if (longitude < -180 || longitude > 180) return null;
  return { id, display_name, category, latitude, longitude };
}

function unavailable(id: string, position: number, landmarkId: string): UnavailableTripStop {
  return {
    id,
    position,
    is_available: false,
    distance_from_previous_miles: null,
    landmark: { id: landmarkId, is_available: false },
  };
}

interface ParsedStop {
  stop: TripStop;
  /** True when anything was dropped: an untrusted landmark or a distance. */
  downgraded: boolean;
}

/**
 * One stop of an owner or shared trip. `null` only for a broken wrapper
 * (stop ID, position, keys, or a landmark without a valid landmark ID);
 * a stop whose landmark cannot be trusted becomes the unavailable placeholder.
 */
export function parseTripStop(raw: unknown, expectedPosition: number): ParsedStop | null {
  if (!isRecord(raw) || !hasExactKeys(raw, STOP_KEYS)) return null;
  const id = parseUuid(raw.id);
  if (id === null || raw.position !== expectedPosition) return null;
  if (typeof raw.is_available !== "boolean") return null;
  if (!isRecord(raw.landmark)) return null;
  const landmarkId = parseUuid(raw.landmark.id);
  if (landmarkId === null) return null;

  const distance = raw.distance_from_previous_miles;
  if (distance !== null && !isNonNegativeFinite(distance)) return null;

  if (raw.is_available === true) {
    const landmark = parseTripLandmark(raw.landmark);
    if (landmark !== null) {
      return {
        stop: {
          id,
          position: expectedPosition,
          is_available: true,
          distance_from_previous_miles: distance,
          landmark,
        },
        downgraded: false,
      };
    }
    return { stop: unavailable(id, expectedPosition, landmarkId), downgraded: true };
  }

  const exactPlaceholder =
    hasExactKeys(raw.landmark, ["id", "is_available"]) &&
    raw.landmark.is_available === false &&
    distance === null;
  return { stop: unavailable(id, expectedPosition, landmarkId), downgraded: !exactPlaceholder };
}

function summaryFrom(stops: readonly TripStop[]): DistanceSummary {
  const legs = stops
    .map((s) => s.distance_from_previous_miles)
    .filter((d): d is number => d !== null);
  return {
    total_miles: legs.length === 0 ? null : legs.reduce((sum, d) => sum + d, 0),
    measured_legs: legs.length,
    total_legs: Math.max(stops.length - 1, 0),
  };
}

function parseSummaryShape(raw: unknown): DistanceSummary | null {
  if (!isRecord(raw) || !hasExactKeys(raw, SUMMARY_KEYS)) return null;
  const { total_miles, measured_legs, total_legs } = raw;
  if (!isNonNegativeInteger(measured_legs) || !isNonNegativeInteger(total_legs)) return null;
  if (total_miles !== null && !isNonNegativeFinite(total_miles)) return null;
  return { total_miles, measured_legs, total_legs };
}

/** Totals agree when both are null, or both are numbers within floating-point rounding. */
function totalsAgree(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
}

/**
 * The stops array and summary of an owner (or shared) trip: positions 0…n-1
 * in order, at most 25, unique stop and landmark IDs; distances only between
 * adjacent available stops; a consistent summary.
 */
export function parseStopsAndSummary(
  rawStops: unknown,
  rawSummary: unknown,
): { stops: TripStop[]; distance_summary: DistanceSummary } | null {
  if (!Array.isArray(rawStops) || rawStops.length > MAX_TRIP_STOPS) return null;
  const serverSummary = parseSummaryShape(rawSummary);
  if (serverSummary === null) return null;

  const stops: TripStop[] = [];
  const stopIds = new Set<string>();
  const landmarkIds = new Set<string>();
  let downgraded = false;
  for (const [index, raw] of rawStops.entries()) {
    const parsed = parseTripStop(raw, index);
    if (parsed === null) return null;
    let { stop } = parsed;
    if (stopIds.has(stop.id) || landmarkIds.has(stop.landmark.id)) return null;
    stopIds.add(stop.id);
    landmarkIds.add(stop.landmark.id);
    downgraded ||= parsed.downgraded;

    // A distance is shown only between two available stops (spec §5.6).
    const previous = stops[index - 1];
    if (
      stop.is_available &&
      stop.distance_from_previous_miles !== null &&
      (previous === undefined || !previous.is_available)
    ) {
      stop = { ...stop, distance_from_previous_miles: null };
      downgraded = true;
    }
    stops.push(stop);
  }

  const computed = summaryFrom(stops);
  if (downgraded) return { stops, distance_summary: computed };
  if (
    serverSummary.measured_legs !== computed.measured_legs ||
    serverSummary.total_legs !== computed.total_legs ||
    !totalsAgree(serverSummary.total_miles, computed.total_miles)
  ) {
    return null;
  }
  return { stops, distance_summary: serverSummary };
}

/** An owner trip (`{ trip }`'s inner object), rebuilt from its approved fields, or null. */
export function parseOwnerTrip(raw: unknown): OwnerTrip | null {
  if (!isRecord(raw) || !hasExactKeys(raw, TRIP_KEYS)) return null;
  const id = parseUuid(raw.id);
  if (id === null || !isTripName(raw.name)) return null;
  if (!isNonNegativeInteger(raw.version, MAX_VERSION)) return null;
  if (!isTimestamp(raw.created_at) || !isTimestamp(raw.updated_at)) return null;
  if (typeof raw.is_shared !== "boolean" || typeof raw.sharing_enabled !== "boolean") return null;
  const parsed = parseStopsAndSummary(raw.stops, raw.distance_summary);
  if (parsed === null) return null;
  return {
    id,
    name: raw.name,
    version: raw.version,
    created_at: raw.created_at,
    updated_at: raw.updated_at,
    is_shared: raw.is_shared,
    sharing_enabled: raw.sharing_enabled,
    stops: parsed.stops,
    distance_summary: parsed.distance_summary,
  };
}

/** `{ trip }` — the wrapper of create, detail, rename, and reorder responses. */
export function parseOwnerTripResponse(raw: unknown): OwnerTrip | null {
  if (!isRecord(raw) || !hasExactKeys(raw, ["trip"])) return null;
  return parseOwnerTrip(raw.trip);
}

function parseTripListItem(raw: unknown): TripListItem | null {
  if (!isRecord(raw) || !hasExactKeys(raw, LIST_ITEM_KEYS)) return null;
  const id = parseUuid(raw.id);
  if (id === null || !isTripName(raw.name)) return null;
  if (!isNonNegativeInteger(raw.stop_count, MAX_TRIP_STOPS)) return null;
  if (!isTimestamp(raw.updated_at) || typeof raw.is_shared !== "boolean") return null;
  return {
    id,
    name: raw.name,
    stop_count: raw.stop_count,
    updated_at: raw.updated_at,
    is_shared: raw.is_shared,
  };
}

/** A list page, matching the requested `page` and `limit`, with no duplicate trips; or null. */
export function parseTripListPage(
  raw: unknown,
  expected: { page: number; limit: number },
): TripListPage | null {
  if (!isRecord(raw) || !hasExactKeys(raw, LIST_KEYS)) return null;
  if (!Array.isArray(raw.trips) || typeof raw.has_more !== "boolean") return null;
  if (!isPositiveInteger(raw.page) || !isPositiveInteger(raw.limit)) return null;
  if (raw.page !== expected.page || raw.limit !== expected.limit) return null;
  if (raw.trips.length > raw.limit) return null;
  const trips: TripListItem[] = [];
  const seen = new Set<string>();
  for (const item of raw.trips) {
    const trip = parseTripListItem(item);
    if (trip === null || seen.has(trip.id)) return null;
    seen.add(trip.id);
    trips.push(trip);
  }
  return { trips, page: raw.page, limit: raw.limit, has_more: raw.has_more };
}

// ---------------------------------------------------------------------------
// Public shared trips and share links (M05-T06 Increment 1; spec v1.1 §§4,
// 5.4, 7.2, 10.3, 10.4; ADR-014 decisions 6, 10; decisions D5, D7).
// ---------------------------------------------------------------------------

/**
 * The public shared-trip view: name, stops, and summary only — no trip ID,
 * owner, version, timestamps, or sharing state exist on this type, so none can
 * be fabricated or rendered.
 */
export interface SharedTrip {
  name: string;
  stops: TripStop[];
  distance_summary: DistanceSummary;
}

const SHARED_TRIP_KEYS = ["name", "stops", "distance_summary"];

/**
 * A share token exactly as the backend issues and accepts it: 32 random bytes
 * as 43 base64url characters (spec §10.3; backend `share-token.ts`).
 */
export const SHARE_TOKEN_SYNTAX = /^[A-Za-z0-9_-]{43}$/;

export function isShareToken(value: unknown): value is string {
  return typeof value === "string" && SHARE_TOKEN_SYNTAX.test(value);
}

/**
 * `{ trip: { name, stops, distance_summary } }` from
 * `GET /api/v1/shared/trips/:shareToken`, rebuilt from its approved fields, or
 * null. Fail-closed: any other key at either level (an ID, version,
 * timestamps, owner, or sharing field) rejects the whole response rather than
 * being dropped. The name must satisfy the trip-name rule exactly as stored
 * (already trimmed). Stops reuse the owner view's checks: an untrusted
 * landmark becomes the unavailable placeholder, a distance touching an
 * unavailable stop is dropped, and the summary must agree with the stops.
 */
export function parseSharedTripResponse(raw: unknown): SharedTrip | null {
  if (!isRecord(raw) || !hasExactKeys(raw, ["trip"])) return null;
  const trip = raw.trip;
  if (!isRecord(trip) || !hasExactKeys(trip, SHARED_TRIP_KEYS)) return null;
  const name = validateTripName(trip.name);
  if (!name.ok || name.value !== trip.name) return null;
  const parsed = parseStopsAndSummary(trip.stops, trip.distance_summary);
  if (parsed === null) return null;
  return { name: name.value, stops: parsed.stops, distance_summary: parsed.distance_summary };
}

/**
 * The `share_url` the owner receives from enable/rotate, accepted only in its
 * canonical form: `http(s)://<host[:port]>/shared/trips/<43 base64url>` with
 * no user name or password, query, fragment, extra segment, trailing slash,
 * whitespace, or escape — and only when the URL parser leaves it EXACTLY as
 * sent (so nothing becomes acceptable through normalization: upper-case
 * scheme or host, a default port, dot segments, percent-encoding,
 * backslashes). The origin is NOT compared with the frontend's (decision D7:
 * the backend's configured origin is authoritative). Returns the URL
 * unchanged, or null; it never throws, logs, or describes the input.
 */
export function parseShareUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const match = /^https?:\/\/[^/?#\\@\s%]+\/shared\/trips\/([A-Za-z0-9_-]{43})$/.exec(raw);
  if (match === null) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") {
    return null;
  }
  if (url.pathname !== `/shared/trips/${match[1]}`) return null;
  if (`${url.origin}${url.pathname}` !== raw) return null;
  return raw;
}

/** `{ share_url }` from `POST /api/v1/trips/:tripId/share` — exactly that key, a valid link; or null. */
export function parseShareResponse(raw: unknown): string | null {
  if (!isRecord(raw) || !hasExactKeys(raw, ["share_url"])) return null;
  return parseShareUrl(raw.share_url);
}

/**
 * `{ stop }` from add-stop: exactly `id`, `position`, `is_available: true`, and
 * the five landmark fields — a `distance_from_previous_miles` (or any other
 * key) makes it invalid. An add can only succeed for a visible landmark, so an
 * untrusted landmark here fails the whole response.
 */
export function parseAddedStopResponse(raw: unknown): AddedTripStop | null {
  if (!isRecord(raw) || !hasExactKeys(raw, ["stop"])) return null;
  const stop = raw.stop;
  if (!isRecord(stop) || !hasExactKeys(stop, ADDED_STOP_KEYS)) return null;
  const id = parseUuid(stop.id);
  if (id === null || stop.is_available !== true) return null;
  if (!isNonNegativeInteger(stop.position, MAX_TRIP_STOPS - 1)) return null;
  const landmark = parseTripLandmark(stop.landmark);
  if (landmark === null) return null;
  return { id, position: stop.position, is_available: true, landmark };
}
