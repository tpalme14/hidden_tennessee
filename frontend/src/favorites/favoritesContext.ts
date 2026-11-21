import { createContext, useContext } from "react";

/**
 * Saved-state model for the favorites UI (M03-T06 Increment 2; approved
 * design K1 with decisions L1–L4).
 *
 * Per landmark, exactly one of:
 * - `checking` — membership is still loading (or the session is still being
 *   verified), so nothing is claimed yet (L4: busy, inactive control);
 * - `saved` — the server listed it, or confirmed a save;
 * - `unsaved` — KNOWN not saved: a confirmed removal, or absent from a
 *   COMPLETE membership load;
 * - `unknown` — membership could not be established for it (a partial load at
 *   the five-page cap, a failed load, or a 404 on save). Never presented as
 *   unsaved; the UI offers a save-only action (L2);
 * - `signed-out` — there is no verified signed-in user.
 */
export type FavoriteStatus = "checking" | "saved" | "unsaved" | "unknown" | "signed-out";

/** Why a favorites request did not succeed, in the terms the UI needs. */
export type FavoritesFailure =
  | { kind: "unauthenticated" }
  | { kind: "rate-limited"; retryAfterSeconds?: number }
  | { kind: "error"; message: string };

/**
 * - `inactive` — no verified signed-in user;
 * - `loading` — pages are being fetched;
 * - `complete` — every saved landmark is known (the last page had no more);
 * - `partial` — the five-page cap (L1) was reached with more remaining;
 * - `failed` — a page request failed; pages already loaded still count.
 */
export type MembershipStatus = "inactive" | "loading" | "complete" | "partial" | "failed";

export interface MembershipState {
  status: MembershipStatus;
  /** Set when `status` is `failed`. */
  failure?: FavoritesFailure;
}

export type SaveOutcome =
  | { kind: "saved"; created: boolean }
  /** 404: unknown, retired, or not public — the landmark cannot be saved. */
  | { kind: "not-saveable" }
  /** A request for this landmark is already in flight; nothing was sent. */
  | { kind: "busy" }
  | { kind: "signed-out" }
  | { kind: "failed"; failure: FavoritesFailure }
  /** The signed-in user changed (or signed out) while the request ran; its result was discarded. */
  | { kind: "discarded" };

export type RemoveOutcome =
  | { kind: "removed" }
  | { kind: "busy" }
  | { kind: "signed-out" }
  | { kind: "failed"; failure: FavoritesFailure }
  | { kind: "discarded" };

export interface FavoritesContextValue {
  membership: MembershipState;
  /** The current status of one landmark (IDs are compared in lower case). */
  statusOf: (landmarkId: string) => FavoriteStatus;
  /** True while a save or removal for this landmark is in flight. */
  isPending: (landmarkId: string) => boolean;
  /** Ensures the landmark is saved; resolves with the outcome, never rejects. */
  save: (landmarkId: string) => Promise<SaveOutcome>;
  /** Ensures the landmark is not saved; resolves with the outcome, never rejects. */
  remove: (landmarkId: string) => Promise<RemoveOutcome>;
  /** Explicit retry after a failed or partial load (no automatic retries; L3). Ignored while loading. */
  retry: () => void;
  /** Starts a fresh membership load even if one is in flight (the older one is discarded). */
  refresh: () => void;
}

export const FavoritesContext = createContext<FavoritesContextValue | null>(null);

/** The favorites context. Must be used inside `FavoritesProvider` (mounted in `main.tsx`). */
export function useFavorites(): FavoritesContextValue {
  const value = useContext(FavoritesContext);
  if (value === null) {
    throw new Error("useFavorites must be used inside <FavoritesProvider>");
  }
  return value;
}

/** One landmark's status and whether a request for it is in flight. */
export function useFavoriteStatus(landmarkId: string): {
  status: FavoriteStatus;
  pending: boolean;
} {
  const { statusOf, isPending } = useFavorites();
  return { status: statusOf(landmarkId), pending: isPending(landmarkId) };
}
