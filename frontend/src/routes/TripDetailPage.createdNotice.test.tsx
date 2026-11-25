import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../api/auth";
import { createTrip, getTrip, listTrips, type OwnerTrip } from "../api/trips";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { createdTripState } from "../trips/tripNotice";
import { MyTripsPage } from "./MyTripsPage";
import { TripDetailPage } from "./TripDetailPage";

/**
 * M05-T06 Increment 2 — the one-time creation announcement, end to end with
 * the REAL My Trips page, trip page, and hooks (API module mocked): it is
 * announced once on the destination trip, only for the confirmed user and that
 * trip, is removed from the history entry (Back/Forward never repeat it), and
 * moves focus to the trip heading only when focus was lost.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  listTrips: vi.fn(),
  createTrip: vi.fn(),
  getTrip: vi.fn(),
}));

const list = vi.mocked(listTrips);
const create = vi.mocked(createTrip);
const get = vi.mocked(getTrip);

const OTHER_USER: AuthUser = { ...TEST_USER, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const TRIP_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TRIP_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TIME = "2026-11-23T16:00:00.000Z";
const RLO = String.fromCodePoint(0x202e);

function emptyTrip(id: string, name: string): OwnerTrip {
  return {
    id,
    name,
    version: 0,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops: [],
    distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
  };
}

let navigateTo: (to: string | number) => void = () => undefined;

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  navigateTo = (to) => {
    void (typeof to === "number" ? navigate(to) : navigate(to));
  };
  return (
    <div data-testid="location" data-state={JSON.stringify(location.state ?? null)}>
      {location.pathname}
    </div>
  );
}

function Harness({ session }: { session: SessionState }) {
  const auth: AuthContextValue = {
    session,
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  return (
    <AuthContext.Provider value={auth}>
      <button type="button">Elsewhere</button>
      <Routes>
        <Route path="/trips" element={<MyTripsPage />} />
        <Route path="/trips/:tripId" element={<TripDetailPage />} />
        <Route path="/other" element={<p>Other page</p>} />
      </Routes>
      <Probe />
    </AuthContext.Provider>
  );
}

type Entry = string | { pathname: string; state: unknown };

function renderAt(
  entry: Entry,
  session: SessionState = { status: "authenticated", user: TEST_USER },
) {
  const view = render(
    <MemoryRouter initialEntries={[entry]}>
      <Harness session={session} />
    </MemoryRouter>,
  );
  return {
    setSession(next: SessionState) {
      view.rerender(
        <MemoryRouter initialEntries={[entry]}>
          <Harness session={next} />
        </MemoryRouter>,
      );
    },
  };
}

const status = () => screen.getByRole("status");
const location = () => screen.getByTestId("location");

beforeEach(() => {
  list.mockReset();
  create.mockReset();
  get.mockReset();
});

afterEach(() => vi.restoreAllMocks());

describe("creation announcement on the trip page", () => {
  it("is announced once with the name isolated, focuses the heading, and is cleared from history", async () => {
    const name = `${RLO}Smoky Falls`;
    list.mockResolvedValue({ trips: [], page: 1, limit: 20, has_more: false });
    create.mockResolvedValueOnce(emptyTrip(TRIP_A, name));
    get.mockResolvedValue(emptyTrip(TRIP_A, name));
    renderAt("/trips");
    await screen.findByText(/You don.t have any trips yet/);
    await userEvent.type(screen.getByLabelText("New trip name"), name);
    await userEvent.click(screen.getByRole("button", { name: "Create trip" }));

    const heading = await screen.findByRole("heading", { level: 2, name });
    expect(location()).toHaveTextContent(`/trips/${TRIP_A}`);
    expect(status()).toHaveTextContent(`Created trip ${name}.`);
    expect(status().querySelector("bdi")?.textContent).toBe(name);
    expect(heading).toHaveFocus();
    // The router replaces the history entry asynchronously (after the notice is read).
    await waitFor(() => expect(location()).toHaveAttribute("data-state", "null"));

    // Back to My Trips and Forward to the trip: no repeat.
    act(() => navigateTo(-1));
    await screen.findByText(/You don.t have any trips yet/);
    act(() => navigateTo(1));
    await screen.findByRole("heading", { level: 2, name });
    expect(status()).not.toHaveTextContent("Created trip");
  });

  it.each<[string, unknown]>([
    ["another user", createdTripState({ userId: OTHER_USER.id, tripId: TRIP_A, name: "Falls" })],
    ["another trip", createdTripState({ userId: TEST_USER.id, tripId: TRIP_B, name: "Falls" })],
  ])("a notice for %s is not announced, and is still removed", async (_label, state) => {
    get.mockResolvedValue(emptyTrip(TRIP_A, "Falls"));
    renderAt({ pathname: `/trips/${TRIP_A}`, state });
    await screen.findByRole("heading", { level: 2, name: "Falls" });
    expect(status()).not.toHaveTextContent("Created trip");
    expect(screen.getByRole("heading", { level: 2, name: "Falls" })).not.toHaveFocus();
    // The router replaces the history entry asynchronously (after the notice is read).
    await waitFor(() => expect(location()).toHaveAttribute("data-state", "null"));
  });

  it("a malformed notice is not a notice: ignored, not announced", async () => {
    get.mockResolvedValue(emptyTrip(TRIP_A, "Falls"));
    renderAt({
      pathname: `/trips/${TRIP_A}`,
      state: { tripNotice: { kind: "trip-created", userId: TEST_USER.id } },
    });
    await screen.findByRole("heading", { level: 2, name: "Falls" });
    expect(status()).not.toHaveTextContent("Created trip");
    expect(screen.getByRole("heading", { level: 2, name: "Falls" })).not.toHaveFocus();
  });

  it("arriving while the session is unconfirmed consumes the notice without announcing it", async () => {
    get.mockResolvedValue(emptyTrip(TRIP_A, "Falls"));
    const { setSession } = renderAt(
      {
        pathname: `/trips/${TRIP_A}`,
        state: createdTripState({ userId: TEST_USER.id, tripId: TRIP_A, name: "Falls" }),
      },
      { status: "loading" },
    );
    // The router replaces the history entry asynchronously (after the notice is read).
    await waitFor(() => expect(location()).toHaveAttribute("data-state", "null"));
    setSession({ status: "authenticated", user: TEST_USER });
    await screen.findByRole("heading", { level: 2, name: "Falls" });
    expect(status()).not.toHaveTextContent("Created trip");
  });

  it("does not take focus the user moved elsewhere while the trip loaded", async () => {
    const pending = deferred<OwnerTrip>();
    get.mockReturnValueOnce(pending.promise);
    renderAt({
      pathname: `/trips/${TRIP_A}`,
      state: createdTripState({ userId: TEST_USER.id, tripId: TRIP_A, name: "Falls" }),
    });
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    await act(async () => pending.resolve(emptyTrip(TRIP_A, "Falls")));
    await screen.findByRole("heading", { level: 2, name: "Falls" });
    expect(status()).toHaveTextContent("Created trip Falls.");
    expect(elsewhere).toHaveFocus();
  });
});
