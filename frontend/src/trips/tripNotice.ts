import { parseUuid } from "../api/tripValidation";

/**
 * One-time navigation notices between trip pages (M05-T06 Increments 2–3;
 * decision D4).
 *
 * A notice travels in the router's history state — memory only, never the URL
 * or browser storage — and is shown ONCE by the destination page, and only
 * when it belongs to the destination: the same confirmed user and, for a
 * created trip, the same trip. The destination then replaces the history entry
 * without the state, so Back/Forward or a reload never repeats it. History
 * state is untrusted input: it is read only through the `read…` functions
 * below, which accept the exact shape or nothing.
 */

export interface CreatedTripNotice {
  kind: "trip-created";
  userId: string;
  tripId: string;
  name: string;
}

/**
 * For My Trips after leaving a trip page because of a delete request:
 * - `trip-deleted` — the server confirmed this deletion (`204`); `name` is the
 *   trip's name as it was;
 * - `trip-unavailable` — the trip is no longer available to this user (a `404`
 *   to the delete, or a re-read after an uncertain delete that found nothing).
 *   It does not say why, or that this request deleted it; `uncertain` is true
 *   when the delete request's own outcome was unknown.
 */
export type TripsListNotice =
  | { kind: "trip-deleted"; userId: string; name: string }
  | { kind: "trip-unavailable"; userId: string; uncertain: boolean };

const STATE_KEY = "tripNotice";

/** The `state` to navigate with after a confirmed creation. */
export function createdTripState(notice: Omit<CreatedTripNotice, "kind">): Record<string, unknown> {
  return { [STATE_KEY]: { kind: "trip-created", ...notice } };
}

/** The `state` to navigate to My Trips with after a delete request. */
export function tripsListState(notice: TripsListNotice): Record<string, unknown> {
  return { [STATE_KEY]: { ...notice } };
}

function rawNotice(state: unknown): Record<string, unknown> | null {
  if (typeof state !== "object" || state === null) return null;
  const raw = (state as Record<string, unknown>)[STATE_KEY];
  return typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
}

/** The created-trip notice in a location's state, or null (any other shape is ignored). */
export function readCreatedTripNotice(state: unknown): CreatedTripNotice | null {
  const raw = rawNotice(state);
  if (raw === null) return null;
  const { kind, userId, tripId, name } = raw;
  if (kind !== "trip-created" || typeof userId !== "string" || userId === "") return null;
  const id = parseUuid(tripId);
  if (id === null || typeof name !== "string" || name === "") return null;
  return { kind, userId, tripId: id, name };
}

/** The My Trips notice in a location's state, or null (any other shape is ignored). */
export function readTripsListNotice(state: unknown): TripsListNotice | null {
  const raw = rawNotice(state);
  if (raw === null) return null;
  const { kind, userId } = raw;
  if (typeof userId !== "string" || userId === "") return null;
  if (kind === "trip-deleted") {
    const { name } = raw;
    if (typeof name !== "string" || name === "") return null;
    return { kind, userId, name };
  }
  if (kind === "trip-unavailable") {
    const { uncertain } = raw;
    if (typeof uncertain !== "boolean") return null;
    return { kind, userId, uncertain };
  }
  return null;
}
