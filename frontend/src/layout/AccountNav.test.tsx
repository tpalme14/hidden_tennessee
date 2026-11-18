import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { ApiError } from "../api/client";
import { getSession, signOut } from "../api/auth";
import { AuthProvider } from "../auth/AuthProvider";
import { TEST_SESSION, TEST_USER, deferred } from "../auth/testFixtures";
import { AppLayout } from "./AppLayout";

/**
 * M03-T03 Increment 2 — the shell's account area for each session state,
 * sign-out success and failure, retry, focus handling, and keyboard use.
 * The real `AuthProvider` runs; only the auth API module is mocked.
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
    // No error detail leaks into the UI.
    expect(screen.queryByText(/offline|NETWORK_ERROR/)).not.toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveFocus();
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
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    renderShell();
    return screen.findByRole("button", { name: "Sign out" });
  }

  it("success: stays signed in until the server confirms, then shows Sign in with focus on it", async () => {
    const user = userEvent.setup();
    const button = await renderSignedIn();
    const pending = deferred<void>();
    mockedSignOut.mockReturnValueOnce(pending.promise);

    await user.click(button);
    expect(button).toHaveTextContent("Signing out…");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText(TEST_USER.email)).toBeInTheDocument();
    await user.click(button); // a second activation while pending sends nothing
    expect(mockedSignOut).toHaveBeenCalledTimes(1);

    pending.resolve();
    const signIn = await screen.findByRole("link", { name: "Sign in" });
    expect(signIn).toHaveFocus();
    expect(screen.queryByText(TEST_USER.email)).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // Sign-out never re-reads the session to decide the outcome.
    expect(mockedGetSession).toHaveBeenCalledTimes(1);
  });

  it("failure: keeps the signed-in UI and shows an alert; retrying from the alert can then succeed", async () => {
    const user = userEvent.setup();
    const button = await renderSignedIn();
    mockedSignOut.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));

    await user.click(button);
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Sign-out didn't complete. You're still signed in.");
    expect(alert).not.toHaveTextContent(/offline|NETWORK_ERROR/);
    expect(screen.getByText(TEST_USER.email)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveAttribute(
      "aria-disabled",
      "false",
    );
    expect(screen.queryByRole("link", { name: "Sign in" })).not.toBeInTheDocument();

    mockedSignOut.mockResolvedValueOnce(undefined);
    await user.click(within(alert).getByRole("button", { name: "Try signing out again" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveFocus();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(mockedSignOut).toHaveBeenCalledTimes(2);
  });

  it("a second failure re-announces the alert", async () => {
    const user = userEvent.setup();
    const button = await renderSignedIn();
    mockedSignOut.mockRejectedValue(new ApiError(503, "SERVICE_UNAVAILABLE", "down"));

    await user.click(button);
    await screen.findByRole("alert");
    const pending = deferred<void>();
    mockedSignOut.mockReturnValueOnce(pending.promise);
    await user.click(screen.getByRole("button", { name: "Sign out" }));
    // The old alert is cleared while the new attempt runs ...
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    pending.reject(new ApiError(503, "SERVICE_UNAVAILABLE", "down"));
    // ... and a fresh one appears when it fails.
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign-out didn't complete.");
    expect(screen.getByText(TEST_USER.email)).toBeInTheDocument();
  });

  it("works from the keyboard alone", async () => {
    const user = userEvent.setup();
    await renderSignedIn();
    mockedSignOut.mockResolvedValueOnce(undefined);

    // Skip link → Discover → Sign out.
    await user.tab();
    await user.tab();
    expect(screen.getByRole("link", { name: "Discover" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Sign out" })).toHaveFocus();
    await user.keyboard("{Enter}");

    expect(await screen.findByRole("link", { name: "Sign in" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Register" })).toHaveFocus();
  });
});
