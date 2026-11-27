import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getSession,
  register,
  requestPasswordReset,
  resetPassword,
  signIn,
  signOut,
} from "../api/auth";
import { ApiError } from "../api/client";
import { AuthProvider } from "../auth/AuthProvider";
import { captureResetToken, clearResetToken, getResetToken } from "../auth/resetToken";
import { TEST_SESSION, TEST_USER, deferred } from "../auth/testFixtures";
import { updateSafety, type ProtectedCategory } from "../pwa/updateSafety";
import { ForgotPasswordPage } from "./ForgotPasswordPage";
import { RegisterPage } from "./RegisterPage";
import { ResetPasswordPage } from "./ResetPasswordPage";
import { SignInPage } from "./SignInPage";

/**
 * M06-T02 Increment 4b-ii — authentication fields, the captured reset token,
 * and a completed reset registered as protected information. Presence only:
 * no credential, address, or token ever reaches the registry. Synthetic data;
 * the auth API is mocked; existing behavior (validation, credential clearing,
 * token handling, navigation) is unchanged.
 */

vi.mock("../api/auth", () => ({
  getSession: vi.fn(),
  register: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
}));

const EMAIL = "synthetic.user@example.test";
const PASSWORD = "synthetic password value";
const TOKEN = "SyntheticResetToken24Chr";

const categories = () => updateSafety.getSnapshot().protectedCategories;
const revision = () => updateSafety.getSnapshot().protectedRevision;
const snapshotText = () => JSON.stringify(updateSafety.getSnapshot());

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/" element={<p data-testid="home">home</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  clearResetToken();
  vi.mocked(getSession).mockReset().mockResolvedValue(null);
  for (const m of [register, signIn, signOut, requestPasswordReset, resetPassword]) {
    vi.mocked(m).mockReset();
  }
});
afterEach(() => {
  cleanup();
  clearResetToken();
  expect(categories()).toEqual([]);
});

describe("sign-in fields", () => {
  it("first input protects; edits are new revisions; a credential failure keeps the address protected; clearing removes it", async () => {
    renderAt("/sign-in");
    const email = screen.getByLabelText("Email address");
    const password = screen.getByLabelText("Password");
    expect(categories()).toEqual([]);
    fireEvent.change(email, { target: { value: EMAIL } });
    expect(categories()).toEqual(["sign-in"]);
    const r = revision();
    fireEvent.change(password, { target: { value: PASSWORD } });
    expect(revision()).toBeGreaterThan(r);
    expect(snapshotText()).not.toContain(EMAIL);
    expect(snapshotText()).not.toContain(PASSWORD);

    vi.mocked(signIn).mockRejectedValueOnce(new ApiError(401, "INVALID_CREDENTIALS", "x"));
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(password).toHaveValue(""); // existing credential clearing
    expect(categories()).toEqual(["sign-in"]); // the address is still entered
    fireEvent.change(email, { target: { value: "" } });
    expect(categories()).toEqual([]);
  });

  it("a successful sign-in navigates away and leaves no registration", async () => {
    renderAt("/sign-in");
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: EMAIL } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
    vi.mocked(signIn).mockResolvedValueOnce(TEST_USER);
    vi.mocked(getSession).mockResolvedValue(TEST_SESSION);
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByTestId("home")).toBeInTheDocument();
    expect(categories()).toEqual([]);
  });
});

describe("registration fields", () => {
  it("protected while any field is filled; clearing all removes it; unmount leaves none", () => {
    const view = renderAt("/register");
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: EMAIL } });
    expect(categories()).toEqual(["registration"]);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: "" } });
    expect(categories()).toEqual(["registration"]);
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "" } });
    expect(categories()).toEqual([]);
    fireEvent.change(screen.getByLabelText("Confirm password"), { target: { value: "x" } });
    expect(snapshotText()).not.toContain(EMAIL);
    view.unmount();
    expect(categories()).toEqual([]);
  });
});

describe("forgot-password address", () => {
  it("protected while entered; the confirmation (sent) ends it", async () => {
    renderAt("/forgot-password");
    fireEvent.change(screen.getByLabelText("Email address"), { target: { value: EMAIL } });
    expect(categories()).toEqual(["password-reset-request"]);
    expect(snapshotText()).not.toContain(EMAIL);
    vi.mocked(requestPasswordReset).mockResolvedValueOnce(undefined);
    await userEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(categories()).toEqual([]);
  });
});

describe("reset password: fields, the captured link, and the completed reset", () => {
  function captureToken() {
    captureResetToken({
      location: { pathname: "/reset-password", search: `?token=${TOKEN}`, hash: "" },
      history: { state: null, replaceState: () => {} },
    });
  }

  it("the captured link is protected from the first render; without a token nothing is", () => {
    renderAt("/reset-password");
    expect(categories()).toEqual([]);
    cleanup();
    captureToken();
    renderAt("/reset-password");
    expect(categories()).toEqual(["reset-link"]);
    expect(snapshotText()).not.toContain(TOKEN);
  });

  it("on success the completed reset is protected BEFORE the link's protection ends, until the page is left", async () => {
    captureToken();
    renderAt("/reset-password");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: PASSWORD },
    });
    expect([...categories()].sort()).toEqual(["new-password", "reset-link"]);

    // Every registry change from here on is recorded: there must be no instant
    // without either the link or the completed reset protected.
    const seen: (readonly ProtectedCategory[])[] = [];
    const unsubscribe = updateSafety.subscribe(() => seen.push(categories()));
    const session = deferred<null>();
    vi.mocked(resetPassword).mockResolvedValueOnce(undefined);
    vi.mocked(getSession).mockReturnValueOnce(session.promise); // hold the session re-check
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(getResetToken()).toBeNull(); // existing token clearing
    expect(categories()).toContain("password-reset-complete");
    expect(categories()).not.toContain("reset-link");
    for (const state of seen) {
      expect(
        state.includes("reset-link") || state.includes("password-reset-complete"),
        `unprotected instant: ${JSON.stringify(state)}`,
      ).toBe(true);
    }
    unsubscribe();

    await act(async () => session.resolve(null));
    // Navigated to sign-in: the reset page is left, so its registrations end.
    expect(await screen.findByRole("region", { name: "Sign in" })).toBeInTheDocument();
    expect(categories()).toEqual([]);
  });

  it("a rejected link ends the link's protection; nothing about a completed reset is registered", async () => {
    captureToken();
    renderAt("/reset-password");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: PASSWORD },
    });
    vi.mocked(resetPassword).mockRejectedValueOnce(new ApiError(400, "INVALID_TOKEN", "x"));
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(categories()).toEqual([]);
  });

  it("a failed reset (server error) keeps the link and the fields protected", async () => {
    captureToken();
    renderAt("/reset-password");
    fireEvent.change(screen.getByLabelText("New password"), { target: { value: PASSWORD } });
    fireEvent.change(screen.getByLabelText("Confirm new password"), {
      target: { value: PASSWORD },
    });
    vi.mocked(resetPassword).mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x"));
    await userEvent.click(screen.getByRole("button", { name: "Reset password" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect([...categories()].sort()).toEqual(["new-password", "reset-link"]);
  });
});
