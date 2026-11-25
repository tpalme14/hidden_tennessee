import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../api/auth";
import { ApiError } from "../api/client";
import { getLandmarkGeoMarkers } from "../api/landmarks";
import {
  addTripStop,
  getTrip,
  removeTripStop,
  reorderTripStops,
  TRIP_STOP_ALREADY_EXISTS,
  TRIP_STOP_LIMIT_REACHED,
  type AddedTripStop,
  type OwnerTrip,
  type TripStop,
} from "../api/trips";
import type { LandmarkCollectionResponse } from "../api/types";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { TripDetailPage } from "./TripDetailPage";

/**
 * M05-T05 Increment 4 — "Add to this trip" from the nearby results, with the
 * REAL `useTrip` (one change lock for add, remove, and reorder) and the real
 * nearby hook; the API modules are mocked. Every success is followed by an
 * authoritative re-read; nothing is shown before the server confirms.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  getTrip: vi.fn(),
  addTripStop: vi.fn(),
  removeTripStop: vi.fn(),
  reorderTripStops: vi.fn(),
}));
vi.mock("../api/landmarks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/landmarks")>()),
  getLandmarkGeoMarkers: vi.fn(),
}));

const get = vi.mocked(getTrip);
const add = vi.mocked(addTripStop);
const remove = vi.mocked(removeTripStop);
const reorder = vi.mocked(reorderTripStops);
const geo = vi.mocked(getLandmarkGeoMarkers);

const TRIP_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TIME = "2026-11-23T16:00:00.000Z";
const OTHER_USER: AuthUser = { ...TEST_USER, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const STOP_ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LANDMARK = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const NEAR = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;

/** An available stop for landmark `lm` (an ID) named `name`. */
function stop(n: number, position: number, lm = LANDMARK(n), name = `Stop place ${n}`): TripStop {
  return {
    id: STOP_ID(n),
    position,
    is_available: true,
    distance_from_previous_miles: position === 0 ? null : 1.5,
    landmark: {
      id: lm,
      display_name: name,
      category: "falls",
      latitude: 35.5 + n / 100,
      longitude: -84,
    },
  };
}

function hiddenStop(n: number, position: number, lm = LANDMARK(n)): TripStop {
  return {
    id: STOP_ID(n),
    position,
    is_available: false,
    distance_from_previous_miles: null,
    landmark: { id: lm, is_available: false },
  };
}

function trip(stops: TripStop[], version = 3): OwnerTrip {
  const legs = stops
    .map((s) => s.distance_from_previous_miles)
    .filter((d): d is number => d !== null);
  return {
    id: TRIP_A,
    name: "Weekend Waterfalls",
    version,
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
  };
}

/** Stop 1 (origin), stop 2, and an unavailable stop 3 whose landmark is NEAR(9). */
const BASE = trip([stop(1, 0), stop(2, 1), hiddenStop(3, 2, NEAR(9))]);

function item(n: number, name: string, distance: number, lat = 35.6 + n / 100) {
  return {
    id: NEAR(n),
    display_name: name,
    category: "falls",
    latitude: lat,
    longitude: -84.2,
    distance_miles: distance,
  };
}

function page(items: ReturnType<typeof item>[]): LandmarkCollectionResponse {
  return { items, page: 1, limit: 200, has_more: false, is_truncated: false };
}

const RESULTS = page([item(1, "Near One", 1), item(2, "Near Two", 2), item(9, "Hidden Again", 3)]);

function added(landmarkId: string, position: number): AddedTripStop {
  return {
    id: STOP_ID(50),
    position,
    is_available: true,
    landmark: {
      id: landmarkId,
      display_name: "x",
      category: "falls",
      latitude: 35.7,
      longitude: -84.2,
    },
  } as AddedTripStop;
}

/** BASE plus NEAR(n) appended as stop 4. */
function withNear(n: number, name: string, base = BASE): OwnerTrip {
  const appended: TripStop = {
    id: STOP_ID(50 + n),
    position: base.stops.length,
    is_available: true,
    distance_from_previous_miles: null,
    landmark: {
      id: NEAR(n),
      display_name: name,
      category: "falls",
      latitude: 35.6 + n / 100,
      longitude: -84.2,
    },
  };
  return trip([...base.stops, appended], base.version + 1);
}

function Harness({ session, auth }: { session: SessionState; auth: Partial<AuthContextValue> }) {
  const value: AuthContextValue = {
    session,
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
    ...auth,
  };
  return (
    <AuthContext.Provider value={value}>
      <button type="button">Outside</button>
      <Routes>
        <Route path="/trips/:tripId" element={<TripDetailPage />} />
      </Routes>
    </AuthContext.Provider>
  );
}

async function renderReady(initial: OwnerTrip = BASE) {
  get.mockResolvedValueOnce(initial);
  geo.mockResolvedValue(RESULTS);
  const refresh = vi.fn(() => Promise.resolve());
  const path = `/trips/${TRIP_A}`;
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Harness session={{ status: "authenticated", user: TEST_USER }} auth={{ refresh }} />
    </MemoryRouter>,
  );
  await screen.findByRole("list", { name: "Stops" });
  await userEvent.click(screen.getByRole("button", { name: "Find nearby: Stop 1, Stop place 1" }));
  await screen.findByRole("list", { name: /^Landmarks near Stop/ });
  return {
    view,
    refresh,
    setSession(next: SessionState) {
      view.rerender(
        <MemoryRouter initialEntries={[path]}>
          <Harness session={next} auth={{ refresh }} />
        </MemoryRouter>,
      );
    },
  };
}

const panel = () => document.getElementById("trip-nearby-panel");
const resultsList = () =>
  panel()?.querySelector<HTMLElement>('ul[aria-label^="Landmarks near Stop"]') ?? null;
const addButton = (name: string) =>
  within(resultsList()!).queryByRole("button", { name: `Add to this trip: ${name}` });
const rowOf = (name: string) => within(resultsList()!).getByRole("link", { name }).closest("li")!;
const pageStatus = () =>
  document.querySelector<HTMLElement>(
    "section[aria-labelledby='trip-heading'] > p[role='status']",
  )!;
const tripStopNames = () =>
  within(screen.getByRole("list", { name: "Stops" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);
const tripMarkers = () =>
  screen
    .getByRole("region", { name: "Map of the trip's available stops" })
    .querySelectorAll(".leaflet-marker-icon");
const nearbyMarkerLabels = () =>
  Array.from(
    screen
      .getByRole("region", { name: "Map of the search origin and nearby landmarks" })
      .querySelectorAll<HTMLElement>(".leaflet-marker-icon"),
  ).map((m) => m.getAttribute("aria-label"));

beforeEach(() => {
  get.mockReset();
  add.mockReset();
  remove.mockReset();
  reorder.mockReset();
  geo.mockReset();
});

describe("eligibility and presentation", () => {
  it("offers Add on non-member rows of the current search only; members — including an unavailable stop's landmark — show their stop", async () => {
    await renderReady();
    const buttons = within(resultsList()!).getAllByRole("button", { name: /^Add to this trip/ });
    expect(buttons.map((b) => [b.textContent, b.getAttribute("aria-label")])).toEqual([
      ["Add to this trip", "Add to this trip: Near One"],
      ["Add to this trip", "Add to this trip: Near Two"],
    ]);
    expect(rowOf("Hidden Again").textContent).toMatch(/In this trip \(Stop 3\)$/);
    expect(within(rowOf("Hidden Again")).queryByRole("button")).toBeNull();
    // The map popups and markers get no mutation controls.
    expect(
      screen
        .getByRole("region", { name: "Map of the search origin and nearby landmarks" })
        .querySelectorAll("button"),
    ).toHaveLength(0);
  });

  it("names are isolated; the control name starts with its visible text", async () => {
    const rlo = String.fromCodePoint(0x202e);
    get.mockResolvedValueOnce(BASE);
    geo.mockResolvedValue(page([item(4, `${rlo}evil`, 1)]));
    render(
      <MemoryRouter initialEntries={[`/trips/${TRIP_A}`]}>
        <Harness session={{ status: "authenticated", user: TEST_USER }} auth={{}} />
      </MemoryRouter>,
    );
    await screen.findByRole("list", { name: "Stops" });
    await userEvent.click(
      screen.getByRole("button", { name: "Find nearby: Stop 1, Stop place 1" }),
    );
    const button = await within(
      await screen.findByRole("list", { name: /^Landmarks near Stop/ }),
    ).findByRole("button");
    expect(button.getAttribute("aria-label")!.startsWith(button.textContent!)).toBe(true);
    expect(button.closest("li")!.querySelector("bdi")!.textContent).toBe(`${rlo}evil`);
  });

  it("previous-radius results kept during an update or after a failure have no Add controls", async () => {
    await renderReady();
    const next = deferred<LandmarkCollectionResponse>();
    geo.mockReturnValueOnce(next.promise);
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Radius" }), "50");
    expect(within(resultsList()!).queryAllByRole("button")).toHaveLength(0);
    expect(within(panel()!).getByText(/^Landmarks can be added again once a search/)).toBeTruthy();
    await act(async () => {
      next.reject(new ApiError(500, "INTERNAL", "x"));
      await Promise.resolve();
    });
    expect(within(resultsList()!).queryAllByRole("button")).toHaveLength(0);
  });

  it("a full trip (25 stops, unavailable ones counted) offers no Add and says why; room again restores it", async () => {
    const stops = Array.from({ length: 25 }, (_, i) =>
      i === 24 ? hiddenStop(30 + i, i) : stop(30 + i, i),
    );
    const full = trip(stops);
    get.mockResolvedValueOnce(full);
    geo.mockResolvedValue(RESULTS);
    render(
      <MemoryRouter initialEntries={[`/trips/${TRIP_A}`]}>
        <Harness session={{ status: "authenticated", user: TEST_USER }} auth={{}} />
      </MemoryRouter>,
    );
    await screen.findByRole("list", { name: "Stops" });
    await userEvent.click(
      screen.getByRole("button", { name: "Find nearby: Stop 1, Stop place 30" }),
    );
    await screen.findByRole("list", { name: /^Landmarks near Stop/ });
    expect(within(resultsList()!).queryAllByRole("button")).toHaveLength(0);
    expect(within(panel()!).getByText(/^This trip is full: it has 25 stops/)).toBeTruthy();
    remove.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce(trip(stops.slice(0, 24), 4));
    await userEvent.click(
      screen.getByRole("button", { name: "Remove stop 25 (no longer available) from the trip" }),
    );
    await waitFor(() => expect(addButton("Near One")).not.toBeNull());
    expect(within(panel()!).queryByText(/^This trip is full/)).toBeNull();
    expect(geo).toHaveBeenCalledTimes(1);
  });
});

describe("a successful addition", () => {
  it("posts the current trip and landmark, changes nothing until the re-read, then shows the server's trip everywhere", async () => {
    await renderReady();
    const posted = deferred<AddedTripStop>();
    add.mockReturnValueOnce(posted.promise);
    const reread = deferred<OwnerTrip>();
    get.mockReturnValueOnce(reread.promise);
    const originMarkerBefore = screen
      .getByRole("region", { name: "Map of the search origin and nearby landmarks" })
      .querySelector(".leaflet-marker-icon");

    await userEvent.click(addButton("Near One")!);
    expect(add).toHaveBeenCalledWith(TRIP_A, NEAR(1));
    expect(pageStatus().textContent).toBe("Adding stop…");
    expect(addButton("Near One")).toHaveAttribute("aria-disabled", "true");
    expect(addButton("Near Two")).toHaveAttribute("aria-disabled", "true");
    expect(
      screen.getByRole("button", { name: "Remove Stop place 2 from the trip" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(tripStopNames()).toHaveLength(3); // no optimistic stop

    await act(async () => {
      posted.resolve(added(NEAR(1), 3));
      await Promise.resolve();
    });
    expect(get).toHaveBeenCalledTimes(2); // the authoritative re-read
    expect(tripStopNames()).toHaveLength(3); // still nothing until it lands
    expect(pageStatus().textContent).toBe("Updating the trip…");

    await act(async () => {
      reread.resolve(withNear(1, "Near One"));
      await Promise.resolve();
    });
    await waitFor(() => expect(tripStopNames()).toHaveLength(4));
    expect(tripStopNames()[3]).toMatch(/^Stop 4Near One/);
    expect(tripMarkers()).toHaveLength(3);
    expect(rowOf("Near One").textContent).toMatch(/In this trip \(Stop 4\)$/);
    expect(addButton("Near One")).toBeNull();
    expect(nearbyMarkerLabels()).toContain(
      "Near One, Waterfall, About 1.0 mi (1.6 km), straight-line, in this trip (Stop 4)",
    );
    expect(pageStatus().textContent).toBe(
      "Added Near One to the trip as stop 4. The trip has 4 stops.",
    );
    expect(panel()!.querySelector("p[role='status']")!.textContent).not.toMatch(/Added/);
    // Focus: the Add control was replaced, so the row's profile link.
    expect(within(rowOf("Near One")).getByRole("link")).toHaveFocus();
    // No new proximity request; the nearby map kept its markers.
    expect(geo).toHaveBeenCalledTimes(1);
    expect(
      screen
        .getByRole("region", { name: "Map of the search origin and nearby landmarks" })
        .querySelector(".leaflet-marker-icon"),
    ).toBe(originMarkerBefore);
    expect(screen.getByText(/^Straight-line total/)).toBeTruthy();
  });

  it("if the re-read no longer contains the landmark (changed elsewhere), the latest trip is shown as it is", async () => {
    await renderReady();
    add.mockResolvedValueOnce(added(NEAR(1), 3));
    get.mockResolvedValueOnce(trip(BASE.stops, 5));
    await userEvent.click(addButton("Near One")!);
    await waitFor(() =>
      expect(pageStatus().textContent).toBe(
        "Added Near One, but the latest trip doesn't include it — it may have been changed elsewhere. The latest trip is shown.",
      ),
    );
    expect(addButton("Near One")).not.toBeNull();
  });
});

describe("one change at a time", () => {
  it("rapid clicks on the same row and on different rows send one request", async () => {
    await renderReady();
    const posted = deferred<AddedTripStop>();
    add.mockReturnValueOnce(posted.promise);
    fireEvent.click(addButton("Near One")!);
    fireEvent.click(addButton("Near One")!);
    fireEvent.click(addButton("Near Two")!);
    expect(add).toHaveBeenCalledTimes(1);
    // Remove and reorder are locked out too.
    fireEvent.click(screen.getByRole("button", { name: "Remove Stop place 2 from the trip" }));
    fireEvent.click(screen.getByRole("button", { name: "Move down: Stop place 1" }));
    expect(remove).not.toHaveBeenCalled();
    expect(reorder).not.toHaveBeenCalled();
    get.mockResolvedValueOnce(withNear(1, "Near One"));
    await act(async () => {
      posted.resolve(added(NEAR(1), 3));
      await Promise.resolve();
    });
    await waitFor(() => expect(addButton("Near One")).toBeNull());
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("clicks in the same task (before React re-renders) are still refused by the shared synchronous lock", async () => {
    await renderReady();
    const posted = deferred<AddedTripStop>();
    add.mockReturnValueOnce(posted.promise);
    const one = addButton("Near One")!;
    const two = addButton("Near Two")!;
    const removeButton = screen.getByRole("button", { name: "Remove Stop place 2 from the trip" });
    act(() => {
      one.click();
      two.click();
      removeButton.click();
    });
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(TRIP_A, NEAR(1));
    expect(remove).not.toHaveBeenCalled();
    get.mockResolvedValueOnce(withNear(1, "Near One"));
    await act(async () => {
      posted.resolve(added(NEAR(1), 3));
      await Promise.resolve();
    });
    await waitFor(() => expect(addButton("Near One")).toBeNull());
  });

  it("a pending removal blocks additions", async () => {
    await renderReady();
    const removing = deferred<void>();
    remove.mockReturnValueOnce(removing.promise);
    fireEvent.click(screen.getByRole("button", { name: "Remove Stop place 2 from the trip" }));
    fireEvent.click(addButton("Near One")!);
    expect(add).not.toHaveBeenCalled();
    get.mockResolvedValueOnce(trip([stop(1, 0), hiddenStop(3, 1, NEAR(9))], 4));
    await act(async () => {
      removing.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(tripStopNames()).toHaveLength(2));
  });
});

describe("refusals and conflicts", () => {
  it("409 already exists: re-reads, shows membership, announces; no second add", async () => {
    await renderReady();
    add.mockRejectedValueOnce(new ApiError(409, TRIP_STOP_ALREADY_EXISTS, "exists"));
    get.mockResolvedValueOnce(withNear(2, "Near Two"));
    await userEvent.click(addButton("Near Two")!);
    await waitFor(() =>
      expect(pageStatus().textContent).toBe(
        "Near Two is already in this trip. The latest trip is shown.",
      ),
    );
    expect(rowOf("Near Two").textContent).toMatch(/In this trip \(Stop 4\)$/);
    expect(within(rowOf("Near Two")).getByRole("link")).toHaveFocus();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("409 limit reached: re-reads the full trip; Add disappears with the full-trip notice", async () => {
    await renderReady();
    add.mockRejectedValueOnce(new ApiError(409, TRIP_STOP_LIMIT_REACHED, "full"));
    const stops = Array.from({ length: 25 }, (_, i) => (i === 0 ? stop(1, 0) : stop(60 + i, i)));
    get.mockResolvedValueOnce(trip(stops, 9));
    await userEvent.click(addButton("Near One")!);
    await waitFor(() =>
      expect(pageStatus().textContent).toBe(
        "This trip already has 25 stops, the most a trip can hold. The latest trip is shown.",
      ),
    );
    expect(within(resultsList()!).queryAllByRole("button")).toHaveLength(0);
    expect(within(panel()!).getByText(/^This trip is full/)).toBeTruthy();
  });

  it("a generic 404 with the trip still readable: the landmark can't be added (no reason given); focus stays on Add", async () => {
    await renderReady();
    add.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Not found"));
    get.mockResolvedValueOnce(BASE);
    await userEvent.click(addButton("Near One")!);
    await waitFor(() =>
      expect(pageStatus().textContent).toBe(
        "Near One can't be added to this trip. The latest trip is shown.",
      ),
    );
    expect(pageStatus().textContent).not.toMatch(/sensitive|protected|retired|classif/i);
    expect(addButton("Near One")).toHaveFocus();
  });

  it("a generic 404 whose re-read finds no trip shows the generic not-found page", async () => {
    await renderReady();
    add.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Not found"));
    get.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Not found"));
    await userEvent.click(addButton("Near One")!);
    await screen.findByText(/This trip couldn.t be found/);
    expect(panel()).toBeNull();
  });

  it.each<[string, ApiError, RegExp]>([
    [
      "400 INVALID_REQUEST",
      new ApiError(400, "INVALID_REQUEST", "bad"),
      /^Couldn't change the trip\. Please try again\.$/,
    ],
    [
      "403 INVALID_ORIGIN",
      new ApiError(403, "INVALID_ORIGIN", "origin"),
      /^Couldn't change the trip\. Please try again\.$/,
    ],
    [
      "429 with Retry-After",
      new ApiError(429, "RATE_LIMITED", "slow", 12),
      /Please try again in 12 seconds\.$/,
    ],
  ])("%s: an alert, nothing re-read or replayed, focus stays on Add", async (_l, error, text) => {
    await renderReady();
    add.mockRejectedValueOnce(error);
    await userEvent.click(addButton("Near One")!);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(text);
    expect(get).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
    expect(addButton("Near One")).toHaveFocus();
  });

  it("401: the trip and panel are cleared and the session is re-checked", async () => {
    const { refresh } = await renderReady();
    add.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "no"));
    await userEvent.click(addButton("Near One")!);
    await screen.findByText(/your session may have ended/);
    expect(panel()).toBeNull();
    expect(refresh).toHaveBeenCalled();
  });
});

describe("uncertain outcomes", () => {
  it.each<[string, Error]>([
    ["a network error", new ApiError(0, "NETWORK_ERROR", "offline")],
    ["a 500", new ApiError(500, "INTERNAL", "boom")],
    ["an unreadable response", new ApiError(201, "INVALID_RESPONSE", "bad body")],
  ])(
    "%s, landmark present after the re-read: shown as a member; never re-sent",
    async (_l, error) => {
      await renderReady();
      add.mockRejectedValueOnce(error);
      get.mockResolvedValueOnce(withNear(1, "Near One"));
      await userEvent.click(addButton("Near One")!);
      await waitFor(() =>
        expect(pageStatus().textContent).toBe(
          "Couldn't confirm the change, but Near One is in the trip. The latest trip is shown.",
        ),
      );
      expect(addButton("Near One")).toBeNull();
      expect(add).toHaveBeenCalledTimes(1);
    },
  );

  it("landmark absent after the re-read: Add is offered again; only an explicit retry sends another request", async () => {
    await renderReady();
    add.mockRejectedValueOnce(new ApiError(503, "UNAVAILABLE", "x"));
    get.mockResolvedValueOnce(BASE);
    await userEvent.click(addButton("Near One")!);
    await waitFor(() =>
      expect(pageStatus().textContent).toBe(
        "Couldn't confirm whether Near One was added. It isn't in the trip — you can try again.",
      ),
    );
    expect(addButton("Near One")).toHaveFocus();
    expect(add).toHaveBeenCalledTimes(1);
    add.mockResolvedValueOnce(added(NEAR(1), 3));
    get.mockResolvedValueOnce(withNear(1, "Near One"));
    await userEvent.click(addButton("Near One")!);
    await waitFor(() => expect(addButton("Near One")).toBeNull());
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("an uncertain outcome whose re-read fails: the trip must be reloaded; no Add is offered", async () => {
    await renderReady();
    add.mockRejectedValueOnce(new ApiError(500, "INTERNAL", "x"));
    get.mockRejectedValueOnce(new ApiError(500, "INTERNAL", "y"));
    await userEvent.click(addButton("Near One")!);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(
      /^Couldn't confirm whether your change was saved, and the trip couldn't be loaded\. Reload the trip/,
    );
    expect(panel()).toBeNull();
    expect(within(alert).getByRole("button", { name: "Reload trip" })).toHaveFocus();
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("201 then a failed re-read: says the stop WAS added, invites a reload, never a repeat", async () => {
    await renderReady();
    add.mockResolvedValueOnce(added(NEAR(1), 3));
    get.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    await userEvent.click(addButton("Near One")!);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(
      /^The stop was added, but the updated trip couldn't be loaded\. Reload the trip before making more changes\./,
    );
    expect(alert.textContent).not.toMatch(/try again/i);
    expect(panel()).toBeNull();
    expect(screen.queryByRole("list", { name: "Stops" })).toBeNull();
    expect(within(alert).getByRole("button", { name: "Reload trip" })).toHaveFocus();
  });
});

describe("lifecycle during a pending addition", () => {
  it("closing the panel does not cancel the addition; its result is announced and focus is not taken", async () => {
    await renderReady();
    const posted = deferred<AddedTripStop>();
    add.mockReturnValueOnce(posted.promise);
    await userEvent.click(addButton("Near One")!);
    await userEvent.click(screen.getByRole("button", { name: "Close nearby landmarks" }));
    const findNearby = screen.getByRole("button", { name: "Find nearby: Stop 1, Stop place 1" });
    expect(findNearby).toHaveFocus();
    get.mockResolvedValueOnce(withNear(1, "Near One"));
    await act(async () => {
      posted.resolve(added(NEAR(1), 3));
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(pageStatus().textContent).toBe(
        "Added Near One to the trip as stop 4. The trip has 4 stops.",
      ),
    );
    expect(panel()).toBeNull();
    expect(findNearby).toHaveFocus();
  });

  it("switching to another stop's search: the new search is kept and keeps focus; the addition is reconciled", async () => {
    await renderReady();
    const posted = deferred<AddedTripStop>();
    add.mockReturnValueOnce(posted.promise);
    await userEvent.click(addButton("Near One")!);
    await userEvent.click(
      screen.getByRole("button", { name: "Find nearby: Stop 2, Stop place 2" }),
    );
    const heading = screen.getByRole("heading", { level: 3, name: /^Near Stop 2/ });
    expect(heading).toHaveFocus();
    get.mockResolvedValueOnce(withNear(1, "Near One"));
    await act(async () => {
      posted.resolve(added(NEAR(1), 3));
      await Promise.resolve();
    });
    await waitFor(() => expect(tripStopNames()).toHaveLength(4));
    expect(screen.getByRole("heading", { level: 3, name: /^Near Stop 2/ })).toHaveFocus();
    expect(geo).toHaveBeenCalledTimes(2);
  });

  it.each<[string, SessionState]>([
    ["signed out", { status: "anonymous" }],
    ["another user", { status: "authenticated", user: OTHER_USER }],
  ])(
    "%s while pending: the late response changes nothing and announces nothing",
    async (_l, next) => {
      const { setSession } = await renderReady();
      const posted = deferred<AddedTripStop>();
      add.mockReturnValueOnce(posted.promise);
      await userEvent.click(addButton("Near One")!);
      get.mockResolvedValue(BASE);
      setSession(next);
      expect(panel()).toBeNull();
      await act(async () => {
        posted.resolve(added(NEAR(1), 3));
        await Promise.resolve();
      });
      expect(pageStatus().textContent).not.toMatch(/Added/);
      expect(panel()).toBeNull();
    },
  );

  it("unmounting while pending: the late response writes nothing", async () => {
    const { view } = await renderReady();
    const posted = deferred<AddedTripStop>();
    add.mockReturnValueOnce(posted.promise);
    await userEvent.click(addButton("Near One")!);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    view.unmount();
    await act(async () => {
      posted.resolve(added(NEAR(1), 3));
      await Promise.resolve();
    });
    expect(get).toHaveBeenCalledTimes(1);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("focus the user moved elsewhere during the addition stays there", async () => {
    await renderReady();
    const posted = deferred<AddedTripStop>();
    add.mockReturnValueOnce(posted.promise);
    await userEvent.click(addButton("Near One")!);
    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    get.mockResolvedValueOnce(withNear(1, "Near One"));
    await act(async () => {
      posted.resolve(added(NEAR(1), 3));
      await Promise.resolve();
    });
    await waitFor(() => expect(addButton("Near One")).toBeNull());
    expect(outside).toHaveFocus();
  });
});
