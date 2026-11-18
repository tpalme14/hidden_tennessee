import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { ApiError } from "../api/client";
import { getSession, requestPasswordReset } from "../api/auth";
import { AuthProvider } from "../auth/AuthProvider";
import { deferred } from "../auth/testFixtures";
import { ForgotPasswordPage, FORGOT_PASSWORD_MESSAGES } from "./ForgotPasswordPage";

/** M03-T03 Increment 5 — the reset-request page. The auth API module is mocked. */

vi.mock("../api/auth", () => ({
  getSession: vi.fn(),
  requestPasswordReset: vi.fn(),
  signOut: vi.fn(),
}));

const mockedRequest = vi.mocked(requestPasswordReset);

function renderPage() {
  return render(
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <AuthProvider>
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/sign-in" element={<p data-testid="sign-in">sign-in</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const emailInput = () => screen.getByLabelText("Email address");
const submitButton = () => screen.getByRole("button", { name: /send(ing)? (reset )?link/i });
const region = () => screen.getByRole("region", { name: "Reset your password" });

beforeEach(() => {
  vi.mocked(getSession).mockReset().mockResolvedValue(null);
  mockedRequest.mockReset();
});

describe("ForgotPasswordPage", () => {
  it("renders a labelled email field, a submit button, and a way back to sign-in", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeInTheDocument();
    expect(emailInput()).toHaveAttribute("autocomplete", "email");
    expect(submitButton()).toHaveTextContent("Send reset link");
    expect(within(region()).getByRole("link", { name: "Back to sign in" })).toHaveAttribute(
      "href",
      "/sign-in",
    );
  });

  it.each([
    ["", "Enter your email address."],
    ["not-an-email", "Enter a valid email address."],
  ])("rejects %j with a field error and focus, sending nothing", async (value, message) => {
    const user = userEvent.setup({ delay: null });
    renderPage();
    if (value) await user.type(emailInput(), value);
    await user.click(submitButton());
    expect(emailInput()).toHaveAttribute("aria-invalid", "true");
    expect(emailInput()).toHaveAccessibleDescription(message);
    expect(emailInput()).toHaveFocus();
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("sends only the trimmed address and shows the neutral confirmation, focused, in place of the form", async () => {
    const user = userEvent.setup({ delay: null });
    const pending = deferred<void>();
    mockedRequest.mockReturnValue(pending.promise);
    renderPage();
    await user.type(emailInput(), "Hiker@Example.test");
    await user.click(submitButton());

    expect(submitButton()).toHaveTextContent("Sending link…");
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    await user.click(submitButton());
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    expect(mockedRequest).toHaveBeenCalledWith("Hiker@Example.test");

    pending.resolve();
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(FORGOT_PASSWORD_MESSAGES.sent);
    expect(status).toHaveFocus();
    expect(screen.queryByLabelText("Email address")).not.toBeInTheDocument();
  });

  it("the confirmation is identical for any address (the server answers alike)", async () => {
    const user = userEvent.setup({ delay: null });
    mockedRequest.mockResolvedValue(undefined);
    const outputs: string[] = [];
    for (const address of ["existing@example.test", "nobody@example.test"]) {
      const view = renderPage();
      await user.type(emailInput(), address);
      await user.click(submitButton());
      await screen.findByRole("status");
      outputs.push(region().outerHTML);
      view.unmount();
    }
    expect(outputs[1]).toBe(outputs[0]);
    expect(outputs[0]).not.toMatch(/existing|nobody/);
  });

  it("unavailable delivery shows the approved message, never claims an email was sent, and keeps the form", async () => {
    const user = userEvent.setup({ delay: null });
    mockedRequest.mockRejectedValue(
      new ApiError(503, "RESET_UNAVAILABLE", "Password reset is temporarily unavailable."),
    );
    renderPage();
    await user.type(emailInput(), "hiker@example.test");
    await user.click(submitButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Password reset is temporarily unavailable. Please try again later.",
    );
    expect(document.body).not.toHaveTextContent(/on its way|sent|check your (email|inbox)/i);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(emailInput()).toHaveValue("hiker@example.test");
    expect(submitButton()).toHaveAttribute("aria-disabled", "false");
  });

  it.each([
    [
      new ApiError(429, "RATE_LIMITED", "x", 600),
      "Too many reset requests. Please wait 10 minutes and try again.",
    ],
    [
      new ApiError(429, "RATE_LIMITED", "x"),
      "Too many reset requests. Please wait a few minutes and try again.",
    ],
    [new ApiError(0, "NETWORK_ERROR", "x"), FORGOT_PASSWORD_MESSAGES.network],
    [new ApiError(503, "SERVICE_UNAVAILABLE", "x"), FORGOT_PASSWORD_MESSAGES.generic],
    [new ApiError(403, "INVALID_ORIGIN", "x"), FORGOT_PASSWORD_MESSAGES.generic],
    [new Error("boom"), FORGOT_PASSWORD_MESSAGES.generic],
  ])("failure %# shows a safe alert and no confirmation", async (error, message) => {
    const user = userEvent.setup({ delay: null });
    mockedRequest.mockRejectedValue(error);
    renderPage();
    await user.type(emailInput(), "hiker@example.test");
    await user.click(submitButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByText(/boom/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("a server email validation error becomes a field error", async () => {
    const user = userEvent.setup({ delay: null });
    mockedRequest.mockRejectedValue(new ApiError(400, "VALIDATION_ERROR", "x"));
    renderPage();
    await user.type(emailInput(), "hiker@example.test");
    await user.click(submitButton());
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(emailInput()).toHaveFocus();
  });

  it("works from the keyboard alone", async () => {
    const user = userEvent.setup({ delay: null });
    mockedRequest.mockResolvedValue(undefined);
    renderPage();
    await user.tab();
    expect(emailInput()).toHaveFocus();
    await user.keyboard("hiker@example.test");
    await user.tab();
    expect(submitButton()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(await screen.findByRole("status")).toHaveFocus();
  });
});
