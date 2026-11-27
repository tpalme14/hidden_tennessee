import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { OnlineOnlyReason } from "../connectivity/OnlineOnlyReason";
import { useOnlineOnlyAction } from "../connectivity/useOnlineOnlyAction";
import styles from "./ReviewForm.module.css";
import {
  MAX_BODY_CODE_POINTS,
  MAX_RATING,
  MIN_RATING,
  countCodePoints,
  validateReviewDraft,
  type ReviewDraftValue,
  type ReviewFieldErrors,
} from "./validation";

/**
 * The review form (M04-T03 Increment 3; spec v1.1 §§4.1, 8; decisions Q11
 * and Q6). Controlled: the DRAFT lives in the parent, so it survives failed
 * submissions, session re-checks, and conflicts.
 *
 * - Rating: five native radio buttons in a `<fieldset>` with a legend.
 * - Text: a `<textarea>` with NO `maxLength` (that counts UTF-16 units); a
 *   counter shows code points ("N of 2,000 characters") through
 *   `aria-describedby`, without announcing every keystroke. Going over the
 *   limit is reported in the counter at once; other problems on submit.
 * - On submit the draft is validated with the server's rules. Problems are
 *   listed in an error summary (an alert that receives focus, with links that
 *   move focus to the field) and next to each field; nothing is sent.
 * - Only validated data reaches `onSubmit`. While `submitting`, the button is
 *   busy and further presses do nothing.
 * - `serverError` (from the parent) is shown as one alert.
 */

export interface ReviewDraft {
  rating: number | null;
  text: string;
}

export const EMPTY_DRAFT: ReviewDraft = { rating: null, text: "" };

export function hasDraftContent(draft: ReviewDraft): boolean {
  return draft.rating !== null || draft.text.trim() !== "";
}

export interface ReviewFormProps {
  heading: string;
  submitLabel: string;
  submittingLabel: string;
  draft: ReviewDraft;
  onDraftChange: (draft: ReviewDraft) => void;
  onSubmit: (value: ReviewDraftValue) => void;
  submitting: boolean;
  serverError: string | null;
  /** Edit mode (Increment 4): a Cancel button that changes nothing on the server. */
  onCancel?: () => void;
  /** Moves focus to the form's heading when it first appears (entering edit mode). */
  focusHeadingOnMount?: boolean;
}

const RATINGS = Array.from({ length: MAX_RATING - MIN_RATING + 1 }, (_, i) => MIN_RATING + i);

export function ReviewForm({
  heading,
  submitLabel,
  submittingLabel,
  draft,
  onDraftChange,
  onSubmit,
  submitting,
  serverError,
  onCancel,
  focusHeadingOnMount = false,
}: ReviewFormProps) {
  const id = useId();
  // M06-T02 Increment 3b-i: posting or saving needs the server (OFF-UX-5).
  // Only SUBMISSION is refused; typing, rating, and Cancel stay available, and
  // the draft (held by the parent) is never touched.
  const online = useOnlineOnlyAction();
  const headingRef = useRef<HTMLHeadingElement>(null);
  /** Read once: focus moves only when the form first appears. */
  const focusOnMount = useRef(focusHeadingOnMount);

  useEffect(() => {
    if (focusOnMount.current) headingRef.current?.focus();
  }, []);
  const headingId = `${id}-heading`;
  const ratingName = `${id}-rating`;
  const ratingFirstId = `${id}-rating-${MIN_RATING}`;
  const ratingErrorId = `${id}-rating-error`;
  const textId = `${id}-text`;
  const counterId = `${id}-counter`;
  const textErrorId = `${id}-text-error`;
  const summaryRef = useRef<HTMLDivElement>(null);
  const [errors, setErrors] = useState<ReviewFieldErrors>({});
  /** Incremented on each submit that failed validation; moves focus to the summary once rendered. */
  const [failedAttempt, setFailedAttempt] = useState(0);

  useEffect(() => {
    if (failedAttempt > 0) summaryRef.current?.focus();
  }, [failedAttempt]);

  const count = countCodePoints(draft.text);
  const over = count - MAX_BODY_CODE_POINTS;

  function focusField(fieldId: string) {
    document.getElementById(fieldId)?.focus();
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // The form's own submit path (button click, Enter, or requestSubmit) is guarded.
    if (submitting || online.unavailable) return;
    const result = validateReviewDraft({ rating: draft.rating, body: draft.text });
    if (!result.ok) {
      setErrors(result.errors);
      setFailedAttempt((attempt) => attempt + 1);
      return;
    }
    setErrors({});
    onSubmit(result.value);
  }

  const summaryItems: { message: string; target: string }[] = [];
  if (errors.rating) summaryItems.push({ message: errors.rating, target: ratingFirstId });
  if (errors.body) summaryItems.push({ message: errors.body, target: textId });

  return (
    <form noValidate aria-labelledby={headingId} onSubmit={handleSubmit} className={styles.form}>
      <h4 id={headingId} ref={headingRef} tabIndex={focusHeadingOnMount ? -1 : undefined}>
        {heading}
      </h4>

      {summaryItems.length > 0 ? (
        <div role="alert" tabIndex={-1} ref={summaryRef} className={styles.summary}>
          <p>There&apos;s a problem with your review:</p>
          <ul>
            {summaryItems.map((item) => (
              <li key={item.target}>
                <a
                  href={`#${item.target}`}
                  onClick={(event) => {
                    event.preventDefault();
                    focusField(item.target);
                  }}
                >
                  {item.message}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <fieldset
        className={styles.fieldset}
        aria-describedby={errors.rating ? ratingErrorId : undefined}
        aria-invalid={errors.rating ? true : undefined}
      >
        <legend>Rating (required)</legend>
        {RATINGS.map((value) => {
          const optionId = `${id}-rating-${value}`;
          return (
            <span key={value} className={styles.option}>
              <input
                type="radio"
                id={optionId}
                name={ratingName}
                value={value}
                checked={draft.rating === value}
                onChange={() => {
                  onDraftChange({ ...draft, rating: value });
                  if (errors.rating) setErrors({ ...errors, rating: undefined });
                }}
              />
              <label htmlFor={optionId}>
                {value} {value === 1 ? "star" : "stars"}
              </label>
            </span>
          );
        })}
        {errors.rating ? (
          <p id={ratingErrorId} className={styles.error}>
            {errors.rating}
          </p>
        ) : null}
      </fieldset>

      <p className={styles.field}>
        <label htmlFor={textId}>Review (optional)</label>
        <textarea
          id={textId}
          rows={6}
          value={draft.text}
          aria-describedby={[counterId, errors.body ? textErrorId : null].filter(Boolean).join(" ")}
          aria-invalid={errors.body || over > 0 ? true : undefined}
          onChange={(event) => {
            onDraftChange({ ...draft, text: event.target.value });
            if (errors.body) setErrors({ ...errors, body: undefined });
          }}
        />
        <span id={counterId} className={over > 0 ? styles.counterOver : styles.counter}>
          {count.toLocaleString("en-US")} of {MAX_BODY_CODE_POINTS.toLocaleString("en-US")}{" "}
          characters
          {over > 0 ? ` — ${over.toLocaleString("en-US")} over the limit` : ""}
        </span>
        {errors.body ? (
          <span id={textErrorId} className={styles.error}>
            {errors.body}
          </span>
        ) : null}
      </p>

      {serverError !== null ? (
        <p role="alert" className={styles.error}>
          {serverError}
        </p>
      ) : null}

      <p>
        <button
          type="submit"
          aria-disabled={submitting || online.unavailable ? true : undefined}
          aria-busy={submitting ? true : undefined}
          aria-describedby={online.describedBy}
        >
          {submitting ? submittingLabel : submitLabel}
        </button>
        {onCancel ? (
          <>
            {" "}
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
          </>
        ) : null}
      </p>
      <OnlineOnlyReason action={online} className={styles.counter} />
    </form>
  );
}
