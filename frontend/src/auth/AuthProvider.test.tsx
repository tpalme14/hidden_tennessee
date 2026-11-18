import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "../api/client";
import { getSession, signOut } from "../api/auth";
import { AuthProvider } from "./AuthProvider";
import { useAuth, type AuthContextValue } from "./session";
import { TEST_SESSION, TEST_USER, deferred } from "./testFixtures";

/** M03-T03 Increment 2 — the session provider's four-state model, with the auth API module mocked. */

vi.mock("../api/auth", () => ({ getSession: vi.fn(), signOut: vi.fn() }));

const mockedGetSession = vi.mocked(getSession);
const mockedSignOut = vi.mocked(signOut);

let latest: AuthContextValue;

function Probe() {
  latest = useAuth();
  const { session, checking } = latest;
  return (
    <p data-testid="probe">
      {session.status}
      {session.status === "authenticated" ? `:${session.user.email}` : ""}
      {checking ? ":checking" : ""}
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

beforeEach(() => {
  mockedGetSession.mockReset();
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
    expect(mockedGetSession).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(null));
    expect(probe()).toHaveTextContent(/^anonymous$/);
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

  it("never reads or writes browser storage", async () => {
    const getItem = vi.spyOn(Storage.prototype, "getItem");
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    mockedSignOut.mockResolvedValue(undefined);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^authenticated/));
    await act(() => latest.signOut());

    expect(getItem).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
  });

  it("throws a clear error when useAuth is used outside the provider", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow("useAuth must be used inside <AuthProvider>");
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
      pending.resolve(null);
      await refreshed;
    });
    expect(probe()).toHaveTextContent(/^anonymous$/);
  });

  it("refresh never rejects, even when the check fails", async () => {
    mockedGetSession.mockResolvedValueOnce(null);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^anonymous$/));
    mockedGetSession.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    await expect(act(() => latest.refresh())).resolves.toBeUndefined();
    expect(probe()).toHaveTextContent(/^unavailable$/);
  });

  it("an older, slower check never overwrites a newer answer", async () => {
    const slow = deferred<typeof TEST_SESSION>();
    mockedGetSession.mockReturnValueOnce(slow.promise);
    renderProvider();

    mockedGetSession.mockResolvedValueOnce(null);
    await act(() => latest.refresh());
    expect(probe()).toHaveTextContent(/^anonymous$/);

    await act(async () => slow.resolve(TEST_SESSION));
    expect(probe()).toHaveTextContent(/^anonymous$/);
  });
});

describe("AuthProvider — sign-out", () => {
  async function renderSignedIn() {
    mockedGetSession.mockResolvedValueOnce(TEST_SESSION);
    renderProvider();
    await waitFor(() => expect(probe()).toHaveTextContent(/^authenticated/));
  }

  it("moves to anonymous only after the server confirms sign-out", async () => {
    await renderSignedIn();
    const pending = deferred<void>();
    mockedSignOut.mockReturnValueOnce(pending.promise);
    let signedOut!: Promise<void>;
    act(() => {
      signedOut = latest.signOut();
    });
    // Still signed in while the request is in flight.
    expect(probe()).toHaveTextContent(`authenticated:${TEST_USER.email}`);

    await act(async () => {
      pending.resolve();
      await signedOut;
    });
    expect(probe()).toHaveTextContent(/^anonymous$/);
    expect(mockedSignOut).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a network failure", new ApiError(0, "NETWORK_ERROR", "offline")],
    ["a CSRF rejection", new ApiError(403, "INVALID_ORIGIN", "Invalid origin")],
    ["an unconfirmed body", new ApiError(200, "INVALID_RESPONSE", "Unexpected response.")],
  ])("rejects and keeps the user signed in after %s", async (_label, error) => {
    await renderSignedIn();
    mockedSignOut.mockRejectedValueOnce(error);
    await act(async () => {
      await expect(latest.signOut()).rejects.toBe(error);
    });
    expect(probe()).toHaveTextContent(`authenticated:${TEST_USER.email}`);
    expect(latest.session).toEqual({ status: "authenticated", user: TEST_USER });
  });

  it("a confirmed sign-out discards a session check that was still in flight", async () => {
    await renderSignedIn();
    const stale = deferred<typeof TEST_SESSION>();
    mockedGetSession.mockReturnValueOnce(stale.promise);
    act(() => {
      void latest.refresh();
    });
    mockedSignOut.mockResolvedValueOnce(undefined);
    await act(() => latest.signOut());
    expect(probe()).toHaveTextContent(/^anonymous$/);

    await act(async () => stale.resolve(TEST_SESSION));
    expect(probe()).toHaveTextContent(/^anonymous$/);
  });
});
