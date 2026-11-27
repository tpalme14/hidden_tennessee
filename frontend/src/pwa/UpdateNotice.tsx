import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { serviceWorker, type ServiceWorkerController, type UpdatePhase } from "./serviceWorker";
import { updateSafety, type ProtectedCategory, type UpdateSafety } from "./updateSafety";
import styles from "./UpdateNotice.module.css";

/**
 * Application-update notices and controls (M06-T02 Increments 4a and 4b-iii;
 * Specification 6 §5, OFF-SW-1).
 *
 * - A waiting update offers Update now and Later. Later keeps the current
 *   version for that waiting worker for this page session.
 * - After an activation was actually observed elsewhere, or late, Reload is
 *   offered. Nothing ever activates or reloads without one of these actions.
 * - While changes are still being saved (a mutation request or an operation
 *   hold), Update now and Reload are refused with an explanation, and nothing
 *   happens by itself when the work finishes.
 * - When information held only on this page would be lost, an inline
 *   confirmation lists it by CATEGORY (never values). It is bound to the
 *   action, the waiting worker shown, and the protected-information revision
 *   it lists; when that revision changes, the list is refreshed and must be
 *   confirmed again.
 *
 * These checks here are explanations only. The authoritative checks — worker
 * token, revision, pending requests, holds, and the transition gate — run
 * synchronously inside the controller's `acceptUpdate` / `reloadPage`.
 *
 * Q3 (Increment 5): while a refusal applies, its sentence is a `<span>` inside
 * the same live region, referenced by the refused control's `aria-describedby`
 * (no second region, no duplicated text); both clear when the work ends.
 *
 * Announcements: one role-less `aria-live="polite"` region, added the first
 * time there is something to say (mounted empty, then filled on the next
 * commit) and then kept. The confirmation is not a live region; focus moves to
 * its text when it opens, and back to the control that opened it on Keep
 * working. Focus otherwise never moves on its own, except to the main content
 * after Later (the Later button no longer exists).
 */

export const UPDATE_MESSAGES: Partial<Record<UpdatePhase, string>> = {
  waiting:
    "A new version of this app is available. Update now reloads this page with it; Later keeps the current version until every tab of this app has been closed.",
  activating: "Starting the update. Keep this page open.",
  reloading: "Reloading this page.",
  "activated-elsewhere":
    "A newer version of this app was activated in another tab. This page keeps running the version it opened with until it is reloaded.",
  failed: "The update couldn't be started. This page keeps working with the current version.",
  unavailable:
    "That update is no longer available. This page keeps working with the current version.",
  unresolved: "The update's outcome couldn't be confirmed. This page won't reload automatically.",
  "reload-required":
    "A newer version of this app became active, but this page wasn't reloaded. It keeps running the version it opened with until it is reloaded.",
};

/** Human-readable descriptions of what would be lost — categories only, never values. */
export const CATEGORY_LABELS: Record<ProtectedCategory, string> = {
  "review-draft": "an unsent review",
  "review-edit": "unsaved changes to your review",
  "trip-name": "a new trip name you typed",
  "trip-rename": "an unsaved trip name change",
  "sign-in": "sign-in details you typed",
  registration: "registration details you typed",
  "password-reset-request": "an email address you typed",
  "new-password": "a new password you typed",
  "reset-link": "the password reset link you opened (it can't be reopened from this page)",
  "password-reset-complete": "the confirmation that your password was reset",
  "share-link":
    "a share link shown only once (sharing stays on, but the link can't be shown again)",
  "unfinished-trip-add": "an unfinished add to a trip (the trip itself is saved)",
};

export const REFUSED_TEXT = {
  update:
    "Updating isn't available while changes are still being saved. Try again when they finish.",
  reload:
    "Reloading isn't available while changes are still being saved. Try again when they finish.",
} as const;
export const STALE_TEXT = "What's on this page changed. Review the list and confirm again.";

type Action = "update" | "reload";

interface Confirmation {
  action: Action;
  /** The waiting worker shown when it opened (update only). */
  waitingToken: number | null;
  /** The protected-information revision the list below was taken from. */
  revision: number;
  categories: readonly ProtectedCategory[];
  refreshed: boolean;
}

function focusMainContent() {
  document.getElementById("main-content")?.focus();
}

export function UpdateNotice({
  controller = serviceWorker,
  safety = updateSafety,
  onDismissed = focusMainContent,
}: {
  controller?: ServiceWorkerController;
  safety?: UpdateSafety;
  /** Where focus goes after Later closes the notice. */
  onDismissed?: () => void;
}) {
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );
  const snapshot = useSyncExternalStore(safety.subscribe, safety.getSnapshot, safety.getSnapshot);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [refusal, setRefusal] = useState<Action | null>(null);
  const actionButton = useRef<HTMLButtonElement>(null);
  const confirmText = useRef<HTMLParagraphElement>(null);
  const focusConfirm = useRef(false);
  const focusAction = useRef(false);

  const action: Action | null =
    state.update === "waiting" && state.waitingToken !== null
      ? "update"
      : state.update === "activated-elsewhere" || state.update === "reload-required"
        ? "reload"
        : null;
  const message = UPDATE_MESSAGES[state.update] ?? "";

  // A confirmation or refusal belongs to the action (and worker) it was made for.
  const confirmationCurrent =
    confirmation !== null &&
    confirmation.action === action &&
    (action !== "update" || confirmation.waitingToken === state.waitingToken);
  useEffect(() => {
    if (confirmation && !confirmationCurrent) setConfirmation(null);
  }, [confirmation, confirmationCurrent]);
  useEffect(() => {
    setRefusal((current) => (current !== null && current !== action ? null : current));
  }, [action]);

  // A changed protected-information revision makes the list stale: refresh it.
  useEffect(() => {
    if (!confirmation || snapshot.protectedRevision === confirmation.revision) return;
    if (snapshot.protectedCategories.length === 0) {
      // Nothing would be lost any more: close it; the user chooses again.
      setConfirmation(null);
      focusAction.current = true;
      return;
    }
    setConfirmation({
      ...confirmation,
      revision: snapshot.protectedRevision,
      categories: snapshot.protectedCategories,
      refreshed: true,
    });
    focusConfirm.current = true;
  }, [confirmation, snapshot]);

  useLayoutEffect(() => {
    if (focusConfirm.current && confirmText.current) {
      focusConfirm.current = false;
      confirmText.current.focus();
    }
    if (focusAction.current && actionButton.current) {
      focusAction.current = false;
      actionButton.current.focus();
    }
  });

  // M06-T02 Increment 5 (Q3): the refusal is shown — and describes its control —
  // only while work is actually still pending; it clears when the work ends
  // (presentation only: nothing activates or reloads by itself).
  const workPending =
    snapshot.pendingRequests > 0 || snapshot.operationHolds > 0 || snapshot.gateHeld;
  const shownRefusal = refusal !== null && refusal === action && workPending ? refusal : null;
  useEffect(() => {
    if (refusal !== null && !workPending) setRefusal(null);
  }, [refusal, workPending]);
  const refusalId = useId();
  const announcement = [message, shownRefusal ? REFUSED_TEXT[shownRefusal] : ""]
    .filter(Boolean)
    .join(" ");
  const [regionMounted, setRegionMounted] = useState(false);
  const [regionReady, setRegionReady] = useState(false);
  useEffect(() => {
    if (announcement && !regionMounted) setRegionMounted(true);
  }, [announcement, regionMounted]);
  useEffect(() => {
    if (regionMounted && !regionReady) setRegionReady(true);
  }, [regionMounted, regionReady]);

  function openConfirmation(kind: Action, refreshed: boolean) {
    const current = safety.getSnapshot();
    setConfirmation({
      action: kind,
      waitingToken: kind === "update" ? controller.getState().waitingToken : null,
      revision: current.protectedRevision,
      categories: current.protectedCategories,
      refreshed,
    });
    focusConfirm.current = true;
  }

  function refuse(kind: Action) {
    setConfirmation(null);
    setRefusal(kind);
    focusAction.current = true;
  }

  /** Dispatches to the controller with exactly what the user saw. */
  function perform(kind: Action, waitingToken: number | null, protectedRevision: number) {
    const result =
      kind === "update"
        ? controller.acceptUpdate({ waitingToken: waitingToken ?? -1, protectedRevision })
        : controller.reloadPage({ protectedRevision });
    if (result === "stale") {
      if (safety.getSnapshot().protectedCategories.length > 0) openConfirmation(kind, true);
      else setConfirmation(null);
      return;
    }
    if (result === "busy") {
      refuse(kind);
      return;
    }
    setConfirmation(null);
  }

  /** Update now or Reload. */
  function start(kind: Action) {
    setRefusal(null);
    const current = safety.getSnapshot();
    if (current.pendingRequests > 0 || current.operationHolds > 0 || current.gateHeld) {
      refuse(kind);
      return;
    }
    if (current.protectedCategories.length > 0) {
      openConfirmation(kind, false);
      return;
    }
    perform(kind, controller.getState().waitingToken, current.protectedRevision);
  }

  const shownConfirmation = confirmationCurrent ? confirmation : null;
  const visible = Boolean(message);

  return (
    <div className={visible ? styles.notice : styles.hidden} data-update-notice="">
      {regionMounted ? (
        <p
          className={visible ? styles.message : styles.visuallyHidden}
          aria-live="polite"
          aria-atomic="true"
        >
          {regionReady ? (
            <>
              {message}
              {shownRefusal ? (
                <>
                  {message ? " " : ""}
                  <span id={refusalId}>{REFUSED_TEXT[shownRefusal]}</span>
                </>
              ) : null}
            </>
          ) : (
            ""
          )}
        </p>
      ) : null}
      {action === "update" && !shownConfirmation ? (
        <div className={styles.actions}>
          <button
            ref={actionButton}
            type="button"
            className={styles.button}
            aria-describedby={shownRefusal === "update" && regionReady ? refusalId : undefined}
            onClick={() => start("update")}
          >
            Update now
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => {
              setRefusal(null);
              controller.postpone();
              onDismissed();
            }}
          >
            Later
          </button>
        </div>
      ) : null}
      {action === "reload" && !shownConfirmation ? (
        <div className={styles.actions}>
          <button
            ref={actionButton}
            type="button"
            className={styles.button}
            aria-describedby={shownRefusal === "reload" && regionReady ? refusalId : undefined}
            onClick={() => start("reload")}
          >
            Reload
          </button>
        </div>
      ) : null}
      {state.update === "failed" ? (
        <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={() => controller.reconsider()}>
            Check again
          </button>
        </div>
      ) : null}
      {shownConfirmation ? (
        <div className={styles.confirm} data-update-confirmation="">
          <p ref={confirmText} tabIndex={-1} className={styles.confirmText}>
            {shownConfirmation.refreshed ? `${STALE_TEXT} ` : ""}
            {shownConfirmation.action === "update"
              ? "Updating reloads this page."
              : "Reloading this page"}{" "}
            {shownConfirmation.action === "update"
              ? "Information held only on this page will be lost:"
              : "loses information held only on this page:"}
          </p>
          <ul className={styles.list}>
            {shownConfirmation.categories.map((category) => (
              <li key={category}>{CATEGORY_LABELS[category]}</li>
            ))}
          </ul>
          <p className={styles.confirmText}>
            Anything already saved on the server is not affected.
          </p>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                setConfirmation(null);
                focusAction.current = true;
              }}
            >
              Keep working
            </button>
            <button
              type="button"
              className={styles.button}
              onClick={() =>
                perform(
                  shownConfirmation.action,
                  shownConfirmation.waitingToken,
                  shownConfirmation.revision,
                )
              }
            >
              {shownConfirmation.action === "update" ? "Update anyway" : "Reload anyway"}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
