import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { ApiError } from "../api/client";
import { getSession, resetPassword, signIn, signOut } from "../api/auth";
import { AuthProvider } from "../auth/AuthProvider";
import { captureResetToken, clearResetToken, getResetToken } from "../auth/resetToken";
import { TEST_SESSION, deferred } from "../auth/testFixtures";
import { ResetPasswordPage, RESET_PASSWORD_MESSAGES } from "./ResetPasswordPage";
import { SignInPage, SIGN_IN_MESSAGES } from "./SignInPage";

/**
 * M03-T03 Increment 5 — the reset-completion page. The token is put in memory
 * exactly as `main.tsx` does (via `captureResetToken`); the auth API module is
 * mocked. Every test also checks that the token never reaches the DOM.
 */

vi.mock("../api/auth", () => ({
  getSession: vi.fn(),
  resetPassword: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const mockedGetSession = vi.mocked(getSession);
const mockedReset = vi.mocked(resetPassword);

const TOKEN = "TokenValue24CharactersXY";
const NEW_PASSWORD = "a brand new password";

function captureToken(token = TOKEN) {
  captureResetToken({
    location: { pathname: "/reset-password", search: `?token=${token}`, hash: "" },
    history: { state: null, replaceState: () => {} },
  });
}

function renderAt(path = "/reset-password") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/forgot-password" element={<p data-testid="forgot">forgot</p>} />
          <Route path="/" element={<p data-testid="home">home</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const newPassword = () => screen.getByLabelText("New password");
const confirmPassword = () => screen.getByLabelText("Confirm new password");
const submitButton = () => screen.getByRole("button", { name: /reset(ting)? password/i });

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  pw = NEW_PASSWORD,
  confirm = pw,
) {
  if (pw) await user.type(newPassword(), pw);
  if (confirm) await user.type(confirmPassword(), confirm);
  await user.click(submitButton());
}

let consoleSpies: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  clearResetToken();
  mockedGetSession.mockReset().mockResolvedValue(null);
  mockedReset.mockReset();
  vi.mocked(signIn).mockReset();
  vi.mocked(signOut).mockReset();
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
    vi.spyOn(console, level),
  );
});

afterEach(() => {
  // The token never reaches the page, the console, or storage.
  expect(document.body.innerHTML).not.toContain(TOKEN);
  for (const spy of consoleSpies) {
    for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN);
  }
  expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
  expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
  expect(document.cookie).not.toContain(TOKEN);
  vi.restoreAllMocks();
});

describe("ResetPasswordPage — link states", () => {
  it("without a token: explains the link is incomplete and offers a new one", () => {
    renderAt();
    expect(screen.getByText(RESET_PASSWORD_MESSAGES.missing)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("arriving from the library's error redirect (?error=INVALID_TOKEN): invalid-link message", () => {
    renderAt("/reset-password?error=INVALID_TOKEN");
    expect(screen.getByRole("alert")).toHaveTextContent(RESET_PASSWORD_MESSAGES.invalid);
    expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  });

  it("with a captured token: the form, labelled, with the policy hint", () => {
    captureToken();
    renderAt();
    expect(screen.getByRole("heading", { name: "Choose a new password" })).toBeInTheDocument();
    expect(newPassword()).toHaveAttribute("autocomplete", "new-password");
    expect(newPassword()).toHaveAccessibleDescription("Use 8 to 128 characters.");
    expect(confirmPassword()).toHaveAttribute("type", "password");
    expect(screen.getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });

  it("does not redirect a signed-in visitor away", async () => {
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    captureToken();
    renderAt();
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(newPassword()).toBeInTheDocument();
  });
});

describe("ResetPasswordPage — validation", () => {
  it.each([
    ["", "", "newPassword", "Use at least 8 characters."],
    ["short", "short", "newPassword", "Use at least 8 characters."],
    [NEW_PASSWORD, "different password", "confirmPassword", "The passwords do not match."],
  ])(
    "rejects %j / %j with a field error and focus, sending nothing",
    async (pw, confirm, field, message) => {
      const user = userEvent.setup({ delay: null });
      captureToken();
      renderAt();
      await fillAndSubmit(user, pw, confirm);
      const input = field === "newPassword" ? newPassword() : confirmPassword();
      expect(input).toHaveAttribute("aria-invalid", "true");
      expect(input).toHaveAccessibleDescription(expect.stringContaining(message));
      expect(input).toHaveFocus();
      expect(mockedReset).not.toHaveBeenCalled();
    },
  );
});

describe("ResetPasswordPage — submission", () => {
  it("success: token sent only to the wrapper's body, forgotten, session re-checked, then sign-in with a notice", async () => {
    const user = userEvent.setup({ delay: null });
    captureToken();
    renderAt();
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(1));

    const pending = deferred<void>();
    mockedReset.mockReturnValue(pending.promise);
    await fillAndSubmit(user);
    expect(mockedReset).toHaveBeenCalledWith(TOKEN, NEW_PASSWORD);
    expect(submitButton()).toHaveTextContent("Resetting password…");
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    await user.click(submitButton());
    expect(mockedReset).toHaveBeenCalledTimes(1);

    pending.resolve();
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(SIGN_IN_MESSAGES.passwordReset);
    // A reset revokes every session, so the provider re-checked with the server.
    expect(mockedGetSession).toHaveBeenCalledTimes(2);
    expect(getResetToken()).toBeNull();
  });

  it.each([
    ["an invalid token", new ApiError(400, "INVALID_TOKEN", "invalid token")],
    ["an expired token", new ApiError(400, "INVALID_TOKEN", "expired")],
    ["an already-used token", new ApiError(400, "INVALID_TOKEN", "used")],
  ])(
    "%s: the form is replaced by a focused invalid-link alert and the token is forgotten",
    async (_label, error) => {
      const user = userEvent.setup({ delay: null });
      mockedReset.mockRejectedValue(error);
      captureToken();
      renderAt();
      await fillAndSubmit(user);

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(RESET_PASSWORD_MESSAGES.invalid);
      expect(alert).toHaveFocus();
      expect(screen.queryByText(error.message)).not.toBeInTheDocument();
      expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
      expect(getResetToken()).toBeNull();
      expect(
        within(screen.getByRole("region", { name: "Choose a new password" })).getByRole("link", {
          name: "Request a new reset link",
        }),
      ).toBeInTheDocument();
    },
  );

  it.each([
    ["PASSWORD_TOO_SHORT", "Use at least 8 characters."],
    ["PASSWORD_TOO_LONG", "Use at most 128 characters."],
  ])("a server %s becomes a field error and keeps the token", async (code, message) => {
    const user = userEvent.setup({ delay: null });
    mockedReset.mockRejectedValue(new ApiError(400, code, "x"));
    captureToken();
    renderAt();
    await fillAndSubmit(user);
    await waitFor(() => expect(newPassword()).toHaveAttribute("aria-invalid", "true"));
    expect(newPassword()).toHaveAccessibleDescription(expect.stringContaining(message));
    expect(newPassword()).toHaveFocus();
    expect(getResetToken()).toBe(TOKEN);
  });

  it.each([
    [new ApiError(0, "NETWORK_ERROR", "x"), RESET_PASSWORD_MESSAGES.network],
    [
      new ApiError(429, "RATE_LIMITED", "x", 300),
      "Too many attempts. Please wait 5 minutes and try again.",
    ],
    [new ApiError(503, "SERVICE_UNAVAILABLE", "x"), RESET_PASSWORD_MESSAGES.generic],
    [new ApiError(403, "INVALID_ORIGIN", "x"), RESET_PASSWORD_MESSAGES.generic],
    [new Error("boom"), RESET_PASSWORD_MESSAGES.generic],
  ])(
    "failure %# keeps the form and the token, with a safe alert, and can be retried",
    async (error, message) => {
      const user = userEvent.setup({ delay: null });
      mockedReset.mockRejectedValueOnce(error);
      captureToken();
      renderAt();
      await fillAndSubmit(user);
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
      expect(getResetToken()).toBe(TOKEN);
      expect(submitButton()).toHaveAttribute("aria-disabled", "false");

      mockedReset.mockResolvedValueOnce(undefined);
      await user.click(submitButton());
      expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
      expect(mockedReset).toHaveBeenLastCalledWith(TOKEN, NEW_PASSWORD);
    },
  );
});

describe("ResetPasswordPage — keyboard", () => {
  it("can be completed with the keyboard alone", async () => {
    const user = userEvent.setup({ delay: null });
    mockedReset.mockResolvedValue(undefined);
    captureToken();
    renderAt();
    await user.tab();
    expect(newPassword()).toHaveFocus();
    await user.keyboard(NEW_PASSWORD);
    await user.tab();
    expect(confirmPassword()).toHaveFocus();
    await user.keyboard(NEW_PASSWORD);
    await user.tab();
    expect(submitButton()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
  });
});
