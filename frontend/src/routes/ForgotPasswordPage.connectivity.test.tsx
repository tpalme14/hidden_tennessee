import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { requestPasswordReset } from "../api/auth";
import { ApiError } from "../api/client";
import { deferred } from "../auth/testFixtures";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { FORGOT_PASSWORD_MESSAGES, ForgotPasswordPage } from "./ForgotPasswordPage";

/**
 * M06-T02 Increment 3b-iii — the reset-link request as an online-only action
 * (OFF-UX-5): no request while the server is unreachable; the address and the
 * existing RESET_UNAVAILABLE message are kept; recovery requests nothing; the
 * existing lock and `data-pending` follow the real pending state.
 */

vi.mock("../api/auth", () => ({ requestPasswordReset: vi.fn() }));

const mockedRequest = vi.mocked(requestPasswordReset);
const EMAIL = "hiker@example.test";

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
    <MemoryRouter initialEntries={["/forgot-password"]}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

const email = () => screen.getByLabelText("Email address");
const submit = () => screen.getByRole("button", { name: /send(ing)? (reset )?link/i });
const form = () => submit().closest("form")!;

beforeEach(() => {
  mockedRequest.mockReset();
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("ForgotPasswordPage — requesting a reset link needs the server", () => {
  it.each(STATES)("requests normally with %s", async (_label, apply) => {
    mockedRequest.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();
    apply();
    await user.type(email(), EMAIL);
    await user.click(submit());
    expect(mockedRequest).toHaveBeenCalledWith(EMAIL);
  });

  it("while unreachable: click, Enter, and direct submission request nothing; the address and focus are kept", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(email(), EMAIL);
    evidence("network-failure");
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    expect(submit()).toHaveAccessibleName("Send reset link");
    expect(submit()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    expect(submit()).not.toHaveAttribute("data-pending");
    await user.click(submit());
    await user.type(email(), "{Enter}");
    fireEvent.submit(form());
    act(() => form().requestSubmit());
    expect(mockedRequest).not.toHaveBeenCalled();
    expect(email()).toHaveValue(EMAIL);
    expect(email()).toHaveFocus();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("existing validation still applies when available", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(email(), "not-an-address");
    await user.click(submit());
    expect(email()).toHaveAttribute("aria-invalid", "true");
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it("the existing RESET_UNAVAILABLE message is kept through loss and recovery; recovery requests nothing; an explicit retry requests once more", async () => {
    mockedRequest.mockRejectedValueOnce(new ApiError(503, "RESET_UNAVAILABLE", "x"));
    const user = userEvent.setup();
    renderPage();
    await user.type(email(), EMAIL);
    await user.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      FORGOT_PASSWORD_MESSAGES.unavailable,
    );
    evidence("network-failure");
    expect(screen.getByRole("alert")).toHaveTextContent(FORGOT_PASSWORD_MESSAGES.unavailable);
    browserEvent("online");
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    mockedRequest.mockResolvedValueOnce(undefined);
    await user.click(submit());
    expect(await screen.findByRole("status")).toHaveTextContent(FORGOT_PASSWORD_MESSAGES.sent);
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it("an in-flight request keeps its lock and data-pending through loss and recovery; a second submission is refused", async () => {
    const pending = deferred<void>();
    mockedRequest.mockReturnValueOnce(pending.promise);
    const user = userEvent.setup();
    renderPage();
    await user.type(email(), EMAIL);
    await user.click(submit());
    expect(submit()).toHaveAttribute("data-pending", "true");
    evidence("network-failure");
    expect(submit()).toHaveAttribute("data-pending", "true");
    evidence("response");
    expect(submit()).toHaveAttribute("data-pending", "true");
    act(() => form().requestSubmit());
    expect(mockedRequest).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    expect(screen.getByRole("status")).toHaveTextContent(FORGOT_PASSWORD_MESSAGES.sent);
    expect(mockedRequest).toHaveBeenCalledTimes(1);
  });
});
