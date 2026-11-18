import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useNavigate } from "react-router";
import App from "../App";
import { ApiError } from "../api/client";
import { getSession, resetPassword } from "../api/auth";
import { AuthProvider } from "./AuthProvider";
import { captureResetToken, clearResetToken, getResetToken } from "./resetToken";

/**
 * M03-T03 Increment 6 — the reset token's lifecycle across navigation, with
 * the real `App` routes and `ResetTokenGuard`, under React StrictMode (which
 * mounts, unmounts, and remounts components and re-runs effects in
 * development). The auth API module is mocked.
 */

vi.mock("../api/auth", () => ({
  getSession: vi.fn(),
  resetPassword: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  register: vi.fn(),
  requestPasswordReset: vi.fn(),
}));

const TOKEN = "LifecycleToken24CharsXYZ";
const INCOMPLETE =
  "This password reset link is incomplete. Request a new link to reset your password.";

let navigate: ReturnType<typeof useNavigate>;
function NavigateHandle() {
  navigate = useNavigate();
  return null;
}

function captureToken() {
  captureResetToken({
    location: { pathname: "/reset-password", search: `?token=${TOKEN}`, hash: "" },
    history: { state: null, replaceState: () => {} },
  });
}

function renderApp() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={["/reset-password"]}>
        <AuthProvider>
          <NavigateHandle />
          <App />
        </AuthProvider>
      </MemoryRouter>
    </StrictMode>,
  );
}

const newPasswordField = () => screen.queryByLabelText("New password");

beforeEach(() => {
  clearResetToken();
  vi.mocked(getSession).mockReset().mockResolvedValue(null);
  vi.mocked(resetPassword).mockReset();
});

afterEach(() => {
  expect(document.body.innerHTML).not.toContain(TOKEN);
});

describe("reset-token lifecycle across navigation", () => {
  it("arriving on /reset-password with a token shows the form and keeps the token through StrictMode's remount", async () => {
    captureToken();
    renderApp();
    expect(newPasswordField()).toBeInTheDocument();
    // StrictMode has already mounted, unmounted, and remounted the page and re-run the guard's effect.
    await act(async () => {});
    expect(getResetToken()).toBe(TOKEN);
    expect(newPasswordField()).toBeInTheDocument();
  });

  it("staying on the page (typing, re-rendering, a failed submission) keeps the token", async () => {
    const user = userEvent.setup({ delay: null });
    vi.mocked(resetPassword).mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    captureToken();
    renderApp();
    await user.type(screen.getByLabelText("New password"), "a brand new password");
    await user.type(screen.getByLabelText("Confirm new password"), "a brand new password");
    await user.click(screen.getByRole("button", { name: "Reset password" }));
    await screen.findByRole("alert");
    expect(getResetToken()).toBe(TOKEN);

    // A navigation that stays on /reset-password (e.g. a query change) keeps it too.
    act(() => navigate("/reset-password?step=2"));
    expect(getResetToken()).toBe(TOKEN);
  });

  it("navigating away clears the token; Back returns to the incomplete-link state, not the form", async () => {
    const user = userEvent.setup({ delay: null });
    captureToken();
    renderApp();
    expect(newPasswordField()).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Back to sign in" }));
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(getResetToken()).toBeNull();

    act(() => navigate(-1));
    expect(await screen.findByText(INCOMPLETE)).toBeInTheDocument();
    expect(newPasswordField()).not.toBeInTheDocument();
    expect(getResetToken()).toBeNull();
  });

  it("navigating to an unmatched route (no layout rendered) also clears it", async () => {
    captureToken();
    renderApp();
    act(() => navigate("/no-such-page"));
    await act(async () => {});
    expect(getResetToken()).toBeNull();

    act(() => navigate(-1));
    expect(await screen.findByText(INCOMPLETE)).toBeInTheDocument();
  });

  it("a successful reset still forgets the token and lands on sign-in with the notice", async () => {
    const user = userEvent.setup({ delay: null });
    vi.mocked(resetPassword).mockResolvedValue(undefined);
    captureToken();
    renderApp();
    await user.type(screen.getByLabelText("New password"), "a brand new password");
    await user.type(screen.getByLabelText("Confirm new password"), "a brand new password");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(
      await screen.findByText("Your password has been reset. Sign in with your new password."),
    ).toBeInTheDocument();
    expect(vi.mocked(resetPassword)).toHaveBeenCalledWith(TOKEN, "a brand new password");
    expect(getResetToken()).toBeNull();
  });

  it("an invalid token still shows the invalid-link alert and forgets the token", async () => {
    const user = userEvent.setup({ delay: null });
    vi.mocked(resetPassword).mockRejectedValue(new ApiError(400, "INVALID_TOKEN", "invalid"));
    captureToken();
    renderApp();
    await user.type(screen.getByLabelText("New password"), "a brand new password");
    await user.type(screen.getByLabelText("Confirm new password"), "a brand new password");
    await user.click(screen.getByRole("button", { name: "Reset password" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/invalid or has expired/);
    expect(getResetToken()).toBeNull();
  });
});
