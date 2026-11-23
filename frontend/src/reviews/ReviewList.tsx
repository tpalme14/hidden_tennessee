import type { Ref } from "react";
import type { Review } from "../api/reviews";
import { ReviewItem } from "./ReviewItem";
import styles from "./ReviewsSection.module.css";

/** The label shown in the public list for the signed-in user's own review (spec §3). */
export const OWN_REVIEW_LABEL = "Your review";

/**
 * The public reviews, newest first (M04-T03 Increments 2–3). The entry at
 * `focusIndex` (the first review added by the last "Show more") receives
 * `focusRef` and is programmatically focusable, so focus can move to it after
 * the new reviews appear.
 *
 * The entry whose ID equals `ownReviewId` (from the own-review lookup for the
 * signed-in user) is labelled "Your review" instead of "Community Member".
 * The list never shows ownership controls; those live in the "Your review"
 * panel only (Q3).
 */
export function ReviewList({
  reviews,
  focusIndex,
  focusRef,
  ownReviewId = null,
}: {
  reviews: Review[];
  focusIndex: number | null;
  focusRef: Ref<HTMLLIElement>;
  ownReviewId?: string | null;
}) {
  return (
    <ul className={styles.list}>
      {reviews.map((review, index) => (
        <li
          key={review.id}
          className={styles.item}
          {...(index === focusIndex ? { ref: focusRef, tabIndex: -1 } : {})}
        >
          <ReviewItem
            review={review}
            {...(ownReviewId !== null && review.id === ownReviewId
              ? { authorLabel: OWN_REVIEW_LABEL }
              : {})}
          />
        </li>
      ))}
    </ul>
  );
}
