import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router";
import {
  AuthRefusal,
  refusalMessage,
  RESTRICTION_MESSAGES,
  useAccountSecurity,
  type AuthRestriction,
  type RefusalReason,
  type SignOutOutcome,
  type StorageStatus,
} from "../auth/accountSecurity";
import { useAuth } from "../auth/session";
import styles from "./AccountNav.module.css";

type ActionStatus = "idle" | "pending";

/** Restrictions under which Finish signing out is offered (OFF-OUT-5; U1: it never clears D22). */
const FINISH_AVAILABLE: readonly AuthRestriction[] = [
  "sign-out-pending",
  "safety-lock",
  "safety-lock-unreadable",
  "state-unreadable",
];

const serverConfirmed = (outcome: SignOutOutcome) =>
  outcome.server === "confirmed" || outcome.server === "confirmed-elsewhere";

/** The server-confirmation line: never claims more than the validated response showed (OFF-OUT-11). */
function serverLine(outcome: SignOutOutcome): string {
  if (outcome.server === "not-needed") return "There was no sign-out left to finish.";
  if (serverConfirmed(outcome)) return "You're signed out. The server confirmed the sign-out.";
  return "You're signed out on this device, but the server sign-out isn't confirmed. Your browser's existing sign-in may still be valid.";
}

/**
 * The local-cleanup line, reported separately from server confirmation
 * (OFF-OUT-3). 3c-2: it comes from the DURABLE storage status, so it is also
 * shown after a reload (AC-6) and is never hidden when an obsolete server
 * warning is cleared.
 */
function cleanupLine(storage: StorageStatus, signOutContext: boolean): string | null {
  if (storage === "clean") {
    return signOutContext ? "Offline copies saved on this device were removed." : null;
  }
  if (storage === "cleanup-required" || storage === "failure-recorded") {
    return "Some offline copies on this device couldn't be removed. They stay locked and can't be opened.";
  }
  if (storage === "unreadable") {
    return "The offline data on this device can't be read reliably, so it stays locked.";
  }
  return null;
}

/** AC-32: when neither the sign-out intent nor the safety lock could be stored. */
const MEMORY_ONLY =
  "This browser couldn't save that you signed out, so protection after this page is closed or reloaded could not be confirmed.";

/** Whether the recovery page has something to show (3c-2, R1). */
const needsAttention = (storage: StorageStatus, restriction: AuthRestriction | null) =>
  restriction !== null || (storage !== "clean" && storage !== "unknown");

function OfflineDataLink() {
  return (
    <NavLink to="/offline-data" className={styles.link}>
      Offline data on this device
    </NavLink>
  );
}

/**
 * The account area of the shell header (M03-T03 Increment 2), driven by the
 * four-state session model:
 *
 * - `loading` renders an empty, `aria-busy` navigation region — no links, so a
 *   signed-in user never sees "Sign in" flash on reload, and no visible text;
 * - `anonymous` renders Sign in and Register links;
 * - `unavailable` renders the same links plus a polite notice with Retry, since
 *   the server never said whether a session exists;
 * - `authenticated` renders the account address and a Sign out button.
 *
 * M06-T03 3c-1a (Specification 6 OFF-OUT-1, OFF-OUT-3, OFF-OUT-5, OFF-OUT-11):
 * Sign out signs out on this device at once; the outcome then reports the
 * server confirmation and the local cleanup separately. When the server
 * sign-out isn't confirmed, or a restriction applies, the reason is shown with
 * Finish signing out where it is available. A sign-out refused because the app
 * is updating (DR-4) starts nothing and says why. The complete recovery
 * controls and explanations are 3c-2.
 *
 * When a control the user just activated disappears, focus moves to the new
 * state's first control instead of falling back to the page body.
 */
export function AccountNav() {
  const { session, checking, signOut } = useAuth();
  const account = useAccountSecurity();
  const [signOutStatus, setSignOutStatus] = useState<ActionStatus>("idle");
  const [finishStatus, setFinishStatus] = useState<ActionStatus>("idle");
  const [finishRefusal, setFinishRefusal] = useState<RefusalReason | null>(null);
  const restoreFocus = useRef(false);
  const signInLink = useRef<HTMLAnchorElement>(null);
  const signOutButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!restoreFocus.current || session.status === "loading") return;
    restoreFocus.current = false;
    const active = document.activeElement;
    // Only when the activated control is gone — never steal focus the user moved elsewhere.
    if (active !== null && active !== document.body) return;
    if (session.status === "authenticated") signOutButton.current?.focus();
    else signInLink.current?.focus();
  }, [session.status, account.restriction, account.lastSignOut]);

  async function handleSignOut() {
    if (signOutStatus === "pending") return;
    setSignOutStatus("pending");
    restoreFocus.current = true;
    try {
      await signOut();
    } catch (error) {
      // A local refusal: nothing was started and the user is still signed in.
      if (!(error instanceof AuthRefusal)) throw error;
      restoreFocus.current = false;
    } finally {
      setSignOutStatus("idle");
    }
  }

  async function handleFinish() {
    if (finishStatus === "pending") return;
    setFinishStatus("pending");
    setFinishRefusal(null);
    restoreFocus.current = true;
    try {
      await account.finishSigningOut();
    } catch (error) {
      if (!(error instanceof AuthRefusal)) throw error;
      setFinishRefusal(error.reason);
    } finally {
      setFinishStatus("idle");
    }
  }

  function handleRetry() {
    if (session.status !== "unavailable" || checking) return;
    restoreFocus.current = true;
    void session.retry();
  }

  if (session.status === "loading") {
    return (
      <div className={styles.account}>
        <nav aria-label="Account" aria-busy="true" className={styles.nav} />
      </div>
    );
  }

  if (session.status === "authenticated") {
    const pending = signOutStatus === "pending";
    return (
      <div className={styles.account}>
        <nav aria-label="Account" className={styles.nav}>
          <p className={styles.signedInAs}>
            Signed in as <span className={styles.email}>{session.user.email}</span>
          </p>
          <button
            ref={signOutButton}
            type="button"
            className={styles.button}
            aria-disabled={pending}
            onClick={() => void handleSignOut()}
          >
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </nav>
        {needsAttention(account.storage, null) ? (
          <div className={styles.message}>
            <p role="status">{cleanupLine(account.storage, false)}</p>
            <OfflineDataLink />
          </div>
        ) : null}
        {account.signOutRefusal !== null ? (
          <div role="alert" className={styles.message}>
            <p>Sign-out wasn&apos;t started. {refusalMessage(account.signOutRefusal)}</p>
          </div>
        ) : null}
      </div>
    );
  }

  const outcome = account.lastSignOut;
  const restriction = account.restriction;
  const outcomeUnconfirmed = outcome !== null && !serverConfirmed(outcome);
  // The pending-intent explanation repeats the unconfirmed outcome; show it once.
  const restrictionText =
    restriction === null || (restriction === "sign-out-pending" && outcomeUnconfirmed)
      ? null
      : RESTRICTION_MESSAGES[restriction];
  const finishAvailable = restriction !== null && FINISH_AVAILABLE.includes(restriction);
  const signOutContext = outcome !== null || restriction === "sign-out-pending";
  const cleanup = cleanupLine(account.storage, signOutContext);

  return (
    <div className={styles.account}>
      <nav aria-label="Account" className={styles.nav}>
        <NavLink
          ref={signInLink}
          to="/sign-in"
          className={({ isActive }) => (isActive ? styles.linkActive : styles.link)}
        >
          Sign in
        </NavLink>
        <NavLink
          to="/register"
          className={({ isActive }) => (isActive ? styles.linkActive : styles.link)}
        >
          Register
        </NavLink>
      </nav>
      {signOutStatus === "pending" ? (
        <div className={styles.message}>
          <p role="status">Signed out on this device. Finishing sign-out…</p>
        </div>
      ) : null}
      {outcome !== null ? (
        <div
          role={outcomeUnconfirmed || outcome.protection === "memory-only" ? "alert" : "status"}
          className={styles.message}
        >
          <p>{serverLine(outcome)}</p>
          {outcome.protection === "memory-only" ? <p>{MEMORY_ONLY}</p> : null}
          {cleanup !== null ? <p>{cleanup}</p> : null}
        </div>
      ) : null}
      {restrictionText !== null || finishAvailable || (outcome === null && cleanup !== null) ? (
        <div className={styles.message}>
          {restrictionText !== null ? <p role="status">{restrictionText}</p> : null}
          {outcome === null && cleanup !== null ? <p role="status">{cleanup}</p> : null}
          {finishAvailable ? (
            <button
              type="button"
              className={styles.button}
              aria-disabled={finishStatus === "pending"}
              onClick={() => void handleFinish()}
            >
              {finishStatus === "pending" ? "Finishing sign-out…" : "Finish signing out"}
            </button>
          ) : null}
        </div>
      ) : null}
      {needsAttention(account.storage, restriction) ? <OfflineDataLink /> : null}
      {finishRefusal !== null ? (
        <div role="alert" className={styles.message}>
          <p>Finish signing out wasn&apos;t started. {refusalMessage(finishRefusal)}</p>
        </div>
      ) : null}
      {session.status === "unavailable" ? (
        <div className={styles.message}>
          <p role="status">
            {checking
              ? "Checking whether you're signed in…"
              : "Couldn't check whether you're signed in."}
          </p>
          <button
            type="button"
            className={styles.button}
            aria-disabled={checking}
            onClick={handleRetry}
          >
            Retry
          </button>
        </div>
      ) : null}
    </div>
  );
}
