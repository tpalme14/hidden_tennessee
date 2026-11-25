import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { getLandmarkGeoMarkers } from "../api/landmarks";
import type { LandmarkCollectionResponse } from "../api/types";
import {
  getTrip,
  removeTripStop,
  reorderTripStops,
  type OwnerTrip,
  type TripStop,
} from "../api/trips";
import type { AuthUser } from "../api/auth";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { TripDetailPage } from "./TripDetailPage";

/**
 * M05-T05 Increment 2 — the read-only nearby panel inside the trip page, with
 * the REAL `useTrip` and `useNearbyLandmarks` (API modules mocked): entry
 * points, panel content, radius, states, completeness, membership, lifecycle,
 * focus, and announcements.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  getTrip: vi.fn(),
  removeTripStop: vi.fn(),
  reorderTripStops: vi.fn(),
}));
vi.mock("../api/landmarks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/landmarks")>()),
  getLandmarkGeoMarkers: vi.fn(),
}));

const get = vi.mocked(getTrip);
const remove = vi.mocked(removeTripStop);
const reorder = vi.mocked(reorderTripStops);
const geo = vi.mocked(getLandmarkGeoMarkers);

const TRIP_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TIME = "2026-11-23T16:00:00.000Z";
const OTHER_USER: AuthUser = { ...TEST_USER, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const STOP = (k: string) => `00000000-0000-4000-8000-${String(k.charCodeAt(0)).padStart(12, "0")}`;
const LANDMARK = (k: string) =>
  `11111111-1111-4111-8111-${String(k.charCodeAt(0)).padStart(12, "0")}`;
const NEAR = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const NAMES: Record<string, string> = {
  A: "Alpha Falls",
  B: "Beta Arch",
  D: "Delta Falls",
};

function stop(key: string, position: number, lat?: number): TripStop {
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
      category: key === "B" ? "arch" : "falls",
      latitude: lat ?? 35 + key.charCodeAt(0) / 100,
      longitude: -84,
    },
  };
}

function trip(keys: string[], version = 3, stops?: TripStop[]): OwnerTrip {
  const list = stops ?? keys.map((k, i) => stop(k, i));
  return {
    id: TRIP_A,
    name: "Weekend Waterfalls",
    version,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops: list,
    distance_summary: {
      total_miles: null,
      measured_legs: 0,
      total_legs: Math.max(list.length - 1, 0),
    },
  };
}

function item(id: string, name: string, distance: number, category = "falls") {
  return {
    id,
    display_name: name,
    category,
    latitude: 35.6,
    longitude: -84.1,
    distance_miles: distance,
  };
}

function page(
  items: ReturnType<typeof item>[],
  flags: { has_more?: boolean; is_truncated?: boolean } = {},
): LandmarkCollectionResponse {
  return {
    items,
    page: 1,
    limit: 200,
    has_more: flags.has_more ?? false,
    is_truncated: flags.is_truncated ?? false,
  };
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
      <button type="button">Outside</button>
      <Routes>
        <Route path="/trips/:tripId" element={<TripDetailPage />} />
        <Route path="/landmarks/:id" element={<p>Profile page</p>} />
      </Routes>
    </AuthContext.Provider>
  );
}

/** Each nearby request returns a promise the test settles. */
function controlled() {
  const calls: ReturnType<typeof deferred<LandmarkCollectionResponse>>[] = [];
  geo.mockImplementation(() => {
    const d = deferred<LandmarkCollectionResponse>();
    calls.push(d);
    return d.promise;
  });
  return calls;
}

async function settle(
  d: ReturnType<typeof deferred<LandmarkCollectionResponse>>,
  value: LandmarkCollectionResponse | Error,
) {
  await act(async () => {
    if (value instanceof Error) d.reject(value);
    else d.resolve(value);
    await Promise.resolve();
  });
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

const findNearby = (n: number, name: string) =>
  screen.getByRole("button", { name: `Find nearby: Stop ${n}, ${name}` });
const panel = () => document.getElementById("trip-nearby-panel");
const panelHeading = () => screen.queryByRole("heading", { level: 3, name: /^Near Stop/ });
const radiusSelect = () => screen.getByRole("combobox", { name: "Radius" }) as HTMLSelectElement;
/** The primary results list (the map, below it, has its own links and images). */
const resultsList = () =>
  panel()!.querySelector<HTMLElement>('ul[aria-label^="Landmarks near Stop"]');
const results = () =>
  resultsList() === null
    ? []
    : within(resultsList()!)
        .queryAllByRole("listitem")
        .map((li) => li.textContent);
const pageStatus = () =>
  document.querySelector<HTMLElement>(
    "section[aria-labelledby='trip-heading'] > p[role='status']",
  )!;
const panelStatus = () => panel()!.querySelector<HTMLElement>("p[role='status']")!;

beforeEach(() => {
  get.mockReset();
  remove.mockReset();
  reorder.mockReset();
  geo.mockReset();
});

describe("entry points", () => {
  it("offers Find nearby on available stops only, named from the visible text, without fetching", async () => {
    controlled();
    await renderReady();
    const buttons = screen.getAllByRole("button", { name: /^Find nearby/ });
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Find nearby: Stop 1, Alpha Falls",
      "Find nearby: Stop 2, Beta Arch",
      "Find nearby: Stop 4, Delta Falls",
    ]);
    for (const b of buttons) {
      expect(b.textContent).toBe("Find nearby");
      expect(b.getAttribute("aria-label")!.startsWith(b.textContent!)).toBe(true);
      expect(b).toHaveAttribute("aria-expanded", "false");
    }
    const unavailable = screen.getAllByRole("listitem")[2]!;
    expect(within(unavailable).queryByRole("button", { name: /Find nearby/ })).toBeNull();
    expect(geo).not.toHaveBeenCalled();
    expect(panel()).toBeNull();
    // The trip map and distance summary are unchanged.
    expect(document.querySelectorAll(".leaflet-marker-icon")).toHaveLength(3);
  });
});

describe("opening, results, and radius", () => {
  it("opens one panel for the stop (focus on its heading), with the stop's exact coordinates and 25 mi", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(2, "Beta Arch"));
    expect(geo).toHaveBeenCalledTimes(1);
    expect(geo).toHaveBeenCalledWith({
      q: "",
      categories: [],
      geo: { mode: "near", near: "35.66,-84", radius: 25 },
    });
    expect(panelHeading()).toHaveFocus();
    expect(panelHeading()!.textContent).toBe("Near Stop 2: Beta Arch");
    expect(panelHeading()!.querySelector("bdi")?.textContent).toBe("Beta Arch");
    expect(findNearby(2, "Beta Arch")).toHaveAttribute("aria-expanded", "true");
    expect(findNearby(2, "Beta Arch")).toHaveAttribute("aria-controls", "trip-nearby-panel");
    expect(radiusSelect().value).toBe("25");
    expect(panelStatus().textContent).toBe("Finding landmarks within 25 mi (40.2 km) of Stop 2…");
    expect(within(panel()!).getByText(/by straight-line distance/)).toBeTruthy();

    await settle(
      calls[0]!,
      page([
        item(LANDMARK("B"), "Beta Arch", 0, "arch"), // the origin itself
        item(NEAR(1), "Twin Arch", 0, "arch"), // same point, different landmark
        item(NEAR(2), "Small Sink", 0.004, "sink"),
        item(LANDMARK("D"), "Delta Falls", 0.8),
        item(NEAR(3), "Far Bald", 12.34, "bald"),
      ]),
    );
    expect(results()).toEqual([
      "Twin ArchNatural ArchLess than 0.1 mi (less than 0.2 km), straight-lineAdd to this trip",
      "Small SinkSinkholeLess than 0.1 mi (less than 0.2 km), straight-lineAdd to this trip",
      "Delta FallsWaterfallAbout 0.8 mi (1.3 km), straight-lineIn this trip (Stop 4)",
      "Far BaldMountain BaldAbout 12.3 mi (19.9 km), straight-lineAdd to this trip",
    ]);
    const links = within(resultsList()!).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      `/landmarks/${NEAR(1)}`,
      `/landmarks/${NEAR(2)}`,
      `/landmarks/${LANDMARK("D")}`,
      `/landmarks/${NEAR(3)}`,
    ]);
    expect(panelStatus().textContent).toBe("4 landmarks within 25 mi (40.2 km), closest first.");
    // Increment 4: an Add control on each non-member row of the current search; none for the member.
    expect(
      within(resultsList()!)
        .getAllByRole("button", { name: /^Add to this trip/ })
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual([
      "Add to this trip: Twin Arch",
      "Add to this trip: Small Sink",
      "Add to this trip: Far Bald",
    ]);
    expect(panelHeading()).toHaveFocus();
  });

  it("names are plain text in <bdi>, never markup", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    const rlo = String.fromCodePoint(0x202e);
    await settle(
      calls[0]!,
      page([item(NEAR(1), `<img src=x onerror="alert(1)">`, 1), item(NEAR(2), `${rlo}evil`, 2)]),
    );
    expect(resultsList()!.querySelector("img")).toBeNull();
    const bdis = Array.from(resultsList()!.querySelectorAll("bdi")).map((b) => b.textContent);
    expect(bdis).toEqual([`<img src=x onerror="alert(1)">`, `${rlo}evil`]);
  });

  it("radius: allowed choices with kilometres; the displayed-results radius stays distinct from the requested one", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    expect(Array.from(radiusSelect().options).map((o) => o.textContent)).toEqual([
      "5 mi (8.0 km)",
      "10 mi (16.1 km)",
      "25 mi (40.2 km)",
      "50 mi (80.5 km)",
      "100 mi (160.9 km)",
    ]);
    await settle(calls[0]!, page([item(NEAR(1), "Near One", 3)]));
    radiusSelect().focus();
    await userEvent.selectOptions(radiusSelect(), "50");
    expect(geo).toHaveBeenLastCalledWith(
      expect.objectContaining({ geo: { mode: "near", near: "35.65,-84", radius: 50 } }),
    );
    expect(radiusSelect().value).toBe("50");
    expect(within(panel()!).getByText(/^Showing the earlier 1 landmark found within 25 mi/)).toBe(
      within(panel()!).getByText(
        "Showing the earlier 1 landmark found within 25 mi (40.2 km) while the search within 50 mi (80.5 km) loads.",
      ),
    );
    expect(panelStatus().textContent).toBe(
      "Updating: finding landmarks within 50 mi (80.5 km) of Stop 1…",
    );
    expect(within(panel()!).getByRole("list")).toHaveAttribute("aria-busy", "true");
    expect(radiusSelect()).toHaveFocus();
    await settle(calls[1]!, page([item(NEAR(1), "Near One", 3), item(NEAR(2), "Near Two", 30)]));
    // The caption and the status line now both name the NEW radius.
    expect(
      within(panel()!).getByText("2 landmarks within 50 mi (80.5 km), closest first.", {
        selector: "p:not([role])",
      }),
    ).toBeTruthy();
    expect(panelStatus().textContent).toBe("2 landmarks within 50 mi (80.5 km), closest first.");
    expect(within(panel()!).getByRole("list")).not.toHaveAttribute("aria-busy");
    expect(radiusSelect()).toHaveFocus();
  });

  it("keeps the chosen radius for the next search in this session", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await userEvent.selectOptions(radiusSelect(), "10");
    await userEvent.click(screen.getByRole("button", { name: "Close nearby landmarks" }));
    await userEvent.click(findNearby(4, "Delta Falls"));
    expect(radiusSelect().value).toBe("10");
    expect(geo).toHaveBeenLastCalledWith(
      expect.objectContaining({ geo: expect.objectContaining({ radius: 10 }) }),
    );
    expect(calls).toHaveLength(3);
  });
});

describe("errors, empty results, and completeness", () => {
  it.each<[string, Error]>([
    ["a 500", new ApiError(500, "INTERNAL", "boom")],
    ["a 429", new ApiError(429, "RATE_LIMITED", "Too many", 30)],
    ["a network error", new ApiError(0, "NETWORK_ERROR", "offline")],
  ])("%s: a safe alert with Try again, which retries without moving focus", async (_l, error) => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, error);
    const alert = within(panel()!).getByRole("alert");
    expect(alert.textContent).toContain("Nearby landmarks couldn't be loaded. Please try again.");
    expect(alert.textContent).not.toMatch(/boom|Too many|offline|429|500/);
    const retry = within(alert).getByRole("button", { name: "Try again" });
    retry.focus();
    await userEvent.click(retry);
    expect(geo).toHaveBeenCalledTimes(2);
    await settle(calls[1]!, page([item(NEAR(1), "Near One", 1)]));
    expect(within(panel()!).queryByRole("alert")).toBeNull();
    expect(results()).toHaveLength(1);
  });

  it("a failed radius change keeps earlier results, labelled with their own radius and the failure", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page([item(NEAR(1), "Near One", 1)]));
    await userEvent.selectOptions(radiusSelect(), "5");
    await settle(calls[1]!, new ApiError(500, "INTERNAL", "x"));
    expect(
      within(panel()!).getByText(
        "The search within 5 mi (8.0 km) failed. Still showing the earlier 1 landmark found within 25 mi (40.2 km).",
      ),
    ).toBeTruthy();
    expect(results()).toHaveLength(1);
    expect(within(panel()!).getByRole("alert")).toBeTruthy();
  });

  it("empty: a complete result suggests a larger radius; never claims the origin was not found", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page([item(LANDMARK("A"), "Alpha Falls", 0)]));
    const text =
      "No other publicly viewable landmarks were found within 25 mi (40.2 km) of this stop. Try a larger radius.";
    expect(panelStatus().textContent).toBe(text);
    expect(within(panel()!).getAllByText(text)).toHaveLength(2);
    expect(within(panel()!).queryByRole("list")).toBeNull();
  });

  it("empty with more matches reported, or with every item malformed, never says there are no others", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page([item(LANDMARK("A"), "Alpha Falls", 0)], { has_more: true }));
    expect(panelStatus().textContent).toBe(
      "No other landmarks could be listed, although the search reports more matches within 25 mi (40.2 km).",
    );
    await userEvent.selectOptions(radiusSelect(), "10");
    const broken = { ...item(NEAR(5), "Broken", 1), latitude: 200 };
    await settle(calls[1]!, page([broken]));
    expect(panelStatus().textContent).toBe(
      "No results within 10 mi (16.1 km) can be displayed: the results returned could not be shown.",
    );
    expect(panel()!.textContent).not.toMatch(/No other publicly viewable|Broken|200/);
  });

  it("incomplete coverage and partly malformed results are both stated beside the list", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    const broken = { ...item(NEAR(9), "Broken", 1), distance_miles: -1 };
    await settle(
      calls[0]!,
      page([item(NEAR(1), "Near One", 1), broken], { is_truncated: true, has_more: true }),
    );
    expect(results()).toHaveLength(1);
    expect(
      within(panel()!).getByText(
        /^More landmarks are within 25 mi \(40\.2 km\) than are listed here\./,
      ),
    ).toBeTruthy();
    expect(within(panel()!).getByText("1 result could not be displayed.")).toBeTruthy();
    expect(panelStatus().textContent).toBe(
      "1 landmark within 25 mi (40.2 km), closest first. Not every landmark in this radius is listed. 1 result could not be displayed.",
    );
    expect(panel()!.textContent).not.toContain("Broken");
  });
});

describe("switching, closing, and keyboard", () => {
  it("opening another stop replaces the search at once; the first stop's late response is ignored", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page([item(NEAR(1), "Near One", 1)]));
    await userEvent.click(findNearby(4, "Delta Falls"));
    expect(document.querySelectorAll("#trip-nearby-panel")).toHaveLength(1);
    expect(panelHeading()!.textContent).toBe("Near Stop 4: Delta Falls");
    expect(results()).toEqual([]);
    expect(findNearby(1, "Alpha Falls")).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await userEvent.click(findNearby(4, "Delta Falls"));
    await settle(calls[2]!, page([item(NEAR(2), "Stale", 1)]));
    expect(results()).toEqual([]);
    await settle(calls[3]!, page([item(NEAR(3), "Fresh", 1)]));
    expect(within(resultsList()!).getByRole("link").textContent).toBe("Fresh");
  });

  it("Close returns focus to the stop's Find nearby button; a late response does not reopen it", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(2, "Beta Arch"));
    await userEvent.click(screen.getByRole("button", { name: "Close nearby landmarks" }));
    expect(panel()).toBeNull();
    expect(findNearby(2, "Beta Arch")).toHaveFocus();
    await settle(calls[0]!, page([item(NEAR(1), "Near One", 1)]));
    expect(panel()).toBeNull();
    expect(pageStatus().textContent).toBe("");
  });

  it("keyboard: Enter opens, Tab reaches the controls and links, Escape inside closes and restores focus", async () => {
    const calls = controlled();
    await renderReady();
    findNearby(4, "Delta Falls").focus();
    await userEvent.keyboard("{Enter}");
    expect(panelHeading()).toHaveFocus();
    await settle(calls[0]!, page([item(NEAR(1), "Near One", 1)]));
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Close nearby landmarks" })).toHaveFocus();
    await userEvent.tab();
    expect(radiusSelect()).toHaveFocus();
    await userEvent.tab();
    expect(within(panel()!).getByRole("link", { name: "Near One" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(panel()).toBeNull();
    expect(findNearby(4, "Delta Falls")).toHaveFocus();
  });

  it("Escape outside the panel does nothing to it", async () => {
    controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    screen.getByRole("button", { name: "Remove Beta Arch from the trip" }).focus();
    await userEvent.keyboard("{Escape}");
    expect(panel()).not.toBeNull();
  });
});

describe("membership and the origin across trip edits", () => {
  it("renumbers labels and the heading after a reorder, without a new nearby request", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(
      calls[0]!,
      page([item(LANDMARK("B"), "Beta Arch", 0.5, "arch"), item(LANDMARK("D"), "Delta Falls", 1)]),
    );
    expect(results()).toEqual([
      "Beta ArchNatural ArchAbout 0.5 mi (0.8 km), straight-lineIn this trip (Stop 2)",
      "Delta FallsWaterfallAbout 1.0 mi (1.6 km), straight-lineIn this trip (Stop 4)",
    ]);
    reorder.mockResolvedValueOnce(trip(["B", "A", "C", "D"], 4));
    await userEvent.click(screen.getByRole("button", { name: "Move down: Alpha Falls" }));
    await waitFor(() =>
      expect(pageStatus().textContent).toContain("Moved Alpha Falls to position 2 of 4."),
    );
    expect(panelHeading()!.textContent).toBe("Near Stop 2: Alpha Falls");
    expect(results()[0]).toMatch(/In this trip \(Stop 1\)$/);
    expect(geo).toHaveBeenCalledTimes(1);
  });

  it("removing the origin with its Remove button closes the panel, announces why, and keeps the trip's focus plan", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(2, "Beta Arch"));
    await settle(calls[0]!, page([item(NEAR(1), "Near One", 1)]));
    remove.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce(trip(["A", "C", "D"], 4));
    await userEvent.click(screen.getByRole("button", { name: "Remove Beta Arch from the trip" }));
    await screen.findByText(/Removed/, { selector: "section > p[role='status'] *" });
    expect(panel()).toBeNull();
    expect(pageStatus().textContent).toBe(
      "Removed Beta Arch from the trip. The trip has 3 stops. The nearby search was closed because its stop was removed from the trip.",
    );
    // The trip's own focus plan (next stop's Remove) — not the nearby fallback.
    expect(
      screen.getByRole("button", { name: "Remove stop 2 (no longer available) from the trip" }),
    ).toHaveFocus();
  });

  it("an origin that becomes unavailable while focus is in the panel: closed, announced, focus to Stops", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page([item(NEAR(1), "Near One", 1)]));
    within(panel()!).getByRole("link", { name: "Near One" }).focus();
    const hidden = {
      ...stop("A", 1),
      is_available: false,
      landmark: { id: LANDMARK("A"), is_available: false },
    } as TripStop;
    reorder.mockResolvedValueOnce(trip([], 4, [stop("B", 0), hidden, stop("C", 2), stop("D", 3)]));
    fireEvent.click(screen.getByRole("button", { name: "Move down: Alpha Falls" }));
    await screen.findByText(/stop is no longer available/);
    expect(panel()).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Stops" })).toHaveFocus();
  });

  it("an origin whose location changed: closed, focus back to its Find nearby button", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page([item(NEAR(1), "Near One", 1)]));
    within(panel()!).getByRole("link", { name: "Near One" }).focus();
    reorder.mockResolvedValueOnce(
      trip([], 4, [stop("B", 0), stop("A", 1, 36.5), stop("C", 2), stop("D", 3)]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Move down: Alpha Falls" }));
    await screen.findByText(/location changed/);
    expect(panel()).toBeNull();
    expect(findNearby(2, "Alpha Falls")).toHaveFocus();
    expect(geo).toHaveBeenCalledTimes(1);
  });

  it("never takes focus the user moved elsewhere when the panel closes", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page([item(NEAR(1), "Near One", 1)]));
    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    reorder.mockResolvedValueOnce(trip(["B", "D", "C"], 4));
    fireEvent.click(screen.getByRole("button", { name: "Move down: Alpha Falls" }));
    await screen.findByText(/removed from the trip/);
    expect(outside).toHaveFocus();
  });
});

describe("session", () => {
  it.each<[string, SessionState]>([
    ["anonymous", { status: "anonymous" }],
    ["unavailable", { status: "unavailable", retry: () => Promise.resolve() }],
    ["another user", { status: "authenticated", user: OTHER_USER }],
  ])("%s: the panel and its results are cleared, and do not come back", async (_l, next) => {
    const calls = controlled();
    const { setSession } = await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page([item(NEAR(1), "Near One", 1)]));
    await userEvent.selectOptions(radiusSelect(), "50");
    get.mockResolvedValue(trip(["A", "B", "C", "D"]));
    setSession(next);
    expect(panel()).toBeNull();
    expect(screen.queryByText("Near One")).toBeNull();
    await settle(calls[1]!, page([item(NEAR(2), "Late", 1)]));
    setSession({ status: "authenticated", user: TEST_USER });
    await screen.findByRole("list", { name: "Stops" });
    expect(panel()).toBeNull();
    expect(screen.queryByText("Late")).toBeNull();
    expect(geo).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// The supplementary nearby map (M05-T05 Increment 3)
// ---------------------------------------------------------------------------

const nearbyMapRegion = () =>
  screen.queryByRole("region", { name: "Map of the search origin and nearby landmarks" });
const nearbyIcons = () =>
  Array.from(nearbyMapRegion()?.querySelectorAll<HTMLElement>(".leaflet-marker-icon") ?? []);
const tripIcons = () =>
  Array.from(
    screen
      .getByRole("region", { name: "Map of the trip's available stops" })
      .querySelectorAll<HTMLElement>(".leaflet-marker-icon"),
  );

function placed(base: ReturnType<typeof item>, latitude: number, longitude: number) {
  return { ...base, latitude, longitude };
}

const SPREAD = [
  placed(item(NEAR(1), "Near One", 1), 35.7, -84.1),
  placed(item(NEAR(2), "Near Two", 2), 35.8, -84.2),
];

describe("supplementary nearby map", () => {
  it("appears after the list for results: the origin and each result, from the same shown set, with legend and caption", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    expect(nearbyMapRegion()).toBeNull(); // initial loading: no map
    await settle(calls[0]!, page(SPREAD));
    expect(nearbyMapRegion()).not.toBeNull();
    expect(nearbyIcons().map((i) => i.getAttribute("aria-label"))).toEqual([
      "Stop 1, search origin: Alpha Falls",
      "Near One, Waterfall, About 1.0 mi (1.6 km), straight-line",
      "Near Two, Waterfall, About 2.0 mi (3.2 km), straight-line",
    ]);
    const list = resultsList()!;
    expect(
      list.compareDocumentPosition(nearbyMapRegion()!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(panel()!).getByText(
        "The map shows the search origin and the 2 landmarks listed above, within 25 mi (40.2 km).",
      ),
    ).toBeTruthy();
    expect(
      within(panel()!).getByText(/^Legend: the dark square marker labelled “Stop”/),
    ).toBeTruthy();
    // The existing trip map is unchanged.
    expect(tripIcons()).toHaveLength(3);
    expect(geo).toHaveBeenCalledTimes(1);
  });

  it("during a radius update and after its failure the map keeps the earlier results and their radius, with the same markers", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page(SPREAD));
    const before = nearbyIcons();
    await userEvent.selectOptions(radiusSelect(), "50");
    expect(nearbyIcons()).toEqual(before);
    expect(
      within(panel()!).getByText(
        "The map still shows the earlier 2 landmarks found within 25 mi (40.2 km), not results for 50 mi (80.5 km).",
      ),
    ).toBeTruthy();
    await settle(calls[1]!, new ApiError(500, "INTERNAL", "x"));
    expect(nearbyIcons()).toEqual(before);
    expect(
      within(panel()!).getByText(/^The map still shows the earlier 2 landmarks found within 25 mi/),
    ).toBeTruthy();
    expect(geo).toHaveBeenCalledTimes(2);
  });

  it("no map after a failure with nothing kept, or for an empty result made of malformed items; the origin only for a genuine empty result", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, new ApiError(500, "INTERNAL", "x"));
    expect(nearbyMapRegion()).toBeNull();
    await userEvent.click(within(panel()!).getByRole("button", { name: "Try again" }));
    await settle(calls[1]!, page([{ ...item(NEAR(5), "Broken", 1), latitude: 200 }]));
    expect(nearbyMapRegion()).toBeNull();
    await userEvent.selectOptions(radiusSelect(), "10");
    await settle(calls[2]!, page([item(LANDMARK("A"), "Alpha Falls", 0)]));
    expect(nearbyIcons().map((i) => i.getAttribute("aria-label"))).toEqual([
      "Stop 1, search origin: Alpha Falls",
    ]);
    expect(
      within(panel()!).getByText(
        "The map shows the search origin only: no other landmarks were found within 10 mi (16.1 km).",
      ),
    ).toBeTruthy();
  });

  it("a reorder renumbers the origin marker in place, with no request", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page(SPREAD));
    const origin = nearbyIcons()[0]!;
    reorder.mockResolvedValueOnce(trip(["B", "A", "C", "D"], 4));
    await userEvent.click(screen.getByRole("button", { name: "Move down: Alpha Falls" }));
    await waitFor(() =>
      expect(origin.getAttribute("aria-label")).toBe("Stop 2, search origin: Alpha Falls"),
    );
    expect(nearbyIcons()[0]).toBe(origin);
    expect(origin.textContent).toBe("Stop 2");
    expect(geo).toHaveBeenCalledTimes(1);
  });

  it("switching stops removes the earlier map at once; losing the session removes it too", async () => {
    const calls = controlled();
    const { setSession } = await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page(SPREAD));
    await userEvent.click(findNearby(4, "Delta Falls"));
    expect(nearbyMapRegion()).toBeNull();
    await settle(calls[1]!, page(SPREAD));
    expect(nearbyIcons()[0]!.getAttribute("aria-label")).toBe("Stop 4, search origin: Delta Falls");
    setSession({ status: "anonymous" });
    expect(nearbyMapRegion()).toBeNull();
  });

  it("nested Escape: a popup closes first and the panel stays; the next Escape closes the panel", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page(SPREAD));
    const marker = nearbyIcons()[1]!;
    marker.focus();
    fireEvent.keyPress(marker, { key: "Enter", code: "Enter", keyCode: 13, charCode: 13 });
    const popupLink = within(
      nearbyMapRegion()!.querySelector<HTMLElement>(".leaflet-popup")!,
    ).getByRole("link");
    popupLink.focus();
    await userEvent.keyboard("{Escape}");
    expect(nearbyMapRegion()!.querySelector(".leaflet-popup")).toBeNull();
    expect(panel()).not.toBeNull();
    expect(marker).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(panel()).toBeNull();
    expect(findNearby(1, "Alpha Falls")).toHaveFocus();
  });

  it("a focused map marker that leaves the results hands focus to the panel heading", async () => {
    const calls = controlled();
    await renderReady();
    await userEvent.click(findNearby(1, "Alpha Falls"));
    await settle(calls[0]!, page(SPREAD));
    nearbyIcons()[2]!.focus();
    act(() => changeRadiusWithoutFocus("5"));
    await settle(calls[1]!, page([SPREAD[0]!]));
    expect(panelHeading()).toHaveFocus();
  });
});

/** Changes the radius without moving focus (as a script or assistive technology could). */
function changeRadiusWithoutFocus(value: string) {
  fireEvent.change(radiusSelect(), { target: { value } });
}
