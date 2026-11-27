import { isValidFullProfile } from "../api/landmarkProfileValidation";
import { parseOwnerTripResponse, type OwnerTrip } from "../api/tripValidation";
import {
  isKnownCategory,
  OFFLINE_SCHEMA_VERSION,
  validateStoredLandmark,
  validateStoredTrip,
  type StoredAvailableLandmark,
  type StoredAvailableTrip,
  type StoredLandmark,
  type StoredStop,
  type StoredTrip,
  type StoredUnavailableLandmark,
  type StoredUnavailableTrip,
} from "./records";

/**
 * Projection of API data into persisted offline records (M06-T03 Increment
 * 3a; Specification 6 v1.1 OFF-EV-3, OFF-SNAP-1–6). Every output is built
 * field by field from the allowlist — never by spreading or storing a
 * response — and is then checked again by the stored-record validator, so a
 * projection can never produce a record the reader would reject.
 *
 * This is distinct from validating already persisted records (`records.ts`):
 * projection decides what may ENTER storage from server data; validation
 * decides whether what is READ back may be used. Neither writes anything.
 */

/** Ownership and bookkeeping supplied by the (later) storage operation — never taken from a response. */
export interface ProjectionContext {
  account_id: string;
  lifecycle_id: string;
  revision: number;
  /** The original first-save time; preserved by refreshes and markers (OFF-SNAP-7). */
  saved_at: string;
  /** Set only by a successful explicit whole-snapshot refresh. */
  refreshed_at?: string;
}

/**
 * OFF-EV-3 / OFF-SNAP-2: an available landmark snapshot from a validated full
 * profile whose `id` equals the requested ID and whose category is known —
 * otherwise `null`. A minimal (redacted) profile is never eligible.
 */
export function projectAvailableLandmark(
  profile: unknown,
  requestedId: string,
  context: ProjectionContext,
): StoredAvailableLandmark | null {
  if (!isValidFullProfile(profile)) return null; // exact keys: no `redacted`, nothing extra
  if (profile.id !== requestedId.toLowerCase()) return null;
  if (!isKnownCategory(profile.category)) return null;
  const record: StoredAvailableLandmark = {
    schema_version: OFFLINE_SCHEMA_VERSION,
    account_id: context.account_id,
    lifecycle_id: context.lifecycle_id,
    revision: context.revision,
    landmark_id: profile.id,
    status: "available",
    display_name: profile.display_name,
    category: profile.category,
    latitude: profile.latitude,
    longitude: profile.longitude,
    saved_at: context.saved_at,
    source_description: profile.source_description,
    source_access_label: profile.source_access_label,
    source_url: profile.source_url,
  };
  if (context.refreshed_at !== undefined) record.refreshed_at = context.refreshed_at;
  const checked = validateStoredLandmark(record);
  return checked.ok && checked.record.status === "available" ? checked.record : null;
}

/**
 * OFF-SNAP-3: an unavailable landmark marker. Only the identifier and the
 * original `saved_at` are taken from the previous record; every protected
 * field of an available record is dropped.
 */
export function projectUnavailableLandmark(
  previous: StoredLandmark,
  unavailableRecordedAt: string,
  revision: number,
): StoredUnavailableLandmark | null {
  const record: StoredUnavailableLandmark = {
    schema_version: OFFLINE_SCHEMA_VERSION,
    account_id: previous.account_id,
    lifecycle_id: previous.lifecycle_id,
    revision,
    landmark_id: previous.landmark_id,
    status: "unavailable",
    saved_at: previous.saved_at,
    unavailable_recorded_at: unavailableRecordedAt,
  };
  const checked = validateStoredLandmark(record);
  return checked.ok && checked.record.status === "unavailable" ? checked.record : null;
}

function projectStop(stop: OwnerTrip["stops"][number]): StoredStop | null {
  if (stop.is_available) {
    if (!isKnownCategory(stop.landmark.category)) return null;
    return {
      stop_id: stop.id,
      position: stop.position,
      is_available: true,
      distance_from_previous_miles: stop.distance_from_previous_miles,
      landmark: {
        id: stop.landmark.id,
        display_name: stop.landmark.display_name,
        category: stop.landmark.category,
        latitude: stop.landmark.latitude,
        longitude: stop.landmark.longitude,
      },
    };
  }
  return {
    stop_id: stop.id,
    position: stop.position,
    is_available: false,
    distance_from_previous_miles: null,
    landmark: { id: stop.landmark.id, is_available: false },
  };
}

/**
 * OFF-SNAP-4: an available trip snapshot from a validated owner-trip response
 * (`{ trip }`, parsed by the existing `parseOwnerTripResponse`, which rebuilds
 * the trip from its approved fields) whose `id` equals the requested trip ID —
 * otherwise `null`. `version`, `is_shared`, `sharing_enabled`, `created_at`,
 * and any share URL or token are never copied (D17).
 */
export function projectAvailableTrip(
  response: unknown,
  requestedTripId: string,
  context: ProjectionContext,
): StoredAvailableTrip | null {
  const trip = parseOwnerTripResponse(response);
  if (trip === null || trip.id !== requestedTripId.toLowerCase()) return null;
  const stops: StoredStop[] = [];
  for (const stop of trip.stops) {
    const projected = projectStop(stop);
    if (projected === null) return null;
    stops.push(projected);
  }
  const record: StoredAvailableTrip = {
    schema_version: OFFLINE_SCHEMA_VERSION,
    account_id: context.account_id,
    lifecycle_id: context.lifecycle_id,
    revision: context.revision,
    trip_id: trip.id,
    status: "available",
    name: trip.name,
    stops,
    distance_summary: {
      total_miles: trip.distance_summary.total_miles,
      measured_legs: trip.distance_summary.measured_legs,
      total_legs: trip.distance_summary.total_legs,
    },
    distance_summary_state: "server",
    saved_at: context.saved_at,
    trip_updated_at: trip.updated_at,
  };
  if (context.refreshed_at !== undefined) record.refreshed_at = context.refreshed_at;
  const checked = validateStoredTrip(record);
  return checked.ok && checked.record.status === "available" ? checked.record : null;
}

/** OFF-SNAP-6: an unavailable trip marker — identifier and original `saved_at` only. */
export function projectUnavailableTrip(
  previous: StoredTrip,
  unavailableRecordedAt: string,
  revision: number,
): StoredUnavailableTrip | null {
  const record: StoredUnavailableTrip = {
    schema_version: OFFLINE_SCHEMA_VERSION,
    account_id: previous.account_id,
    lifecycle_id: previous.lifecycle_id,
    revision,
    trip_id: previous.trip_id,
    status: "unavailable",
    saved_at: previous.saved_at,
    unavailable_recorded_at: unavailableRecordedAt,
  };
  const checked = validateStoredTrip(record);
  return checked.ok && checked.record.status === "unavailable" ? checked.record : null;
}
