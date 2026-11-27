import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { parseSafeHttpUrl } from "../api/landmarkProfileValidation";
import { useAccountSecurity } from "../auth/accountSecurity";
import { categoryLabel } from "../map/categoryMarkerStyle";
import { OfflineCopyControl } from "../offline/OfflineCopyControl";
import {
  COORDINATE_DISCLAIMER,
  lastSyncedText,
  OUTDATED_WARNING,
  recordedUnavailableText,
  UNREADABLE_COPY,
} from "../offline/offlineText";
import { useSnapshotView } from "../offline/useSnapshotView";
import { OfflineAccessNotice, OfflineReadNotice } from "./OfflineLibraryPage";
import styles from "./OfflineLibrary.module.css";

/**
 * A saved landmark (M06-T03 Increment 3e; Specification 6 §3.4, OFF-UX-3/4,
 * OFF-SNAP-2/3/7). No map: coordinates are text, with the Specification 2
 * statement. Every view shows its last-synced time and the may-be-outdated
 * warning; a marker shows only that the landmark is no longer available.
 * Rendered ONLY from the authorized view store (DR-3).
 */
export function OfflineLandmarkPage() {
  const { id = "" } = useParams<{ id: string }>();
  const itemId = id.toLowerCase();
  const account = useAccountSecurity();
  const { view, ops } = useSnapshotView();
  const [loaded, setLoaded] = useState(false);
  const readable = account.offline === "eligible" || account.offline === "offline-read";

  useEffect(() => {
    if (!readable) return;
    let current = true;
    setLoaded(false);
    void ops.getLandmark(itemId).then(() => {
      if (current) setLoaded(true);
    });
    return () => {
      current = false;
    };
  }, [readable, itemId, ops, account.offline]);

  const entry = view.landmarks.get(itemId);
  let content;
  if (!readable) content = <OfflineAccessNotice />;
  else if (entry === undefined) {
    content = loaded ? (
      <p>This landmark isn&apos;t saved on this device.</p>
    ) : (
      <p role="status">Loading the saved copy…</p>
    );
  } else if (entry.status === "unreadable") {
    content = (
      <>
        <p>{UNREADABLE_COPY}</p>
      </>
    );
  } else if (entry.record.status === "unavailable") {
    content = (
      <>
        <p>{recordedUnavailableText(entry.record.unavailable_recorded_at)}.</p>
        <p className={styles.muted}>Its details were removed from this device.</p>
      </>
    );
  } else {
    const record = entry.record;
    const safeUrl = parseSafeHttpUrl(record.source_url ?? null);
    content = (
      <>
        <p>{categoryLabel(record.category)}</p>
        <p className={styles.muted}>{lastSyncedText(entry.lastSyncedAt ?? record.saved_at)}</p>
        <p className={styles.warning}>{OUTDATED_WARNING}</p>
        <p>
          Latitude {record.latitude}, longitude {record.longitude}
        </p>
        <p>{COORDINATE_DISCLAIMER}</p>
        {record.source_description ? <p>{record.source_description}</p> : null}
        {record.source_access_label ? <p>{record.source_access_label}</p> : null}
        {safeUrl ? (
          <p>
            <a href={safeUrl} target="_blank" rel="noreferrer noopener">
              {safeUrl}
            </a>
          </p>
        ) : null}
      </>
    );
  }

  const heading =
    entry?.status === "ok" && entry.record.status === "available"
      ? entry.record.display_name
      : "Saved landmark";
  const controlName =
    entry?.status === "ok" && entry.record.status === "available"
      ? entry.record.display_name
      : "this landmark";

  return (
    <section aria-labelledby="offline-landmark-heading" className={styles.page}>
      <h2 id="offline-landmark-heading">{heading}</h2>
      {account.offline === "offline-read" ? <OfflineReadNotice /> : null}
      {content}
      {/* One stable slot (3e): the control stays mounted when its own action
          removes the copy, so its result is still announced. */}
      {readable && (entry !== undefined || loaded) ? (
        <OfflineCopyControl kind="landmark" id={itemId} name={controlName} />
      ) : null}
      <p>
        <Link to="/offline">All saved copies</Link> ·{" "}
        <Link to={`/landmarks/${itemId}`}>Online profile (needs a connection)</Link>
      </p>
    </section>
  );
}
