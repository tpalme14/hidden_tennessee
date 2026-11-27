import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Link } from "react-router";
import { AuthContext } from "../auth/session";
import { OnlineOnlyReason } from "../connectivity/OnlineOnlyReason";
import { useOnlineOnlyAction } from "../connectivity/useOnlineOnlyAction";
import { MessageText } from "./MessageText";
import type { MessagePart } from "./messageParts";
import { tripPath } from "./tripPaths";
import styles from "./TripsAnnouncer.module.css";

/**
 * Shared announcements for list-variant "Add to trip" controls (M05-T04
 * Increment 5), mirroring `FavoritesAnnouncer` (M03-T06 resolution B2), which
 * is deliberately favorites-only and is not reused.
 *
 * `GeographicResultsList` must contain no `status`/`alert` regions (M02-T08:
 * `DiscoveryPage` already announces that list's own status). Its "Add to
 * trip" controls therefore report here instead, OUTSIDE the list:
 * - one polite live region (`aria-live="polite"`, `aria-atomic`, no explicit
 *   role, so the page's role-based status queries are unaffected) for the
 *   pending state and confirmed success, with a "View trip" link — rendered
 *   only while a user is verified (signed out, there are no trip messages);
 * - one `role="alert"` element, present only while there is a failure, with
 *   "View trip" and "Try adding again" when they apply.
 * Only the newest message of each kind is shown; a new message about a
 * landmark clears that landmark's message of the other kind. Nothing here
 * moves focus.
 *
 * Messages name trips, so they are account-specific: they are cleared at
 * once whenever the verified user changes or the session is no longer
 * verified.
 */

export interface TripAnnouncement {
  tone: "status" | "alert";
  /** Names are `{ name }` parts, rendered direction-isolated. */
  parts: MessagePart[];
  viewTripId?: string;
  onRetry?: () => void;
  retryDisabled?: boolean;
}

export interface TripsAnnouncerValue {
  announce: (landmarkId: string, announcement: TripAnnouncement) => void;
  clear: (landmarkId: string) => void;
}

interface Entry extends TripAnnouncement {
  seq: number;
  landmarkId: string;
}

const TripsAnnouncerContext = createContext<TripsAnnouncerValue | null>(null);

/** The surrounding announcer, or null when there is none. */
export function useTripsAnnouncer(): TripsAnnouncerValue | null {
  return useContext(TripsAnnouncerContext);
}

export function TripsAnnouncer({ children }: { children: ReactNode }) {
  const auth = useContext(AuthContext);
  const verifiedUserId = auth?.session.status === "authenticated" ? auth.session.user.id : null;
  const [status, setStatus] = useState<Entry | null>(null);
  const [alert, setAlert] = useState<Entry | null>(null);
  const seq = useRef(0);
  // M06-T02 Increment 3b-ii-a: "Try adding again" needs the server (OFF-UX-5).
  // Shown unavailable, with its reason OUTSIDE the alert (so the alert is not
  // re-announced), and refused here as well as by the caller's own guard.
  // Nothing is retried on recovery.
  const retryOnline = useOnlineOnlyAction();

  useEffect(() => {
    setStatus(null);
    setAlert(null);
  }, [verifiedUserId]);

  const announce = useCallback((landmarkId: string, announcement: TripAnnouncement) => {
    const next: Entry = { ...announcement, seq: ++seq.current, landmarkId };
    const aboutOther = (current: Entry | null) =>
      current?.landmarkId === landmarkId ? null : current;
    if (announcement.tone === "status") {
      setStatus(next);
      setAlert(aboutOther);
    } else {
      setAlert(next);
      setStatus(aboutOther);
    }
  }, []);

  const clear = useCallback((landmarkId: string) => {
    const aboutOther = (current: Entry | null) =>
      current?.landmarkId === landmarkId ? null : current;
    setStatus(aboutOther);
    setAlert(aboutOther);
  }, []);

  const value = useMemo(() => ({ announce, clear }), [announce, clear]);

  return (
    <TripsAnnouncerContext.Provider value={value}>
      {/* Present only while a user is verified — the only time a trip message can exist —
          and therefore already in place before any add-to-trip action. */}
      {verifiedUserId === null ? null : (
        <div aria-live="polite" aria-atomic="true" className={styles.status}>
          {status ? (
            <span key={status.seq}>
              <MessageText parts={status.parts} />
              {status.viewTripId ? (
                <>
                  {" — "}
                  <Link to={tripPath(status.viewTripId)}>View trip</Link>
                </>
              ) : null}
            </span>
          ) : null}
        </div>
      )}
      {alert && verifiedUserId !== null ? (
        <div key={alert.seq} role="alert" className={styles.alert}>
          <p>
            <MessageText parts={alert.parts} />
            {alert.viewTripId ? (
              <>
                {" "}
                <Link to={tripPath(alert.viewTripId)}>View trip</Link>
              </>
            ) : null}
          </p>
          {alert.onRetry ? (
            <button
              type="button"
              className={styles.button}
              aria-disabled={alert.retryDisabled || retryOnline.unavailable ? true : undefined}
              aria-describedby={retryOnline.describedBy}
              onClick={() => {
                if (!retryOnline.unavailable) alert.onRetry?.();
              }}
            >
              Try adding again
            </button>
          ) : null}
        </div>
      ) : null}
      {alert?.onRetry && verifiedUserId !== null ? <OnlineOnlyReason action={retryOnline} /> : null}
      {children}
    </TripsAnnouncerContext.Provider>
  );
}
