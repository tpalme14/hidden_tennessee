import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { getOwnReview, type Review } from "../api/reviews";
import { useAuth } from "../auth/session";

/**
 * The signed-in user's own review of one landmark (M04-T03 Increment 3; spec
 * v1.1 §§3, 6; ADR-013 decision 4 — the authenticated own-review lookup).
 *
 * Follows the four session states (`useAuth`):
 * - `loading` → `checking` (nothing is requested yet);
 * - `anonymous` → `signed-out` (nothing is requested);
 * - `unavailable` → `session-unavailable` (signed-in status unknown; nothing
 *   is requested; the session's own `retry` is the way forward);
 * - `authenticated` → the lookup for (landmark, user).
 *
 * Lookup outcomes: `none` (no review yet), `found`, `unavailable` (404 — the
 * landmark is missing, retired, or not public), or `error` (with `reload`).
 * A 401 asks the existing auth mechanism to re-check the session and then
 * repeats the lookup; it never decides "signed out" on its own (the
 * favorites convention).
 *
 * Results are tied to the landmark AND the user they were requested for: a
 * generation counter discards any response from before a landmark change, a
 * user change, a sign-out, or a reload, and every result carries the user ID
 * it belongs to, so another account's review can never be shown as "yours".
 */

export const OWN_REVIEW_LOAD_ERROR = "Your review couldn't be loaded. Please try again.";

export type OwnReviewState =
  | { kind: "checking" }
  | { kind: "signed-out" }
  | { kind: "session-unavailable" }
  | { kind: "none"; userId: string }
  | { kind: "found"; userId: string; review: Review }
  | { kind: "unavailable"; userId: string }
  | { kind: "error"; userId: string; message: string };

export interface OwnReview {
  state: OwnReviewState;
  /**
   * Repeats the lookup (after an error, or after a confirmed change). With
   * `{ silent: true }` (Increment 4, after an edit) the current result stays
   * shown until the new one replaces it — only when it belongs to the same
   * landmark and user — so the "Your review" panel is not unmounted and keeps
   * focus.
   */
  reload: (options?: { silent?: boolean }) => void;
}

export function useOwnReview(landmarkId: string): OwnReview {
  const { session, refresh } = useAuth();
  const userId = session.status === "authenticated" ? session.user.id : null;
  const [state, setState] = useState<OwnReviewState>({ kind: "checking" });
  const [reloadToken, setReloadToken] = useState(0);
  const generation = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Set by a silent `reload` for the next lookup only. */
  const silentNext = useRef(false);
  const lookedUp = useRef<{ landmarkId: string; userId: string } | null>(null);

  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    const silentRequested = silentNext.current;
    silentNext.current = false;

    if (session.status === "loading") {
      setState({ kind: "checking" });
      return;
    }
    if (session.status === "anonymous") {
      setState({ kind: "signed-out" });
      return;
    }
    if (session.status === "unavailable" || userId === null) {
      setState({ kind: "session-unavailable" });
      return;
    }

    const forUser = userId;
    const previous = stateRef.current;
    const silent =
      silentRequested &&
      lookedUp.current?.landmarkId === landmarkId &&
      lookedUp.current.userId === forUser &&
      (previous.kind === "found" || previous.kind === "none") &&
      previous.userId === forUser;
    lookedUp.current = { landmarkId, userId: forUser };
    if (!silent) setState({ kind: "checking" });
    getOwnReview(landmarkId).then(
      (review) => {
        if (generation.current !== current) return;
        setState(
          review === null
            ? { kind: "none", userId: forUser }
            : { kind: "found", userId: forUser, review },
        );
      },
      (error: unknown) => {
        if (generation.current !== current) return;
        if (error instanceof ApiError && error.status === 401) {
          // Let the session check decide; then look again (a still-valid
          // session gets a fresh lookup, an ended one becomes signed-out).
          setState({ kind: "checking" });
          void refresh().then(() => {
            if (generation.current === current) setReloadToken((token) => token + 1);
          });
          return;
        }
        if (error instanceof ApiError && error.status === 404) {
          setState({ kind: "unavailable", userId: forUser });
          return;
        }
        setState({ kind: "error", userId: forUser, message: OWN_REVIEW_LOAD_ERROR });
      },
    );

    return () => {
      generation.current += 1;
    };
    // `refresh` is a stable callback from the provider; the lookup otherwise
    // depends on the landmark, the session state, and the verified user only.
  }, [landmarkId, session.status, userId, reloadToken, refresh]);

  const reload = useCallback((options?: { silent?: boolean }) => {
    silentNext.current = options?.silent === true;
    setReloadToken((token) => token + 1);
  }, []);

  // Defence in depth: never present a result that belongs to someone else.
  const visible: OwnReviewState =
    "userId" in state && state.userId !== userId ? { kind: "checking" } : state;

  return { state: visible, reload };
}
