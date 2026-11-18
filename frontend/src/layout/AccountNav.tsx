import { useEffect, useRef, useState } from "react";
import { NavLink } from "react-router";
import { useAuth } from "../auth/session";
import styles from "./AccountNav.module.css";

type SignOutStatus = "idle" | "pending" | "failed";

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
 * Sign-out changes the UI only after the server confirms it (spec §4.4); a
 * failure keeps the signed-in UI and shows an alert with a retry. When a
 * control the user just activated disappears (Sign out → Sign in, or Retry →
 * the resolved state), focus moves to the new state's first control instead
 * of falling back to the page body.
 *
 * The Sign in and Register routes arrive in Increments 3 and 4.
 */
export function AccountNav() {
  const { session, checking, signOut } = useAuth();
  const [signOutStatus, setSignOutStatus] = useState<SignOutStatus>("idle");
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
  }, [session.status]);

  async function handleSignOut() {
    if (signOutStatus === "pending") return;
    setSignOutStatus("pending");
    restoreFocus.current = true;
    try {
      await signOut();
      setSignOutStatus("idle");
    } catch {
      restoreFocus.current = false;
      setSignOutStatus("failed");
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
        {signOutStatus === "failed" ? (
          <div role="alert" className={styles.message}>
            <p>Sign-out didn&apos;t complete. You&apos;re still signed in.</p>
            <button type="button" className={styles.button} onClick={() => void handleSignOut()}>
              Try signing out again
            </button>
          </div>
        ) : null}
      </div>
    );
  }

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
