import type { ReactNode } from "react";
import { vi } from "vitest";
import type { AuthUser } from "../api/auth";
import { TEST_USER } from "../auth/testFixtures";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";

/**
 * Test-only session context for the reviews components (M04-T03 Increment 3).
 * `refresh` and `signOut` are spies; `refresh` resolves immediately unless a
 * test supplies its own.
 */
export const OTHER_USER: AuthUser = {
  ...TEST_USER,
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  email: "other@example.test",
};

export function authValue(
  session: SessionState,
  overrides: Partial<AuthContextValue> = {},
): AuthContextValue {
  return {
    session,
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
}

export const signedIn = (user: AuthUser = TEST_USER): SessionState => ({
  status: "authenticated",
  user,
});

export function WithAuth({ value, children }: { value: AuthContextValue; children: ReactNode }) {
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
