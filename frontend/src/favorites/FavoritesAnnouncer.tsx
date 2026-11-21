import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import styles from "./FavoritesAnnouncer.module.css";

/**
 * Shared announcements for favorite controls inside a list (M03-T06
 * Increment 4, developer-approved resolution B2). Not a general notification
 * system: it carries favorites outcomes only, for the controls rendered
 * inside it.
 *
 * Why it exists: `GeographicResultsList` must contain no `status`/`alert`
 * regions (M02-T08 — `DiscoveryPage` already announces that list's own
 * status). List-variant `FavoriteButton`s therefore send their confirmed
 * outcomes and failures here instead of rendering live regions per row.
 *
 * Rendered OUTSIDE the list, before `children`:
 * - one polite live region (`aria-live="polite"`, `aria-atomic`) holding the
 *   latest confirmed outcome. It deliberately has no explicit `status` role,
 *   so existing role-based M02 queries for the page's own status messages are
 *   unaffected; screen readers announce it the same way;
 * - one `role="alert"` element, present only while there is an error.
 * Both are visible, never focusable, and never move focus.
 *
 * Concurrency: every announcement gets a sequence number. Each region shows
 * only the newest message of its kind (never a concatenation); a repeated
 * identical message is re-announced because its node is replaced. A new
 * outcome for landmark X clears the other region only if that region's
 * message is also about X — another landmark's error is never hidden by an
 * unrelated success. Every message names its landmark.
 */

export type FavoritesAnnouncementKind = "status" | "alert";

export interface FavoritesAnnouncerValue {
  announce: (kind: FavoritesAnnouncementKind, landmarkId: string, text: string) => void;
  /** Clears any message about this landmark (called when a new action for it starts). */
  clear: (landmarkId: string) => void;
}

interface Announcement {
  seq: number;
  landmarkId: string;
  text: string;
}

const FavoritesAnnouncerContext = createContext<FavoritesAnnouncerValue | null>(null);

/** The surrounding announcer, or null when there is none. */
export function useFavoritesAnnouncer(): FavoritesAnnouncerValue | null {
  return useContext(FavoritesAnnouncerContext);
}

export function FavoritesAnnouncer({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Announcement | null>(null);
  const [alert, setAlert] = useState<Announcement | null>(null);
  const seq = useRef(0);

  const announce = useCallback(
    (kind: FavoritesAnnouncementKind, landmarkId: string, text: string) => {
      const next: Announcement = { seq: ++seq.current, landmarkId, text };
      const aboutOther = (current: Announcement | null) =>
        current?.landmarkId === landmarkId ? null : current;
      if (kind === "status") {
        setStatus(next);
        setAlert(aboutOther);
      } else {
        setAlert(next);
        setStatus(aboutOther);
      }
    },
    [],
  );

  const clear = useCallback((landmarkId: string) => {
    const aboutOther = (current: Announcement | null) =>
      current?.landmarkId === landmarkId ? null : current;
    setStatus(aboutOther);
    setAlert(aboutOther);
  }, []);

  const value = useMemo(() => ({ announce, clear }), [announce, clear]);

  return (
    <FavoritesAnnouncerContext.Provider value={value}>
      <div aria-live="polite" aria-atomic="true" className={styles.status}>
        {status ? <span key={status.seq}>{status.text}</span> : null}
      </div>
      {alert ? (
        <p key={alert.seq} role="alert" className={styles.alert}>
          {alert.text}
        </p>
      ) : null}
      {children}
    </FavoritesAnnouncerContext.Provider>
  );
}
