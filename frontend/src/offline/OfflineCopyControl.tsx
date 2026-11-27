import { useContext, useEffect, useState } from "react";
import { Link } from "react-router";
import { useAccountSecurity } from "../auth/accountSecurity";
import { AuthContext } from "../auth/session";
import { OnlineOnlyReason } from "../connectivity/OnlineOnlyReason";
import { useOnlineOnlyAction } from "../connectivity/useOnlineOnlyAction";
import {
  lastSyncedText,
  persistenceText,
  recordedUnavailableText,
  resultMessage,
  UNREADABLE_COPY,
  type Tone,
} from "./offlineText";
import type { RemoveResult, SnapshotResult } from "./snapshots";
import { useSnapshotView } from "./useSnapshotView";
import styles from "./OfflineCopyControl.module.css";

type Kind = "landmark" | "trip";
type Busy = "save" | "refresh" | "remove" | null;

/**
 * OFF-UX-2: when an online page fails to load, it may LINK to a saved copy —
 * it is never silently replaced by one. Shown only when a copy exists.
 */
export function SavedCopyLink({ kind, id }: { kind: Kind; id: string }) {
  const account = useAccountSecurity();
  const { view, ops } = useSnapshotView();
  const itemId = id.toLowerCase();
  const readable = account.offline === "eligible" || account.offline === "offline-read";
  useEffect(() => {
    if (!readable || itemId === "") return;
    void (kind === "landmark" ? ops.getLandmark(itemId) : ops.getTrip(itemId));
  }, [readable, kind, itemId, ops]);
  const entry = kind === "landmark" ? view.landmarks.get(itemId) : view.trips.get(itemId);
  if (!readable || entry === undefined) return null;
  return (
    <p>
      <Link to={`/offline/${kind === "landmark" ? "landmarks" : "trips"}/${itemId}`}>
        Open the copy saved on this device
      </Link>
    </p>
  );
}

/**
 * "Save for offline" (M06-T03 Increment 3e; Specification 6 §3.3, OFF-UX-1,
 * OFF-UX-5; approved E2). Explicit only, and separate from Favorite: neither
 * action performs the other.
 *
 * - Save and Refresh need the server: disabled with the reason while it can't
 *   be reached or the app is updating (nothing is queued), and available only
 *   to a VERIFIED account (`offline === "eligible"`).
 * - Remove is local only (E2): also available while reading offline.
 * - The status comes ONLY from the authorized view store (DR-3).
 */
export function OfflineCopyControl({ kind, id, name }: { kind: Kind; id: string; name: string }) {
  // Outside AuthProvider (isolated page tests) this reads as signed out.
  const session = useContext(AuthContext)?.session ?? { status: "anonymous" as const };
  const account = useAccountSecurity();
  const { view, ops } = useSnapshotView();
  const online = useOnlineOnlyAction();
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<{ tone: Tone; text: string } | null>(null);
  const itemId = id.toLowerCase();
  const eligible = account.offline === "eligible";
  const readable = eligible || account.offline === "offline-read";

  useEffect(() => {
    if (!readable) return;
    void (kind === "landmark" ? ops.getLandmark(itemId) : ops.getTrip(itemId));
  }, [readable, kind, itemId, ops, account.offline]);

  const entry = kind === "landmark" ? view.landmarks.get(itemId) : view.trips.get(itemId);

  if (!readable) {
    const signedOut = session.status !== "authenticated";
    return (
      <div className={styles.control}>
        <p>
          {signedOut
            ? "Sign in to save this for offline use."
            : "Saving for offline isn't available right now."}
        </p>
        {!signedOut || account.restriction !== null ? (
          <p>
            <Link to="/offline-data">Offline data on this device</Link>
          </p>
        ) : null}
      </div>
    );
  }

  async function run(action: Exclude<Busy, null>) {
    if (busy !== null) return;
    setBusy(action);
    setMessage(null);
    let result: SnapshotResult | RemoveResult;
    if (action === "remove") {
      result = await (kind === "landmark" ? ops.removeLandmark(itemId) : ops.removeTrip(itemId));
    } else if (action === "save") {
      result = await (kind === "landmark" ? ops.saveLandmark(itemId) : ops.saveTrip(itemId));
    } else {
      result = await (kind === "landmark" ? ops.refreshLandmark(itemId) : ops.refreshTrip(itemId));
    }
    const text = resultMessage(result, kind);
    const persistence = result.kind === "saved" ? persistenceText(result.persistence) : null;
    setMessage(persistence === null ? text : { ...text, text: `${text.text} ${persistence}` });
    setBusy(null);
  }

  const onlineBlocked = !eligible || online.unavailable;
  const status =
    entry === undefined
      ? "Not saved for offline."
      : entry.status === "unreadable"
        ? UNREADABLE_COPY
        : entry.record.status === "available"
          ? `Saved for offline. ${lastSyncedText(entry.lastSyncedAt ?? entry.record.saved_at)}.`
          : `Saved copy: ${recordedUnavailableText(entry.record.unavailable_recorded_at)}.`;

  return (
    <div className={styles.control} aria-label={`Offline copy of ${name}`} role="group">
      <p>{status}</p>
      <div className={styles.actions}>
        {entry === undefined ? (
          <button
            type="button"
            className={styles.button}
            aria-disabled={onlineBlocked || busy !== null}
            aria-describedby={online.describedBy}
            onClick={() => {
              if (!onlineBlocked) void run("save");
            }}
          >
            {busy === "save" ? "Saving…" : "Save for offline"}
          </button>
        ) : (
          <>
            {entry.status === "ok" ? (
              <button
                type="button"
                className={styles.button}
                aria-disabled={onlineBlocked || busy !== null}
                aria-describedby={online.describedBy}
                onClick={() => {
                  if (!onlineBlocked) void run("refresh");
                }}
              >
                {busy === "refresh" ? "Refreshing…" : "Refresh offline copy"}
              </button>
            ) : null}
            <button
              type="button"
              className={styles.button}
              aria-disabled={busy !== null}
              onClick={() => void run("remove")}
            >
              {busy === "remove" ? "Removing…" : "Remove offline copy"}
            </button>
          </>
        )}
      </div>
      {!eligible ? (
        <p className={styles.hint}>
          Saving and refreshing need you to be signed in with a connection to the server.
        </p>
      ) : (
        <OnlineOnlyReason action={online} className={styles.hint} />
      )}
      <p role="status" className={styles.status}>
        {message?.tone === "status" ? message.text : ""}
      </p>
      <p role="alert" className={styles.alert}>
        {message?.tone === "alert" ? message.text : ""}
      </p>
    </div>
  );
}
