import { useEffect, useRef, useState } from "react";
import {
  AuthRefusal,
  EXPLANATIONS,
  REFUSAL_MESSAGES,
  RESTRICTION_MESSAGES,
  SITE_DATA_MESSAGE,
  useAccountSecurity,
  type DeleteAllOutcome,
  type ExplainedState,
  type RecoverStorageResult,
  type RetryCleanupResult,
} from "../auth/accountSecurity";
import type { DeletionProgress } from "../offline/cleanup";
import type { LocalRecoveryRefusal } from "../offline/recovery";
import styles from "./OfflineDataPage.module.css";

/**
 * "Offline data on this device" (M06-T03 Increment 3c-2; approved decision R1;
 * Specification 6 OFF-LIFE-9, OFF-OUT-3/5/9, OFF-FAIL-3–6, §12.18 OFF-REC-1–4;
 * AC-4, AC-10, AC-34, AC-40, AC-41). Reusable by the future offline library.
 *
 * It shows the durable storage status, the applicable recovery actions, and
 * the explanation of any restriction. Server confirmation, local cleanup,
 * durable protection, authentication restrictions, and offline eligibility are
 * reported separately.
 *
 * - Retry cleanup is MANDATORY invalidation cleanup: no discard consent.
 * - Recover offline storage first runs without discard authorization; only if
 *   it reports that saved copies would be discarded is the disclosure shown,
 *   and only an explicit "Remove and recover" authorizes it. Declining removes
 *   nothing.
 * - Delete all offline data ALWAYS asks first. A blocked deletion is reported
 *   as waiting, never as complete (it cannot be cancelled while it waits).
 *
 * Nothing here clears the safety lock, removes a sign-out intent, or claims a
 * server sign-out. Site-data removal is only described (OFF-REC-3).
 */

type Busy = "retry" | "recover" | "delete" | "finish" | null;

/** Restrictions under which Finish signing out is offered (OFF-OUT-5; U1: it never clears D22). */
const FINISH_AVAILABLE = [
  "sign-out-pending",
  "safety-lock",
  "safety-lock-unreadable",
  "state-unreadable",
] as const;
type Message = { tone: "status" | "alert"; text: string } | null;

const DELETE_DISCLOSURE =
  "This deletes every saved offline copy on this device for every account. You'll need to save them again. It doesn't delete landmarks, favorites, trips, or reviews saved on the server.";
const RECOVER_DISCLOSURE =
  "Recovering offline storage removes the saved offline landmarks and trips stored in this browser. You'll need to save them again. Landmarks, favorites, trips, and reviews saved on the server aren't affected.";
const BLOCKED_PROGRESS =
  "Deletion is waiting because another tab of this app is still using offline data. Close the app's other tabs; deletion finishes when they're closed. It can't be cancelled while it waits.";

const refused = (reason: "updating" | "coordination-unavailable") =>
  reason === "updating" ? REFUSAL_MESSAGES.updating : RESTRICTION_MESSAGES[reason];

function notPossibleText(reason: LocalRecoveryRefusal | "safety-lock-at-removal"): string {
  switch (reason) {
    case "intent-pending":
    case "intent-malformed":
      return "Offline storage can't be recovered until the sign-out is finished. Finish signing out first.";
    case "safety-lock-present":
    case "safety-lock-unreadable":
    case "safety-lock-at-removal":
      return "Offline storage can't be recovered in this browser while offline data protection is on.";
    case "state-unreadable":
    case "data-unreadable":
      return "Offline storage can't be recovered because the offline data on this device can't be read reliably.";
    case "no-failure-record":
      return "There's nothing to recover.";
    case "authorization-required":
      return "Nothing was removed. Offline copies stay locked.";
  }
}

function retryText(result: RetryCleanupResult): Message {
  switch (result.kind) {
    case "cleaned":
      return { tone: "status", text: "Offline copies from the earlier sign-in were removed." };
    case "nothing-to-clean":
      return { tone: "status", text: "There was nothing to remove." };
    case "failed":
      return {
        tone: "alert",
        text: "Offline copies couldn't be removed. They stay locked. You can try again, or delete all offline data on this device.",
      };
    case "not-possible":
      return {
        tone: "alert",
        text: "Cleanup isn't possible in the current state. Nothing was removed.",
      };
    case "refused":
      return { tone: "alert", text: `Cleanup wasn't started. ${refused(result.reason)}` };
  }
}

function recoverText(
  result: Exclude<RecoverStorageResult, { kind: "authorization-required" }>,
): Message {
  switch (result.kind) {
    case "recovered":
      return {
        tone: "status",
        text: "Offline storage was recovered. Nothing else changed: your sign-in and the server's data are unaffected.",
      };
    case "not-possible":
      return { tone: "alert", text: notPossibleText(result.reason) };
    case "failed":
      return {
        tone: "alert",
        text: "Offline storage couldn't be recovered. It stays locked. You can try again.",
      };
    case "refused":
      return { tone: "alert", text: `Recovery wasn't started. ${refused(result.reason)}` };
  }
}

function deleteText(result: DeleteAllOutcome): Message {
  switch (result.kind) {
    case "deleted":
      if (result.failureRecord === "retained") {
        const why =
          result.retainedReason === "authorization-required"
            ? "New offline data was saved meanwhile. Use Recover offline storage to continue."
            : result.retainedReason === "failed" || result.retainedReason === undefined
              ? "The earlier failure couldn't be cleared. You can try Recover offline storage."
              : notPossibleText(result.retainedReason);
        return {
          tone: "alert",
          text: `All offline data on this device was deleted, but offline storage is still locked. ${why}`,
        };
      }
      return {
        tone: "status",
        text:
          result.failureRecord === "recovered"
            ? "All offline data on this device was deleted, and offline storage was recovered."
            : "All offline data on this device was deleted.",
      };
    case "failed":
      return {
        tone: "alert",
        text: "Offline data couldn't be deleted. It stays locked. You can try again.",
      };
    case "not-attempted":
      return {
        tone: "alert",
        text: "Nothing was deleted, because offline data protection couldn't be saved first.",
      };
    case "refused":
      return { tone: "alert", text: `Deletion wasn't started. ${refused(result.reason)}` };
  }
}

export function OfflineDataPage() {
  const account = useAccountSecurity();
  const [busy, setBusy] = useState<Busy>(null);
  const [message, setMessage] = useState<Message>(null);
  const [consent, setConsent] = useState<"recover" | "delete" | null>(null);
  const [progress, setProgress] = useState<DeletionProgress | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const deleteButton = useRef<HTMLButtonElement>(null);
  const recoverButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (consent !== null) confirmRef.current?.focus();
  }, [consent]);

  const { restriction, storage, offline } = account;
  const explained: ExplainedState | null =
    restriction ?? (storage === "unreadable" ? "storage-unreadable" : null);
  const explanation = explained === null ? null : EXPLANATIONS[explained];
  const coordinated = restriction !== "coordination-unavailable" && storage !== "unknown";

  async function run<T>(kind: Exclude<Busy, null>, action: () => Promise<T>): Promise<T | null> {
    if (busy !== null) return null;
    setBusy(kind);
    setMessage(null);
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof AuthRefusal)) {
        setMessage({ tone: "alert", text: "That didn't complete. Nothing else was changed." });
      }
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function handleRetry() {
    const result = await run("retry", () => account.retryCleanup());
    if (result !== null) setMessage(retryText(result));
  }

  async function handleFinish() {
    const outcome = await run("finish", () => account.finishSigningOut());
    if (outcome === null) return;
    const confirmed = outcome.server === "confirmed" || outcome.server === "confirmed-elsewhere";
    setMessage(
      confirmed
        ? { tone: "status", text: "The server confirmed the sign-out." }
        : outcome.server === "not-needed"
          ? { tone: "status", text: "There was no sign-out left to finish." }
          : {
              tone: "alert",
              text: "The server sign-out still isn't confirmed. You can try again.",
            },
    );
  }

  async function handleRecover(authorizeDiscard: boolean) {
    setConsent(null);
    const result = await run("recover", () => account.recoverStorage(authorizeDiscard));
    if (result === null) return;
    if (result.kind === "authorization-required") {
      setConsent("recover"); // explicit, informed consent first (OFF-LIFE-9, AC-40)
      return;
    }
    setMessage(recoverText(result));
  }

  async function handleDelete() {
    setConsent(null);
    setProgress("requested");
    const result = await run("delete", () => account.deleteAllData((step) => setProgress(step)));
    setProgress(null);
    if (result !== null) setMessage(deleteText(result));
    deleteButton.current?.focus();
  }

  function cancel(kind: "recover" | "delete") {
    setConsent(null);
    if (kind === "recover") {
      setMessage({ tone: "status", text: "Nothing was removed. Offline copies stay locked." });
      recoverButton.current?.focus();
    } else {
      deleteButton.current?.focus();
    }
  }

  const eligibility =
    offline === "eligible"
      ? "Offline copies are available for your account on this device."
      : offline === "locked"
        ? "Offline copies on this device are locked."
        : "Offline copies aren't available, because you aren't signed in on this device.";
  const storageText =
    storage === "clean"
      ? "Nothing on this device needs to be recovered."
      : storage === "cleanup-required"
        ? "Offline copies from an earlier sign-in are still stored. They stay locked and must be removed before offline copies can be used again."
        : storage === "failure-recorded"
          ? "An earlier attempt to remove offline copies failed, so offline copies stay locked until offline storage is recovered."
          : storage === "unreadable"
            ? "The offline data on this device can't be read reliably, so it stays locked."
            : "The offline data on this device can't be checked in this browser.";

  const deleteNotes: string[] = [];
  if (restriction === "sign-out-pending") {
    deleteNotes.push(
      "Your pending sign-out isn't affected: it stays recorded until the server sign-out is confirmed.",
    );
  }
  if (restriction === "state-unreadable" || restriction === "safety-lock-unreadable") {
    deleteNotes.push(
      "If this browser's offline security status still can't be read when deleting, offline data protection is turned on first, which the app can't turn off. Signing in would then stay unavailable in this browser until you remove this site's data.",
    );
  }

  return (
    <section aria-labelledby="offline-data-heading" className={styles.page}>
      <h2 id="offline-data-heading" className={styles.heading}>
        Offline data on this device
      </h2>

      <div className={styles.section}>
        <h3>Status</h3>
        <p>{eligibility}</p>
        <p>{storageText}</p>
      </div>

      {explanation !== null ? (
        <div className={`${styles.section} ${styles.explanation}`}>
          <h3>What&apos;s unavailable and why</h3>
          <dl>
            <dt>Unavailable</dt>
            <dd>{explanation.unavailable}</dd>
            <dt>Why</dt>
            <dd>{explanation.reason}</dd>
            <dt>What you can do</dt>
            <dd>
              <ul>
                {explanation.actions.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </dd>
          </dl>
          {explanation.siteData ? <p>{SITE_DATA_MESSAGE}</p> : null}
        </div>
      ) : null}

      {coordinated ? (
        <div className={styles.section}>
          <h3>Actions</h3>
          <div className={styles.actions}>
            {restriction !== null &&
            (FINISH_AVAILABLE as readonly string[]).includes(restriction) ? (
              <button
                type="button"
                className={styles.button}
                aria-disabled={busy !== null}
                onClick={() => void handleFinish()}
              >
                {busy === "finish" ? "Finishing sign-out…" : "Finish signing out"}
              </button>
            ) : null}
            {storage === "cleanup-required" ? (
              <button
                type="button"
                className={styles.button}
                aria-disabled={busy !== null}
                onClick={() => void handleRetry()}
              >
                {busy === "retry" ? "Removing…" : "Retry cleanup"}
              </button>
            ) : null}
            {storage === "failure-recorded" ? (
              <button
                ref={recoverButton}
                type="button"
                className={styles.button}
                aria-disabled={busy !== null}
                onClick={() => void handleRecover(false)}
              >
                {busy === "recover" ? "Recovering…" : "Recover offline storage"}
              </button>
            ) : null}
            <button
              ref={deleteButton}
              type="button"
              className={styles.danger}
              aria-disabled={busy !== null}
              onClick={() => {
                if (busy === null) setConsent("delete");
              }}
            >
              {busy === "delete" ? "Deleting…" : "Delete all offline data on this device"}
            </button>
          </div>
        </div>
      ) : null}

      {consent === "delete" ? (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="delete-confirm-heading"
          className={styles.confirm}
        >
          <p id="delete-confirm-heading">
            <strong>Delete all offline data on this device?</strong>
          </p>
          <p>{DELETE_DISCLOSURE}</p>
          {deleteNotes.map((note) => (
            <p key={note}>{note}</p>
          ))}
          <div className={styles.actions}>
            <button type="button" className={styles.danger} onClick={() => void handleDelete()}>
              Delete offline data
            </button>
            <button type="button" className={styles.button} onClick={() => cancel("delete")}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {consent === "recover" ? (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="group"
          aria-labelledby="recover-confirm-heading"
          className={styles.confirm}
        >
          <p id="recover-confirm-heading">
            <strong>Remove saved offline copies to recover?</strong>
          </p>
          <p>{RECOVER_DISCLOSURE}</p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.danger}
              onClick={() => void handleRecover(true)}
            >
              Remove and recover
            </button>
            <button type="button" className={styles.button} onClick={() => cancel("recover")}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      <p role="status" className={styles.status}>
        {progress === "blocked"
          ? BLOCKED_PROGRESS
          : progress !== null
            ? "Deleting offline data…"
            : message?.tone === "status"
              ? message.text
              : ""}
      </p>
      <p role="alert" className={styles.alert}>
        {message?.tone === "alert" ? message.text : ""}
      </p>
    </section>
  );
}
