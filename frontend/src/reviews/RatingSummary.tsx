import type { ReviewAggregate } from "../api/reviews";
import { formatRatingSummary } from "./formatRating";
import styles from "./ReviewsSection.module.css";

/**
 * The landmark's aggregate rating (M04-T03 Increment 2; spec v1.1 §5): the
 * one-decimal average and the review count, or "No reviews yet" — never a
 * zero-star rating. The value itself is never altered (Q4).
 */
export function RatingSummary({ aggregate }: { aggregate: ReviewAggregate }) {
  return <p className={styles.summary}>{formatRatingSummary(aggregate)}</p>;
}
