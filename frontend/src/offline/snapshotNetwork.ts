import { ApiError, getJson } from "../api/client";
import { isValidFullProfile, isValidMinimalProfile } from "../api/landmarkProfileValidation";
import { parseOwnerTripResponse } from "../api/tripValidation";

/**
 * Snapshot response classification (M06-T03 Increment 3d; Specification 6
 * v1.1 OFF-EV-1, OFF-EV-2, OFF-EV-3). It only CLASSIFIES: nothing is stored
 * here, and the raw body is passed on only so that the accepted projections
 * (`projection.ts`) can rebuild an allowlisted record from it.
 *
 * Only `unavailable` is authoritative evidence that may invalidate content.
 * `auth` (401) is an authentication failure, never content unavailability;
 * `transient` and `invalid` are never authoritative.
 */

export type LandmarkResponse =
  /** `200` with a validated full profile whose `id` is the requested one (OFF-EV-3). */
  | { kind: "available"; body: unknown }
  /** Authoritative: a `404` with the JSON error envelope, or a valid minimal redacted profile. */
  | { kind: "unavailable"; evidence: "not-found" | "redacted" }
  | { kind: "auth" }
  | { kind: "transient" }
  | { kind: "invalid" };

export type TripResponse =
  /** `200` with a validated owner trip `{ trip }` whose `id` is the requested one. */
  | { kind: "available"; body: unknown }
  /** Authoritative trip unavailability (deleted or not owned); never landmark evidence. */
  | { kind: "unavailable" }
  | { kind: "auth" }
  | { kind: "transient" }
  | { kind: "invalid" };

export interface SnapshotNetwork {
  fetchLandmark(id: string): Promise<LandmarkResponse>;
  fetchTrip(id: string): Promise<TripResponse>;
}

/** The error classes shared by both endpoints. */
function classifyError(error: unknown): "unavailable" | "auth" | "transient" | "invalid" {
  if (!(error instanceof ApiError)) return "invalid";
  if (error.status === 404 && error.code === "NOT_FOUND") return "unavailable";
  if (error.status === 401) return "auth";
  if (error.status === 0 || error.status === 429 || error.status >= 500) return "transient";
  return "invalid"; // any other status, or a body that failed the client's own checks
}

export async function fetchLandmark(
  id: string,
  get: (path: string) => Promise<unknown> = getJson,
): Promise<LandmarkResponse> {
  const requested = id.toLowerCase();
  let body: unknown;
  try {
    body = await get(`/api/v1/landmarks/${encodeURIComponent(requested)}`);
  } catch (error) {
    const kind = classifyError(error);
    return kind === "unavailable" ? { kind, evidence: "not-found" } : { kind };
  }
  if (isValidFullProfile(body) && body.id === requested) return { kind: "available", body };
  if (isValidMinimalProfile(body) && body.id === requested) {
    return { kind: "unavailable", evidence: "redacted" };
  }
  return { kind: "invalid" };
}

export async function fetchTrip(
  id: string,
  get: (path: string) => Promise<unknown> = getJson,
): Promise<TripResponse> {
  const requested = id.toLowerCase();
  let body: unknown;
  try {
    body = await get(`/api/v1/trips/${encodeURIComponent(requested)}`);
  } catch (error) {
    return { kind: classifyError(error) };
  }
  const trip = parseOwnerTripResponse(body);
  return trip !== null && trip.id === requested ? { kind: "available", body } : { kind: "invalid" };
}

/** The application's network wiring. */
export const browserSnapshotNetwork: SnapshotNetwork = {
  fetchLandmark: (id) => fetchLandmark(id),
  fetchTrip: (id) => fetchTrip(id),
};
