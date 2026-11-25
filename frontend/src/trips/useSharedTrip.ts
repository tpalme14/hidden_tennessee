import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { getSharedTrip, type SharedTrip } from "../api/trips";
import { isShareToken } from "../api/tripValidation";

/**
 * The public, read-only shared trip for one share token (M05-T06 Increment
 * 5a; spec v1.1 §§4, 5.4, 7.2, 10.4; decisions D5, D6, D10; refinement R1).
 *
 * Independent of authentication: it never reads the session, never re-checks
 * it, and sends its one request through `getSharedTrip` → `getPublicJson`
 * (`credentials: "omit"`). It holds ONE snapshot — the validated shared trip
 * (`name`, `stops`, `distance_summary` only; no trip ID, owner, version,
 * timestamps, or sharing state exist on it).
 *
 * Views:
 * - `loading` — the trip for this token is being fetched;
 * - `ready` — the validated trip, with `loadId`, a presentation-only number
 *   that is new for every successful load (used to give the map a fresh
 *   identity — never the token, never an owner ID);
 * - `unavailable` — the ONE generic outcome for a malformed token (no request
 *   is made), a `400`, or a `404` (revoked, rotated, deleted, unknown, or
 *   sharing switched off — indistinguishable by design);
 * - `error` — a recoverable failure (network, `5xx`, an invalid response);
 *   only an explicit `retry` fetches again.
 *
 * ORDERING. Every fetch carries an epoch; only the latest fetch for the
 * CURRENT token may write, and only while mounted. The view is derived from
 * the CURRENT token on every render, so a token change hides the previous
 * trip immediately — before any effect runs. Nothing is persisted, prefetched,
 * polled, or retried automatically.
 */

export type SharedTripView =
  | { status: "loading" }
  | { status: "ready"; trip: SharedTrip; loadId: number }
  | { status: "unavailable" }
  | { status: "error" };

interface Snapshot {
  /** The token this snapshot belongs to (memory only, never rendered or logged). */
  token: string;
  view: SharedTripView;
}

export interface UseSharedTrip {
  view: SharedTripView;
  /** Fetches again after a recoverable failure (never automatic). */
  retry: () => void;
}

function failureView(error: unknown): SharedTripView {
  if (error instanceof RangeError) return { status: "unavailable" };
  if (error instanceof ApiError && (error.status === 404 || error.status === 400)) {
    return { status: "unavailable" };
  }
  return { status: "error" };
}

export function useSharedTrip(shareToken: string | undefined): UseSharedTrip {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const epochRef = useRef(0);
  const loadSeq = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async (token: string) => {
    const epoch = ++epochRef.current;
    setSnapshot({ token, view: { status: "loading" } });
    let view: SharedTripView;
    try {
      const trip = await getSharedTrip(token);
      view = { status: "ready", trip, loadId: ++loadSeq.current };
    } catch (error) {
      view = failureView(error);
    }
    if (!mounted.current || epochRef.current !== epoch) return;
    setSnapshot({ token, view });
  }, []);

  const valid = isShareToken(shareToken);

  useEffect(() => {
    if (!isShareToken(shareToken)) {
      // Malformed (or missing): nothing is requested; outstanding fetches are dropped.
      epochRef.current += 1;
      setSnapshot(null);
      return;
    }
    void load(shareToken);
  }, [shareToken, load]);

  const retry = useCallback(() => {
    if (!isShareToken(shareToken)) return;
    void load(shareToken);
  }, [shareToken, load]);

  let view: SharedTripView;
  if (!valid) view = { status: "unavailable" };
  else if (snapshot === null || snapshot.token !== shareToken) view = { status: "loading" };
  else view = snapshot.view;

  return { view, retry };
}
