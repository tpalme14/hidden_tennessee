import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSession, resetPassword, signIn, signOut } from "../api/auth";
import { ApiError } from "../api/client";
import { AuthProvider } from "../auth/AuthProvider";
import { captureResetToken, clearResetToken, getResetToken } from "../auth/resetToken";
import { deferred } from "../auth/testFixtures";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { RESET_PASSWORD_MESSAGES, ResetPasswordPage } from "./ResetPasswordPage";

/**
 * M06-T02 Increment 3b-iii — choosing a new password as an online-only action
 * (OFF-UX-5): no reset request while the server is unreachable; the typed
 * passwords and the in-memory token are kept (never cleared or sent by a
 * connectivity change); the missing/invalid-token states are unchanged;
 * recovery submits nothing. Synthetic token and passwords only.
 */

vi.mock("../api/auth", () => ({
  getSession: vi.fn(),
  resetPassword: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const mockedReset = vi.mocked(resetPassword);
const TOKEN = "SyntheticToken24CharsXYZ";
const NEW_PASSWORD = "a synthetic new password";

function evidence(kind: RequestEvidence) {
  act(() => connectivity.reportOutcome(connectivity.beginRequest(), kind));
}
const browserEvent = (type: "online" | "offline") =>
  act(() => {
    window.dispatchEvent(new Event(type));
  });
const STATES: [string, () => void][] = [
  ["reachable", () => evidence("response")],
  [
    "unknown reachability",
    () => {
      evidence("network-failure");
      browserEvent("online");
    },
  ],
  ["a server problem", () => evidence("server-problem")],
  ["the browser's offline hint alone", () => browserEvent("offline")],
];

function captureToken() {
  captureResetToken({
    location: { pathname: "/reset-password", search: `?token=${TOKEN}`, hash: "" },
    history: { state: null, replaceState: () => {} },
  });
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/reset-password"]}>
      <AuthProvider>
        <Routes>
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/sign-in" element={<p data-testid="sign-in">sign in</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const newPassword = () => screen.getByLabelText("New password");
const confirmPassword = () => screen.getByLabelText("Confirm new password");
const submit = () => screen.getByRole("button", { name: /reset(ting)? password/i });
const form = () => submit().closest("form")!;

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(newPassword(), NEW_PASSWORD);
  await user.type(confirmPassword(), NEW_PASSWORD);
}

beforeEach(() => {
  clearResetToken();
  vi.mocked(getSession).mockReset().mockResolvedValue(null);
  mockedReset.mockReset();
  vi.mocked(signIn).mockReset();
  vi.mocked(signOut).mockReset();
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  clearResetToken();
  evidence("response");
  browserEvent("online");
});

describe("ResetPasswordPage — choosing a new password needs the server", () => {
  it.each(STATES)("submits normally with %s", async (_label, apply) => {
    captureToken();
    mockedReset.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();
    apply();
    await fill(user);
    await user.click(submit());
    expect(mockedReset).toHaveBeenCalledWith(TOKEN, NEW_PASSWORD);
  });

  it("while unreachable: click, Enter, and direct submission send nothing; passwords and the token are kept", async () => {
    captureToken();
    const user = userEvent.setup();
    renderPage();
    await fill(user);
    evidence("network-failure");
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    expect(submit()).toHaveAccessibleName("Reset password");
    expect(submit()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    expect(submit()).not.toHaveAttribute("data-pending");
    await user.click(submit());
    await user.type(confirmPassword(), "{Enter}");
    fireEvent.submit(form());
    act(() => form().requestSubmit());
    expect(mockedReset).not.toHaveBeenCalled();
    expect(newPassword()).toHaveValue(NEW_PASSWORD);
    expect(confirmPassword()).toHaveValue(NEW_PASSWORD);
    expect(getResetToken()).toBe(TOKEN);
  });

  it("existing validation still applies when available", async () => {
    captureToken();
    const user = userEvent.setup();
    renderPage();
    await user.type(newPassword(), NEW_PASSWORD);
    await user.type(confirmPassword(), "different value here");
    await user.click(submit());
    expect(confirmPassword()).toHaveAttribute("aria-invalid", "true");
    expect(mockedReset).not.toHaveBeenCalled();
  });

  it("without a token the page still explains the link is incomplete, with or without the server", () => {
    renderPage();
    evidence("network-failure");
    expect(screen.getByText(RESET_PASSWORD_MESSAGES.missing)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reset password/i })).toBeNull();
  });

  it("recovery submits nothing; an explicit submit then gets the existing invalid-token outcome (token forgotten)", async () => {
    captureToken();
    const user = userEvent.setup();
    renderPage();
    await fill(user);
    evidence("network-failure");
    browserEvent("offline");
    browserEvent("online"); // unreachable → unknown
    expect(mockedReset).not.toHaveBeenCalled();
    mockedReset.mockRejectedValueOnce(new ApiError(400, "INVALID_TOKEN", "x"));
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(RESET_PASSWORD_MESSAGES.invalid);
    expect(getResetToken()).toBeNull();
    expect(mockedReset).toHaveBeenCalledTimes(1);
  });

  it("an in-flight reset keeps its lock and data-pending through loss and recovery; a second submission is refused", async () => {
    captureToken();
    const pending = deferred<void>();
    mockedReset.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    renderPage();
    await fill(user);
    await user.click(submit());
    expect(submit()).toHaveAttribute("data-pending", "true");
    evidence("network-failure");
    expect(submit()).toHaveAttribute("data-pending", "true");
    evidence("response");
    expect(submit()).toHaveAttribute("data-pending", "true");
    act(() => form().requestSubmit());
    expect(mockedReset).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    expect(await screen.findByTestId("sign-in")).toBeInTheDocument();
    expect(mockedReset).toHaveBeenCalledTimes(1);
  });
});
