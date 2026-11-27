import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ApiError } from "../api/client";
import { getSession, signOut } from "../api/auth";
import { AuthProvider } from "../auth/AuthProvider";
import {
  AccountSecurityContext,
  createInertSnapshots,
  RESTRICTION_MESSAGES,
  type AccountSecurityContextValue,
} from "../auth/accountSecurity";
import { AuthContext, type AuthContextValue } from "../auth/session";
import { openOfflineDataDatabase, openOfflineStateDatabase } from "../offline/db";
import { AccountNav } from "./AccountNav";
import { SAFETY_LOCK_KEY } from "../offline/safetyLock";
import type { FakeLockManager } from "../offline/testSupport";
import { updateSafety } from "../pwa/updateSafety";
import { TEST_SESSION, TEST_USER, deferred } from "../auth/testFixtures";
import { AppLayout } from "./AppLayout";

/**
 * M03-T03 Increment 2 — the shell's account area for each session state,
 * sign-out success and failure, retry, focus handling, and keyboard use.
 * The real `AuthProvider` runs; only the auth API module is mocked (with the
 * test setup's Web Locks and IndexedDB stand-ins since M06-T03 3c-1a).
 */

vi.mock("../api/auth", () => ({ getSession: vi.fn(), signOut: vi.fn() }));

const mockedGetSession = vi.mocked(getSession);
const mockedSignOut = vi.mocked(signOut);

function renderShell() {
  return render(
    <MemoryRouter>
      <AuthProvider>
        <AppLayout />
      </AuthProvider>
    </MemoryRouter>,
  );
}

const accountNav = () => screen.getByRole("navigation", { name: "Account" });

beforeEach(() => {
  mockedGetSession.mockReset();
  mockedSignOut.mockReset();
});

describe("AccountNav — session states", () => {
  it("loading: a busy, empty account region — no links, no text, no notice", () => {
    mockedGetSession.mockReturnValue(deferred<null>().promise);
    renderShell();

    expect(accountNav()).toHaveAttribute("aria-busy", "true");
    expect(accountNav()).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // The primary navigation is unaffected.
    expect(screen.getByRole("link", { name: "Discover" })).toHaveAttribute("href", "/");
  });

  it("anonymous: Sign in and Register links, nothing else", async () => {
    mockedGetSession.mockResolvedValue(null);
    renderShell();

    await screen.findByRole("link", { name: "Sign in" });
    const nav = accountNav(); // re-queried: the loading-state element is replaced
    expect(within(nav).getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(within(nav).getByRole("link", { name: "Register" })).toHaveAttribute(
      "href",
      "/register",
    );
    expect(nav).not.toHaveAttribute("aria-busy");
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("unavailable: the same links plus a polite notice with Retry", async () => {
    mockedGetSession.mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "offline"));
    renderShell();

    expect(await screen.findByRole("status")).toHaveTextContent(
      "Couldn't check whether you're signed in.",
    );
    expect(within(accountNav()).getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(within(accountNav()).getByRole("link", { name: "Register" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /sign out/i })).not.toBeInTheDocument();
    // No error detail leaks into the account area. (Since M06-T03 3e the
    // installation guidance legitimately mentions "Save for offline" (Q5).)
    expect(within(accountNav().parentElement!).queryByText(/offline|NETWORK_ERROR/)).toBeNull();
  });

  it("authenticated: the account address and Sign out, no Sign in or Register", async () => {
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    renderShell();

    await screen.findByText(TEST_USER.email);
    const nav = accountNav(); // re-queried: the loading-state element is replaced
    expect(within(nav).getByText(TEST_USER.email)).toBeInTheDocument();
    expect(nav).toHaveTextContent(`Signed in as ${TEST_USER.email}`);
    expect(within(nav).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Register" })).not.toBeInTheDocument();
  });
});

describe("AccountNav — retry", () => {
  it("Retry re-checks, shows progress, and moves focus to the resolved state's first control", async () => {
    const user = userEvent.setup();
    mockedGetSession.mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "down"));
    renderShell();
    const retry = await screen.findByRole("button", { name: "Retry" });

    const pending = deferred<null>();
    mockedGetSession.mockReturnValueOnce(pending.promise);
    await user.click(retry);

    expect(screen.getByRole("status")).toHaveTextContent("Checking whether you're signed in…");
    expect(retry).toHaveAttribute("aria-disabled", "true");
    await user.click(retry); // ignored while the check runs
    expect(mockedGetSession).toHaveBeenCalledTimes(2);

    pending.resolve(null);
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
    // Focus moves in a passive effect that can run after the DOM change above.
    await waitFor(() => expect(screen.getByRole("link", { name: "Sign in" })).toHaveFocus());
  });

  it("Retry that finds a session shows the signed-in UI with focus on Sign out", async () => {
    const user = userEvent.setup();
    mockedGetSession.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    renderShell();
    const retry = await screen.findByRole("button", { name: "Retry" });

    mockedGetSession.mockResolvedValueOnce(TEST_SESSION);
    await user.click(retry);
    await waitFor(() => expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus());
  });

  it("a Retry that fails again keeps the notice and the focus on Retry", async () => {
    const user = userEvent.setup();
    mockedGetSession.mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "offline"));
    renderShell();
    const retry = await screen.findByRole("button", { name: "Retry" });
    await user.click(retry);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Couldn't check whether you're signed in.",
      ),
    );
    expect(mockedGetSession).toHaveBeenCalledTimes(2);
    expect(retry).toHaveFocus();
    expect(retry).toHaveAttribute("aria-disabled", "false");
  });
});

describe("AccountNav — sign-out", () => {
  async function renderSignedIn() {
    mockedGetSession.mockResolvedValueOnce(TEST_SESSION).mockResolvedValue(null);
    renderShell();
    return screen.findByRole("button", { name: "Sign out" });
  }

  // M06-T03 3c-1a (Specification 6 OFF-OUT-1, OFF-OUT-3, OFF-OUT-5): these
  // replace the M03 expectations that a failed sign-out keeps the user signed
  // in. Sign-out now signs out on this device at once; server confirmation
  // and local cleanup are reported separately.
  it("success: signed out on this device at once, then the server confirmation, with focus on Sign in", async () => {
    const user = userEvent.setup();
    const button = await renderSignedIn();
    const pending = deferred<void>();
    mockedSignOut.mockReturnValueOnce(pending.promise);

    await user.click(button);
    const signIn = await screen.findByRole("link", { name: "Sign in" });
    expect(screen.queryByText(TEST_USER.email)).not.toBeInTheDocument();
    expect(screen.getByText("Signed out on this device. Finishing sign-out…")).toBeInTheDocument();

    pending.resolve();
    const status = await screen.findByText("You're signed out. The server confirmed the sign-out.");
    expect(status.closest("[role=status]")).not.toBeNull();
    expect(
      screen.getByText("Offline copies saved on this device were removed."),
    ).toBeInTheDocument();
    await waitFor(() => expect(signIn).toHaveFocus());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish signing out" })).not.toBeInTheDocument();
    expect(mockedSignOut).toHaveBeenCalledTimes(1);
  });

  it("failure: signed out on this device; an alert says the server sign-out isn't confirmed, with the cleanup status and Finish signing out", async () => {
    const user = userEvent.setup();
    const button = await renderSignedIn();
    mockedSignOut.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));

    await user.click(button);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "You're signed out on this device, but the server sign-out isn't confirmed. Your browser's existing sign-in may still be valid.",
    );
    expect(alert).toHaveTextContent("Offline copies saved on this device were removed.");
    expect(alert).not.toHaveTextContent(/offline"|NETWORK_ERROR/);
    expect(screen.queryByText(TEST_USER.email)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();

    // Finish signing out (OFF-OUT-5): a validated confirmation resolves it.
    mockedSignOut.mockResolvedValueOnce(undefined);
    await user.click(screen.getByRole("button", { name: "Finish signing out" }));
    expect(
      await screen.findByText("You're signed out. The server confirmed the sign-out."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish signing out" })).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockedSignOut).toHaveBeenCalledTimes(2);
  });

  it("a failed Finish signing out keeps the alert and the action; nothing is retried automatically", async () => {
    const user = userEvent.setup();
    const button = await renderSignedIn();
    mockedSignOut.mockRejectedValue(new ApiError(503, "SERVICE_UNAVAILABLE", "down"));

    await user.click(button);
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: "Finish signing out" }));
    await waitFor(() => expect(mockedSignOut).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "the server sign-out isn't confirmed",
    );
    // M06-T03 3c-1 correction: the operation completes after its request
    // (completion, then the restriction read); wait for the action to return
    // rather than expecting it at once.
    expect(await screen.findByRole("button", { name: "Finish signing out" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    // Still signed out on this device.
    expect(screen.getByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    // Nothing is retried automatically: once every coordinated operation has
    // settled (no lock held or pending, no update-safety hold), still two requests.
    const locks = navigator.locks as unknown as FakeLockManager;
    await waitFor(() => {
      expect(locks.snapshot()).toEqual({ held: [], pending: [] });
      expect(updateSafety.getSnapshot().operationHolds).toBe(0);
    });
    expect(mockedSignOut).toHaveBeenCalledTimes(2);
  });

  it("works from the keyboard alone", async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    mockedSignOut.mockResolvedValueOnce(undefined);

    // Skip link → Discover → My Favorites → My Trips (signed in only; M03-T06 K6,
    // M05-T06 Increment 2) → Saved for offline (M06-T03 3e) → Sign out.
    await user.tab();
    await user.tab();
    expect(screen.getByRole("link", { name: "Discover" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "My Favorites" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "My Trips" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Saved for offline" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Register" })).toHaveFocus();
  });
});

describe("AccountNav — offline security restrictions (M06-T03 3c-1a)", () => {
  it("without usable Web Locks: the browser limitation is explained and no session is requested (AC-36)", async () => {
    delete (navigator as { locks?: unknown }).locks;
    renderShell();
    expect(
      await screen.findByText(RESTRICTION_MESSAGES["coordination-unavailable"]),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finish signing out" })).not.toBeInTheDocument();
    expect(mockedGetSession).not.toHaveBeenCalled();
  });

  it("with D22 present: the reason and Finish signing out, which never clears D22 (U1)", async () => {
    const user = userEvent.setup();
    localStorage.setItem(SAFETY_LOCK_KEY, "true");
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    mockedSignOut.mockResolvedValue(undefined);
    renderShell();
    expect(await screen.findByText(RESTRICTION_MESSAGES["safety-lock"])).toBeInTheDocument();
    expect(screen.queryByText(TEST_USER.email)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Finish signing out" }));
    expect(
      await screen.findByText("You're signed out. The server confirmed the sign-out."),
    ).toBeInTheDocument();
    expect(screen.getByText(RESTRICTION_MESSAGES["safety-lock"])).toBeInTheDocument();
    expect(localStorage.getItem(SAFETY_LOCK_KEY)).toBe("true");
  });
});

describe("AccountNav — durable cleanup status and the recovery link (M06-T03 3c-2)", () => {
  const intent = {
    key: "signout_intent",
    schema_version: 1,
    pending: true,
    created_at: "2026-11-25T09:00:00.000Z",
  };
  async function seedIntent() {
    const opened = await openOfflineStateDatabase();
    if (opened.kind !== "open") throw new Error(opened.kind);
    await opened.db.put("state", intent);
    opened.db.close();
  }
  async function seedResidual() {
    const opened = await openOfflineDataDatabase();
    if (opened.kind !== "open") throw new Error(opened.kind);
    await (opened.db as unknown as { put(s: string, v: unknown): Promise<unknown> }).put(
      "landmarks",
      {
        schema_version: 1,
        account_id: TEST_USER.id,
        lifecycle_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        revision: 1,
        landmark_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
        status: "unavailable",
        saved_at: "2026-11-25T09:00:00.000Z",
        unavailable_recorded_at: "2026-11-25T09:00:00.000Z",
      },
    );
    opened.db.close();
  }

  it("after a reload with a pending sign-out: the cleanup status, Finish signing out, and the link (AC-6)", async () => {
    await seedIntent();
    mockedGetSession.mockResolvedValue(TEST_SESSION); // the cookie is still valid
    renderShell();
    expect(
      await screen.findByText("Offline copies saved on this device were removed."),
    ).toBeInTheDocument();
    expect(screen.getByText(RESTRICTION_MESSAGES["sign-out-pending"])).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish signing out" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Offline data on this device" })).toHaveAttribute(
      "href",
      "/offline-data",
    );
  });

  it("after a reload with records that couldn't be removed: the unresolved cleanup warning (AC-6, AC-10)", async () => {
    await seedIntent();
    await seedResidual();
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    renderShell();
    expect(
      await screen.findByText(
        "Some offline copies on this device couldn't be removed. They stay locked and can't be opened.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Offline copies saved on this device were removed.")).toBeNull();
    expect(screen.getByRole("link", { name: "Offline data on this device" })).toBeInTheDocument();
  });

  function renderWith(account: Partial<AccountSecurityContextValue>) {
    const auth: AuthContextValue = {
      session: { status: "anonymous" },
      checking: false,
      refresh: vi.fn(() => Promise.resolve()),
      signOut: vi.fn(() => Promise.resolve()),
    };
    render(
      <MemoryRouter>
        <AuthContext.Provider value={auth}>
          <AccountSecurityContext.Provider
            value={{
              restriction: null,
              offline: "none",
              lastSignOut: null,
              signOutRefusal: null,
              signIn: vi.fn(),
              finishSigningOut: vi.fn(),
              storage: "clean",
              retryCleanup: vi.fn(),
              recoverStorage: vi.fn(),
              deleteAllData: vi.fn(),
              snapshots: createInertSnapshots(),
              ...account,
            }}
          >
            <AccountNav />
          </AccountSecurityContext.Provider>
        </AuthContext.Provider>
      </MemoryRouter>,
    );
  }

  it("with no obsolete server warning, an unresolved cleanup is still reported (combined warning)", () => {
    renderWith({ storage: "failure-recorded" });
    expect(
      screen.getByText(
        "Some offline copies on this device couldn't be removed. They stay locked and can't be opened.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/server sign-out isn't confirmed/)).toBeNull();
    expect(screen.getByRole("link", { name: "Offline data on this device" })).toBeInTheDocument();
  });

  it("discloses when durable protection could not be confirmed (AC-32)", () => {
    renderWith({
      lastSignOut: {
        server: "confirmed", // announced as an alert even when the server confirmed
        intent: "not-recorded",
        cleanup: "not-run",
        protection: "memory-only",
      },
      storage: "unknown",
    });
    expect(screen.getByRole("alert")).toHaveTextContent(
      "protection after this page is closed or reloaded could not be confirmed",
    );
  });

  it("shows no recovery link when nothing needs attention", () => {
    renderWith({ storage: "clean" });
    expect(screen.queryByRole("link", { name: "Offline data on this device" })).toBeNull();
  });
});
