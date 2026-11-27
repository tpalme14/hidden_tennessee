import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { ApiError } from "../api/client";
import { getSession, register, signIn, signOut } from "../api/auth";
import { AuthProvider } from "../auth/AuthProvider";
import { RESTRICTION_MESSAGES } from "../auth/accountSecurity";
import { openOfflineStateDatabase } from "../offline/db";
import type { FakeLockManager } from "../offline/testSupport";
import { updateSafety } from "../pwa/updateSafety";
import { SAFETY_LOCK_KEY } from "../offline/safetyLock";
import { TEST_SESSION, TEST_USER, deferred } from "../auth/testFixtures";
import { RegisterPage } from "./RegisterPage";
import { SignInPage, SIGN_IN_MESSAGES } from "./SignInPage";

/**
 * M03-T03 Increment 4 — the sign-in page: validation, pending state, generic
 * credential failures, throttling, the registration notice, the safe return
 * destination, session states, the session refresh after success, and the
 * registration → sign-in flow. The real `AuthProvider` runs; the auth API
 * module is mocked.
 */

vi.mock("../api/auth", () => ({
  getSession: vi.fn(),
  register: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const mockedGetSession = vi.mocked(getSession);
const mockedSignIn = vi.mocked(signIn);
const mockedRegister = vi.mocked(register);

const PASSWORD = "correct horse battery";

function Destination({ name }: { name: string }) {
  const location = useLocation();
  return (
    <p data-testid="destination">
      {name}:{location.pathname}
      {location.search}
    </p>
  );
}

function renderAt(path: string, state?: unknown) {
  return render(
    <MemoryRouter
      initialEntries={[
        {
          pathname: path.split("?")[0]!,
          search: path.includes("?") ? `?${path.split("?")[1]}` : "",
          state,
        },
      ]}
    >
      <AuthProvider>
        <Routes>
          <Route path="/sign-in" element={<SignInPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/" element={<Destination name="home" />} />
          <Route path="/landmarks/:id" element={<Destination name="landmark" />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const emailInput = () => screen.getByLabelText("Email address");
const passwordInput = () => screen.getByLabelText("Password");
const submitButton = () => screen.getByRole("button", { name: /^sign(ing)? in/i });
const page = () => screen.getByRole("region", { name: "Sign in" });

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  email = "  Hiker@Example.test ",
  password = PASSWORD,
) {
  if (email) await user.type(emailInput(), email);
  if (password) await user.type(passwordInput(), password);
  await user.click(submitButton());
}

beforeEach(() => {
  mockedGetSession.mockReset();
  mockedSignIn.mockReset();
  mockedRegister.mockReset();
  vi.mocked(signOut).mockReset();
  mockedGetSession.mockResolvedValue(null);
});

describe("SignInPage — form", () => {
  it("renders a labelled form with sign-in autocomplete hints and a link to registration", () => {
    renderAt("/sign-in");
    expect(screen.getByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(emailInput()).toHaveAttribute("autocomplete", "email");
    expect(passwordInput()).toHaveAttribute("type", "password");
    expect(passwordInput()).toHaveAttribute("autocomplete", "current-password");
    expect(submitButton()).toHaveTextContent("Sign in");
    expect(within(page()).getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register",
    );
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("an empty submit shows field errors, focuses the email field, and sends nothing", async () => {
    const user = userEvent.setup({ delay: null });
    renderAt("/sign-in");
    await user.click(submitButton());

    expect(emailInput()).toHaveAttribute("aria-invalid", "true");
    expect(emailInput()).toHaveAccessibleDescription("Enter your email address.");
    expect(passwordInput()).toHaveAccessibleDescription("Enter your password.");
    expect(emailInput()).toHaveFocus();
    expect(mockedSignIn).not.toHaveBeenCalled();
  });

  it("checks only presence for the password — the policy is not restated", async () => {
    const user = userEvent.setup({ delay: null });
    mockedSignIn.mockRejectedValue(new ApiError(401, "INVALID_EMAIL_OR_PASSWORD", "x"));
    renderAt("/sign-in");
    await fillAndSubmit(user, "hiker@example.test", "short");
    await waitFor(() => expect(mockedSignIn).toHaveBeenCalledWith("hiker@example.test", "short"));
    expect(document.body).not.toHaveTextContent(/8 to 128|at least 8/);
  });
});

describe("SignInPage — registration notice", () => {
  it("shows the neutral notice when arriving from registration", () => {
    renderAt("/sign-in", { registered: true });
    expect(screen.getByRole("status")).toHaveTextContent(SIGN_IN_MESSAGES.registered);
  });

  it.each([[undefined], [null], [{}], [{ registered: "yes" }], ["registered"]])(
    "shows no notice for other router state (%j)",
    (state) => {
      renderAt("/sign-in", state);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );
});

describe("SignInPage — success", () => {
  // M06-T03 3c-1a: the provider's coordinated sign-in sends the request after
  // its security checks (asynchronously) and confirms the session itself.
  it("signs in, confirms the session from the server, then goes home", async () => {
    const user = userEvent.setup({ delay: null });
    renderAt("/sign-in");
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(1));

    mockedSignIn.mockResolvedValue(TEST_USER);
    const refreshed = deferred<typeof TEST_SESSION>();
    mockedGetSession.mockReturnValueOnce(refreshed.promise);
    await fillAndSubmit(user);

    await waitFor(() => expect(mockedSignIn).toHaveBeenCalledWith("Hiker@Example.test", PASSWORD));
    // Still here, pending, until the provider's own check confirms the session.
    expect(submitButton()).toHaveTextContent("Signing in…");
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("destination")).not.toBeInTheDocument();

    refreshed.resolve(TEST_SESSION);
    expect(await screen.findByTestId("destination")).toHaveTextContent("home:/");
    expect(mockedGetSession).toHaveBeenCalledTimes(2);
  });

  it("ignores repeat submits while signing in", async () => {
    const user = userEvent.setup({ delay: null });
    const pending = deferred<typeof TEST_USER>();
    mockedSignIn.mockReturnValue(pending.promise);
    renderAt("/sign-in");
    await fillAndSubmit(user);
    await user.click(submitButton());
    await user.keyboard("{Enter}");
    // M06-T03 3c-1 correction: the request is sent by the coordinated sign-in
    // after its security steps, so wait for it rather than counting at once.
    await waitFor(() => expect(mockedSignIn).toHaveBeenCalledTimes(1));

    mockedGetSession.mockResolvedValue(TEST_SESSION);
    pending.resolve(TEST_USER);
    expect(await screen.findByTestId("destination")).toBeInTheDocument();
    // A duplicate attempt would have queued behind the first one's tnle-auth
    // hold and run after it. Wait until every coordinated operation has
    // settled (no lock held or pending, no update-safety hold), then check
    // that no delayed duplicate was ever sent. This also keeps unfinished work
    // from reaching the next test.
    const locks = navigator.locks as unknown as FakeLockManager;
    await waitFor(() => {
      expect(locks.snapshot()).toEqual({ held: [], pending: [] });
      expect(updateSafety.getSnapshot().operationHolds).toBe(0);
    });
    expect(mockedSignIn).toHaveBeenCalledTimes(1);
  });

  it("goes to a safe returnTo, keeping its query", async () => {
    const user = userEvent.setup({ delay: null });
    mockedSignIn.mockResolvedValue(TEST_USER);
    renderAt("/sign-in?returnTo=%2Flandmarks%2Fabc%3Ftab%3D1");
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(1));
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    await fillAndSubmit(user);
    expect(await screen.findByTestId("destination")).toHaveTextContent(
      "landmark:/landmarks/abc?tab=1",
    );
  });

  it.each([
    "https%3A%2F%2Fevil.example%2F",
    "%2F%2Fevil.example",
    "%2F%5Cevil.example",
    "%2F%252F%252Fevil.example",
    "javascript%3Aalert(1)",
  ])("falls back to / for an unsafe returnTo (%s)", async (raw) => {
    const user = userEvent.setup({ delay: null });
    mockedSignIn.mockResolvedValue(TEST_USER);
    renderAt(`/sign-in?returnTo=${raw}`);
    expect(within(page()).getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register",
    );
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(1));
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    await fillAndSubmit(user);
    expect(await screen.findByTestId("destination")).toHaveTextContent("home:/");
  });

  it("still leaves the page if the confirming session check fails (the header then offers Retry)", async () => {
    const user = userEvent.setup({ delay: null });
    mockedSignIn.mockResolvedValue(TEST_USER);
    renderAt("/sign-in");
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(1));
    mockedGetSession.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    await fillAndSubmit(user);
    expect(await screen.findByTestId("destination")).toHaveTextContent("home:/");
  });
});

describe("SignInPage — failures", () => {
  it.each([
    [
      "a wrong password",
      new ApiError(401, "INVALID_EMAIL_OR_PASSWORD", "Invalid email or password"),
    ],
    [
      "an unknown address",
      new ApiError(401, "INVALID_EMAIL_OR_PASSWORD", "Invalid email or password"),
    ],
    ["a 400 from the endpoint", new ApiError(400, "VALIDATION_ERROR", "Invalid email")],
    [
      "a hypothetical existence-revealing 401",
      new ApiError(401, "USER_NOT_FOUND", "User not found"),
    ],
  ])("%s: one generic message, password cleared and focused, email kept", async (_label, error) => {
    const user = userEvent.setup({ delay: null });
    mockedSignIn.mockRejectedValue(error);
    renderAt("/sign-in");
    await fillAndSubmit(user);

    expect(await screen.findByRole("alert")).toHaveTextContent(SIGN_IN_MESSAGES.credentials);
    expect(screen.queryByText(error.message)).not.toBeInTheDocument();
    expect(passwordInput()).toHaveValue("");
    expect(passwordInput()).toHaveFocus();
    expect(emailInput()).toHaveValue("Hiker@Example.test");
    expect(submitButton()).toHaveTextContent("Sign in");
    expect(submitButton()).toHaveAttribute("aria-disabled", "false");
    expect(screen.queryByTestId("destination")).not.toBeInTheDocument();
  });

  it("the page is byte-identical after a wrong password and after an unknown address", async () => {
    const user = userEvent.setup({ delay: null });
    const outcomes: string[] = [];
    for (const error of [
      new ApiError(401, "INVALID_EMAIL_OR_PASSWORD", "wrong password"),
      new ApiError(401, "INVALID_EMAIL_OR_PASSWORD", "unknown address"),
    ]) {
      mockedSignIn.mockRejectedValueOnce(error);
      const view = renderAt("/sign-in");
      await fillAndSubmit(user, "same@example.test");
      await screen.findByRole("alert");
      outcomes.push(page().outerHTML);
      view.unmount();
    }
    expect(outcomes[1]).toBe(outcomes[0]);
  });

  it.each([
    [new ApiError(429, "RATE_LIMITED", "x", 30), "Please wait 30 seconds and try again."],
    [new ApiError(429, "RATE_LIMITED", "x", 120), "Please wait 2 minutes and try again."],
    [new ApiError(429, "RATE_LIMITED", "x"), "Please wait a minute and try again."],
  ])("throttling shows how long to wait (%#) and keeps the password", async (error, wait) => {
    const user = userEvent.setup({ delay: null });
    mockedSignIn.mockRejectedValue(error);
    renderAt("/sign-in");
    await fillAndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      `Too many sign-in attempts. ${wait}`,
    );
    expect(passwordInput()).toHaveValue(PASSWORD);
  });

  it.each([
    [new ApiError(0, "NETWORK_ERROR", "x"), SIGN_IN_MESSAGES.network],
    [new ApiError(503, "SERVICE_UNAVAILABLE", "x"), SIGN_IN_MESSAGES.generic],
    [new ApiError(403, "INVALID_ORIGIN", "x"), SIGN_IN_MESSAGES.generic],
    [new ApiError(200, "INVALID_RESPONSE", "x"), SIGN_IN_MESSAGES.generic],
    [new Error("boom"), SIGN_IN_MESSAGES.generic],
  ])("other failures show a safe message and keep the form (%#)", async (error, message) => {
    const user = userEvent.setup({ delay: null });
    mockedSignIn.mockRejectedValue(error);
    renderAt("/sign-in");
    await fillAndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(passwordInput()).toHaveValue(PASSWORD);
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
  });

  it("a retry after a failure clears the alert and can succeed", async () => {
    const user = userEvent.setup({ delay: null });
    mockedSignIn.mockRejectedValueOnce(new ApiError(401, "INVALID_EMAIL_OR_PASSWORD", "x"));
    renderAt("/sign-in");
    await fillAndSubmit(user);
    await screen.findByRole("alert");

    mockedSignIn.mockResolvedValueOnce(TEST_USER);
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    await user.type(passwordInput(), PASSWORD);
    await user.click(submitButton());
    expect(await screen.findByTestId("destination")).toHaveTextContent("home:/");
    expect(mockedSignIn).toHaveBeenCalledTimes(2);
  });
});

describe("SignInPage — session states", () => {
  it("shows the form while the session check is loading", () => {
    mockedGetSession.mockReturnValue(deferred<null>().promise);
    renderAt("/sign-in");
    expect(emailInput()).toBeInTheDocument();
  });

  it("does not redirect away when the session check is unavailable", async () => {
    mockedGetSession.mockRejectedValue(new ApiError(503, "SERVICE_UNAVAILABLE", "down"));
    renderAt("/sign-in?returnTo=%2Flandmarks%2Fabc");
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(emailInput()).toBeInTheDocument();
    expect(screen.queryByTestId("destination")).not.toBeInTheDocument();
  });

  it("sends an already signed-in visitor to the safe destination", async () => {
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    renderAt("/sign-in?returnTo=%2Flandmarks%2Fabc");
    expect(await screen.findByTestId("destination")).toHaveTextContent("landmark:/landmarks/abc");
  });

  it("sends an already signed-in visitor home when returnTo is unsafe", async () => {
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    renderAt("/sign-in?returnTo=%2F%2Fevil.example");
    expect(await screen.findByTestId("destination")).toHaveTextContent("home:/");
  });
});

describe("registration → sign-in (cross-increment)", () => {
  it("carries returnTo through registration, shows the notice, does not sign in, then signs in to the destination", async () => {
    const user = userEvent.setup({ delay: null });
    mockedRegister.mockResolvedValue(TEST_USER);
    renderAt("/register?returnTo=%2Flandmarks%2Fabc");
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(1));

    await user.type(screen.getByLabelText("Email address"), "hiker@example.test");
    await user.type(screen.getByLabelText("Password"), PASSWORD);
    await user.type(screen.getByLabelText("Confirm password"), PASSWORD);
    await user.click(screen.getByRole("button", { name: "Create account" }));

    // On the real sign-in page, with the notice and the destination preserved.
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(SIGN_IN_MESSAGES.registered);
    expect(within(page()).getByRole("link", { name: "Create an account" })).toHaveAttribute(
      "href",
      "/register?returnTo=%2Flandmarks%2Fabc",
    );
    // Registration signed nobody in: no sign-in call, no extra session check.
    expect(mockedSignIn).not.toHaveBeenCalled();
    expect(mockedGetSession).toHaveBeenCalledTimes(1);

    mockedSignIn.mockResolvedValue(TEST_USER);
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    await user.type(emailInput(), "hiker@example.test");
    await user.type(passwordInput(), PASSWORD);
    await user.click(submitButton());
    expect(await screen.findByTestId("destination")).toHaveTextContent("landmark:/landmarks/abc");
  });
});

describe("SignInPage — keyboard", () => {
  it("can be completed with the keyboard alone", async () => {
    const user = userEvent.setup({ delay: null });
    mockedSignIn.mockResolvedValue(TEST_USER);
    renderAt("/sign-in");

    await user.tab();
    expect(emailInput()).toHaveFocus();
    await user.keyboard("hiker@example.test");
    await user.tab();
    expect(passwordInput()).toHaveFocus();
    await user.keyboard(PASSWORD);
    await user.tab();
    expect(submitButton()).toHaveFocus();
    await user.tab();
    expect(within(page()).getByRole("link", { name: "Create an account" })).toHaveFocus();

    mockedGetSession.mockResolvedValue(TEST_SESSION);
    await user.click(passwordInput());
    await user.keyboard("{Enter}");
    expect(await screen.findByTestId("destination")).toHaveTextContent("home:/");
  });
});

describe("SignInPage — password reset (Increment 5)", () => {
  it("offers a Forgot password? link after the other actions", () => {
    renderAt("/sign-in");
    const links = within(page()).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Create an account",
      "Forgot password?",
    ]);
    expect(within(page()).getByRole("link", { name: "Forgot password?" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("shows the reset notice for { passwordReset: true }", () => {
    renderAt("/sign-in", { passwordReset: true });
    expect(screen.getByRole("status")).toHaveTextContent(SIGN_IN_MESSAGES.passwordReset);
  });

  it.each([[{ passwordReset: "yes" }], [{ passwordReset: 1 }]])(
    "shows no notice for a non-boolean passwordReset (%j)",
    (state) => {
      renderAt("/sign-in", state);
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );
});

describe("SignInPage — offline security restrictions (M06-T03 3c-1a)", () => {
  async function seedIntent() {
    const opened = await openOfflineStateDatabase();
    if (opened.kind !== "open") throw new Error(opened.kind);
    await opened.db.put("state", {
      key: "signout_intent",
      schema_version: 1,
      pending: true,
      created_at: "2026-11-25T09:00:00.000Z",
    });
    opened.db.close();
  }

  it("with D22 present, explains why and sends no credentials (U3)", async () => {
    const user = userEvent.setup({ delay: null });
    localStorage.setItem(SAFETY_LOCK_KEY, "true");
    renderAt("/sign-in");
    const notice = await screen.findByText(RESTRICTION_MESSAGES["safety-lock"]);
    expect(notice.closest("[role=status]")).not.toBeNull();
    await fillAndSubmit(user);
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    expect(submitButton()).toHaveAccessibleDescription(RESTRICTION_MESSAGES["safety-lock"]);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockedSignIn).not.toHaveBeenCalled();
    expect(localStorage.getItem(SAFETY_LOCK_KEY)).toBe("true");
  });

  it("without usable Web Locks, explains the browser limitation and sends nothing (AC-36)", async () => {
    const user = userEvent.setup({ delay: null });
    delete (navigator as { locks?: unknown }).locks;
    renderAt("/sign-in");
    expect(
      await screen.findByText(RESTRICTION_MESSAGES["coordination-unavailable"]),
    ).toBeInTheDocument();
    await fillAndSubmit(user);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockedSignIn).not.toHaveBeenCalled();
    expect(mockedGetSession).not.toHaveBeenCalled();
  });

  it("with a pending sign-out, offers Sign in again: the sign-out is confirmed before credentials are sent", async () => {
    const user = userEvent.setup({ delay: null });
    await seedIntent();
    const order: string[] = [];
    vi.mocked(signOut).mockImplementation(() => {
      order.push("sign-out");
      return Promise.resolve();
    });
    mockedSignIn.mockImplementation(() => {
      order.push("sign-in");
      return Promise.resolve(TEST_USER);
    });
    // A still-valid cookie: the startup check must not restore it (OFF-OUT-4).
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    renderAt("/sign-in");
    expect(await screen.findByRole("button", { name: "Sign in again" })).toBeInTheDocument();
    await fillAndSubmit(user);
    expect(await screen.findByTestId("destination")).toHaveTextContent("home:/");
    expect(order).toEqual(["sign-out", "sign-in"]);
  });

  it("Sign in again sends no credentials when the sign-out can't be confirmed (AC-35)", async () => {
    const user = userEvent.setup({ delay: null });
    await seedIntent();
    vi.mocked(signOut).mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "offline"));
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    renderAt("/sign-in");
    await screen.findByRole("button", { name: "Sign in again" });
    await fillAndSubmit(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The earlier sign-out couldn't be confirmed with the server, so your details weren't sent",
    );
    expect(mockedSignIn).not.toHaveBeenCalled();
    expect(screen.queryByTestId("destination")).not.toBeInTheDocument();
  });
});
