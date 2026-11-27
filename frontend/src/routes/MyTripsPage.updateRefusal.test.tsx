import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { createTrip, listTrips, type TripListPage } from "../api/trips";
import { AuthContext, type AuthContextValue } from "../auth/session";
import { TEST_USER } from "../auth/testFixtures";
import { connectivity } from "../connectivity/connectivity";
import { updateSafety } from "../pwa/updateSafety";
import { MyTripsPage, UNCERTAIN_CREATE_TEXT } from "./MyTripsPage";

/**
 * M06-T02 Increment 4b-iii (D2) — a creation refused locally because the app
 * is updating is a KNOWN non-execution. With the REAL client and update-safety
 * gate (only the list read is mocked; `fetch` is stubbed and must stay
 * unused): no request, no "couldn't confirm" message, no reconciliation read,
 * the typed name kept, nothing retried. A genuine uncertain outcome keeps its
 * existing handling.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  listTrips: vi.fn(),
}));
const list = vi.mocked(listTrips);
const EMPTY: TripListPage = { trips: [], page: 1, limit: 20, has_more: false };

function renderPage() {
  const auth: AuthContextValue = {
    session: { status: "authenticated", user: TEST_USER },
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  render(
    <MemoryRouter initialEntries={["/trips"]}>
      <AuthContext.Provider value={auth}>
        <Routes>
          <Route path="/trips" element={<MyTripsPage />} />
          <Route path="/trips/:tripId" element={<p data-testid="trip">trip</p>} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

const nameInput = () => screen.getByLabelText("New trip name");
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  list.mockReset().mockResolvedValue(EMPTY);
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("My Trips — a creation refused because the app is updating", () => {
  it("sends nothing, says so truthfully, starts no reconciliation, keeps the name, retries nothing", async () => {
    renderPage();
    await screen.findByText("You don't have any trips yet.", { exact: false }).catch(() => null);
    const listReads = list.mock.calls.length;
    const evidence = connectivity.getState();
    fireEvent.change(nameInput(), { target: { value: "Synthetic Weekend" } });

    const gate = updateSafety.tryAcquireGate();
    if (gate.kind !== "acquired") throw new Error("expected the gate");
    try {
      // The button may already be marked unavailable; the form's submit path is used directly.
      fireEvent.submit(nameInput().closest("form")!);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("The trip wasn't created because the app is updating.");
      expect(alert).not.toHaveTextContent(UNCERTAIN_CREATE_TEXT);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(list.mock.calls.length).toBe(listReads); // no page-1 check
      expect(nameInput()).toHaveValue("Synthetic Weekend");
      expect(connectivity.getState()).toEqual(evidence);
      expect(updateSafety.getSnapshot().pendingRequests).toBe(0);
    } finally {
      gate.gate.release();
    }
    await Promise.resolve();
    expect(fetchMock).not.toHaveBeenCalled(); // not retried after the gate is released
  });

  it("a genuine network failure keeps its uncertain-outcome handling (check, message)", async () => {
    renderPage();
    await screen.findByLabelText("New trip name");
    const listReads = list.mock.calls.length;
    fetchMock.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    fireEvent.change(nameInput(), { target: { value: "Synthetic Weekend" } });
    await userEvent.click(screen.getByRole("button", { name: "Create trip" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(UNCERTAIN_CREATE_TEXT);
    expect(list.mock.calls.length).toBeGreaterThan(listReads); // the page-1 check ran
  });

  it("the classification is by code: the client's refusal error is recognized", async () => {
    // The exact error the client throws while the gate is held.
    const gate = updateSafety.tryAcquireGate();
    if (gate.kind !== "acquired") throw new Error("expected the gate");
    try {
      await expect(createTrip("x")).rejects.toMatchObject({
        code: "UPDATE_IN_PROGRESS",
        status: 0,
      });
      await expect(createTrip("x")).rejects.toBeInstanceOf(ApiError);
    } finally {
      gate.gate.release();
    }
  });
});
