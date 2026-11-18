import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { ApiError } from "../api/client";
import { getSession, register, signOut } from "../api/auth";
import { AuthProvider } from "../auth/AuthProvider";
import { TEST_SESSION, TEST_USER, deferred } from "../auth/testFixtures";
import { RegisterPage } from "./RegisterPage";

/**
 * M03-T03 Increment 3 — the registration page: validation, pending state,
 * API failures, neutral success, navigation to sign-in, session states, and
 * keyboard use. The real `AuthProvider` runs; the auth API module is mocked.
 */

vi.mock("../api/auth", () => ({ getSession: vi.fn(), register: vi.fn(), signOut: vi.fn() }));

const mockedGetSession = vi.mocked(getSession);
const mockedRegister = vi.mocked(register);

const VALID_PASSWORD = "correct horse battery";

/** Stands in for the Increment 4 sign-in page: shows what it would receive. */
function SignInProbe() {
  const location = useLocation();
  return (
    <p data-testid="sign-in-probe">
      {location.pathname}
      {location.search}|{JSON.stringify(location.state)}
    </p>
  );
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/sign-in" element={<SignInProbe />} />
          <Route path="/" element={<p data-testid="home">home</p>} />
          <Route path="/landmarks/:id" element={<p data-testid="landmark">landmark</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const emailInput = () => screen.getByLabelText("Email address");
const passwordInput = () => screen.getByLabelText("Password");
const confirmInput = () => screen.getByLabelText("Confirm password");
const submitButton = () => screen.getByRole("button", { name: /create account|creating account/i });

async function fillForm(
  user: ReturnType<typeof userEvent.setup>,
  { email = "  New.Hiker@Example.test ", password = VALID_PASSWORD, confirm = VALID_PASSWORD } = {},
) {
  if (email) await user.type(emailInput(), email);
  if (password) await user.type(passwordInput(), password);
  if (confirm) await user.type(confirmInput(), confirm);
}

beforeEach(() => {
  mockedGetSession.mockReset();
  mockedRegister.mockReset();
  vi.mocked(signOut).mockReset();
  mockedGetSession.mockResolvedValue(null);
});

describe("RegisterPage — form", () => {
  it("renders a labelled form with a password hint and the right autocomplete hints", async () => {
    renderAt("/register");

    expect(screen.getByRole("heading", { name: "Create an account" })).toBeInTheDocument();
    expect(emailInput()).toHaveAttribute("type", "email");
    expect(emailInput()).toHaveAttribute("autocomplete", "email");
    expect(passwordInput()).toHaveAttribute("type", "password");
    expect(passwordInput()).toHaveAttribute("autocomplete", "new-password");
    expect(passwordInput()).toHaveAccessibleDescription("Use 8 to 128 characters.");
    expect(confirmInput()).toHaveAttribute("autocomplete", "new-password");
    expect(submitButton()).toHaveTextContent("Create account");
    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    // No field starts out marked invalid.
    for (const input of [emailInput(), passwordInput(), confirmInput()]) {
      expect(input).toHaveAttribute("aria-invalid", "false");
    }
  });

  it("an empty submit shows field errors, marks the fields invalid, focuses the first, and sends nothing", async () => {
    const user = userEvent.setup({ delay: null });
    renderAt("/register");
    await user.click(submitButton());

    expect(emailInput()).toHaveAttribute("aria-invalid", "true");
    expect(emailInput()).toHaveAccessibleDescription("Enter your email address.");
    expect(passwordInput()).toHaveAttribute("aria-invalid", "true");
    expect(passwordInput()).toHaveAccessibleDescription(
      "Use 8 to 128 characters. Use at least 8 characters.",
    );
    expect(emailInput()).toHaveFocus();
    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it("reports an invalid email, a short password, and a mismatch, focusing the first problem", async () => {
    const user = userEvent.setup({ delay: null });
    renderAt("/register");
    await fillForm(user, { email: "not-an-email", password: "short", confirm: "different" });
    await user.click(submitButton());

    expect(emailInput()).toHaveAccessibleDescription("Enter a valid email address.");
    expect(passwordInput()).toHaveAccessibleDescription(
      "Use 8 to 128 characters. Use at least 8 characters.",
    );
    expect(confirmInput()).toHaveAccessibleDescription("The passwords do not match.");
    expect(emailInput()).toHaveFocus();
    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it("focuses the first invalid field even when it is not the first field", async () => {
    const user = userEvent.setup({ delay: null });
    renderAt("/register");
    await fillForm(user, { confirm: "something else entirely" });
    await user.click(submitButton());

    expect(emailInput()).toHaveAttribute("aria-invalid", "false");
    expect(passwordInput()).toHaveAttribute("aria-invalid", "false");
    expect(confirmInput()).toHaveFocus();
    expect(confirmInput()).toHaveAccessibleDescription("The passwords do not match.");
  });

  it("rejects a 129-character password and accepts the 128-character boundary", async () => {
    const user = userEvent.setup({ delay: null });
    mockedRegister.mockResolvedValue(TEST_USER);
    renderAt("/register");
    // Pasted rather than typed: long values typed key by key are needlessly slow.
    const paste = async (input: HTMLElement, text: string) => {
      await user.clear(input);
      await user.click(input);
      await user.paste(text);
    };
    const tooLong = "a".repeat(129);
    await fillForm(user, { password: "", confirm: "" });
    await paste(passwordInput(), tooLong);
    await paste(confirmInput(), tooLong);
    await user.click(submitButton());
    expect(passwordInput()).toHaveAccessibleDescription(
      "Use 8 to 128 characters. Use at most 128 characters.",
    );
    expect(mockedRegister).not.toHaveBeenCalled();

    await paste(passwordInput(), "a".repeat(128));
    await paste(confirmInput(), "a".repeat(128));
    await user.click(submitButton());
    expect(mockedRegister).toHaveBeenCalledWith("New.Hiker@Example.test", "a".repeat(128));
  });

  it("editing a field clears only that field's error", async () => {
    const user = userEvent.setup({ delay: null });
    renderAt("/register");
    await user.click(submitButton());
    expect(emailInput()).toHaveAttribute("aria-invalid", "true");

    await user.type(emailInput(), "h");
    expect(emailInput()).toHaveAttribute("aria-invalid", "false");
    expect(emailInput()).not.toHaveAccessibleDescription();
    expect(passwordInput()).toHaveAttribute("aria-invalid", "true");
  });
});

describe("RegisterPage — submission", () => {
  it("success sends the trimmed email and the untrimmed password, then goes to sign-in with a notice and no session", async () => {
    const user = userEvent.setup({ delay: null });
    mockedRegister.mockResolvedValue(TEST_USER);
    renderAt("/register");
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(1));
    await fillForm(user, { password: " spaced password ", confirm: " spaced password " });
    await user.click(submitButton());

    expect(mockedRegister).toHaveBeenCalledWith("New.Hiker@Example.test", " spaced password ");
    expect(await screen.findByTestId("sign-in-probe")).toHaveTextContent(
      '/sign-in|{"registered":true}',
    );
    // Registration never signs in: no further session check, no sign-in call.
    expect(mockedGetSession).toHaveBeenCalledTimes(1);
  });

  it("a duplicate address gets exactly the same outcome as a new one (the backend answers both alike)", async () => {
    const user = userEvent.setup({ delay: null });
    mockedRegister.mockResolvedValue({ ...TEST_USER, email: "existing@example.test" });
    const first = renderAt("/register");
    await fillForm(user, { email: "existing@example.test" });
    await user.click(submitButton());
    const firstOutcome = (await screen.findByTestId("sign-in-probe")).textContent;
    first.unmount();

    renderAt("/register");
    await fillForm(user, { email: "existing@example.test" });
    await user.click(submitButton());
    const secondOutcome = (await screen.findByTestId("sign-in-probe")).textContent;

    expect(secondOutcome).toBe(firstOutcome);
    expect(document.body).not.toHaveTextContent(/already|exists|taken|in use/i);
  });

  it("shows pending feedback and ignores repeat submits until the request settles", async () => {
    const user = userEvent.setup({ delay: null });
    const pending = deferred<typeof TEST_USER>();
    mockedRegister.mockReturnValue(pending.promise);
    renderAt("/register");
    await fillForm(user);
    await user.click(submitButton());

    expect(submitButton()).toHaveTextContent("Creating account…");
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("button", { name: "Creating account…" }).closest("form"),
    ).toHaveAttribute("aria-busy", "true");
    await user.click(submitButton());
    await user.keyboard("{Enter}");
    expect(mockedRegister).toHaveBeenCalledTimes(1);

    pending.resolve(TEST_USER);
    expect(await screen.findByTestId("sign-in-probe")).toBeInTheDocument();
  });

  it.each([
    ["PASSWORD_TOO_SHORT", 400, "password", "Use at least 8 characters."],
    ["PASSWORD_TOO_LONG", 400, "password", "Use at most 128 characters."],
    ["VALIDATION_ERROR", 400, "email", "Enter a valid email address."],
  ] as const)(
    "a server %s becomes a field error with focus on the field",
    async (code, status, field, message) => {
      const user = userEvent.setup({ delay: null });
      mockedRegister.mockRejectedValue(new ApiError(status, code, "Server wording not shown"));
      renderAt("/register");
      await fillForm(user);
      await user.click(submitButton());

      const input = field === "email" ? emailInput() : passwordInput();
      await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
      expect(input).toHaveAccessibleDescription(expect.stringContaining(message));
      expect(input).toHaveFocus();
      expect(screen.queryByText("Server wording not shown")).not.toBeInTheDocument();
      expect(screen.queryByTestId("sign-in-probe")).not.toBeInTheDocument();
    },
  );

  it.each([
    [
      "a network failure",
      new ApiError(0, "NETWORK_ERROR", "raw"),
      "Couldn't reach the server. Check your connection and try again.",
    ],
    [
      "throttling with a wait",
      new ApiError(429, "RATE_LIMITED", "raw", 600),
      "Too many registration attempts. Please wait 10 minutes and try again.",
    ],
    [
      "throttling with a short wait",
      new ApiError(429, "RATE_LIMITED", "raw", 45),
      "Too many registration attempts. Please wait 45 seconds and try again.",
    ],
    [
      "throttling without a wait",
      new ApiError(429, "RATE_LIMITED", "raw"),
      "Too many registration attempts. Please wait a few minutes and try again.",
    ],
    [
      "a 503",
      new ApiError(503, "SERVICE_UNAVAILABLE", "raw"),
      "Registration couldn't be completed. Please try again.",
    ],
    [
      "a CSRF rejection",
      new ApiError(403, "INVALID_ORIGIN", "raw"),
      "Registration couldn't be completed. Please try again.",
    ],
    [
      "an unexpected body",
      new ApiError(200, "INVALID_RESPONSE", "raw"),
      "Registration couldn't be completed. Please try again.",
    ],
    [
      "an existence-revealing error the backend should never send",
      new ApiError(422, "USER_ALREADY_EXISTS", "User already exists"),
      "Registration couldn't be completed. Please try again.",
    ],
    ["a non-API error", new Error("boom"), "Registration couldn't be completed. Please try again."],
  ])("%s shows a safe alert and keeps the form filled", async (_label, error, message) => {
    const user = userEvent.setup({ delay: null });
    mockedRegister.mockRejectedValue(error);
    renderAt("/register");
    await fillForm(user);
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText(/raw|User already exists|boom/)).not.toBeInTheDocument();
    // (Browsers — and jsdom — strip surrounding whitespace from type="email" values.)
    expect(emailInput()).toHaveValue("New.Hiker@Example.test");
    expect(passwordInput()).toHaveValue(VALID_PASSWORD);
    expect(submitButton()).toHaveTextContent("Create account");
    expect(submitButton()).toHaveAttribute("aria-disabled", "false");
    expect(screen.queryByTestId("sign-in-probe")).not.toBeInTheDocument();
  });

  it("a retry after a failure clears the alert and can succeed", async () => {
    const user = userEvent.setup({ delay: null });
    mockedRegister.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "raw"));
    mockedRegister.mockResolvedValueOnce(TEST_USER);
    renderAt("/register");
    await fillForm(user);
    await user.click(submitButton());
    await screen.findByRole("alert");

    await user.click(submitButton());
    expect(await screen.findByTestId("sign-in-probe")).toHaveTextContent('{"registered":true}');
    expect(mockedRegister).toHaveBeenCalledTimes(2);
  });
});

describe("RegisterPage — return destination", () => {
  it("forwards a safe returnTo to sign-in, in the link and after success", async () => {
    const user = userEvent.setup({ delay: null });
    mockedRegister.mockResolvedValue(TEST_USER);
    renderAt("/register?returnTo=%2Flandmarks%2Fabc%3Ftab%3D1");

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute(
      "href",
      "/sign-in?returnTo=%2Flandmarks%2Fabc%3Ftab%3D1",
    );
    await fillForm(user);
    await user.click(submitButton());
    expect(await screen.findByTestId("sign-in-probe")).toHaveTextContent(
      '/sign-in?returnTo=%2Flandmarks%2Fabc%3Ftab%3D1|{"registered":true}',
    );
  });

  it.each([
    "https%3A%2F%2Fevil.example%2F",
    "%2F%2Fevil.example",
    "%2F%5Cevil.example",
    "javascript%3Aalert(1)",
  ])("drops an unsafe returnTo (%s)", async (raw) => {
    const user = userEvent.setup({ delay: null });
    mockedRegister.mockResolvedValue(TEST_USER);
    renderAt(`/register?returnTo=${raw}`);

    expect(screen.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
    await fillForm(user);
    await user.click(submitButton());
    expect(await screen.findByTestId("sign-in-probe")).toHaveTextContent(
      '/sign-in|{"registered":true}',
    );
  });
});

describe("RegisterPage — session states", () => {
  it("shows the form while the session check is still loading", () => {
    mockedGetSession.mockReturnValue(deferred<null>().promise);
    renderAt("/register");
    expect(emailInput()).toBeInTheDocument();
  });

  it("does not redirect away when the session check is unavailable", async () => {
    mockedGetSession.mockRejectedValue(new ApiError(0, "NETWORK_ERROR", "offline"));
    renderAt("/register");
    await waitFor(() => expect(mockedGetSession).toHaveBeenCalledTimes(1));
    // Let the failed check settle into `unavailable`, then confirm the form is still here.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(emailInput()).toBeInTheDocument();
    expect(screen.queryByTestId("home")).not.toBeInTheDocument();
  });

  it("sends a signed-in user to the home route", async () => {
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    renderAt("/register");
    expect(await screen.findByTestId("home")).toBeInTheDocument();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
  });

  it("sends a signed-in user to a safe returnTo instead", async () => {
    mockedGetSession.mockResolvedValue(TEST_SESSION);
    renderAt("/register?returnTo=%2Flandmarks%2Fabc");
    expect(await screen.findByTestId("landmark")).toBeInTheDocument();
  });
});

describe("RegisterPage — keyboard", () => {
  it("can be completed with the keyboard alone, in field order", async () => {
    const user = userEvent.setup({ delay: null });
    mockedRegister.mockResolvedValue(TEST_USER);
    renderAt("/register");

    await user.tab();
    expect(emailInput()).toHaveFocus();
    await user.keyboard("hiker@example.test");
    await user.tab();
    expect(passwordInput()).toHaveFocus();
    await user.keyboard(VALID_PASSWORD);
    await user.tab();
    expect(confirmInput()).toHaveFocus();
    await user.keyboard(VALID_PASSWORD);
    await user.tab();
    expect(submitButton()).toHaveFocus();
    await user.tab();
    expect(
      within(screen.getByRole("region", { name: "Create an account" })).getByRole("link", {
        name: "Sign in",
      }),
    ).toHaveFocus();

    await user.click(emailInput());
    await user.keyboard("{Enter}");
    expect(mockedRegister).toHaveBeenCalledWith("hiker@example.test", VALID_PASSWORD);
    expect(await screen.findByTestId("sign-in-probe")).toBeInTheDocument();
  });
});
