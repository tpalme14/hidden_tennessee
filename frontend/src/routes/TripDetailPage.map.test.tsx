import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import {
  getTrip,
  removeTripStop,
  reorderTripStops,
  type OwnerTrip,
  type TripStop,
} from "../api/trips";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { TripDetailPage } from "./TripDetailPage";

/**
 * M05-T04 Increment 4 — the trip map inside the page, with the REAL `useTrip`
 * (API module mocked): one state for list and map, so numbering always
 * matches; the map changes only after a server-confirmed change; and every
 * path that drops the trip (failed re-read, 401, session loss, another trip)
 * drops the map with it. No extra request is ever made for map data.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  getTrip: vi.fn(),
  removeTripStop: vi.fn(),
  reorderTripStops: vi.fn(),
}));

const get = vi.mocked(getTrip);
const remove = vi.mocked(removeTripStop);
const reorder = vi.mocked(reorderTripStops);

const TRIP_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TRIP_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TIME = "2026-11-23T16:00:00.000Z";
const STOP = (k: string) => `00000000-0000-4000-8000-${String(k.charCodeAt(0)).padStart(12, "0")}`;
const LANDMARK = (k: string) =>
  `11111111-1111-4111-8111-${String(k.charCodeAt(0)).padStart(12, "0")}`;
const NAMES: Record<string, string> = {
  A: "Alpha Falls",
  B: "Beta Arch",
  D: "Delta Falls",
  E: "Echo Falls",
};

function stop(key: string, position: number): TripStop {
  if (key === "C") {
    return {
      id: STOP(key),
      position,
      is_available: false,
      distance_from_previous_miles: null,
      landmark: { id: LANDMARK(key), is_available: false },
    };
  }
  return {
    id: STOP(key),
    position,
    is_available: true,
    distance_from_previous_miles: null,
    landmark: {
      id: LANDMARK(key),
      display_name: NAMES[key]!,
      category: "falls",
      latitude: 35 + key.charCodeAt(0) / 100,
      longitude: -84,
    },
  };
}

function trip(keys: string[], version = 3, id = TRIP_A): OwnerTrip {
  return {
    id,
    name: "Weekend Waterfalls",
    version,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops: keys.map((k, i) => stop(k, i)),
    distance_summary: {
      total_miles: null,
      measured_legs: 0,
      total_legs: Math.max(keys.length - 1, 0),
    },
  };
}

let navigateTo: (path: string) => void = () => undefined;
function Navigator() {
  const navigate = useNavigate();
  navigateTo = (path) => void navigate(path);
  return null;
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
      <Routes>
        <Route path="/trips/:tripId" element={<TripDetailPage />} />
      </Routes>
      <Navigator />
    </AuthContext.Provider>
  );
}

async function renderReady(initial: OwnerTrip = trip(["A", "B", "C", "D"])) {
  get.mockResolvedValueOnce(initial);
  const path = `/trips/${TRIP_A}`;
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Harness session={{ status: "authenticated", user: TEST_USER }} />
    </MemoryRouter>,
  );
  await screen.findByRole("list", { name: "Stops" });
  return {
    view,
    setSession(next: SessionState) {
      view.rerender(
        <MemoryRouter initialEntries={[path]}>
          <Harness session={next} />
        </MemoryRouter>,
      );
    },
  };
}

const markerLabels = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".leaflet-marker-icon")).map((m) =>
    m.getAttribute("aria-label"),
  );
const listNumbersOfAvailable = () =>
  within(screen.getByRole("list", { name: "Stops" }))
    .getAllByRole("listitem")
    .filter((li) => !li.textContent?.includes("No longer available"))
    .map((li) => {
      const n = li.textContent?.match(/^Stop (\d+)/)?.[1];
      const name = within(li).getByRole("link").textContent;
      return `Stop ${n}: ${name}, Waterfall`;
    });
const hasMap = () => document.querySelector(".leaflet-container") !== null;

let fetchSpy: ReturnType<typeof vi.spyOn>;

/**
 * Finds a live region (status, alert, or aria-live) whose FULL text matches —
 * messages render names in their own <bdi> elements (Increment 6), so the text
 * spans several nodes and `findByText` cannot match it.
 */
async function findMessage(text: string | RegExp): Promise<HTMLElement> {
  let found: HTMLElement | undefined;
  await waitFor(() => {
    const regions = Array.from(
      document.querySelectorAll<HTMLElement>("[role=status], [role=alert], [aria-live]"),
    );
    found = regions.find((r) => {
      const content = r.textContent ?? "";
      return typeof text === "string" ? content.includes(text) : text.test(content);
    });
    expect(found).toBeDefined();
  });
  return found!;
}

beforeEach(() => {
  get.mockReset();
  remove.mockReset();
  reorder.mockReset();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("one state for the list and the map", () => {
  it("marker numbers and names equal the list's available stops", async () => {
    await renderReady();
    expect(markerLabels()).toEqual(listNumbersOfAvailable());
    expect(markerLabels()).toEqual([
      "Stop 1: Alpha Falls, Waterfall",
      "Stop 2: Beta Arch, Waterfall",
      "Stop 4: Delta Falls, Waterfall",
    ]);
  });

  it("no request is made for map data: only the one trip read, and no fetch at all", async () => {
    await renderReady();
    expect(get).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a move changes the map only after the server confirms; then both renumber together", async () => {
    await renderReady();
    const move = deferred<OwnerTrip>();
    reorder.mockReturnValueOnce(move.promise);
    await userEvent.click(screen.getByRole("button", { name: "Move up: Beta Arch" }));
    expect(markerLabels()).toContain("Stop 2: Beta Arch, Waterfall"); // nothing optimistic
    await act(async () => move.resolve(trip(["B", "A", "C", "D"], 4)));
    expect([...markerLabels()].sort()).toEqual([...listNumbersOfAvailable()].sort());
    expect(markerLabels()).toContain("Stop 1: Beta Arch, Waterfall");
  });

  it("a removal updates the map from the fresh trip", async () => {
    await renderReady();
    remove.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce(trip(["A", "C", "D"], 4));
    await userEvent.click(screen.getByRole("button", { name: "Remove Beta Arch from the trip" }));
    await findMessage(/Removed Beta Arch/);
    expect(markerLabels()).toEqual([
      "Stop 1: Alpha Falls, Waterfall",
      "Stop 3: Delta Falls, Waterfall",
    ]);
  });

  it("a stop that became unavailable in the fresh trip loses its marker", async () => {
    await renderReady(trip(["A", "B"]));
    remove.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce({
      ...trip(["C", "D"], 4),
    });
    await userEvent.click(screen.getByRole("button", { name: "Remove Alpha Falls from the trip" }));
    await findMessage(/Removed Alpha Falls/);
    expect(markerLabels()).toEqual(["Stop 2: Delta Falls, Waterfall"]);
  });
});

describe("the map goes with the trip", () => {
  it("a failed re-read removes the map with the outdated list", async () => {
    await renderReady();
    remove.mockResolvedValueOnce(undefined);
    get.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    await userEvent.click(screen.getByRole("button", { name: "Remove Beta Arch from the trip" }));
    await screen.findByRole("button", { name: "Reload trip" });
    expect(hasMap()).toBe(false);
    expect(document.querySelectorAll(".leaflet-marker-icon")).toHaveLength(0);
  });

  it("a 401 removes the map", async () => {
    await renderReady();
    reorder.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "Authentication required."));
    await userEvent.click(screen.getByRole("button", { name: "Move up: Beta Arch" }));
    await screen.findByText(/session may have ended/);
    expect(hasMap()).toBe(false);
  });

  it("a session check failure removes the map; a late move result never restores old markers", async () => {
    const harness = await renderReady();
    const move = deferred<OwnerTrip>();
    reorder.mockReturnValueOnce(move.promise);
    await userEvent.click(screen.getByRole("button", { name: "Move up: Beta Arch" }));
    harness.setSession({ status: "unavailable", retry: vi.fn() });
    expect(hasMap()).toBe(false);
    await act(async () => move.resolve(trip(["B", "A", "C", "D"], 4)));
    expect(hasMap()).toBe(false);
    expect(markerLabels()).toEqual([]);
  });

  it("another trip never shows the previous trip's markers", async () => {
    await renderReady();
    const other = deferred<OwnerTrip>();
    get.mockReturnValueOnce(other.promise);
    act(() => navigateTo(`/trips/${TRIP_B}`));
    expect(hasMap()).toBe(false);
    await act(async () => other.resolve(trip(["E"], 1, TRIP_B)));
    expect(markerLabels()).toEqual(["Stop 1: Echo Falls, Waterfall"]);
  });
});

describe("focus fallback", () => {
  it("removing the stop whose marker has focus is handled by the list's focus rule, never stranded on <body>", async () => {
    await renderReady();
    // Focus the Beta marker, then remove Beta through its list button by keyboard-free click,
    // which moves focus to the button first (the user's deliberate choice).
    remove.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce(trip(["A", "C", "D"], 4));
    await userEvent.click(screen.getByRole("button", { name: "Remove Beta Arch from the trip" }));
    await findMessage(/Removed Beta Arch/);
    expect(document.activeElement).not.toBe(document.body);
    expect(
      screen.getByRole("button", { name: "Remove stop 2 (no longer available) from the trip" }),
    ).toHaveFocus();
  });

  it("a focused marker that disappears after a refresh hands focus to the Stops heading", async () => {
    await renderReady();
    const betaMarker = Array.from(
      document.querySelectorAll<HTMLElement>(".leaflet-marker-icon"),
    ).find((m) => m.getAttribute("aria-label")?.includes("Beta Arch"))!;
    // A concurrent change elsewhere: a version conflict re-read in which Beta is gone,
    // triggered by the keyboard user who is still on the Beta marker.
    reorder.mockRejectedValueOnce(new ApiError(409, "TRIP_VERSION_CONFLICT", "changed"));
    get.mockResolvedValueOnce(trip(["A", "D"], 7));
    const moveButton = screen.getByRole("button", { name: "Move down: Alpha Falls" });
    moveButton.click();
    betaMarker.focus();
    await screen.findByText(/This trip changed since you loaded it/);
    expect(markerLabels()).toEqual([
      "Stop 1: Alpha Falls, Waterfall",
      "Stop 2: Delta Falls, Waterfall",
    ]);
    expect(screen.getByRole("heading", { level: 3, name: "Stops" })).toHaveFocus();
  });
});
