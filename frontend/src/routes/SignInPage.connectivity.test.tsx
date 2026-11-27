import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSession, signIn, signOut } from "../api/auth";
import { ApiError } from "../api/client";
import { AuthProvider } from "../auth/AuthProvider";
import { TEST_SESSION, TEST_USER, deferred } from "../auth/testFixtures";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { SIGN_IN_MESSAGES, SignInPage } from "./SignInPage";

/**
 * M06-T02 Increment 3b-iii — sign-in submission as an online-only action
 * (OFF-UX-5). The form's own submit path is refused while the server is
 * unreachable (no credentials are sent); typing, links, and existing messages
 * are unaffected; recovery submits nothing; the existing submission lock and
 * the presentation-only `data-pending` marker follow the real pending state.
 * Synthetic credentials only.
 */

vi.mock("../api/auth", () => ({
  getSession: vi.fn(),
  register: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const mockedGetSession = vi.mocked(getSession);
const mockedSignIn = vi.mocked(signIn);
const EMAIL = "hiker@example.test";
const PASSWORD = "synthetic password value";

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

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/sign-in"]}>
      <AuthProvider>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/" element={<p data-testid="home">home</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const email = () => screen.getByLabelText("Email address");
const password = () => screen.getByLabelText("Password");
const submit = () => screen.getByRole("button", { name: /^sign(ing)? in/i });
const form = () => submit().closest("form")!;

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(email(), EMAIL);
  await user.type(password(), PASSWORD);
}

beforeEach(() => {
  mockedGetSession.mockReset().mockResolvedValue(null);
  mockedSignIn.mockReset();
  vi.mocked(signOut).mockReset();
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("SignInPage — signing in needs the server", () => {
  it.each(STATES)("signs in normally with %s", async (_label, apply) => {
    mockedSignIn.mockResolvedValueOnce(TEST_USER);
    const user = userEvent.setup();
    renderPage();
    apply();
    await fill(user);
    expect(submit()).not.toHaveAttribute("aria-disabled", "true");
    await user.click(submit());
    // M06-T03 3c-1a: sent by the coordinated sign-in, after its security checks.
    await waitFor(() => expect(mockedSignIn).toHaveBeenCalledWith(EMAIL, PASSWORD));
  });

  it("while unreachable: click, Enter, and direct submission send no credentials; values, focus, and links are kept; no validation runs", async () => {
    const user = userEvent.setup();
    renderPage();
    await fill(user);
    evidence("network-failure");

    expect(submit()).toHaveAttribute("aria-disabled", "true");
    expect(submit()).toHaveAccessibleName("Sign in");
    expect(submit()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    expect(submit()).not.toHaveAttribute("data-pending");

    // Each attempt is checked on its own, right after it is made.
    await user.click(submit());
    expect(mockedSignIn, "mouse click").not.toHaveBeenCalled();
    await user.type(password(), "{Enter}");
    expect(mockedSignIn, "Enter in a field").not.toHaveBeenCalled();
    fireEvent.submit(form());
    act(() => form().requestSubmit());
    submit().focus();
    await user.keyboard("{Enter}");
    await user.keyboard(" ");
    expect(mockedSignIn).not.toHaveBeenCalled();
    expect(submit()).toHaveFocus();
    expect(email()).toHaveValue(EMAIL);
    expect(password()).toHaveValue(PASSWORD);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "Forgot password?" })).toBeInTheDocument();

    // Empty fields are refused too — validation never runs while unavailable.
    await user.clear(email());
    await user.click(submit());
    expect(email()).not.toHaveAttribute("aria-invalid", "true");
  });

  it("existing validation still applies when available", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(submit());
    expect(email()).toHaveAttribute("aria-invalid", "true");
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it("keeps the values across loss and recovery, never signs in by itself, and signs in when asked", async () => {
    mockedSignIn.mockResolvedValueOnce(TEST_USER);
    const user = userEvent.setup();
    renderPage();
    await fill(user);
    evidence("network-failure");
    browserEvent("offline");
    browserEvent("online"); // unreachable → unknown
    expect(email()).toHaveValue(EMAIL);
    expect(password()).toHaveValue(PASSWORD);
    expect(submit()).not.toHaveAttribute("aria-disabled", "true");
    expect(mockedSignIn).not.toHaveBeenCalled();
    await user.click(submit());
    await waitFor(() => expect(mockedSignIn).toHaveBeenCalledTimes(1));
  });

  it("an existing credential failure (alert, cleared password) is kept through loss and recovery", async () => {
    mockedSignIn.mockRejectedValueOnce(new ApiError(401, "INVALID_CREDENTIALS", "x"));
    const user = userEvent.setup();
    renderPage();
    await fill(user);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(SIGN_IN_MESSAGES.credentials);
    expect(password()).toHaveValue("");
    evidence("network-failure");
    evidence("response");
    expect(screen.getByRole("alert")).toHaveTextContent(SIGN_IN_MESSAGES.credentials);
    expect(email()).toHaveValue(EMAIL);
  });

  it("an in-flight sign-in keeps its lock and data-pending through loss and recovery; a second submission is refused", async () => {
    const pending = deferred<typeof TEST_USER>();
    mockedSignIn.mockReturnValueOnce(pending.promise);
    mockedGetSession.mockResolvedValue(null);
    const user = userEvent.setup();
    renderPage();
    await fill(user);
    expect(submit()).not.toHaveAttribute("data-pending");
    await user.click(submit());
    expect(submit()).toHaveTextContent("Signing in…");
    expect(submit()).toHaveAttribute("data-pending", "true");

    evidence("network-failure");
    expect(submit()).toHaveAttribute("data-pending", "true");
    evidence("response");
    expect(submit()).toHaveAttribute("data-pending", "true");
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    act(() => form().requestSubmit());
    await user.click(submit());
    expect(mockedSignIn).toHaveBeenCalledTimes(1);

    mockedGetSession.mockResolvedValue(TEST_SESSION);
    await act(async () => pending.resolve(TEST_USER));
    expect(await screen.findByTestId("home")).toBeInTheDocument();
    expect(mockedSignIn).toHaveBeenCalledTimes(1);
  });
});
