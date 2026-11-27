import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "../api/client";
import { getSession, signIn, signOut } from "../api/auth";
import { openOfflineDataDatabase, openOfflineStateDatabase } from "../offline/db";
import { NOTICE_CHANNEL } from "../offline/notices";
import { SAFETY_LOCK_KEY } from "../offline/safetyLock";
import { AuthProvider } from "./AuthProvider";
import {
  AuthRefusal,
  useAccountSecurity,
  type AccountSecurity,
  type AccountSecurityContextValue,
  type AccountState,
  type StorageStatus,
} from "./accountSecurity";
import { useAuth, type AuthContextValue } from "./session";
import { TEST_SESSION, TEST_USER, deferred } from "./testFixtures";

/**
 * M03-T03 Increment 2 — the session provider's four-state model, with the auth
 * API module mocked; updated in M06-T03 Increment 3c-1a for the coordinated
 * operations (Specification 6 OFF-OUT-1, OFF-OUT-4, OFF-OUT-7 amendment,
 * OFF-LIFE-7). The test setup supplies TEST-ONLY Web Locks, IndexedDB, and
 * BroadcastChannel stand-ins; nothing here is real-browser evidence.
 */

vi.mock("../api/auth", () => ({ getSession: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }));

const mockedGetSession = vi.mocked(getSession);
const mockedSignIn = vi.mocked(signIn);
const mockedSignOut = vi.mocked(signOut);

let latest: AuthContextValue;
let account: AccountSecurityContextValue;

function Probe() {
  latest = useAuth();
  account = useAccountSecurity();
  const { session, checking } = latest;
  return (
    <p data-testid="probe">
      {session.status}
      {session.status === "authenticated" ? `:${session.user.email}` : ""}
      {checking ? ":checking" : ""}
      {account.restriction !== null ? `:${account.restriction}` : ""}
    </p>
  );
}

function renderProvider() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

const probe = () => screen.getByTestId("probe");

async function readIntent(): Promise<unknown> {
  const opened = await openOfflineStateDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  const value: unknown = await opened.db.get("state", "signout_intent");
  opened.db.close();
  return value;
}
async function readMarker(): Promise<unknown> {
  const opened = await openOfflineDataDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  const value: unknown = await opened.db.get("meta", "marker");
  opened.db.close();
  return value;
}

beforeEach(() => {
  mockedGetSession.mockReset();
  mockedSignIn.mockReset();
  mockedSignOut.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AuthProvider — initial session check", () => {
  it("starts in loading and checks the session exactly once", async () => {
    const pending = deferred<null>();
    mockedGetSession.mockReturnValue(pending.promise);
    renderProvider();

    expect(probe()).toHaveTextContent("loading:checking");
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(1));

    await act(async () => pending.resolve(null));
    await waitFor(() => expect(probe()).toHaveTextContent(/^anonymous$/));
    expect(mockedGetSession).toHaveBeenCalledTimes(1);
  });

  it("is anonymous when the endpoint answers null", async () => {
    mockedGetSession.mockResolvedValue(null);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^anonymous$/));
  });

  it("is authenticated with the user when the endpoint returns a session", async () => {
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(`authenticated:${TEST_USER.email}`));
    expect(latest.session).toEqual({ status: "authenticated", user: TEST_USER });
    expect(account.offline).toBe("eligible");
  });

  it.each([
    ["a network failure", new ApiError(0, "NETWORK_ERROR", "Unable to reach the server.")],
    [
      "a 5xx response",
      new ApiError(503, "SERVICE_UNAVAILABLE", "Service temporarily unavailable."),
    ],
    ["a malformed body", new ApiError(200, "INVALID_RESPONSE", "Unexpected response.")],
    ["a throttled check", new ApiError(429, "RATE_LIMITED", "Too many requests.")],
  ])("is unavailable — not anonymous — after %s", async (_label, error) => {
    mockedGetSession.mockRejectedValue(error);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^unavailable$/));
    expect(latest.session.status).toBe("unavailable");
  });

  it("writes no browser storage and reads only the offline safety-lock key", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    mockedSignOut.mockResolvedValue(undefined);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^authenticated/));
    await act(() => latest.signOut());

    expect(getItem.mock.calls.every(([key]) => key === SAFETY_LOCK_KEY)).toBe(true);
    expect(setItem).not.toHaveBeenCalled();
  });

  it("throws a clear error when useAuth is used outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useAuth must be used inside <AuthProvider>");
  });

  it("without usable Web Locks: no session request, nothing created, anonymous with the reason (AC-36, U2)", async () => {
    delete (navigator as { locks?: unknown }).locks;
    mockedGetSession.mockResolvedValue(TEST_SESSION); // a still-valid cookie
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^anonymous:coordination-unavailable$/));
    expect(mockedGetSession).not.toHaveBeenCalled();
    expect(await indexedDB.databases()).toEqual([]);
    await act(async () => {
      await expect(account.signIn("a@example.test", "pw")).rejects.toBeInstanceOf(AuthRefusal);
    });
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it("with D22 present an authenticated response is not restored and D22 is left in place (AC-33)", async () => {
    localStorage.setItem(SAFETY_LOCK_KEY, "true");
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^anonymous:safety-lock$/));
    expect(localStorage.getItem(SAFETY_LOCK_KEY)).toBe("true");
  });
});

describe("AuthProvider — retry and refresh", () => {
  it("retry from unavailable re-checks and moves to the server's answer", async () => {
    mockedGetSession.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^unavailable$/));

    const pending = deferred<typeof TEST_SESSION>();
    mockedGetSession.mockReturnValueOnce(pending.promise);
    const { session } = latest;
    if (session.status !== "unavailable") throw new Error("expected unavailable");
    let retried!: Promise<void>;
    act(() => {
      retried = session.retry();
    });
    // The notice state is kept while the retry runs, flagged as checking.
    expect(probe()).toHaveTextContent("unavailable:checking");

    await act(async () => {
      await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(2));
      pending.resolve(TEST_SESSION);
      await retried;
    });
    expect(probe()).toHaveTextContent(`authenticated:${TEST_USER.email}`);
    expect(mockedGetSession).toHaveBeenCalledTimes(2);
  });

  it("a failed retry stays unavailable", async () => {
    mockedGetSession.mockRejectedValue(new ApiError(500, "INTERNAL", "boom"));
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^unavailable$/));
    await act(() => latest.refresh());
    expect(probe()).toHaveTextContent(/^unavailable$/);
    expect(mockedGetSession).toHaveBeenCalledTimes(2);
  });

  it("refresh keeps the signed-in state while checking, then shows a revoked or expired session as anonymous", async () => {
    mockedGetSession.mockResolvedValueOnce(TEST_SESSION);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^authenticated/));

    const pending = deferred<null>();
    mockedGetSession.mockReturnValueOnce(pending.promise);
    let refreshed!: Promise<void>;
    act(() => {
      refreshed = latest.refresh();
    });
    expect(probe()).toHaveTextContent(`authenticated:${TEST_USER.email}:checking`);

    await act(async () => {
      await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(2));
      pending.resolve(null);
      await refreshed;
    });
    expect(probe()).toHaveTextContent(/^anonymous$/);
    // OFF-OUT-8: the confirmed absence ended the lifecycle.
    expect(await readMarker()).toBeUndefined();
  });

  it("refresh never rejects, even when the check fails", async () => {
    mockedGetSession.mockResolvedValueOnce(null);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^anonymous$/));
    mockedGetSession.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    await expect(act(() => latest.refresh())).resolves.toBeUndefined();
    expect(probe()).toHaveTextContent(/^unavailable$/);
  });

  it("checks are serialized and the newest answer wins", async () => {
    const slow = deferred<typeof TEST_SESSION>();
    mockedGetSession.mockReturnValueOnce(slow.promise);
    renderProvider();
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(1));

    mockedGetSession.mockResolvedValueOnce(null);
    let refreshed!: Promise<void>;
    act(() => {
      refreshed = latest.refresh();
    });
    await act(async () => {
      slow.resolve(TEST_SESSION);
      await refreshed;
    });
    expect(probe()).toHaveTextContent(/^anonymous$/);
  });
});

describe("AuthProvider — sign-in", () => {
  it("publishes the signed-in state only after the security checks complete", async () => {
    mockedGetSession.mockResolvedValueOnce(null);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^anonymous$/));

    const verified = deferred<typeof TEST_SESSION>();
    mockedSignIn.mockResolvedValueOnce(TEST_USER);
    mockedGetSession.mockReturnValueOnce(verified.promise);
    let signingIn!: Promise<void>;
    act(() => {
      signingIn = account.signIn("hiker@example.test", "pw");
    });
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(2));
    // The sign-in response alone publishes nothing.
    expect(probe()).toHaveTextContent(/^anonymous$/);
    await act(async () => {
      verified.resolve(TEST_SESSION);
      await signingIn;
    });
    expect(probe()).toHaveTextContent(`authenticated:${TEST_USER.email}`);
    expect(await readMarker()).toMatchObject({ account_id: TEST_USER.id });
  });
});

describe("AuthProvider — sign-out (OFF-OUT-1)", () => {
  async function renderSignedIn() {
    mockedGetSession.mockResolvedValueOnce(TEST_SESSION);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^authenticated/));
  }

  it("signs out on this device at once, then reports the server confirmation", async () => {
    await renderSignedIn();
    const pending = deferred<void>();
    mockedSignOut.mockReturnValueOnce(pending.promise);
    let signedOut!: Promise<void>;
    act(() => {
      signedOut = latest.signOut();
    });
    // Signed out on this device before any request completes.
    expect(probe()).toHaveTextContent(/^anonymous$/);

    await act(async () => {
      await waitFor(() => expect(mockedSignOut).toHaveBeenCalledTimes(1));
      pending.resolve();
      await signedOut;
    });
    expect(probe()).toHaveTextContent(/^anonymous$/);
    expect(account.lastSignOut).toEqual({
      server: "confirmed",
      intent: "resolved",
      cleanup: "completed",
      protection: "intent",
    });
    expect(await readIntent()).toBeUndefined();
  });

  it.each([
    ["a network failure", new ApiError(0, "NETWORK_ERROR", "offline")],
    ["a CSRF rejection", new ApiError(403, "INVALID_ORIGIN", "Invalid origin")],
    ["an unconfirmed body", new ApiError(200, "INVALID_RESPONSE", "Unexpected response.")],
  ])(
    "after %s: signed out on this device, server sign-out not confirmed, intent pending (OFF-OUT-3)",
    async (_label, error) => {
      await renderSignedIn();
      mockedSignOut.mockRejectedValueOnce(error);
      await act(() => latest.signOut());
      expect(probe()).toHaveTextContent(/^anonymous:sign-out-pending$/);
      expect(account.lastSignOut).toEqual({
        server: "not-confirmed",
        intent: "pending",
        cleanup: "completed",
        protection: "intent",
      });
      expect(await readIntent()).toMatchObject({ pending: true });
      expect(mockedSignOut).toHaveBeenCalledTimes(1); // no automatic retry
    },
  );

  it("an authenticated check that was still in flight never restores the signed-out session (OFF-OUT-4)", async () => {
    await renderSignedIn();
    const stale = deferred<typeof TEST_SESSION>();
    mockedGetSession.mockReturnValueOnce(stale.promise);
    act(() => {
      void latest.refresh();
    });
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(2));
    mockedSignOut.mockResolvedValueOnce(undefined);
    let signedOut!: Promise<void>;
    act(() => {
      signedOut = latest.signOut();
    });
    expect(probe()).toHaveTextContent(/^anonymous$/);

    await act(async () => {
      stale.resolve(TEST_SESSION);
      await signedOut;
    });
    expect(probe()).toHaveTextContent(/^anonymous$/);
  });

  it("is refused while an update holds the gate: nothing is started and the user stays signed in (DR-4)", async () => {
    await renderSignedIn();
    const { updateSafety } = await import("../pwa/updateSafety");
    const gate = updateSafety.tryAcquireGate();
    if (gate.kind !== "acquired") throw new Error(gate.kind);
    try {
      await act(async () => {
        await expect(latest.signOut()).rejects.toMatchObject({ reason: "updating" });
      });
      expect(probe()).toHaveTextContent(`authenticated:${TEST_USER.email}`);
      expect(account.signOutRefusal).toBe("updating");
      expect(mockedSignOut).not.toHaveBeenCalled();
      expect(await readIntent()).toBeUndefined();
    } finally {
      gate.gate.release();
    }
  });
});

describe("AuthProvider — cross-tab notices and visibility (OFF-LIFE-7)", () => {
  it("a lifecycle-ended notice withdraws signed-in state at once; only the re-check publishes again", async () => {
    mockedGetSession.mockResolvedValueOnce(TEST_SESSION);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^authenticated/));

    const recheck = deferred<null>();
    mockedGetSession.mockReturnValueOnce(recheck.promise);
    const other = new BroadcastChannel(NOTICE_CHANNEL);
    other.postMessage({ type: "lifecycle-ended" });
    await waitFor(() => expect(probe()).toHaveTextContent(/^loading/));
    await act(async () => {
      await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(2));
      recheck.resolve(null);
    });
    await waitFor(() => expect(probe()).toHaveTextContent(/^anonymous$/));
    other.close();
  });

  it("a notice alone never authorizes access: an anonymous tab is not signed in by it", async () => {
    mockedGetSession.mockResolvedValueOnce(null);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^anonymous$/));
    mockedGetSession.mockResolvedValueOnce(null);
    const other = new BroadcastChannel(NOTICE_CHANNEL);
    other.postMessage({ type: "lifecycle-changed" });
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(probe()).toHaveTextContent(/^anonymous$/));
    other.close();
  });

  it("regaining visibility re-checks a signed-in tab", async () => {
    mockedGetSession.mockResolvedValueOnce(TEST_SESSION);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^authenticated/));
    mockedGetSession.mockResolvedValueOnce(null);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(probe()).toHaveTextContent(/^anonymous$/));
  });
});

describe("AuthProvider — D-1: an obsolete 'not confirmed' warning after another tab resolves the sign-out", () => {
  async function failedSignOut() {
    mockedGetSession.mockResolvedValueOnce(TEST_SESSION);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^authenticated/));
    mockedSignOut.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    await act(() => latest.signOut());
    expect(account.lastSignOut).toMatchObject({ server: "not-confirmed", intent: "pending" });
    expect(probe()).toHaveTextContent(/^anonymous:sign-out-pending$/);
  }
  async function noticeAndCheck(expectedCalls: number) {
    const other = new BroadcastChannel(NOTICE_CHANNEL);
    other.postMessage({ type: "state-changed" });
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(expectedCalls));
    await waitFor(() => expect(probe()).not.toHaveTextContent(/checking/));
    other.close();
  }

  it("a notice while the intent is still pending keeps the warning (unresolved sign-out)", async () => {
    await failedSignOut();
    mockedGetSession.mockResolvedValue(TEST_SESSION); // the cookie is still valid
    await noticeAndCheck(2);
    expect(probe()).toHaveTextContent(/^anonymous:sign-out-pending$/);
    expect(account.lastSignOut).toMatchObject({ server: "not-confirmed", intent: "pending" });
  });

  it("an authoritative check that finds the intent resolved clears the warning without claiming confirmation", async () => {
    await failedSignOut();
    // INSTRUMENTED: another tab's validated confirmation removed the intent.
    const opened = await openOfflineStateDatabase();
    if (opened.kind !== "open") throw new Error(opened.kind);
    await opened.db.delete("state", "signout_intent");
    opened.db.close();
    mockedGetSession.mockResolvedValue(null);
    await noticeAndCheck(2);
    expect(probe()).toHaveTextContent(/^anonymous$/);
    expect(account.lastSignOut).toBeNull(); // cleared, not replaced by a confirmation
  });

  function stubSecurity(
    outcome: AccountSecurityContextValue["lastSignOut"],
    afterCheck: AccountState,
    storage: StorageStatus = "clean",
  ): AccountSecurity {
    let checks = 0;
    return {
      channel: { open: () => "open", close: () => {} },
      checkSession: vi.fn(() => {
        checks += 1;
        const state: AccountState =
          checks === 1
            ? {
                session: { status: "authenticated", user: TEST_USER },
                restriction: null,
                offline: "eligible",
              }
            : afterCheck;
        return Promise.resolve({ kind: "done" as const, state, followUp: false });
      }),
      signIn: vi.fn(),
      startSignOut: () => ({
        kind: "started",
        done: Promise.resolve({
          outcome: outcome!,
          state: {
            session: { status: "anonymous" },
            restriction: "sign-out-pending",
            offline: "none",
          },
        }),
      }),
      finishSigningOut: vi.fn(),
      blockLocally: () => {},
      coordinationUsable: () => true,
      inspectStorage: () => Promise.resolve(storage),
      retryCleanup: vi.fn(),
      recoverStorage: vi.fn(),
      deleteAllData: vi.fn(),
      snapshots: { clearView: () => {} } as unknown as AccountSecurity["snapshots"],
      onSessionCheckRequired: () => () => {},
    };
  }

  // 3c-2: the cleanup warning now comes from the DURABLE storage status, so an
  // obsolete server warning is cleared even when that sign-out's cleanup
  // failed, while the unresolved cleanup is still reported (combined warning).
  it("an obsolete server warning is cleared while the durable cleanup warning remains", async () => {
    const security = stubSecurity(
      { server: "not-confirmed", intent: "pending", cleanup: "failed" },
      { session: { status: "anonymous" }, restriction: null, offline: "none" },
      "failure-recorded",
    );
    render(
      <AuthProvider security={security}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(probe()).toHaveTextContent(/^authenticated/));
    await act(() => latest.signOut());
    expect(account.lastSignOut).toMatchObject({ server: "not-confirmed" });
    await act(() => latest.refresh());
    expect(account.lastSignOut).toBeNull();
    expect(account.storage).toBe("failure-recorded");
  });

  it.each([
    [
      "a check that still finds D22 (the intent cannot be shown resolved) keeps the warning",
      { server: "not-confirmed", intent: "pending", cleanup: "completed" } as const,
      { session: { status: "anonymous" }, restriction: "safety-lock", offline: "none" } as const,
    ],
  ])("%s", async (_label, outcome, afterCheck) => {
    const security = stubSecurity(outcome, afterCheck);
    render(
      <AuthProvider security={security}>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(probe()).toHaveTextContent(/^authenticated/));
    await act(() => latest.signOut());
    await act(() => latest.refresh());
    expect(security.checkSession).toHaveBeenCalledTimes(2);
    expect(account.lastSignOut).toEqual(outcome);
  });
});
