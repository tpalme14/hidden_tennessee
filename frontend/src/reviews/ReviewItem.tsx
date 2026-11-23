import type { Review } from "../api/reviews";
import styles from "./ReviewsSection.module.css";

/**
 * One public review (M04-T03 Increment 2; spec v1.1 §§3, 5, 8; decisions Q7
 * and the M04-T02 bidi follow-up).
 *
 * - Attribution is the review's `author_label` ("Community Member") — no
 *   identity is ever shown or available.
 * - The body is rendered as a React TEXT node only (never HTML), so markup in
 *   a review is shown literally and cannot execute.
 * - The body paragraph has `dir="auto"`: its direction comes from its own
 *   first strong character and it is bidi-isolated (the HTML user-agent style
 *   for `[dir]` is `unicode-bidi: isolate`), so control characters such as
 *   U+202E inside a review cannot reorder the surrounding page.
 * - Line breaks and spacing are preserved (`white-space: pre-wrap`).
 * - The date is the creation date in the viewer's locale; "Edited" is shown
 *   when `updated_at` differs from `created_at`.
 */

const STARS = 5;

/** The creation date, in the viewer's locale and time zone (e.g. "Nov 21, 2026"). */
export function formatReviewDate(iso: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(iso));
}

export function isEdited(review: Pick<Review, "created_at" | "updated_at">): boolean {
  return review.updated_at !== review.created_at;
}

/**
 * `authorLabel` replaces the API's "Community Member" ONLY for the signed-in
 * user's own review, identified by the own-review lookup (spec §3: "You" /
 * "Your Review"). It is never derived from the review itself.
 */
export function ReviewItem({ review, authorLabel }: { review: Review; authorLabel?: string }) {
  const stars = "★".repeat(review.rating) + "☆".repeat(STARS - review.rating);
  return (
    <>
      <p className={styles.meta}>
        <span aria-hidden="true" className={styles.stars}>
          {stars}
        </span>
        Rated {review.rating} out of 5
      </p>
      <p className={styles.meta}>
        {authorLabel ?? review.author_label} ·{" "}
        <time dateTime={review.created_at}>{formatReviewDate(review.created_at)}</time>
        {isEdited(review) ? " · Edited" : null}
      </p>
      {review.body !== null ? (
        <p dir="auto" className={styles.body}>
          {review.body}
        </p>
      ) : null}
    </>
  );
}
