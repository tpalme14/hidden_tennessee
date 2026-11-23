import { useEffect, useId, useRef } from "react";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { formatReviewCount } from "./formatRating";
import { OwnReviewPanel } from "./OwnReviewPanel";
import { RatingSummary } from "./RatingSummary";
import { ReviewList } from "./ReviewList";
import styles from "./ReviewsSection.module.css";
import { useLandmarkReviews } from "./useLandmarkReviews";
import { useOwnReview } from "./useOwnReview";

/**
 * Read-only reviews for an active, PUBLIC landmark (M04-T03 Increment 2;
 * spec v1.1 §§5, 7, 8). Render it ONLY inside the full profile: minimal,
 * unavailable, loading, and error profiles never mount it, so they never
 * request reviews.
 *
 * States: loading; ready (summary, disclaimer, list, "Show more"); empty
 * ("No reviews yet" from the summary); unavailable (the list answered 404 —
 * the landmark is missing, retired, or not public, so nothing about it or its
 * reviews is shown); error (with "Try again").
 *
 * "Show more" (decision Q2) appends the next page; if that fails, the shown
 * reviews stay, an alert explains, and the same button retries. After a
 * successful "Show more", focus moves to
 * the first newly shown review — or, when nothing new was added, to the count
 * line — so focus is never lost when the button disappears. The count line is
 * a polite status region, so the new total is announced.
 *
 * Increment 3 adds the signed-in user's own review (`OwnReviewPanel`, fed by
 * `useOwnReview`) between the summary and the list, and labels that user's
 * entry in the list "Your review" by matching the own-review ID. After a
 * confirmed post the list is refreshed WITHOUT being cleared first.
 * Requires the session context (`AuthProvider`).
 */

export const REVIEWS_DISCLAIMER =
  "Reviews are personal opinions. They do not establish public access, legal entry, maintained trails, or safety.";
export const REVIEWS_UNAVAILABLE_TEXT = "Reviews aren't available for this landmark.";

export function ReviewsSection({ landmarkId }: { landmarkId: string }) {
  const { state, loadMore, reload, refresh } = useLandmarkReviews(landmarkId);
  const own = useOwnReview(landmarkId);
  const headingId = useId();
  const firstNewRef = useRef<HTMLLIElement>(null);
  const countRef = useRef<HTMLParagraphElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** The page last focused after a "Show more" — focus moves once per appended page. */
  const focusedPage = useRef(1);

  const readyPage = state.kind === "ready" ? state.page : null;
  const firstNewIndex = state.kind === "ready" ? state.firstNewIndex : null;

  useEffect(() => {
    if (readyPage === null) {
      focusedPage.current = 1;
      return;
    }
    if (readyPage <= focusedPage.current) {
      // A refresh went back to page 1: the next "Show more" must move focus again.
      focusedPage.current = readyPage;
      return;
    }
    focusedPage.current = readyPage;
    if (firstNewIndex !== null) firstNewRef.current?.focus();
    else countRef.current?.focus();
  }, [readyPage, firstNewIndex]);

  return (
    <section aria-labelledby={headingId} className={styles.section}>
      {/* Programmatically focusable: focus lands here after a deletion (Increment 4). */}
      <h3 id={headingId} ref={headingRef} tabIndex={-1}>
        Reviews
      </h3>

      {state.kind === "loading" ? <LoadingState label="Loading reviews…" /> : null}

      {state.kind === "unavailable" ? <p>{REVIEWS_UNAVAILABLE_TEXT}</p> : null}

      {state.kind === "error" ? <ErrorState message={state.message} onRetry={reload} /> : null}

      {state.kind === "ready" ? (
        <>
          <RatingSummary aggregate={state.aggregate} />
          <p className={styles.disclaimer}>{REVIEWS_DISCLAIMER}</p>
        </>
      ) : null}

      {/* The signed-in user's own review / the form (Increment 3). Shown for
          every list state except "unavailable", so a list refresh after a
          post never unmounts it (its announcement and focus target stay). */}
      {state.kind !== "unavailable" ? (
        <OwnReviewPanel
          landmarkId={landmarkId}
          own={own}
          onReviewsChanged={refresh}
          focusReviewsHeading={() => headingRef.current?.focus()}
        />
      ) : null}

      {state.kind === "ready" ? (
        <>
          {state.reviews.length > 0 ? (
            <>
              <ReviewList
                reviews={state.reviews}
                focusIndex={state.firstNewIndex}
                focusRef={firstNewRef}
                ownReviewId={own.state.kind === "found" ? own.state.review.id : null}
              />
              {/* "Showing all" only when nothing is missing: a review added while
                  paging (newest first) can leave fewer shown than the total
                  even after the last page (M04-T03 Increment 5 fix). */}
              <p role="status" ref={countRef} tabIndex={-1}>
                {state.reviews.length < state.aggregate.rating_count
                  ? `Showing ${state.reviews.length} of ${formatReviewCount(state.aggregate.rating_count)}.`
                  : `Showing all ${formatReviewCount(state.reviews.length)}.`}
              </p>
            </>
          ) : null}
          {/* A failed "Show more" keeps the button where it is (so focus is not
              lost) and reports the failure once; pressing it again retries. */}
          {state.loadMoreError !== null ? <p role="alert">{state.loadMoreError}</p> : null}
          {state.hasMore ? (
            <p>
              <button
                type="button"
                aria-disabled={state.loadingMore ? true : undefined}
                aria-busy={state.loadingMore ? true : undefined}
                onClick={() => {
                  if (!state.loadingMore) loadMore();
                }}
              >
                {state.loadingMore ? "Loading more reviews…" : "Show more reviews"}
              </button>
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
