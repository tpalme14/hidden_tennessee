import type { Persistence, RemoveResult, SnapshotResult } from "./snapshots";

/**
 * Interface text for saved offline copies (M06-T03 Increment 3e; Specification
 * 6 OFF-UX-1–6, OFF-SNAP-7, OFF-STORE-2/4/6/7, AC-39). Freshness is device time
 * and shown as approximate; markers say when unavailability was RECORDED and
 * never claim a refresh or sync.
 */

/** Device-clock timestamps, presented as approximate (OFF-SNAP-7). */
export function formatSavedTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "an unknown time";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

export const lastSyncedText = (iso: string) => `Last synced about ${formatSavedTime(iso)}`;
export const recordedUnavailableText = (iso: string) =>
  `No longer available — recorded ${formatSavedTime(iso)}`;

/** OFF-UX-4: shown on every saved-copy view. */
export const OUTDATED_WARNING =
  "This saved copy may be out of date, and the landmark's availability may have changed since it was saved.";

/** OFF-UX-3 / Specification 2: the coordinate statement. */
export const COORDINATE_DISCLAIMER =
  "Coordinates and labels shown here do not establish public access, legal entry, maintained trails, or safety.";

/** OFF-STORE-7: neutral; never presented as browser eviction. */
export const EMPTY_LIBRARY =
  "No saved copies on this device. Saved copies can be removed by the browser or when you sign out.";

export const UNREADABLE_COPY = "This saved copy can't be read. You can remove it.";

/** Honest persistent-storage reporting (OFF-STORE-6): never a guarantee. */
export function persistenceText(persistence: Persistence | undefined): string | null {
  switch (persistence) {
    case "granted":
      return "Your browser agreed to keep saved copies unless you remove them or clear site data; this isn't a guarantee.";
    case "denied":
    case "failed":
      return "Your browser may remove saved copies when it needs space.";
    case "unsupported":
      return "This browser doesn't say whether it will keep saved copies; it may remove them when it needs space.";
    default:
      return null;
  }
}

export type Tone = "status" | "alert";

/** One message per operation result; errors are alerts (OFF-UX-1). */
export function resultMessage(
  result: SnapshotResult | RemoveResult,
  noun: "landmark" | "trip",
): { tone: Tone; text: string } {
  switch (result.kind) {
    case "saved":
      return {
        tone: "status",
        text: `Saved for offline. You can open this ${noun} without a connection.`,
      };
    case "refreshed":
      return { tone: "status", text: "The offline copy was refreshed." };
    case "restored":
      return { tone: "status", text: "The offline copy was refreshed and is available again." };
    case "already-saved":
      return { tone: "status", text: "This is already saved for offline." };
    case "removed":
      return { tone: "status", text: "The offline copy was removed from this device." };
    case "not-found":
      return { tone: "status", text: "There was no offline copy to remove." };
    case "unavailable":
      return {
        tone: "alert",
        text: `This ${noun} is no longer available. ${
          result.marker
            ? "The saved copy now shows only that it's unavailable."
            : "Nothing was saved."
        }`,
      };
    case "superseded":
      return {
        tone: "alert",
        text: `This ${noun} was marked unavailable while the request was in progress, so nothing was saved. Try again.`,
      };
    case "changed-meanwhile":
      return { tone: "alert", text: "The saved copy changed meanwhile. Try again." };
    case "deleted-meanwhile":
      return { tone: "alert", text: "The saved copy was removed meanwhile, so nothing was saved." };
    case "not-saved":
      return { tone: "alert", text: "There's no saved copy to refresh." };
    case "limit-reached":
      return {
        tone: "alert",
        text: `You've reached the limit of ${result.limit} saved ${noun}s on this device. Remove a saved copy to save another.`,
      };
    case "quota":
      return {
        tone: "alert",
        text: "Your browser's storage for this site is full, so nothing was saved. Free up space or remove saved copies.",
      };
    case "storage-unavailable":
      return { tone: "alert", text: "Offline storage isn't available in this browser." };
    case "storage-failed":
      return { tone: "alert", text: "The offline copy couldn't be stored. Nothing was changed." };
    case "stale":
      return {
        tone: "alert",
        text:
          result.reason === "transient"
            ? "Couldn't reach the server. Your saved copy hasn't changed."
            : "The server sent an unexpected response. Your saved copy hasn't changed.",
      };
    case "session-check-required":
      return { tone: "alert", text: "Your sign-in needs to be checked. Nothing was saved." };
    case "not-eligible":
      return {
        tone: "alert",
        text: "Saved copies aren't available right now. See Offline data on this device for details.",
      };
    case "unreadable":
      return { tone: "alert", text: UNREADABLE_COPY };
    case "updating":
      return { tone: "alert", text: "The app is updating. Try again when the update finishes." };
    case "coordination-unavailable":
      return {
        tone: "alert",
        text: "This browser can't coordinate saved copies safely. Use a current version of a supported browser.",
      };
    case "invalidation-not-durable":
      return {
        tone: "alert",
        text:
          result.protection === "deleted"
            ? `This ${noun} is no longer available; the affected saved copies were removed from this device.`
            : result.protection === "memory-only"
              ? `This ${noun} is no longer available, and this browser couldn't record that durably. The saved copy is hidden for now; protection after closing this page could not be confirmed.`
              : `This ${noun} is no longer available, and saved copies are locked until offline storage is recovered.`,
      };
  }
}
