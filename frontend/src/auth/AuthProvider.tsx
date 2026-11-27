import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AccountSecurityContext,
  AuthRefusal,
  createBrowserAccountSecurity,
  type AccountSecurity,
  type AccountSecurityContextValue,
  type AccountState,
  type AuthRestriction,
  type OfflineEligibility,
  type RefusalReason,
  type SignOutOutcome,
  type StorageStatus,
} from "./accountSecurity";
import type { DeletionProgress } from "../offline/cleanup";
import { AuthContext, type AuthContextValue, type SessionState } from "./session";

/**
 * D-1 (M06-T03 3c-1b correction): this tab's earlier "server sign-out isn't
 * confirmed" outcome becomes obsolete once a later AUTHORITATIVE coordinated
 * check publishes no restriction — the durable sign-out intent was read under
 * the lock and is no longer pending, and no other restriction (D22, unreadable
 * state, coordination) applies. Only that warning is cleared: no server
 * confirmation is inferred or shown, a notice alone never triggers it (only the
 * check's published result does).
 *
 * 3c-2: cleanup warnings no longer come from this per-tab outcome but from the
 * DURABLE storage status (`storage`), so clearing an obsolete server warning
 * can never hide an unresolved cleanup warning; the earlier failed-cleanup
 * exception is therefore removed.
 */
function withoutObsoleteWarning(outcome: SignOutOutcome | null): SignOutOutcome | null {
  if (outcome === null) return null;
  const unconfirmed = outcome.server === "not-confirmed" || outcome.server === "not-sent";
  return unconfirmed ? null : outcome;
}

/**
 * Holds the signed-in state for the whole app (M03-T03 Increment 2), now
 * derived from COORDINATED operations (M06-T03 Increment 3c-1a,
 * `accountSecurity.ts`): every session check, sign-in, sign-out, and Finish
 * signing out runs under `tnle-auth` and the offline security rules before
 * anything is published. The session cookie stays HttpOnly and is never
 * visible here; the only browser storage touched is the offline security state
 * the specification requires (the D22 key is only ever read here).
 *
 * Every publication carries a UI generation number; only the newest check (and
 * a sign-out, which starts a new generation) may change the state, so a slow
 * answer never overwrites a newer one.
 *
 * Cross-tab notices (best-effort) and regaining visibility or focus never
 * publish anything themselves: they only block locally (for `lifecycle-ended`
 * and `lock-set`) and start an authoritative coordinated check.
 */
export function AuthProvider({
  children,
  security: injected,
}: {
  children: ReactNode;
  /** Test injection only; production uses the browser wiring. */
  security?: AccountSecurity;
}) {
  const [security] = useState<AccountSecurity>(() => injected ?? createBrowserAccountSecurity());
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [restriction, setRestriction] = useState<AuthRestriction | null>(null);
  const [offline, setOffline] = useState<OfflineEligibility>("none");
  const [lastSignOut, setLastSignOut] = useState<SignOutOutcome | null>(null);
  const [signOutRefusal, setSignOutRefusal] = useState<RefusalReason | null>(null);
  const [checking, setChecking] = useState(true);
  const [storage, setStorage] = useState<StorageStatus>("unknown");
  const generation = useRef(0);
  const sessionRef = useRef<SessionState>(session);
  const restrictionRef = useRef<AuthRestriction | null>(null);
  const background = useRef<{ running: boolean; again: boolean }>({ running: false, again: false });

  /** The durable storage status; an inspection failure is never reported as clean. */
  const inspectStorage = useCallback(async (): Promise<StorageStatus> => {
    try {
      return await security.inspectStorage();
    } catch {
      return "unknown";
    }
  }, [security]);

  const publish = useCallback((state: AccountState, retry: () => Promise<void>) => {
    const next: SessionState =
      state.session.status === "unavailable" ? { status: "unavailable", retry } : state.session;
    sessionRef.current = next;
    restrictionRef.current = state.restriction;
    setSession(next);
    setRestriction(state.restriction);
    setOffline(state.offline);
  }, []);

  const check = useCallback(async (): Promise<void> => {
    const current = ++generation.current;
    setChecking(true);
    let followUp = false;
    try {
      const result = await security.checkSession({
        proceed: () => current === generation.current,
      });
      const durable = result.kind === "done" ? await inspectStorage() : null;
      if (current !== generation.current) return;
      if (result.kind === "not-started") {
        // An application update holds the gate (DR-5): nothing was started.
        if (sessionRef.current.status === "loading") {
          publish(
            { session: { status: "unavailable" }, restriction: null, offline: "none" },
            check,
          );
        }
      } else {
        publish(result.state, check);
        if (durable !== null) setStorage(durable);
        followUp = result.followUp;
        if (result.state.restriction === null) setLastSignOut(withoutObsoleteWarning);
      }
    } catch {
      if (current !== generation.current) return;
      publish({ session: { status: "unavailable" }, restriction: null, offline: "none" }, check);
    }
    setChecking(false);
    if (followUp) await check(); // after an account switch's cleanup (OFF-LIFE-8)
  }, [security, publish, inspectStorage]);

  /** Coalesced background re-check: at most one runs, and one more after the latest trigger. */
  const recheck = useCallback(() => {
    const state = background.current;
    if (state.running) {
      state.again = true;
      return;
    }
    state.running = true;
    void (async () => {
      do {
        state.again = false;
        await check();
      } while (state.again);
      state.running = false;
    })();
  }, [check]);

  const signOut = useCallback(async (): Promise<void> => {
    setSignOutRefusal(null);
    const started = security.startSignOut();
    if (started.kind === "refused") {
      setSignOutRefusal(started.reason);
      throw new AuthRefusal(started.reason);
    }
    // OFF-OUT-1 step 1: signed out on this device at once, before any await.
    const current = ++generation.current;
    setChecking(false);
    setLastSignOut(null);
    publish({ session: { status: "anonymous" }, restriction: null, offline: "none" }, check);
    const { outcome, state } = await started.done;
    const durable = await inspectStorage();
    setLastSignOut(outcome);
    setStorage(durable);
    if (current === generation.current) publish(state, check);
  }, [security, publish, check, inspectStorage]);

  const signIn = useCallback(
    async (email: string, password: string, options: { again?: boolean } = {}) => {
      const current = ++generation.current;
      const result = await security.signIn(email, password, options.again === true);
      if (result.kind === "failed") throw result.error;
      if (result.state !== null && current === generation.current) {
        publish(result.state, check);
        setChecking(false);
        if (result.state.session.status === "authenticated") setLastSignOut(null);
      }
      if (result.kind === "refused") throw new AuthRefusal(result.reason);
      if (result.followUp) await check();
      if (result.state.restriction !== null) throw new AuthRefusal(result.state.restriction);
    },
    [security, publish, check],
  );

  const finishSigningOut = useCallback(async (): Promise<SignOutOutcome> => {
    const current = ++generation.current;
    const result = await security.finishSigningOut();
    if (result.kind === "refused") throw new AuthRefusal(result.reason);
    const durable = await inspectStorage();
    setLastSignOut(result.outcome);
    setStorage(durable);
    if (current === generation.current) {
      publish(result.state, check);
      setChecking(false);
    }
    return result.outcome;
  }, [security, publish, check, inspectStorage]);

  // 3c-2 recovery actions. Each is followed by a coordinated session check,
  // which re-inspects the storage status and lets offline eligibility return
  // only through a verified identity (AC-40).
  const retryCleanup = useCallback(async () => {
    const result = await security.retryCleanup();
    await check();
    return result;
  }, [security, check]);
  const recoverStorage = useCallback(
    async (authorizeDiscard: boolean) => {
      const result = await security.recoverStorage(authorizeDiscard);
      await check();
      return result;
    },
    [security, check],
  );
  const deleteAllData = useCallback(
    async (onProgress?: (progress: DeletionProgress) => void) => {
      const result = await security.deleteAllData(onProgress);
      await check();
      return result;
    },
    [security, check],
  );

  useEffect(() => {
    void check();
    const outcome = security.channel.open((type) => {
      if (type === "lifecycle-ended" || type === "lock-set") {
        // Block locally at once and withdraw signed-in content; only the
        // authoritative check below may publish a state again.
        security.blockLocally();
        if (sessionRef.current.status === "authenticated") {
          generation.current++;
          sessionRef.current = { status: "loading" };
          setSession({ status: "loading" });
          setOffline("none");
        }
      }
      recheck();
      // 3e: re-read what this tab shows (removed or invalidated copies leave it).
      void security.snapshots.revalidateView();
    });
    void outcome; // best-effort: an unavailable channel leaves the visibility fallback
    // 3d (AC-37): a snapshot request answered 401 starts the coordinated session check.
    const offSessionCheck = security.onSessionCheckRequired(recheck);
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      if (sessionRef.current.status === "authenticated" || restrictionRef.current !== null) {
        recheck();
      }
      // 3e (OFF-LIFE-7 fallback): re-validate rendered saved copies on regaining focus.
      void security.snapshots.revalidateView();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      // Discard any in-flight answer once unmounted (and on StrictMode's re-run).
      generation.current++;
      security.channel.close();
      offSessionCheck();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [security, check, recheck]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, checking, refresh: check, signOut }),
    [session, checking, check, signOut],
  );
  const account = useMemo<AccountSecurityContextValue>(
    () => ({
      restriction,
      offline,
      lastSignOut,
      signOutRefusal,
      signIn,
      finishSigningOut,
      storage,
      retryCleanup,
      recoverStorage,
      deleteAllData,
      snapshots: security.snapshots,
    }),
    [
      restriction,
      offline,
      lastSignOut,
      signOutRefusal,
      signIn,
      finishSigningOut,
      storage,
      retryCleanup,
      recoverStorage,
      deleteAllData,
      security,
    ],
  );

  return (
    <AuthContext.Provider value={value}>
      <AccountSecurityContext.Provider value={account}>{children}</AccountSecurityContext.Provider>
    </AuthContext.Provider>
  );
}
