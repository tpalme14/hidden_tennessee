import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { installPrompt, type InstallOutcome, type InstallPromptStore } from "./installPrompt";
import { updateSafety, type UpdateSafety } from "./updateSafety";
import styles from "./InstallAffordance.module.css";

/**
 * The installation affordance in the shell header (M06-T02 Increment 4d;
 * Specification 6 v1.1 §3.1; decisions D3, U12, U13).
 *
 * - A browser-provided prompt is retained → an **Install app** button, which
 *   shows the browser's own prompt only when activated (never automatically).
 * - No prompt is available → a collapsed "Install this app" disclosure with
 *   generic guidance that never guarantees an option exists.
 * - Standalone display mode, or a reported `appinstalled` → no promotion.
 * - While an application update owns the transition gate → nothing (no
 *   competing interaction during the update; the gate is only read).
 *
 * Installation is kept distinct from offline availability: the worker caches
 * only the application shell, so the wording never promises offline
 * landmarks, trips, maps, account data, or changes.
 *
 * Outcomes are announced through one role-less polite region, added the first
 * time there is something to say (mounted empty, then filled). Focus never
 * moves when installation becomes available; when the activated Install app
 * button disappears, focus goes to the outcome message instead of the body.
 */

export const INSTALL_MESSAGES: Record<InstallOutcome | "pending" | "installed", string> = {
  pending: "Your browser is asking whether to install this app.",
  accepted:
    "Your browser accepted the installation request. Depending on your browser and device, the app may now be available from your home screen or app list.",
  dismissed: "Installation was dismissed. Nothing was installed.",
  failed: "Your browser couldn't show its installation prompt. You can keep using the app here.",
  installed: "Your browser reports that this app was installed.",
};

export const INSTALL_GUIDANCE =
  "Some browsers let you install this app from their menu, with an option such as Install app or Add to Home Screen. Not every browser offers this.";
export const OFFLINE_NOTE =
  "Installing doesn't download landmarks, trips, maps, or your account for use without a connection: the app itself opens, but information from the server still needs one. To read a landmark or trip without a connection, save it with Save for offline while signed in.";

export function InstallAffordance({
  store = installPrompt,
  safety = updateSafety,
}: {
  store?: InstallPromptStore;
  safety?: UpdateSafety;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const updating = useSyncExternalStore(
    safety.subscribe,
    () => safety.getSnapshot().gateHeld,
    () => safety.getSnapshot().gateHeld,
  );
  const button = useRef<HTMLButtonElement>(null);
  const message = useRef<HTMLParagraphElement>(null);
  const activated = useRef(false);

  const text = state.installedReported
    ? INSTALL_MESSAGES.installed
    : state.pending
      ? INSTALL_MESSAGES.pending
      : state.outcome
        ? INSTALL_MESSAGES[state.outcome]
        : "";

  const [regionMounted, setRegionMounted] = useState(false);
  const [regionReady, setRegionReady] = useState(false);
  useEffect(() => {
    if (text && !regionMounted) setRegionMounted(true);
  }, [text, regionMounted]);
  useEffect(() => {
    if (regionMounted && !regionReady) setRegionReady(true);
  }, [regionMounted, regionReady]);

  const showButton = !updating && !state.standalone && (state.available || state.pending);
  const showGuidance = !updating && !state.standalone && !state.installedReported && !showButton;

  // The activated button is gone (prompt settled): keep focus off the page body.
  useLayoutEffect(() => {
    if (!activated.current || showButton) return;
    activated.current = false;
    const active = document.activeElement;
    if (active === null || active === document.body) message.current?.focus();
  });

  if (state.standalone || updating) {
    return null;
  }

  return (
    <div className={styles.install} data-install-affordance="">
      {showButton ? (
        <button
          ref={button}
          type="button"
          className={styles.button}
          aria-disabled={state.pending || undefined}
          onClick={() => {
            if (state.pending) return;
            activated.current = true;
            store.promptInstall(); // synchronous: keeps the browser's user activation
          }}
        >
          Install app
        </button>
      ) : null}
      {showGuidance ? (
        <details className={styles.guidance}>
          <summary className={styles.summary}>Install this app</summary>
          <p>{INSTALL_GUIDANCE}</p>
          <p>{OFFLINE_NOTE}</p>
        </details>
      ) : null}
      {regionMounted ? (
        <p
          ref={message}
          tabIndex={-1}
          className={text ? styles.message : styles.visuallyHidden}
          aria-live="polite"
          aria-atomic="true"
        >
          {regionReady ? text : ""}
        </p>
      ) : null}
    </div>
  );
}
