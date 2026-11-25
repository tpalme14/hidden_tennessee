import { validateTripName } from "../trips/tripNameRule";
import {
  ApiError,
  deleteNoContent,
  getJson,
  getPublicJson,
  patchJson,
  postJson,
  putJsonBody,
} from "./client";
import {
  MAX_TRIP_STOPS,
  MAX_VERSION,
  isShareToken,
  parseAddedStopResponse,
  parseOwnerTripResponse,
  parseShareResponse,
  parseSharedTripResponse,
  parseTripListPage,
  parseUuid,
  type AddedTripStop,
  type OwnerTrip,
  type SharedTrip,
  type TripListPage,
} from "./tripValidation";

export type {
  AddedTripStop,
  AvailableTripStop,
  DistanceSummary,
  OwnerTrip,
  SharedTrip,
  TripLandmark,
  TripListItem,
  TripListPage,
  TripStop,
  UnavailableTripStop,
} from "./tripValidation";
export { MAX_TRIP_STOPS } from "./tripValidation";

/**
 * Typed wrappers over the owner trips API (M05-T04 Increment 1), mirroring the
 * contract implemented and verified in M05-T03 (specs/TRIP_PLANNING_SPEC.md
 * v1.1 §§6, 7, 7.2, 7.3; ADR-014; the README's "Trips API" section). The
 * session cookie identifies the user; no user ID is ever sent or received.
 *
 * Every response is validated and rebuilt by `tripValidation.ts` before it
 * reaches the interface; a malformed one is an `INVALID_RESPONSE` `ApiError`,
 * never a partial result. Server errors keep the existing `ApiError` contract
 * (status, code, message, `retryAfterSeconds` on 429).
 *
 * M05-T06 Increment 1 adds rename, delete, share enable/rotate and revoke, and
 * the public shared-trip read. Inputs (IDs, names, versions, share tokens) are
 * checked before any request; a malformed input is a `RangeError` with a fixed
 * message that never contains the input, and nothing is sent. No call here is
 * ever retried automatically.
 */

const TRIPS_PATH = "/api/v1/trips";
const tripPath = (tripId: string) => `${TRIPS_PATH}/${encodeURIComponent(tripId)}`;

/** The trips API's named conflicts (spec §7.3). */
export const TRIP_STOP_ALREADY_EXISTS = "TRIP_STOP_ALREADY_EXISTS";
export const TRIP_STOP_LIMIT_REACHED = "TRIP_STOP_LIMIT_REACHED";
export const TRIP_VERSION_CONFLICT = "TRIP_VERSION_CONFLICT";
export const TRIP_SHARING_UNAVAILABLE = "TRIP_SHARING_UNAVAILABLE";

export const DEFAULT_TRIPS_PAGE = 1;
export const DEFAULT_TRIPS_LIMIT = 20;
export const MAX_TRIPS_LIMIT = 100;

export interface TripListQuery {
  /** Positive integer; the server's default is 1. */
  page?: number;
  /** 1–100; the server's default is 20. */
  limit?: number;
}

function invalidResponse(status: number): ApiError {
  return new ApiError(status, "INVALID_RESPONSE", "The server returned an unexpected response.");
}

/** A trip ID in canonical lower case, or a RangeError (fixed message, no input echoed). */
function requireTripId(tripId: string): string {
  const canonical = parseUuid(tripId);
  if (canonical === null) throw new RangeError("trip ID must be a UUID");
  return canonical;
}

function assertQuery(page: number, limit: number): void {
  if (!Number.isSafeInteger(page) || page < 1) {
    throw new RangeError("trips page must be a positive integer");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_TRIPS_LIMIT) {
    throw new RangeError(`trips limit must be an integer from 1 through ${MAX_TRIPS_LIMIT}`);
  }
}

/** `GET /api/v1/trips?page&limit` — one page of the user's trips, most recently updated first. */
export async function listTrips(query: TripListQuery = {}): Promise<TripListPage> {
  const page = query.page ?? DEFAULT_TRIPS_PAGE;
  const limit = query.limit ?? DEFAULT_TRIPS_LIMIT;
  assertQuery(page, limit);
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  const raw = await getJson<unknown>(`${TRIPS_PATH}?${params.toString()}`);
  const parsed = parseTripListPage(raw, { page, limit });
  if (parsed === null) throw invalidResponse(200);
  return parsed;
}

/**
 * `POST /api/v1/trips` — creates an empty trip. `name` must already be
 * validated with `validateTripName` (the server applies the same rule and is
 * authoritative). The response must be a new trip: version 0, no stops.
 */
export async function createTrip(name: string): Promise<OwnerTrip> {
  const raw = await postJson<unknown>(TRIPS_PATH, { name });
  const trip = parseOwnerTripResponse(raw);
  if (trip === null || trip.version !== 0 || trip.stops.length !== 0) throw invalidResponse(201);
  return trip;
}

/** `GET /api/v1/trips/:tripId` — the owner view. A missing or someone else's trip is a 404 `ApiError`. */
export async function getTrip(tripId: string): Promise<OwnerTrip> {
  const raw = await getJson<unknown>(tripPath(tripId));
  const trip = parseOwnerTripResponse(raw);
  if (trip === null || trip.id !== tripId.toLowerCase()) throw invalidResponse(200);
  return trip;
}

/**
 * `POST /api/v1/trips/:tripId/stops` — appends a landmark. Resolves to the new
 * stop, which carries no distance and no `version`: reload the trip
 * (`getTrip`) before reordering (spec §6.4). Errors: 404 for a missing or
 * someone else's trip and for a missing or unavailable landmark; 409
 * `TRIP_STOP_ALREADY_EXISTS`; 409 `TRIP_STOP_LIMIT_REACHED`.
 */
export async function addTripStop(tripId: string, landmarkId: string): Promise<AddedTripStop> {
  const raw = await postJson<unknown>(`${tripPath(tripId)}/stops`, { landmark_id: landmarkId });
  const stop = parseAddedStopResponse(raw);
  if (stop === null || stop.landmark.id !== landmarkId.toLowerCase()) throw invalidResponse(201);
  return stop;
}

/**
 * `DELETE /api/v1/trips/:tripId/stops/:stopId` — removes a stop (`204`, no
 * body and no `version`: reload the trip before reordering). A stop that is
 * not in the user's trip is a 404 `ApiError`.
 */
export async function removeTripStop(tripId: string, stopId: string): Promise<void> {
  await deleteNoContent(`${tripPath(tripId)}/stops/${encodeURIComponent(stopId)}`);
}

/**
 * `PUT /api/v1/trips/:tripId/stops/order` — replaces the stop order. `stopIds`
 * must list every current stop exactly once and `version` must be the trip's
 * current version. Resolves to the reordered trip (version + 1). A stale
 * version is a 409 `TRIP_VERSION_CONFLICT`; a wrong ID set is a 400
 * `INVALID_REQUEST`.
 */
export async function reorderTripStops(
  tripId: string,
  stopIds: readonly string[],
  version: number,
): Promise<OwnerTrip> {
  if (stopIds.length === 0 || stopIds.length > MAX_TRIP_STOPS) {
    throw new RangeError(`a reorder lists 1 through ${MAX_TRIP_STOPS} stops`);
  }
  if (!Number.isSafeInteger(version) || version < 0) {
    throw new RangeError("version must be a non-negative integer");
  }
  const { status, body } = await putJsonBody<unknown>(`${tripPath(tripId)}/stops/order`, {
    stop_ids: stopIds,
    version,
  });
  const trip = parseOwnerTripResponse(body);
  if (
    status !== 200 ||
    trip === null ||
    trip.id !== tripId.toLowerCase() ||
    trip.stops.length !== stopIds.length ||
    trip.stops.some((stop, i) => stop.id !== stopIds[i]!.toLowerCase())
  ) {
    throw invalidResponse(status);
  }
  return trip;
}

/**
 * `PATCH /api/v1/trips/:tripId` — renames the trip (spec §§5.5, 6.4). `name`
 * passes through `validateTripName` here (the trimmed value is what is sent);
 * `version` is the trip's last observed version and is always sent. Resolves
 * to the renamed trip, which must be the requested trip, carry the sent name,
 * and have a version greater than the one sent. Errors: 409
 * `TRIP_VERSION_CONFLICT` (stale version, nothing changed), 404 (missing or
 * someone else's trip), 400 (the server's name rule, authoritative).
 */
export async function renameTrip(
  tripId: string,
  name: string,
  version: number,
): Promise<OwnerTrip> {
  const id = requireTripId(tripId);
  const checked = validateTripName(name);
  if (!checked.ok) throw new RangeError("trip name does not satisfy the trip-name rule");
  if (!Number.isSafeInteger(version) || version < 0 || version > MAX_VERSION) {
    throw new RangeError("version must be a non-negative integer");
  }
  const { status, body } = await patchJson<unknown>(tripPath(id), {
    name: checked.value,
    version,
  });
  const trip = parseOwnerTripResponse(body);
  if (
    status !== 200 ||
    trip === null ||
    trip.id !== id ||
    trip.name !== checked.value ||
    trip.version <= version
  ) {
    throw invalidResponse(status);
  }
  return trip;
}

/**
 * `DELETE /api/v1/trips/:tripId` — deletes the trip and its stops (`204`, no
 * body; spec §5.5). A missing or someone else's trip is a 404 `ApiError`.
 */
export async function deleteTrip(tripId: string): Promise<void> {
  await deleteNoContent(tripPath(requireTripId(tripId)));
}

/**
 * `POST /api/v1/trips/:tripId/share` — enables sharing, or rotates the link
 * (spec §§5.4, 7.2, 10.3). Every call issues a NEW token and invalidates the
 * previous one; this response is the only place the raw link ever appears.
 * Resolves to the validated `share_url` (decision D7). The response carries no
 * trip and no `version`: the caller must re-read the trip. Errors: 409
 * `TRIP_SHARING_UNAVAILABLE` (sharing switched off on the server, nothing
 * changed), 404 (missing or someone else's trip).
 */
export async function enableTripSharing(tripId: string): Promise<string> {
  const raw = await postJson<unknown>(`${tripPath(requireTripId(tripId))}/share`, {});
  const shareUrl = parseShareResponse(raw);
  if (shareUrl === null) throw invalidResponse(200);
  return shareUrl;
}

/**
 * `DELETE /api/v1/trips/:tripId/share` — turns sharing off; the link stops
 * working at once (`204`, no body; it succeeds whether or not a link was
 * active, and whether or not sharing is enabled on the server). The caller
 * must re-read the trip for its new `version`.
 */
export async function revokeTripSharing(tripId: string): Promise<void> {
  await deleteNoContent(`${tripPath(requireTripId(tripId))}/share`);
}

/**
 * `GET /api/v1/shared/trips/:shareToken` — the public, read-only view of a
 * shared trip. Sent through `getPublicJson` (no cookies or other credentials;
 * decision D5). A token that is not exactly 43 base64url characters is a
 * `RangeError` and no request is made. A missing, revoked, rotated, or
 * malformed token — and every token while sharing is off on the server — is
 * the server's generic 404.
 */
export async function getSharedTrip(shareToken: string): Promise<SharedTrip> {
  if (!isShareToken(shareToken)) throw new RangeError("share token is malformed");
  const raw = await getPublicJson<unknown>(`/api/v1/shared/trips/${shareToken}`);
  const trip = parseSharedTripResponse(raw);
  if (trip === null) throw invalidResponse(200);
  return trip;
}
