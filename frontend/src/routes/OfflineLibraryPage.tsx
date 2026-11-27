import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAccountSecurity } from "../auth/accountSecurity";
import { useAuth } from "../auth/session";
import { categoryLabel } from "../map/categoryMarkerStyle";
import {
  EMPTY_LIBRARY,
  lastSyncedText,
  recordedUnavailableText,
  resultMessage,
  UNREADABLE_COPY,
} from "../offline/offlineText";
import type { LandmarkEntry, TripEntry } from "../offline/snapshots";
import { useSnapshotView } from "../offline/useSnapshotView";
import styles from "./OfflineLibrary.module.css";

type Load = "loading" | "ready" | "storage-unavailable" | "failed" | "not-eligible";

/** Shared by the library and the saved-copy pages: why saved copies can't be shown. */
export function OfflineAccessNotice() {
  const { session } = useAuth();
  const account = useAccountSecurity();
  const signedOut = session.status !== "authenticated" && account.restriction === null;
  return (
    <div className={styles.notice}>
      <p>
        {signedOut
          ? "Sign in on this device to see what you've saved for offline use."
          : "Saved copies aren't available right now."}
      </p>
      <p>
        {signedOut ? <Link to="/sign-in">Sign in</Link> : null}
        {signedOut ? " · " : null}
        <Link to="/offline-data">Offline data on this device</Link>
      </p>
    </div>
  );
}

/** Shown while reading saved copies without a connection (offline-read; §9.1). */
export function OfflineReadNotice() {
  return (
    <p className={styles.notice}>
      You&apos;re viewing copies saved on this device without a connection to the server. This
      doesn&apos;t sign you in. Saving and refreshing need a connection.
    </p>
  );
}

/**
 * "Saved for offline" (M06-T03 Increment 3e; Specification 6 OFF-UX-2,
 * OFF-UX-6, OFF-STORE-7, OFF-SNAP-8, AC-39). Lists saved landmarks and trips,
 * unavailable markers, and unreadable copies. Content is rendered ONLY from the
 * authorized view store (DR-3); this page keeps just the load status.
 */
export function OfflineLibraryPage() {
  const account = useAccountSecurity();
  const { view, ops } = useSnapshotView();
  const [load, setLoad] = useState<Load>("loading");
  const readable = account.offline === "eligible" || account.offline === "offline-read";

  useEffect(() => {
    if (!readable) {
      setLoad("not-eligible");
      return;
    }
    let current = true;
    setLoad("loading");
    void Promise.all([ops.listLandmarks(), ops.listTrips()]).then(([landmarks, trips]) => {
      if (!current) return;
      const kinds = [landmarks.kind, trips.kind];
      setLoad(
        kinds.every((k) => k === "ok")
          ? "ready"
          : kinds.includes("storage-unavailable")
            ? "storage-unavailable"
            : kinds.includes("not-eligible")
              ? "not-eligible"
              : "failed",
      );
    });
    return () => {
      current = false;
    };
  }, [readable, ops, account.offline]);

  const landmarks = [...view.landmarks.values()];
  const trips = [...view.trips.values()];

  let body: ReactNode;
  if (!readable || load === "not-eligible") body = <OfflineAccessNotice />;
  else if (load === "loading") body = <p role="status">Loading saved copies…</p>;
  else if (load === "storage-unavailable") {
    body = (
      <p role="alert">
        Offline storage isn&apos;t available in this browser, so saved copies can&apos;t be shown.
      </p>
    );
  } else if (load === "failed") {
    body = (
      <p role="alert">
        Saved copies couldn&apos;t be read right now.{" "}
        <Link to="/offline-data">Offline data on this device</Link>
      </p>
    );
  } else if (landmarks.length === 0 && trips.length === 0) {
    body = <p>{EMPTY_LIBRARY}</p>;
  } else {
    body = (
      <>
        <section aria-labelledby="saved-landmarks" className={styles.section}>
          <h3 id="saved-landmarks">Landmarks</h3>
          {landmarks.length === 0 ? (
            <p className={styles.muted}>No saved landmarks.</p>
          ) : (
            <ul className={styles.list}>
              {landmarks.map((entry) => (
                <LandmarkItem key={entryKey(entry)} entry={entry} />
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="saved-trips" className={styles.section}>
          <h3 id="saved-trips">Trips</h3>
          {trips.length === 0 ? (
            <p className={styles.muted}>No saved trips.</p>
          ) : (
            <ul className={styles.list}>
              {trips.map((entry) => (
                <TripItem key={entryKey(entry)} entry={entry} />
              ))}
            </ul>
          )}
        </section>
      </>
    );
  }

  return (
    <section aria-labelledby="offline-library-heading" className={styles.page}>
      <h2 id="offline-library-heading">Saved for offline</h2>
      {account.offline === "offline-read" ? <OfflineReadNotice /> : null}
      {body}
      <p>
        <Link to="/offline-data">Offline data on this device</Link> — status, recovery, and deleting
        all offline data.
      </p>
    </section>
  );
}

function entryKey(entry: LandmarkEntry | TripEntry): string {
  if (entry.status === "unreadable") return entry.id;
  return "landmark_id" in entry.record ? entry.record.landmark_id : entry.record.trip_id;
}

function LandmarkItem({ entry }: { entry: LandmarkEntry }) {
  if (entry.status === "unreadable") return <UnreadableItem kind="landmark" id={entry.id} />;
  const record = entry.record;
  const to = `/offline/landmarks/${record.landmark_id}`;
  if (record.status === "unavailable") {
    return (
      <li className={styles.entry}>
        <Link to={to}>Saved landmark</Link>
        <p>{recordedUnavailableText(record.unavailable_recorded_at)}</p>
      </li>
    );
  }
  return (
    <li className={styles.entry}>
      <Link to={to}>{record.display_name}</Link>
      <p className={styles.muted}>{categoryLabel(record.category)}</p>
      <p className={styles.muted}>{lastSyncedText(entry.lastSyncedAt ?? record.saved_at)}</p>
    </li>
  );
}

function TripItem({ entry }: { entry: TripEntry }) {
  if (entry.status === "unreadable") return <UnreadableItem kind="trip" id={entry.id} />;
  const record = entry.record;
  const to = `/offline/trips/${record.trip_id}`;
  if (record.status === "unavailable") {
    return (
      <li className={styles.entry}>
        <Link to={to}>Saved trip</Link>
        <p>{recordedUnavailableText(record.unavailable_recorded_at)}</p>
      </li>
    );
  }
  const count = record.stops.length;
  return (
    <li className={styles.entry}>
      <Link to={to}>{record.name}</Link>
      <p className={styles.muted}>
        {count} {count === 1 ? "stop" : "stops"}
      </p>
      <p className={styles.muted}>{lastSyncedText(entry.lastSyncedAt ?? record.saved_at)}</p>
    </li>
  );
}

/** OFF-SNAP-8: never shown partially; removable (local only, E2). */
function UnreadableItem({ kind, id }: { kind: "landmark" | "trip"; id: string }) {
  const { ops } = useSnapshotView();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <li className={styles.entry}>
      <p>{UNREADABLE_COPY}</p>
      <button
        type="button"
        className={styles.button}
        onClick={() => {
          void (kind === "landmark" ? ops.removeLandmark(id) : ops.removeTrip(id)).then((r) =>
            setMessage(resultMessage(r, kind).text),
          );
        }}
      >
        Remove this saved copy
      </button>
      <p role="status" className={styles.status}>
        {message ?? ""}
      </p>
    </li>
  );
}
