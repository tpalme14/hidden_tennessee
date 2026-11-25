import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listTrips } from "../api/trips";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { TEST_USER } from "../auth/testFixtures";
import { tripsListState } from "../trips/tripNotice";
import { MyTripsPage } from "./MyTripsPage";

/**
 * M05-T06 Increment 3 — My Trips shows the one-time delete notice only to the
 * confirmed user it names, removes it from the history entry either way, and
 * ignores anything that is not exactly a notice.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  listTrips: vi.fn(),
}));

const list = vi.mocked(listTrips);
const OTHER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function Probe() {
  const location = useLocation();
  return <div data-testid="location" data-state={JSON.stringify(location.state ?? null)} />;
}

function renderWithState(
  state: unknown,
  session: SessionState = { status: "authenticated", user: TEST_USER },
) {
  const auth: AuthContextValue = {
    session,
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={[{ pathname: "/trips", state }]}>
        <Routes>
          <Route path="/trips" element={<MyTripsPage />} />
        </Routes>
        <Probe />
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

const status = () => screen.getByRole("status");

beforeEach(() => {
  list.mockReset();
  list.mockResolvedValue({ trips: [], page: 1, limit: 20, has_more: false });
});
afterEach(() => vi.restoreAllMocks());

describe("My Trips delete notice", () => {
  it("another user's notice is not shown, and is removed from history", async () => {
    renderWithState(tripsListState({ kind: "trip-deleted", userId: OTHER, name: "Alice trip" }));
    await screen.findByText(/You don.t have any trips yet/);
    expect(status()).not.toHaveTextContent("Deleted trip");
    // The router replaces the history entry asynchronously (after the notice is read).
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveAttribute("data-state", "null"),
    );
    expect(screen.getByRole("heading", { level: 2, name: "My Trips" })).not.toHaveFocus();
  });

  it("the user's own notice is shown after the list loads", async () => {
    renderWithState(
      tripsListState({ kind: "trip-unavailable", userId: TEST_USER.id, uncertain: false }),
    );
    await waitFor(() => expect(status()).toHaveTextContent("That trip is no longer available."));
    expect(screen.getByRole("heading", { level: 2, name: "My Trips" })).toHaveFocus();
  });

  it("a malformed notice is ignored", async () => {
    renderWithState({ tripNotice: { kind: "trip-deleted", userId: TEST_USER.id } });
    await screen.findByText(/You don.t have any trips yet/);
    expect(status()).toHaveTextContent("");
  });

  it("arriving while the session is unconfirmed consumes the notice without showing it", async () => {
    renderWithState(tripsListState({ kind: "trip-deleted", userId: TEST_USER.id, name: "Falls" }), {
      status: "loading",
    });
    // The router replaces the history entry asynchronously (after the notice is read).
    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveAttribute("data-state", "null"),
    );
    expect(status()).not.toHaveTextContent("Deleted trip");
  });
});
