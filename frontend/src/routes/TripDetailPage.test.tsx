import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../api/auth";
import { ApiError } from "../api/client";
import { getTrip, type OwnerTrip, type TripStop } from "../api/trips";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { TripDetailPage } from "./TripDetailPage";

/**
 * M05-T04 Increment 2 — the read-only trip detail page with the REAL `useTrip`
 * hook (API module mocked, auth context supplied): authentication gating and
 * the sign-in return path, every page state, stale-response protection, trip
 * ID and identity changes, the stop list's exact content for available and
 * unavailable stops, distances, and safe rendering.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  getTrip: vi.fn(),
}));

const get = vi.mocked(getTrip);

const OTHER_USER: AuthUser = { ...TEST_USER, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const TRIP_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TRIP_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const STOP = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LANDMARK = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const TIME = "2026-11-23T16:00:00.000Z";
const RLO = String.fromCodePoint(0x202e);

function availableStop(
  position: number,
  distance: number | null,
  name = `Falls ${position}`,
): TripStop {
  return {
    id: STOP(position),
    position,
    is_available: true,
    distance_from_previous_miles: distance,
    landmark: {
      id: LANDMARK(position),
      display_name: name,
      category: "falls",
      latitude: 35.678912,
      longitude: -83.591234,
    },
  };
}

function unavailableStop(position: number): TripStop {
  return {
    id: STOP(position),
    position,
    is_available: false,
    distance_from_previous_miles: null,
    landmark: { id: LANDMARK(position), is_available: false },
  };
}

function tripOf(stops: TripStop[], extra: Partial<OwnerTrip> = {}): OwnerTrip {
  const legs = stops
    .map((s) => s.distance_from_previous_miles)
    .filter((d): d is number => d !== null);
  return {
    id: TRIP_A,
    name: "Weekend Waterfalls",
    version: 3,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops,
    distance_summary: {
      total_miles: legs.length === 0 ? null : legs.reduce((a, b) => a + b, 0),
      measured_legs: legs.length,
      total_legs: Math.max(stops.length - 1, 0),
    },
    ...extra,
  };
}

let navigateTo: (path: string) => void = () => undefined;

function NavigationProbe() {
  const location = useLocation();
  const navigate = useNavigate();
  navigateTo = (path) => {
    void navigate(path);
  };
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function Harness({ session, refresh }: { session: SessionState; refresh: () => Promise<void> }) {
  const auth: AuthContextValue = {
    session,
    checking: false,
    refresh,
    signOut: vi.fn(() => Promise.resolve()),
  };
  return (
    <AuthContext.Provider value={auth}>
      <Routes>
        <Route path="/trips/:tripId" element={<TripDetailPage />} />
        <Route path="/sign-in" element={<p>Sign-in page</p>} />
        <Route path="/" element={<p>Discovery page</p>} />
        <Route path="/landmarks/:id" element={<p>Profile page</p>} />
      </Routes>
      <NavigationProbe />
    </AuthContext.Provider>
  );
}

function renderPage(
  path = `/trips/${TRIP_A}`,
  session: SessionState = { status: "authenticated", user: TEST_USER },
) {
  const refresh = vi.fn(() => Promise.resolve());
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Harness session={session} refresh={refresh} />
    </MemoryRouter>,
  );
  return {
    refresh,
    view,
    setSession(next: SessionState) {
      view.rerender(
        <MemoryRouter initialEntries={[path]}>
          <Harness session={next} refresh={refresh} />
        </MemoryRouter>,
      );
    },
  };
}

const pageHeading = () => screen.getByRole("heading", { level: 2 });
const stopsList = () => screen.getByRole("list", { name: "Stops" });
const stopItems = () => within(stopsList()).getAllByRole("listitem");

beforeEach(() => {
  get.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("authentication", () => {
  it("fetches nothing while the session is being checked, and says so", () => {
    renderPage(`/trips/${TRIP_A}`, { status: "loading" });
    expect(screen.getByRole("status")).toHaveTextContent("Checking whether you're signed in…");
    expect(get).not.toHaveBeenCalled();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("signed out: no request, and a sign-in link that returns to this trip", async () => {
    renderPage(`/trips/${TRIP_A}`, { status: "anonymous" });
    const link = screen.getByRole("link", { name: "Sign in to see this trip" });
    expect(link).toHaveAttribute(
      "href",
      `/sign-in?returnTo=${encodeURIComponent(`/trips/${TRIP_A}`)}`,
    );
    expect(get).not.toHaveBeenCalled();
    await userEvent.click(link);
    expect(screen.getByTestId("location")).toHaveTextContent(
      `/sign-in?returnTo=${encodeURIComponent(`/trips/${TRIP_A}`)}`,
    );
  });

  it("session check unavailable: no request and no trip data", () => {
    renderPage(`/trips/${TRIP_A}`, { status: "unavailable", retry: vi.fn() });
    expect(screen.getByText(/couldn't check whether you're signed in/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("a 401 shows no trip data, offers Try again, and asks the session to be re-checked", async () => {
    get.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "Authentication required."));
    const { refresh } = renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load this trip because your session may have ended.");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("signing out after loading removes the trip from the page at once", async () => {
    get.mockResolvedValueOnce(tripOf([availableStop(0, null, "Secret Spot")]));
    const harness = renderPage();
    await screen.findByRole("list", { name: "Stops" });
    harness.setSession({ status: "anonymous" });
    expect(screen.queryByText("Secret Spot")).toBeNull();
    expect(screen.queryByText("Weekend Waterfalls")).toBeNull();
    expect(screen.getByRole("link", { name: "Sign in to see this trip" })).toBeInTheDocument();
  });

  it("a failed session check after loading clears the trip; verifying the SAME user again fetches it fresh (Increment 3 refinement)", async () => {
    get.mockResolvedValueOnce(tripOf([availableStop(0, null, "Secret Spot")]));
    const harness = renderPage();
    await screen.findByText("Secret Spot");
    harness.setSession({ status: "unavailable", retry: vi.fn() });
    expect(screen.queryByText("Secret Spot")).toBeNull();
    expect(get).toHaveBeenCalledTimes(1);
    get.mockResolvedValueOnce(tripOf([availableStop(0, null, "Fresh Spot")]));
    harness.setSession({ status: "authenticated", user: TEST_USER });
    // Not the cached trip: a new request, and loading until it answers.
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Secret Spot")).toBeNull();
    expect(await screen.findByText("Fresh Spot")).toBeInTheDocument();
  });

  it("a response started before a failed session check is dropped after re-verification", async () => {
    const before = deferred<OwnerTrip>();
    get.mockReturnValueOnce(before.promise);
    const harness = renderPage();
    harness.setSession({ status: "unavailable", retry: vi.fn() });
    const after = deferred<OwnerTrip>();
    get.mockReturnValueOnce(after.promise);
    harness.setSession({ status: "authenticated", user: TEST_USER });
    await act(async () => {
      before.resolve(tripOf([availableStop(0, null, "Old Answer")]));
    });
    expect(screen.queryByText("Old Answer")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading trip…");
    await act(async () => {
      after.resolve(tripOf([availableStop(0, null, "New Answer")]));
    });
    expect(screen.getByText("New Answer")).toBeInTheDocument();
  });

  it("a different signed-in user replaces the trip immediately and refetches; the old user's late response is dropped", async () => {
    const first = deferred<OwnerTrip>();
    get.mockReturnValueOnce(first.promise);
    const second = deferred<OwnerTrip>();
    get.mockReturnValueOnce(second.promise);
    const harness = renderPage();
    harness.setSession({ status: "authenticated", user: OTHER_USER });
    expect(get).toHaveBeenCalledTimes(2);
    await act(async () => {
      first.resolve(tripOf([availableStop(0, null, "First User Spot")], { name: "First" }));
    });
    expect(screen.queryByText("First User Spot")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading trip…");
    await act(async () => {
      second.reject(new ApiError(404, "NOT_FOUND", "Resource not found."));
    });
    expect(screen.getByText(/This trip couldn't be found/)).toBeInTheDocument();
    expect(screen.queryByText("First")).toBeNull();
  });

  it("a different user after a successful load never shows the previous user's trip", async () => {
    get.mockResolvedValueOnce(tripOf([availableStop(0, null, "Mine")]));
    const harness = renderPage();
    await screen.findByText("Mine");
    get.mockReturnValueOnce(new Promise(() => undefined));
    harness.setSession({ status: "authenticated", user: OTHER_USER });
    expect(screen.queryByText("Mine")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("Loading trip…");
  });
});

describe("trip retrieval and page states", () => {
  it("loads the trip by its route ID, announcing loading in the status region", async () => {
    const pending = deferred<OwnerTrip>();
    get.mockReturnValueOnce(pending.promise);
    renderPage();
    expect(get).toHaveBeenCalledWith(TRIP_A);
    expect(screen.getByRole("status")).toHaveTextContent("Loading trip…");
    expect(pageHeading()).toHaveTextContent("Trip");
    await act(async () => {
      pending.resolve(tripOf([availableStop(0, null)]));
    });
    expect(pageHeading()).toHaveTextContent("Weekend Waterfalls");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("missing and someone else's trips show the same generic not-found state", async () => {
    get.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    const { view } = renderPage();
    await screen.findByText(/This trip couldn't be found/);
    const pageSection = () => pageHeading().closest("section")!.outerHTML;
    const notFoundHtml = pageSection();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("link", { name: "Discover landmarks" })).toHaveAttribute("href", "/");
    view.unmount();
    get.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    renderPage(`/trips/${TRIP_B}`);
    await screen.findByText(/This trip couldn't be found/);
    expect(pageSection()).toBe(notFoundHtml);
    expect(notFoundHtml).not.toContain(TRIP_A);
  });

  it("a malformed trip ID is the same not-found state, without a request", async () => {
    renderPage("/trips/not-a-trip");
    expect(await screen.findByText(/This trip couldn't be found/)).toBeInTheDocument();
    expect(get).not.toHaveBeenCalled();
  });

  it("an unexpected error offers Try again, which reloads", async () => {
    get.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "Something went wrong."));
    get.mockResolvedValueOnce(tripOf([availableStop(0, null)]));
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load this trip. Please try again.");
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Stops" })).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a malformed response (INVALID_RESPONSE) is an error, never partial data", async () => {
    get.mockRejectedValueOnce(new ApiError(200, "INVALID_RESPONSE", "unexpected"));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load this trip.");
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("429 shows the server's wait time", async () => {
    get.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "Too many", 12));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests. Please try again in 12 seconds.",
    );
  });

  it("an empty trip shows an actionable empty state and no list or total", async () => {
    get.mockResolvedValueOnce(tripOf([]));
    renderPage();
    expect(await screen.findByText("This trip has no stops yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "landmark discovery" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/Straight-line/)).toBeNull();
  });
});

describe("route changes and stale responses", () => {
  it("changing the trip ID clears the old trip at once and ignores its late response", async () => {
    const first = deferred<OwnerTrip>();
    const second = deferred<OwnerTrip>();
    get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderPage();
    act(() => navigateTo(`/trips/${TRIP_B}`));
    expect(get).toHaveBeenLastCalledWith(TRIP_B);
    await act(async () => {
      second.resolve(
        tripOf([availableStop(0, null, "Second Trip Stop")], { id: TRIP_B, name: "B" }),
      );
    });
    expect(pageHeading()).toHaveTextContent("B");
    await act(async () => {
      first.resolve(tripOf([availableStop(0, null, "First Trip Stop")], { name: "A" }));
    });
    expect(pageHeading()).toHaveTextContent("B");
    expect(screen.queryByText("First Trip Stop")).toBeNull();
  });

  it("navigating away from a loaded trip never shows it under the new ID", async () => {
    get.mockResolvedValueOnce(tripOf([availableStop(0, null, "Old Stop")]));
    renderPage();
    await screen.findByText("Old Stop");
    get.mockReturnValueOnce(new Promise(() => undefined));
    act(() => navigateTo(`/trips/${TRIP_B}`));
    expect(screen.queryByText("Old Stop")).toBeNull();
    expect(pageHeading()).toHaveTextContent("Trip");
  });

  it("a response arriving after unmount is ignored without errors", async () => {
    const pending = deferred<OwnerTrip>();
    get.mockReturnValueOnce(pending.promise);
    const consoleError = vi.spyOn(console, "error");
    const { view } = renderPage();
    view.unmount();
    await act(async () => {
      pending.resolve(tripOf([]));
    });
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("the ordered stop list", () => {
  const STOPS = [
    availableStop(0, null, "Example Falls"),
    availableStop(1, 5.24, "Example Arch"),
    unavailableStop(2),
    availableStop(3, null, "Far Falls"),
  ];

  it("is a semantic ordered list numbered by the server's positions, continuing across unavailable stops", async () => {
    get.mockResolvedValueOnce(tripOf(STOPS));
    renderPage();
    await screen.findByRole("list", { name: "Stops" });
    expect(stopsList().tagName).toBe("OL");
    expect(screen.getByRole("heading", { level: 3, name: "Stops" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    const items = stopItems();
    expect(items).toHaveLength(4);
    expect(items.map((li) => li.textContent?.match(/^Stop \d+/)?.[0])).toEqual([
      "Stop 1",
      "Stop 2",
      "Stop 3",
      "Stop 4",
    ]);
  });

  it("an available stop shows its name as a profile link, its category, and its leg", async () => {
    get.mockResolvedValueOnce(tripOf(STOPS));
    renderPage();
    await screen.findByRole("list", { name: "Stops" });
    const [first, second] = stopItems();
    const link = within(second!).getByRole("link", { name: "Example Arch" });
    expect(link).toHaveAttribute("href", `/landmarks/${LANDMARK(1)}`);
    expect(second).toHaveTextContent("Waterfall");
    expect(second).toHaveTextContent("5.2 mi (8.4 km) straight-line from the previous stop");
    // The first stop has no previous-leg text.
    expect(first).not.toHaveTextContent(/previous stop/);
  });

  it("an unavailable stop shows only its number and 'No longer available' — no name, link, category, coordinates, or distance", async () => {
    get.mockResolvedValueOnce(tripOf(STOPS));
    renderPage();
    await screen.findByRole("list", { name: "Stops" });
    const hidden = stopItems()[2]!;
    // Its own text, then the three controls (Increment 3) — nothing else.
    expect(hidden.textContent).toBe("Stop 3No longer availableMove upMove downRemove");
    expect(within(hidden).queryByRole("link")).toBeNull();
    expect(hidden.innerHTML).not.toContain(LANDMARK(2));
    expect(hidden.innerHTML).not.toMatch(/35\.|83\./);
  });

  it("the stop after an unavailable one explains its unmeasured leg", async () => {
    get.mockResolvedValueOnce(tripOf(STOPS));
    renderPage();
    await screen.findByRole("list", { name: "Stops" });
    expect(stopItems()[3]).toHaveTextContent(
      "Distance from the previous stop not measured, because the previous stop is no longer available.",
    );
  });

  it("never renders coordinates, even for available stops", async () => {
    get.mockResolvedValueOnce(tripOf(STOPS));
    const { view } = renderPage();
    await screen.findByRole("list", { name: "Stops" });
    expect(view.container.innerHTML).not.toContain("35.678912");
    expect(view.container.innerHTML).not.toContain("83.591234");
  });

  it("profile links are reachable and followable by keyboard", async () => {
    get.mockResolvedValueOnce(tripOf(STOPS));
    renderPage();
    await screen.findByRole("list", { name: "Stops" });
    const user = userEvent.setup();
    // M05-T06 Increment 3: Rename and Delete trip precede the stop list.
    await user.tab();
    expect(screen.getByRole("button", { name: "Rename" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("button", { name: "Delete trip" })).toHaveFocus();
    // M06-T03 3e: the offline-copy control follows the toolbar (here not eligible: its link).
    await user.tab();
    expect(screen.getByRole("link", { name: "Offline data on this device" })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole("link", { name: "Example Falls" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("location")).toHaveTextContent(`/landmarks/${LANDMARK(0)}`);
  });
});

describe("distances", () => {
  it("partial total: measured count, explanation, and the disclaimer", async () => {
    get.mockResolvedValueOnce(
      tripOf([
        availableStop(0, null),
        availableStop(1, 5.24),
        unavailableStop(2),
        availableStop(3, null),
      ]),
    );
    renderPage();
    await screen.findByRole("list", { name: "Stops" });
    expect(
      screen.getByText(
        "Straight-line total of 1 of 3 legs: 5.2 mi (8.4 km). Legs next to a stop that is no longer available are not measured.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Straight-line distances, not travel or trail distances."),
    ).toBeVisible();
  });

  it("complete total", async () => {
    get.mockResolvedValueOnce(
      tripOf([availableStop(0, null), availableStop(1, 2), availableStop(2, 3.25)]),
    );
    renderPage();
    expect(await screen.findByText("Straight-line total: 5.3 mi (8.4 km).")).toBeInTheDocument();
  });

  it("no measurable leg: an explicit 'no total', never zero", async () => {
    get.mockResolvedValueOnce(tripOf([unavailableStop(0), availableStop(1, null)]));
    const { view } = renderPage();
    await screen.findByRole("list", { name: "Stops" });
    expect(
      screen.getByText(/^No straight-line total: none of the 1 leg can be measured/),
    ).toBeInTheDocument();
    expect(view.container.textContent).not.toMatch(/0\.0 mi/);
  });

  it("a single stop shows no total, no leg, and no disclaimer", async () => {
    get.mockResolvedValueOnce(tripOf([availableStop(0, null)]));
    const { view } = renderPage();
    await screen.findByRole("list", { name: "Stops" });
    expect(view.container.textContent).not.toMatch(/Straight-line|straight-line|previous stop/);
  });
});

describe("safe rendering", () => {
  it("renders hostile and bidirectional names as plain, isolated text", async () => {
    const hostileName = `<img src=x onerror=alert(1)> ${RLO}evil`;
    get.mockResolvedValueOnce(
      tripOf([availableStop(0, null, hostileName)], { name: `${RLO}gnirts <b>bold</b>` }),
    );
    const { view } = renderPage();
    await screen.findByRole("list", { name: "Stops" });
    // No injected element (map tiles, from Increment 4, are the only images).
    expect(view.container.querySelector('img[src="x"], img[onerror]')).toBeNull();
    expect(
      Array.from(view.container.querySelectorAll("img")).every((img) =>
        img.classList.contains("leaflet-tile"),
      ),
    ).toBe(true);
    expect(view.container.querySelector("b")).toBeNull();
    const headingBdi = pageHeading().querySelector("bdi");
    expect(headingBdi).not.toBeNull();
    expect(headingBdi!.textContent).toBe(`${RLO}gnirts <b>bold</b>`);
    const nameBdi = within(stopsList()).getByRole("link").querySelector("bdi");
    expect(nameBdi!.textContent).toBe(hostileName);
  });

  it("very long names are rendered in full (wrapping is left to CSS)", async () => {
    const longName = "W".repeat(100);
    get.mockResolvedValueOnce(
      tripOf([availableStop(0, null, "L".repeat(300))], { name: longName }),
    );
    renderPage();
    await screen.findByRole("list", { name: "Stops" });
    expect(pageHeading()).toHaveTextContent(longName);
    expect(screen.getByRole("link", { name: "L".repeat(300) })).toBeInTheDocument();
  });
});

describe("waits for state to settle", () => {
  it("only one request is made per trip and user", async () => {
    get.mockResolvedValue(tripOf([]));
    renderPage();
    await waitFor(() =>
      expect(screen.getByText("This trip has no stops yet.")).toBeInTheDocument(),
    );
    expect(get).toHaveBeenCalledTimes(1);
  });
});
