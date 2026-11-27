import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSession, register, signIn, signOut } from "../api/auth";
import { ApiError } from "../api/client";
import { AuthProvider } from "../auth/AuthProvider";
import { TEST_USER, deferred } from "../auth/testFixtures";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { RegisterPage } from "./RegisterPage";

/**
 * M06-T02 Increment 3b-iii — registration as an online-only action
 * (OFF-UX-5): no registration request while the server is unreachable; the
 * entered values, validation, and existing errors are kept; recovery submits
 * nothing; the existing lock and `data-pending` follow the real pending state.
 * Synthetic data only.
 */

vi.mock("../api/auth", () => ({
  getSession: vi.fn(),
  register: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

const mockedRegister = vi.mocked(register);
const EMAIL = "new.hiker@example.test";
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
    <MemoryRouter initialEntries={["/register"]}>
      <AuthProvider>
        <Routes>
          <Route path="/register" element={<RegisterPage />} />
          <Route path="/sign-in" element={<p data-testid="sign-in">sign in</p>} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

const email = () => screen.getByLabelText("Email address");
const password = () => screen.getByLabelText("Password");
const confirm = () => screen.getByLabelText("Confirm password");
const submit = () => screen.getByRole("button", { name: /^creat(e|ing) account/i });
const form = () => submit().closest("form")!;

async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(email(), EMAIL);
  await user.type(password(), PASSWORD);
  await user.type(confirm(), PASSWORD);
}

beforeEach(() => {
  vi.mocked(getSession).mockReset().mockResolvedValue(null);
  mockedRegister.mockReset();
  vi.mocked(signIn).mockReset();
  vi.mocked(signOut).mockReset();
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("RegisterPage — registering needs the server", () => {
  it.each(STATES)("registers normally with %s", async (_label, apply) => {
    mockedRegister.mockResolvedValueOnce(TEST_USER);
    const user = userEvent.setup();
    renderPage();
    apply();
    await fill(user);
    await user.click(submit());
    expect(mockedRegister).toHaveBeenCalledWith(EMAIL, PASSWORD);
  });

  it("while unreachable: click, Enter, and direct submission register nothing; values are kept", async () => {
    const user = userEvent.setup();
    renderPage();
    await fill(user);
    evidence("network-failure");
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    expect(submit()).toHaveAccessibleName("Create account");
    expect(submit()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    expect(submit()).not.toHaveAttribute("data-pending");

    await user.click(submit());
    await user.type(confirm(), "{Enter}");
    fireEvent.submit(form());
    act(() => form().requestSubmit());
    submit().focus();
    await user.keyboard(" ");
    expect(mockedRegister).not.toHaveBeenCalled();
    expect(submit()).toHaveFocus();
    expect(email()).toHaveValue(EMAIL);
    expect(password()).toHaveValue(PASSWORD);
    expect(confirm()).toHaveValue(PASSWORD);
    // The password hint is still the field's description.
    expect(password()).toHaveAccessibleDescription(/characters/);
  });

  it("existing validation still applies when available", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.type(email(), EMAIL);
    await user.type(password(), PASSWORD);
    await user.type(confirm(), "something else entirely");
    await user.click(submit());
    expect(confirm()).toHaveAttribute("aria-invalid", "true");
    expect(mockedRegister).not.toHaveBeenCalled();
  });

  it("an existing registration error is kept through loss and recovery; recovery registers nothing; an explicit submit does", async () => {
    mockedRegister.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x"));
    const user = userEvent.setup();
    renderPage();
    await fill(user);
    await user.click(submit());
    const alert = await screen.findByRole("alert");
    const message = alert.textContent;
    evidence("network-failure");
    browserEvent("online");
    expect(screen.getByRole("alert").textContent).toBe(message);
    expect(email()).toHaveValue(EMAIL);
    expect(mockedRegister).toHaveBeenCalledTimes(1);
    mockedRegister.mockResolvedValueOnce(TEST_USER);
    await user.click(submit());
    expect(await screen.findByTestId("sign-in")).toBeInTheDocument();
    expect(mockedRegister).toHaveBeenCalledTimes(2);
  });

  it("an in-flight registration keeps its lock and data-pending through loss and recovery; a second submission is refused", async () => {
    const pending = deferred<typeof TEST_USER>();
    mockedRegister.mockReturnValueOnce(pending.promise);
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
    expect(mockedRegister).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(TEST_USER));
    expect(await screen.findByTestId("sign-in")).toBeInTheDocument();
    expect(mockedRegister).toHaveBeenCalledTimes(1);
  });
});
