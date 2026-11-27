import { createContext, useContext } from "react";
import type { AuthUser } from "../api/auth";

/**
 * The four-state session model (M03-T03 refinement 3). The state is always
 * derived from the backend's session endpoint — never from browser storage
 * (spec §2.5, §3.2). Since M06-T03 3c-1a it is published only after the
 * coordinated offline security checks: while a restriction applies
 * (`useAccountSecurity().restriction`), an authenticated response is not
 * restored and the state is `anonymous` (not signed in on this device):
 *
 * - `loading` — the first check has not answered yet;
 * - `anonymous` — the endpoint answered 200 with `null` (confirmed: no valid
 *   session; expired and revoked sessions also arrive here);
 * - `authenticated` — the endpoint returned a session for `user`;
 * - `unavailable` — the check itself failed (network error, 5xx, or a
 *   malformed body), so signed-in status is unknown. It carries `retry`.
 */
export type SessionState =
  | { status: "loading" }
  | { status: "anonymous" }
  | { status: "authenticated"; user: AuthUser }
  | { status: "unavailable"; retry: () => Promise<void> };

export interface AuthContextValue {
  session: SessionState;
  /** True while a session check is in flight (the initial one or any refresh/retry). */
  checking: boolean;
  /**
   * Re-checks the session with the server. The current state is kept while the
   * check runs, so a revalidation never flashes the UI; the result replaces it
   * (including `anonymous` for a session that expired or was revoked). Exposed
   * for later 401 handling. Never rejects.
   */
  refresh: () => Promise<void>;
  /**
   * Signs out (M06-T03 3c-1a; Specification 6 OFF-OUT-1). The state moves to
   * `anonymous` — signed out on this device — synchronously, before any
   * request; the durable sign-out intent, local cleanup, and the server request
   * follow. Resolves when the operation has finished, whether or not the server
   * confirmed it: the outcome (server confirmation, intent, cleanup) is read
   * from `useAccountSecurity().lastSignOut`, and a failed request is never
   * reported as a confirmed server sign-out (Specification 3 §4.4). Rejects
   * only with an `AuthRefusal` when nothing was started (an update in
   * progress, or no usable cross-tab coordination); the state is then unchanged.
   */
  signOut: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** The session context. Must be used inside `AuthProvider` (mounted in `main.tsx`). */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (value === null) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return value;
}
