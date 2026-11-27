import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { AuthProvider } from "../auth/AuthProvider";
import { TEST_SESSION, TEST_USER } from "../auth/testFixtures";
import { connectivity } from "../connectivity/connectivity";
import { updateSafety, type TransitionGate } from "../pwa/updateSafety";
import { AccountNav } from "./AccountNav";

/**
 * M06-T02 Increment 4c (Q2) — sign-out attempted while an application update
 * holds the transition gate. Real `AccountNav`, `AuthProvider`, auth API
 * module, shared client, update-safety gate, and connectivity store; only the
 * network boundary (`fetch`) is stubbed.
 *
 * M06-T03 3c-1a (DR-4): the refusal is now CONTROL-level. Sign-out takes an
 * operation hold before anything else; while the gate is held the hold is
 * refused, nothing is initiated (no local block, intent, or request), and the
 * account area says the app is updating. This replaces the M06-T02 Q2
 * request-level expectations.
 */

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

let fetchMock: Mock<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>;
let gate: TransitionGate | null = null;

const calls = () =>
  fetchMock.mock.calls.map(([input, init]) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    return `${(init?.method ?? "GET").toUpperCase()} ${new URL(url, "http://localhost").pathname}`;
  });

function acquireGate() {
  const result = updateSafety.tryAcquireGate();
  if (result.kind !== "acquired") throw new Error(`expected the gate, got ${result.kind}`);
  gate = result.gate;
}

function releaseGate() {
  gate?.release();
  gate = null;
}

beforeEach(() => {
  fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const path = new URL(String(input), "http://localhost").pathname;
    if (method === "GET" && path === "/api/auth/get-session")
      return Promise.resolve(json(TEST_SESSION));
    if (method === "POST" && path === "/api/auth/sign-out")
      return Promise.resolve(json({ success: true }));
    return Promise.resolve(json({ code: "UNEXPECTED" }, 500));
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  releaseGate(); // never leak the gate into another test
  cleanup();
  vi.unstubAllGlobals();
});

async function renderSignedIn() {
  render(
    <MemoryRouter>
      <AuthProvider>
        <AccountNav />
      </AuthProvider>
    </MemoryRouter>,
  );
  await screen.findByText(TEST_USER.email);
  // Only the initial session load so far.
  expect(calls()).toEqual(["GET /api/auth/get-session"]);
}

describe("AccountNav sign-out while an update holds the transition gate", () => {
  it("is refused with the updating reason: nothing initiated, still signed in, no follow-up, no evidence, no retry (DR-4)", async () => {
    await renderSignedIn();
    const evidence = connectivity.getState();
    acquireGate();

    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Sign-out wasn't started. The app is updating. Try again when the update finishes.",
    );
    expect(calls()).toEqual(["GET /api/auth/get-session"]); // no POST, no re-read
    expect(screen.getByText(TEST_USER.email)).toBeInTheDocument(); // local state unchanged
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(connectivity.getState()).toEqual(evidence);
    expect(updateSafety.getSnapshot().pendingRequests).toBe(0);
    expect(updateSafety.getSnapshot().operationHolds).toBe(0);

    // Releasing the gate retries nothing by itself.
    releaseGate();
    await act(async () => {
      await Promise.resolve();
    });
    expect(calls()).toEqual(["GET /api/auth/get-session"]);

    // A subsequent explicit attempt signs out normally.
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    await waitFor(() =>
      expect(calls()).toEqual(["GET /api/auth/get-session", "POST /api/auth/sign-out"]),
    );
    expect(
      await screen.findByText("You're signed out. The server confirmed the sign-out."),
    ).toBeInTheDocument();
  });

  it("without the gate, sign-out sends one POST and confirms it", async () => {
    await renderSignedIn();
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeInTheDocument();
    expect(
      await screen.findByText("You're signed out. The server confirmed the sign-out."),
    ).toBeInTheDocument();
    expect(calls()).toEqual(["GET /api/auth/get-session", "POST /api/auth/sign-out"]);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
