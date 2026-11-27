import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { ApiError, UPDATE_IN_PROGRESS } from "../api/client";
import { createTrip, type OwnerTrip, type TripListItem } from "../api/trips";
import { useAuth } from "../auth/session";
import { CreateTripForm } from "../trips/CreateTripForm";
import { MessageText } from "../trips/MessageText";
import { name as namePart, type MessagePart } from "../trips/messageParts";
import { TRIP_NAME_MESSAGES } from "../trips/tripNameRule";
import { createdTripState, readTripsListNotice, type TripsListNotice } from "../trips/tripNotice";
import { tripPath } from "../trips/tripPaths";
import { TRIPS_PATH, parseTripsPageParam, tripsPageHref } from "../trips/tripsPageParam";
import { useTripsList } from "../trips/useTripsList";
import type { TripFailure } from "../trips/useTrip";
import styles from "./MyTripsPage.module.css";

/**
 * My Trips (M05-T06 Increment 2; spec v1.1 §§5.1, 5.1.1, 5.2, 8, 10.1;
 * decisions D3, D13; refinement R4).
 *
 * Signed-in owners only. While the session is unverified (`loading` /
 * `unavailable`) nothing is fetched or shown; signed out, the page offers
 * sign-in returning here.
 *
 * LIST. One page (20) of the user's trips from `useTripsList` — a read
 * snapshot in the server's order, never re-sorted. Each row links to the
 * existing trip page and shows the name (direction-isolated), stop count,
 * last-updated date, and "Shared" when a link is active. Rename and delete
 * live on the trip page only (D3). `?page=` holds the page; an invalid value
 * is replaced with page 1 before anything is requested; Previous/Next follow
 * the response's own `page` and `has_more`.
 *
 * CREATE. `CreateTripForm` → `createTrip`. One creation at a time: a
 * synchronous ref guard refuses a second submission even before React
 * re-renders. Nothing is optimistic: no row and no ID is invented. On the
 * validated `201` the page navigates to the new trip, carrying a one-time
 * notice for that user and trip (`tripNotice.ts`). A response that arrives
 * after the confirmed user changed (sign-out, another user, or a session that
 * was re-verified meanwhile) or after this page unmounted does nothing — the
 * request is not assumed to have been cancelled, it is simply not acted on.
 *
 * UNCERTAIN CREATE (R4) — a network error, a `5xx`, or an unreadable success:
 * never replayed. The page says the trip may have been created and re-reads
 * page 1, where the newest trips are listed (navigating there from a later
 * page). A trip is never identified by its name, and its absence from page 1
 * is never presented as proof that nothing was created. The typed name is
 * kept; another submission is refused until that check has finished. If the
 * check fails, the uncertainty is kept and Try again re-reads the list.
 *
 * Feedback: exactly one status region (session check, loading, creating) and
 * at most one alert (a failed list load — combined with the uncertainty when
 * both apply — or a creation outcome). Messages belong to the confirmed user
 * and disappear when that user changes. After Previous/Next the heading takes
 * focus (the activated link is gone while the new page loads).
 */

const HEADING_ID = "my-trips-heading";
const LIST_HEADING_ID = "my-trips-list-heading";
const SIGN_IN_HREF = `/sign-in?returnTo=${encodeURIComponent(TRIPS_PATH)}`;

const NAME_MESSAGES = new Set<string>(Object.values(TRIP_NAME_MESSAGES));

export const UNCERTAIN_CREATE_TEXT =
  "We couldn't confirm whether your trip was created — it may have been. Your most recently updated trips are listed first below; check them before creating it again.";

const UNCERTAIN_CHECK_FAILED_TEXT =
  "We couldn't confirm whether your trip was created — it may have been — and your trips couldn't be loaded to check.";

function waitText(failure: TripFailure): string {
  if (failure.kind !== "rate-limited") return "";
  return failure.retryAfterSeconds === undefined
    ? "Too many requests. Please wait a moment and try again."
    : `Too many requests. Please try again in ${failure.retryAfterSeconds} second${
        failure.retryAfterSeconds === 1 ? "" : "s"
      }.`;
}

export function listFailureText(failure: TripFailure): string {
  switch (failure.kind) {
    case "unauthenticated":
      return "Couldn't load your trips because your session may have ended.";
    case "rate-limited":
      return waitText(failure);
    default:
      return "Couldn't load your trips. Please try again.";
  }
}

type CreateFailure =
  | { kind: "name"; message: string }
  | { kind: "refused"; text: string; unauthenticated: boolean }
  | { kind: "uncertain" };

/** How a failed creation is reported. Only definite refusals are reported as "not created". */
function classifyCreateFailure(error: unknown): CreateFailure {
  if (!(error instanceof ApiError)) return { kind: "uncertain" };
  // M06-T02 Increment 4b-iii (D2): a local refusal while the app updates is a
  // KNOWN non-execution — nothing was sent — never an uncertain outcome, so no
  // "couldn't confirm" message and no reconciliation read. Not retried.
  if (error.code === UPDATE_IN_PROGRESS) {
    return {
      kind: "refused",
      text: "The trip wasn't created because the app is updating. Nothing was sent; try again in a moment.",
      unauthenticated: false,
    };
  }
  if (error.code === "NETWORK_ERROR" || error.code === "INVALID_RESPONSE" || error.status >= 500) {
    return { kind: "uncertain" };
  }
  if (error.status === 400 && NAME_MESSAGES.has(error.message)) {
    return { kind: "name", message: error.message };
  }
  if (error.status === 401) {
    return {
      kind: "refused",
      text: "The trip wasn't created because your session may have ended.",
      unauthenticated: true,
    };
  }
  if (error.status === 429) {
    const failure: TripFailure =
      error.retryAfterSeconds === undefined
        ? { kind: "rate-limited" }
        : { kind: "rate-limited", retryAfterSeconds: error.retryAfterSeconds };
    return {
      kind: "refused",
      text: `The trip wasn't created. ${waitText(failure)}`,
      unauthenticated: false,
    };
  }
  if (error.status === 403) {
    return {
      kind: "refused",
      text: "The trip wasn't created. Reload the page and try again.",
      unauthenticated: false,
    };
  }
  if (error.status >= 400) {
    return {
      kind: "refused",
      text: "The trip wasn't created. Please try again.",
      unauthenticated: false,
    };
  }
  return { kind: "uncertain" };
}

interface CreationAlert {
  kind: "uncertain" | "refused";
  text: string;
  seq: number;
  /** The confirmed user the message belongs to. */
  userId: string;
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });

/**
 * The one-time notice after leaving a trip page because of a delete request
 * (Increment 3). Confirmed deletion names the trip; "no longer available"
 * deliberately does not say why, nor that the request deleted it.
 */
export function tripsListNoticeParts(notice: TripsListNotice): MessagePart[] {
  if (notice.kind === "trip-deleted") return ["Deleted trip ", namePart(notice.name), "."];
  return notice.uncertain
    ? ["We couldn't confirm the result of your delete request. That trip is no longer available."]
    : ["That trip is no longer available."];
}

function stopCountText(count: number): string {
  return count === 1 ? "1 stop" : `${count} stops`;
}

export function MyTripsPage() {
  const { session, refresh: refreshSession } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const page = parseTripsPageParam(searchParams);
  const { state, reload } = useTripsList(page);

  const userId = session.status === "authenticated" ? session.user.id : null;

  // Session epoch: moves whenever the confirmed user changes, including to and
  // from "unconfirmed", so A → (unconfirmed) → A is a new epoch. A creation
  // response may act only within the epoch it started in.
  const lastUser = useRef<string | null>(userId);
  const sessionEpoch = useRef(0);
  if (lastUser.current !== userId) {
    lastUser.current = userId;
    sessionEpoch.current += 1;
  }

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const focusHeadingOnPageChange = useRef(false);
  const creatingRef = useRef(false);
  const alertSeq = useRef(0);
  const [creating, setCreating] = useState(false);
  const [creationAlert, setCreationAlert] = useState<CreationAlert | null>(null);

  // The one-time notice after a delete request on a trip page (Increment 3):
  // read once per history entry, the entry then replaced without it (so Back,
  // Forward, or a reload never repeat it), and shown only to the confirmed
  // user it names. Focus moves to the heading when it was lost in the
  // navigation (the Delete control is gone), never from a deliberate place.
  const [listNotice, setListNotice] = useState<{
    parts: MessagePart[];
    seq: number;
    userId: string;
  } | null>(null);
  const consumedNoticeKey = useRef<string | null>(null);
  useEffect(() => {
    const notice = readTripsListNotice(location.state);
    if (notice === null || consumedNoticeKey.current === location.key) return;
    consumedNoticeKey.current = location.key;
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
    if (userId === null || notice.userId !== userId) return;
    setListNotice({ parts: tripsListNoticeParts(notice), seq: ++alertSeq.current, userId });
    const active = document.activeElement;
    if (active === null || active === document.body) headingRef.current?.focus();
    // Runs per history entry; the values read are those of that entry.
  }, [location.key]);

  // The page-1 check after an uncertain creation. While it is pending, creation
  // is refused. It is decided DURING RENDER from the list state (no extra
  // effect or render): every load produces new state objects, so the check has
  // finished at the first `ready`/`error` state that is not the one captured
  // when the uncertainty arose. The previous page's list — still in state for
  // one render after navigating to page 1 — therefore never ends it early, and
  // a `loading` → `ready` pair batched into one render still ends it. A
  // different confirmed user ends it too (nothing from before gates the form).
  const stateRef = useRef(state);
  stateRef.current = state;
  const pendingCheck = useRef<{ from: typeof state; userId: string } | null>(null);
  if (
    pendingCheck.current !== null &&
    (pendingCheck.current.userId !== userId ||
      (state !== pendingCheck.current.from &&
        (state.status === "ready" || state.status === "error")))
  ) {
    pendingCheck.current = null;
  }
  const checking = pendingCheck.current !== null;

  // An invalid ?page= becomes page 1, replacing the history entry. The list
  // hook holds nothing for an invalid page, so no request precedes this.
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

  // After a page change the user asked for, the heading takes focus.
  useEffect(() => {
    if (!focusHeadingOnPageChange.current) return;
    focusHeadingOnPageChange.current = false;
    headingRef.current?.focus();
  }, [page]);

  // A different (or no) confirmed user: an earlier user's creation no longer
  // gates the form (its response is ignored when it arrives).
  useEffect(() => {
    creatingRef.current = false;
    setCreating(false);
  }, [userId]);

  const handleCreate = useCallback(
    async (name: string): Promise<{ nameError?: string }> => {
      if (userId === null || creatingRef.current || pendingCheck.current !== null) return {};
      creatingRef.current = true;
      setCreating(true);
      setCreationAlert(null);
      setListNotice(null);
      const epoch = sessionEpoch.current;
      const submittedBy = userId;
      const stillCurrent = () => mounted.current && sessionEpoch.current === epoch;

      let trip: OwnerTrip;
      try {
        trip = await createTrip(name);
      } catch (error) {
        if (!stillCurrent()) return {};
        creatingRef.current = false;
        setCreating(false);
        const failure = classifyCreateFailure(error);
        if (failure.kind === "name") return { nameError: failure.message };
        if (failure.kind === "refused") {
          setCreationAlert({
            kind: "refused",
            text: failure.text,
            seq: ++alertSeq.current,
            userId: submittedBy,
          });
          if (failure.unauthenticated) void refreshSession();
          return {};
        }
        // Uncertain: never replayed. Check page 1, where the newest trips are.
        pendingCheck.current = { from: stateRef.current, userId: submittedBy };
        setCreationAlert({
          kind: "uncertain",
          text: UNCERTAIN_CREATE_TEXT,
          seq: ++alertSeq.current,
          userId: submittedBy,
        });
        if (page === 1) reload();
        else navigate(TRIPS_PATH);
        return {};
      }
      if (!stillCurrent()) return {};
      creatingRef.current = false;
      setCreating(false);
      navigate(tripPath(trip.id), {
        state: createdTripState({ userId: submittedBy, tripId: trip.id, name: trip.name }),
      });
      return {};
    },
    [userId, page, reload, navigate, refreshSession],
  );

  const authenticated = session.status === "authenticated";
  const busy = creating || checking;
  const currentAlert =
    creationAlert !== null && creationAlert.userId === userId ? creationAlert : null;

  // ---- Status region (exactly one) ----
  let statusParts: MessagePart[] = [];
  let statusKey = 0;
  if (session.status === "loading") {
    statusParts = ["Checking whether you're signed in…"];
  } else if (authenticated && creating) {
    statusParts = ["Creating trip…"];
  } else if (authenticated && (state.status === "loading" || state.status === "idle")) {
    statusParts = ["Loading your trips…"];
  } else if (authenticated && listNotice !== null && listNotice.userId === userId) {
    statusParts = listNotice.parts;
    statusKey = listNotice.seq;
  }

  // ---- Alert (at most one) ----
  let alertView: ReactNode = null;
  if (authenticated) {
    if (state.status === "error") {
      const lead = currentAlert?.kind === "uncertain" ? `${UNCERTAIN_CHECK_FAILED_TEXT} ` : "";
      alertView = (
        <div role="alert" className={styles.alert}>
          <p>
            {lead}
            {listFailureText(state.failure)}
          </p>
          <button type="button" className={styles.button} onClick={reload}>
            Try again
          </button>
        </div>
      );
    } else if (currentAlert !== null) {
      alertView = (
        <div role="alert" className={styles.alert} key={currentAlert.seq}>
          <p>{currentAlert.text}</p>
        </div>
      );
    }
  }

  return (
    <section aria-labelledby={HEADING_ID} className={styles.page}>
      <h2 id={HEADING_ID} ref={headingRef} tabIndex={-1} className={styles.heading}>
        My Trips
      </h2>
      <p role="status" className={styles.status}>
        {statusParts.length > 0 ? (
          <span key={statusKey}>
            <MessageText parts={statusParts} />
          </span>
        ) : null}
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
            We couldn&apos;t check whether you&apos;re signed in, so your trips can&apos;t be shown
            right now. Use Retry in the account area to check again.
          </p>
        );
      case "anonymous":
        return (
          <p>
            <Link to={SIGN_IN_HREF}>Sign in to see your trips</Link>
          </p>
        );
      default:
        break;
    }
    return (
      <>
        {/* Keyed by user: another account never inherits a typed name or field error. */}
        <CreateTripForm key={userId ?? ""} busy={busy} onCreate={handleCreate} />
        {renderList()}
      </>
    );
  }

  function renderList() {
    if (page === null || state.status !== "ready") return null;
    if (state.trips.length === 0) {
      if (state.page === 1) {
        return (
          <p className={styles.empty}>
            You don&apos;t have any trips yet. Name a trip above and choose Create trip to start
            one.
          </p>
        );
      }
      return (
        <div className={styles.empty}>
          <p>There are no trips on this page.</p>
          <p>
            <Link to={TRIPS_PATH}>Go to the first page of your trips</Link>
          </p>
        </div>
      );
    }
    return (
      <section aria-labelledby={LIST_HEADING_ID} className={styles.listSection}>
        <h3 id={LIST_HEADING_ID} className={styles.listHeading}>
          Your trips
        </h3>
        <ul className={styles.list} aria-labelledby={LIST_HEADING_ID}>
          {state.trips.map(renderTrip)}
        </ul>
        {state.page > 1 || state.hasMore ? (
          <nav aria-label="Trip list pages" className={styles.pager}>
            {state.page > 1 ? (
              <Link
                to={tripsPageHref(state.page - 1)}
                onClick={() => {
                  focusHeadingOnPageChange.current = true;
                }}
              >
                Previous page
              </Link>
            ) : null}
            <span>Page {state.page}</span>
            {state.hasMore ? (
              <Link
                to={tripsPageHref(state.page + 1)}
                onClick={() => {
                  focusHeadingOnPageChange.current = true;
                }}
              >
                Next page
              </Link>
            ) : null}
          </nav>
        ) : null}
      </section>
    );
  }

  function renderTrip(trip: TripListItem) {
    return (
      <li key={trip.id} className={styles.trip}>
        <Link to={tripPath(trip.id)} className={styles.name}>
          <bdi>{trip.name}</bdi>
        </Link>
        <span className={styles.meta}>{stopCountText(trip.stop_count)}</span>
        <span className={styles.meta}>
          Updated{" "}
          <time dateTime={trip.updated_at}>{dateFormat.format(new Date(trip.updated_at))}</time>
        </span>
        {trip.is_shared ? <span className={styles.shared}>Shared</span> : null}
      </li>
    );
  }
}
