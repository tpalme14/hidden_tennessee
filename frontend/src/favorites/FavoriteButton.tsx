import { useId, useState } from "react";
import { Link, useLocation } from "react-router";
import { useFavoritesAnnouncer, type FavoritesAnnouncementKind } from "./FavoritesAnnouncer";
import { useFavoriteStatus, useFavorites, type FavoritesFailure } from "./favoritesContext";
import styles from "./FavoriteButton.module.css";

/**
 * The favorite control for one landmark (M03-T06 Increment 3; decisions K3,
 * K4, K5, K11, L2, L4). Render it ONLY for active, PUBLIC landmarks — the API
 * refuses every other landmark (D1).
 *
 * One native `<button>` element serves the checking, saved/unsaved, and
 * unknown states, so focus stays on it when the state changes (for example
 * from `unknown` to `saved` after a save):
 * - checking — "Favorite", `aria-disabled` and `aria-busy`, no `aria-pressed`;
 * - saved / unsaved — a toggle: `aria-pressed` true/false, stable accessible
 *   name "Favorite <name>" (the visible text "Favorite" is part of it);
 * - unknown — save-only: "Save to favorites" with an explanatory note and no
 *   `aria-pressed`; it never removes;
 * - signed-out — a native link to sign in with the current path and query as
 *   `returnTo` (validated again by the sign-in page). Nothing is saved
 *   automatically after sign-in.
 *
 * While a request is in flight the button stays focusable but is
 * `aria-disabled`/`aria-busy` and ignores presses. Only server-confirmed
 * results are announced (polite status); failures use a single alert and
 * never imply success.
 *
 * Variants (M03-T06 Increment 4):
 * - `profile` (default) — renders its own polite status and alert regions;
 * - `list` — compact layout, and NO live regions of its own: outcomes go to
 *   the surrounding `FavoritesAnnouncer`, each message naming the landmark.
 *   Required where a list must contain no live regions (M02-T08). Rendering
 *   a list variant without an announcer is a programming error and throws,
 *   so it can never fall back to per-row regions.
 */

type Feedback = { kind: "status" | "alert"; text: string } | null;

/** User-facing text for a failed favorites mutation (shared with the My Favorites page). */
export function failureText(failure: FavoritesFailure): string {
  switch (failure.kind) {
    case "rate-limited":
      return failure.retryAfterSeconds === undefined
        ? "Too many requests. Please wait a moment and try again."
        : `Too many requests. Please try again in ${failure.retryAfterSeconds} second${
            failure.retryAfterSeconds === 1 ? "" : "s"
          }.`;
    case "unauthenticated":
      return "Couldn't update favorites because your session may have ended.";
    default:
      return "Couldn't update favorites. Please try again.";
  }
}

export interface FavoriteButtonProps {
  landmarkId: string;
  displayName: string;
  /** `list`: compact, announcing through the surrounding `FavoritesAnnouncer`. */
  variant?: "profile" | "list";
}

export function FavoriteButton({
  landmarkId,
  displayName,
  variant = "profile",
}: FavoriteButtonProps) {
  const { status, pending } = useFavoriteStatus(landmarkId);
  const { save, remove } = useFavorites();
  const announcer = useFavoritesAnnouncer();
  const location = useLocation();
  const [feedback, setFeedback] = useState<Feedback>(null);
  const noteId = useId();

  const isList = variant === "list";
  if (isList && announcer === null) {
    throw new Error("A list FavoriteButton must be rendered inside <FavoritesAnnouncer>");
  }
  const containerClass = isList ? `${styles.favorite} ${styles.compact}` : styles.favorite;

  /** Starts a new action: clears this control's previous message. */
  function beginAction() {
    if (isList) announcer?.clear(landmarkId);
    else setFeedback(null);
  }

  /** Reports an outcome: own regions on a profile; the shared announcer (named) in a list. */
  function report(kind: FavoritesAnnouncementKind, profileText: string, listText: string) {
    if (isList) announcer?.announce(kind, landmarkId, listText);
    else setFeedback({ kind, text: profileText });
  }

  if (status === "signed-out") {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <div className={containerClass}>
        <Link
          className={styles.link}
          to={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
          aria-label={`Sign in to save ${displayName}`}
        >
          Sign in to save
        </Link>
        {!isList && feedback?.kind === "alert" ? (
          <p role="alert" className={styles.alert}>
            {feedback.text}
          </p>
        ) : null}
      </div>
    );
  }

  const checking = status === "checking";
  const unknown = status === "unknown";
  const isToggle = status === "saved" || status === "unsaved";
  const inactive = checking || pending;

  async function handleActivate() {
    if (inactive) return;
    beginAction();
    if (status === "saved") {
      const outcome = await remove(landmarkId);
      if (outcome.kind === "removed") {
        report("status", "Removed from favorites.", `Removed ${displayName} from favorites.`);
      } else if (outcome.kind === "failed") {
        const text = failureText(outcome.failure);
        report("alert", text, `${displayName}: ${text}`);
      }
      return;
    }
    // unsaved or unknown: save (the only action offered while unknown).
    const outcome = await save(landmarkId);
    switch (outcome.kind) {
      case "saved":
        if (outcome.created) {
          report("status", "Saved to favorites.", `Saved ${displayName} to favorites.`);
        } else {
          report(
            "status",
            "Already in your favorites.",
            `${displayName} is already in your favorites.`,
          );
        }
        break;
      case "not-saveable": {
        const text = "This landmark can't be saved right now.";
        report("alert", text, `${displayName}: ${text}`);
        break;
      }
      case "failed": {
        const text = failureText(outcome.failure);
        report("alert", text, `${displayName}: ${text}`);
        break;
      }
      default:
        // busy, signed-out, discarded: nothing was confirmed, nothing to announce.
        break;
    }
  }

  return (
    <div className={containerClass}>
      <button
        type="button"
        className={styles.button}
        aria-label={unknown ? `Save ${displayName} to favorites` : `Favorite ${displayName}`}
        aria-pressed={isToggle ? status === "saved" : undefined}
        aria-disabled={inactive ? true : undefined}
        aria-busy={inactive ? true : undefined}
        aria-describedby={unknown ? noteId : undefined}
        onClick={() => void handleActivate()}
      >
        <span aria-hidden="true" className={styles.icon}>
          {status === "saved" ? "★" : "☆"}
        </span>
        {unknown ? "Save to favorites" : "Favorite"}
      </button>
      {unknown ? (
        <p id={noteId} className={styles.note}>
          We couldn&apos;t confirm whether this is already saved.
        </p>
      ) : null}
      {isList ? null : (
        <>
          <p role="status" className={styles.status}>
            {feedback?.kind === "status" ? feedback.text : ""}
          </p>
          {feedback?.kind === "alert" ? (
            <p role="alert" className={styles.alert}>
              {feedback.text}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}
