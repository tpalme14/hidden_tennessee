import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import type { FavoriteEntry } from "../api/favorites";
import { useAuth } from "../auth/session";
import { failureText } from "../favorites/FavoriteButton";
import { useFavorites, type FavoritesFailure } from "../favorites/favoritesContext";
import {
  FAVORITES_PATH,
  favoritesPageHref,
  parseFavoritesPageParam,
} from "../favorites/favoritesPageParam";
import { useFavoritesList } from "../favorites/useFavoritesList";
import { OnlineOnlyReason } from "../connectivity/OnlineOnlyReason";
import { useOnlineOnlyAction } from "../connectivity/useOnlineOnlyAction";
import { categoryLabel } from "../map/categoryMarkerStyle";
import styles from "./FavoritesPage.module.css";

/**
 * My Favorites (M03-T06 Increment 5; spec §§6.2, 8; decisions K5–K9, K12,
 * M1–M6).
 *
 * Everything shown about a favorite comes from the favorites API response
 * alone — no other request is made for any entry:
 * - available: a link to the profile, the name, and the category label (M3:
 *   never coordinates, although the API sends them for PUBLIC landmarks);
 * - redacted: a link to the (redacted) profile, name, category, and a note (K9);
 * - unavailable: "No longer available" only — no name, category, link, or
 *   location (spec §6.2); its Remove button is named by position (M1).
 *
 * Removal goes through the favorites provider (so profile and list buttons stay
 * in sync); an entry disappears only after the server confirms (K5). Focus then
 * moves to the next Remove button, else the previous one, else the heading —
 * only when focus was on the removed control and has not moved elsewhere.
 *
 * The page has exactly one status region (loading and confirmed removals) and
 * at most one alert (a failed load, removal, or background re-fetch). Signed
 * out, it offers sign-in returning here; while the session is unverified
 * (`loading`/`unavailable`) it fetches nothing and assumes nothing (M6).
 */

const HEADING_ID = "favorites-heading";
const SIGN_IN_HREF = `/sign-in?returnTo=${encodeURIComponent(FAVORITES_PATH)}`;

interface Message {
  text: string;
  /** Re-renders the node so a repeated identical message is announced again. */
  seq: number;
  /** The user and page the message belongs to; shown only while both still apply. */
  scope: string;
}

interface AlertMessage extends Message {
  kind: "remove" | "refresh";
}

function loadFailureText(failure: FavoritesFailure): string {
  switch (failure.kind) {
    case "unauthenticated":
      return "Couldn't load your favorites because your session may have ended.";
    case "rate-limited":
      return failureText(failure);
    default:
      return "Couldn't load your favorites. Please try again.";
  }
}

function refreshFailureText(failure: FavoritesFailure): string {
  switch (failure.kind) {
    case "unauthenticated":
      return "Couldn't refresh your favorites list because your session may have ended.";
    case "rate-limited":
      return `Couldn't refresh your favorites list. ${failureText(failure)}`;
    default:
      return "Couldn't refresh your favorites list.";
  }
}

function entryName(entry: FavoriteEntry): string | null {
  return entry.availability === "unavailable" ? null : entry.landmark.display_name;
}

export function FavoritesPage() {
  const { session } = useAuth();
  const { remove, isPending } = useFavorites();
  // M06-T02 Increment 3b-i: removal needs the server (OFF-UX-5). One reason,
  // shown above the list, describes every Remove button.
  const online = useOnlineOnlyAction();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const page = parseFavoritesPageParam(searchParams);
  const { state, retry, markRemoved } = useFavoritesList(page);

  const userId = session.status === "authenticated" ? session.user.id : null;
  const scope = `${userId ?? ""}:${page ?? ""}`;

  const headingRef = useRef<HTMLHeadingElement>(null);
  const removeButtons = useRef(new Map<string, HTMLButtonElement>());
  /** The Remove button that last received focus (cleared when focus moves to another element). */
  const lastFocusedRemove = useRef<string | null>(null);
  const previousEntries = useRef<FavoriteEntry[]>([]);
  const focusHeadingOnPageChange = useRef(false);
  const messageSeq = useRef(0);
  const [announcement, setAnnouncement] = useState<Message | null>(null);
  const [alert, setAlert] = useState<AlertMessage | null>(null);

  const entries = state.status === "ready" ? state.entries : [];

  // M4: an invalid ?page= becomes page 1, replacing the history entry.
  useEffect(() => {
    if (page !== null) return;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("page");
        return next;
      },
      { replace: true },
    );
  }, [page, setSearchParams]);

  // A failed background re-fetch becomes the page's alert; a later successful
  // one withdraws it. The list itself is kept either way.
  const refreshFailure = state.status === "ready" ? state.refreshFailure : null;
  useEffect(() => {
    if (refreshFailure === null) {
      setAlert((a) => (a?.kind === "refresh" ? null : a));
      return;
    }
    setAlert({
      kind: "refresh",
      text: refreshFailureText(refreshFailure),
      seq: ++messageSeq.current,
      scope,
    });
    // Runs only when the failure itself changes; `scope` is captured at that time.
  }, [refreshFailure]);

  // A page above 1 emptied by removals: go to the preceding page (history replace).
  const emptiedAbovePageOne =
    state.status === "ready" &&
    state.emptiedByRemoval &&
    state.entries.length === 0 &&
    page !== null &&
    page > 1;
  useEffect(() => {
    if (!emptiedAbovePageOne || page === null) return;
    focusHeadingOnPageChange.current = true;
    navigate(favoritesPageHref(page - 1), { replace: true });
  }, [emptiedAbovePageOne, page, navigate]);

  // After a page change the user asked for, the heading takes focus (the
  // activated Previous/Next link is gone while the new page loads).
  useEffect(() => {
    if (!focusHeadingOnPageChange.current) return;
    focusHeadingOnPageChange.current = false;
    headingRef.current?.focus();
  }, [page]);

  // Focus restoration: when the entry whose Remove button had focus leaves the
  // list (a confirmed removal, or a background re-fetch), and focus has not
  // moved anywhere else, move it to the next surviving Remove button, else the
  // previous one, else the heading. Entries are keyed by landmark ID, so a
  // re-fetch that keeps the focused entry keeps focus on it.
  useLayoutEffect(() => {
    const before = previousEntries.current;
    previousEntries.current = entries;
    const focusedId = lastFocusedRemove.current;
    if (focusedId === null || entries.some((e) => e.landmark_id === focusedId)) return;
    lastFocusedRemove.current = null;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;

    const surviving = new Set(entries.map((e) => e.landmark_id));
    const order = before.map((e) => e.landmark_id);
    const index = order.indexOf(focusedId);
    let target: string | undefined;
    if (index >= 0) {
      target =
        order.slice(index + 1).find((id) => surviving.has(id)) ??
        order
          .slice(0, index)
          .reverse()
          .find((id) => surviving.has(id));
    }
    const button = target === undefined ? undefined : removeButtons.current.get(target);
    if (button) button.focus();
    else headingRef.current?.focus();
  }, [entries]);

  const setRemoveButton = useCallback(
    (landmarkId: string) => (node: HTMLButtonElement | null) => {
      if (node) removeButtons.current.set(landmarkId, node);
      else removeButtons.current.delete(landmarkId);
    },
    [],
  );

  async function handleRemove(entry: FavoriteEntry) {
    const id = entry.landmark_id;
    if (isPending(id) || online.unavailable) return;
    const name = entryName(entry);
    setAlert((a) => (a?.kind === "remove" ? null : a));
    const outcome = await remove(id);
    if (outcome.kind === "removed") {
      markRemoved(id);
      setAnnouncement({
        text:
          name === null ? "Removed an unavailable favorite." : `Removed ${name} from favorites.`,
        seq: ++messageSeq.current,
        scope,
      });
    } else if (outcome.kind === "failed") {
      const text = failureText(outcome.failure);
      setAlert({
        kind: "remove",
        text: name === null ? `Unavailable favorite: ${text}` : `${name}: ${text}`,
        seq: ++messageSeq.current,
        scope,
      });
    }
    // busy, signed-out, discarded: nothing was confirmed; nothing to report.
  }

  // ---- Status region (exactly one) ----
  let statusText = "";
  let statusKey = 0;
  if (session.status === "loading") {
    statusText = "Checking whether you're signed in…";
  } else if (session.status === "authenticated" && state.status === "loading") {
    statusText = "Loading your favorites…";
  } else if (session.status === "authenticated" && announcement?.scope === scope) {
    statusText = announcement.text;
    statusKey = announcement.seq;
  }

  // ---- Alert (at most one) ----
  let alertView: ReactNode = null;
  if (session.status === "authenticated") {
    if (state.status === "error") {
      alertView = (
        <div role="alert" className={styles.alert}>
          <p>{loadFailureText(state.failure)}</p>
          <button type="button" className={styles.button} onClick={retry}>
            Try again
          </button>
        </div>
      );
    } else if (alert !== null && alert.scope === scope) {
      alertView = (
        <div role="alert" className={styles.alert} key={alert.seq}>
          <p>{alert.text}</p>
          {alert.kind === "refresh" && state.status === "ready" && !state.refreshing ? (
            <button type="button" className={styles.button} onClick={retry}>
              Refresh list
            </button>
          ) : null}
        </div>
      );
    }
  }

  return (
    <section aria-labelledby={HEADING_ID} className={styles.page}>
      <h2 id={HEADING_ID} ref={headingRef} tabIndex={-1} className={styles.heading}>
        My Favorites
      </h2>
      <p role="status" className={styles.status}>
        {statusText ? <span key={statusKey}>{statusText}</span> : null}
      </p>
      {alertView}
      {renderBody()}
    </section>
  );

  function renderBody() {
    switch (session.status) {
      case "loading":
        return null;
      case "unavailable":
        return (
          <p>
            We couldn&apos;t check whether you&apos;re signed in, so your favorites can&apos;t be
            shown right now. Use Retry in the account area to check again.
          </p>
        );
      case "anonymous":
        return (
          <p>
            <Link to={SIGN_IN_HREF}>Sign in to see your favorites</Link>
          </p>
        );
      default:
        break;
    }
    if (page === null || state.status !== "ready") return null;

    if (state.entries.length === 0) {
      if (state.refreshing) return <p>Updating your favorites…</p>;
      if (page === 1) {
        return (
          <>
            <p>You haven&apos;t saved any landmarks yet.</p>
            <p>
              <Link to="/">Discover landmarks</Link>
            </p>
          </>
        );
      }
      if (state.emptiedByRemoval) return null; // moving to the preceding page
      return (
        <>
          <p>There are no favorites on this page.</p>
          <p>
            <Link to={FAVORITES_PATH}>Go to the first page of your favorites</Link>
          </p>
        </>
      );
    }

    return (
      <>
        <OnlineOnlyReason action={online} className={styles.note} />
        <ul className={styles.list} aria-labelledby={HEADING_ID}>
          {state.entries.map((entry, index) => renderEntry(entry, index))}
        </ul>
        {page > 1 || state.hasMore ? (
          <nav aria-label="Favorites pages" className={styles.pager}>
            {page > 1 ? (
              <Link
                to={favoritesPageHref(page - 1)}
                onClick={() => {
                  focusHeadingOnPageChange.current = true;
                }}
              >
                Previous page
              </Link>
            ) : null}
            <span>Page {page}</span>
            {state.hasMore ? (
              <Link
                to={favoritesPageHref(page + 1)}
                onClick={() => {
                  focusHeadingOnPageChange.current = true;
                }}
              >
                Next page
              </Link>
            ) : null}
          </nav>
        ) : null}
      </>
    );
  }

  function renderEntry(entry: FavoriteEntry, index: number) {
    const id = entry.landmark_id;
    const pending = isPending(id);
    const removeLabel =
      entry.availability === "unavailable"
        ? `Remove unavailable favorite, item ${index + 1} on this page`
        : `Remove ${entry.landmark.display_name} from favorites`;

    return (
      <li key={id} className={styles.entry}>
        <div className={styles.details}>
          {entry.availability === "unavailable" ? (
            <span>No longer available</span>
          ) : (
            <>
              <Link to={`/landmarks/${encodeURIComponent(id)}`}>{entry.landmark.display_name}</Link>
              <span className={styles.category}>{categoryLabel(entry.landmark.category)}</span>
              {entry.availability === "redacted" ? (
                <span className={styles.note}>Full details aren&apos;t currently available.</span>
              ) : null}
            </>
          )}
        </div>
        <button
          ref={setRemoveButton(id)}
          type="button"
          className={styles.button}
          aria-label={removeLabel}
          aria-disabled={pending || online.unavailable ? true : undefined}
          aria-busy={pending ? true : undefined}
          data-pending={pending ? "true" : undefined}
          aria-describedby={online.describedBy}
          onFocus={() => {
            lastFocusedRemove.current = id;
          }}
          onBlur={(event) => {
            if (event.relatedTarget !== null && lastFocusedRemove.current === id) {
              lastFocusedRemove.current = null;
            }
          }}
          onClick={() => void handleRemove(entry)}
        >
          Remove
        </button>
      </li>
    );
  }
}
