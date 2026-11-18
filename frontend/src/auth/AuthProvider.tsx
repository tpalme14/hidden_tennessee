import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getSession, signOut as apiSignOut } from "../api/auth";
import { AuthContext, type AuthContextValue, type SessionState } from "./session";

/**
 * Holds the signed-in state for the whole app (M03-T03 Increment 2). It asks
 * the backend's session endpoint on mount — which is how a reload restores
 * the signed-in UI (spec §3.2) — and on every `refresh`/`retry`. Nothing is
 * read from or written to browser storage; the session cookie is HttpOnly and
 * never visible here.
 *
 * Every check takes a generation number; only the newest check (and a
 * confirmed sign-out, which starts a new generation) may change the state,
 * so a slow response can never overwrite a newer answer.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({ status: "loading" });
  const [checking, setChecking] = useState(true);
  const generation = useRef(0);

  const check = useCallback(async (): Promise<void> => {
    const current = ++generation.current;
    setChecking(true);
    let next: SessionState;
    try {
      const result = await getSession();
      next =
        result === null ? { status: "anonymous" } : { status: "authenticated", user: result.user };
    } catch {
      // Network failure, 5xx, throttling, or a malformed body: the server did
      // not say whether a session exists, so this is NOT treated as signed out.
      next = { status: "unavailable", retry: check };
    }
    if (current !== generation.current) return;
    setSession(next);
    setChecking(false);
  }, []);

  const signOut = useCallback(async (): Promise<void> => {
    // Throws on any failure, before the state is touched (spec §4.4: a failed
    // request must not be reported as a confirmed logout).
    await apiSignOut();
    generation.current++;
    setChecking(false);
    setSession({ status: "anonymous" });
  }, []);

  useEffect(() => {
    void check();
    return () => {
      // Discard any in-flight answer once unmounted (and on StrictMode's re-run).
      generation.current++;
    };
  }, [check]);

  const value = useMemo<AuthContextValue>(
    () => ({ session, checking, refresh: check, signOut }),
    [session, checking, check, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
