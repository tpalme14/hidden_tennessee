import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { listLandmarkReviews, type Review, type ReviewAggregate } from "../api/reviews";

/**
 * The public review list for one landmark (M04-T03 Increment 2; spec v1.1
 * §§5–6; decision Q2 "Show more").
 *
 * - The first page loads when the landmark ID is set. "Show more" fetches the
 *   next page and APPENDS it, skipping any review whose ID is already shown
 *   (the list is newest first, so a review added meanwhile can shift a later
 *   page by one).
 * - The aggregate and `hasMore` always come from the most recent successful
 *   response: each page and its aggregate share one database snapshot.
 * - A 404 means the landmark is missing, retired, or not public: the list is
 *   `unavailable`, with no review data kept — the same outcome whatever the
 *   reason (spec §7).
 * - Any other failure of the first page is `error` (with `retry`); a failed
 *   "Show more" keeps what is shown and reports `loadMoreError`. A malformed
 *   response is a failure, never a partial success (the API layer already
 *   throws `INVALID_RESPONSE`).
 * - Responses for a previous landmark, or from before a retry/reload, are
 *   discarded (a generation counter), so stale reviews are never shown.
 */

export const REVIEWS_LOAD_ERROR = "Reviews couldn't be loaded. Please try again.";
export const MORE_REVIEWS_LOAD_ERROR = "More reviews couldn't be loaded. Please try again.";

export type LandmarkReviewsState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      reviews: Review[];
      aggregate: ReviewAggregate;
      hasMore: boolean;
      /** The page whose reviews were most recently appended. */
      page: number;
      loadingMore: boolean;
      loadMoreError: string | null;
      /** Index in `reviews` of the first review added by the last "Show more" (for focus). */
      firstNewIndex: number | null;
    };

export interface LandmarkReviews {
  state: LandmarkReviewsState;
  /** Loads the next page and appends it. Ignored unless ready, not loading, and more exist. */
  loadMore: () => void;
  /** Reloads from the first page, showing the loading state (after an error). */
  reload: () => void;
  /**
   * Reloads the first page WITHOUT clearing what is shown (M04-T03 Increment
   * 3, after a confirmed change): the current list and aggregate stay visible
   * until the new page replaces them. A 404 still becomes `unavailable`, and a
   * failure becomes `error`.
   */
  refresh: () => void;
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function useLandmarkReviews(landmarkId: string): LandmarkReviews {
  const [state, setState] = useState<LandmarkReviewsState>({ kind: "loading" });
  const [reloadToken, setReloadToken] = useState(0);
  /** Incremented for every new landmark or reload; only current-generation results are applied. */
  const generation = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;
  /** Set by `refresh` for the next load only; ignored if the landmark changed. */
  const silentNext = useRef(false);
  const loadedLandmark = useRef<string | null>(null);

  useEffect(() => {
    generation.current += 1;
    const current = generation.current;
    const silent =
      silentNext.current &&
      loadedLandmark.current === landmarkId &&
      stateRef.current.kind === "ready";
    silentNext.current = false;
    loadedLandmark.current = landmarkId;
    if (!silent) setState({ kind: "loading" });

    listLandmarkReviews(landmarkId).then(
      (page) => {
        if (generation.current !== current) return;
        setState({
          kind: "ready",
          reviews: page.reviews,
          aggregate: page.aggregate,
          hasMore: page.has_more,
          page: page.page,
          loadingMore: false,
          loadMoreError: null,
          firstNewIndex: null,
        });
      },
      (error: unknown) => {
        if (generation.current !== current) return;
        setState(
          isNotFound(error)
            ? { kind: "unavailable" }
            : { kind: "error", message: REVIEWS_LOAD_ERROR },
        );
      },
    );

    return () => {
      // Invalidate this generation: a response arriving after unmount or a
      // landmark change is ignored.
      generation.current += 1;
    };
  }, [landmarkId, reloadToken]);

  const loadMore = useCallback(() => {
    const before = stateRef.current;
    if (before.kind !== "ready" || before.loadingMore || !before.hasMore) return;
    const current = generation.current;
    const nextPage = before.page + 1;
    setState({ ...before, loadingMore: true, loadMoreError: null });

    listLandmarkReviews(landmarkId, { page: nextPage }).then(
      (page) => {
        if (generation.current !== current) return;
        setState((latest) => {
          if (latest.kind !== "ready") return latest;
          const shown = new Set(latest.reviews.map((review) => review.id));
          const added = page.reviews.filter((review) => !shown.has(review.id));
          return {
            ...latest,
            reviews: [...latest.reviews, ...added],
            aggregate: page.aggregate,
            hasMore: page.has_more,
            page: page.page,
            loadingMore: false,
            loadMoreError: null,
            firstNewIndex: added.length > 0 ? latest.reviews.length : null,
          };
        });
      },
      (error: unknown) => {
        if (generation.current !== current) return;
        if (isNotFound(error)) {
          setState({ kind: "unavailable" });
          return;
        }
        setState((latest) =>
          latest.kind === "ready"
            ? { ...latest, loadingMore: false, loadMoreError: MORE_REVIEWS_LOAD_ERROR }
            : latest,
        );
      },
    );
  }, [landmarkId]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);
  const refresh = useCallback(() => {
    silentNext.current = true;
    setReloadToken((token) => token + 1);
  }, []);

  return { state, loadMore, reload, refresh };
}
