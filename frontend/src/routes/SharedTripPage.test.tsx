import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useLayoutEffect } from "react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { getSharedTrip, type SharedTrip, type TripStop } from "../api/trips";
import { deferred } from "../auth/testFixtures";
import { TripStopList } from "../trips/TripStopList";
import { SHARED_TRIP_ROBOTS } from "../trips/useRobotsNoindex";
import { SHARED_TRIP_UNAVAILABLE_TEXT, SharedTripPage } from "./SharedTripPage";

/**
 * M05-T06 Increment 5a — the public shared-trip page with the REAL
 * `useSharedTrip` hook and the existing read-only components (the shared-trip
 * client mocked): every state, the token lifecycle, read-only presentation
 * from the validated shared data only, map identity, robots metadata, and
 * token confidentiality. Authentication independence is covered with the
 * real App in `SharedTripPage.app.test.tsx`.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  getSharedTrip: vi.fn(),
}));

const shared = vi.mocked(getSharedTrip);

const TOKEN_A = `${"A".repeat(21)}_${"a".repeat(21)}`;
const TOKEN_B = `${"B".repeat(21)}-${"b".repeat(21)}`;
const RLO = String.fromCodePoint(0x202e);
const LANDMARK = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;

function available(
  n: number,
  position: number,
  distance: number | null,
  coords: [number, number] = [35.6 + n / 100, -83.5],
): TripStop {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    position,
    is_available: true,
    distance_from_previous_miles: distance,
    landmark: {
      id: LANDMARK(n),
      display_name: `Falls ${n}`,
      category: "falls",
      latitude: coords[0],
      longitude: coords[1],
    },
  };
}

function unavailable(n: number, position: number): TripStop {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    position,
    is_available: false,
    distance_from_previous_miles: null,
    landmark: { id: LANDMARK(n), is_available: false },
  };
}

function sharedTrip(stops: TripStop[], name = "Weekend Waterfalls"): SharedTrip {
  const legs = stops
    .map((s) => s.distance_from_previous_miles)
    .filter((d): d is number => d !== null);
  return {
    name,
    stops,
    distance_summary: {
      total_miles: legs.length === 0 ? null : legs.reduce((a, b) => a + b, 0),
      measured_legs: legs.length,
      total_legs: Math.max(stops.length - 1, 0),
    },
  };
}

/** A, (unavailable), C, D — where D shares C's exact point. */
const MIXED = sharedTrip([
  available(1, 0, null),
  unavailable(2, 1),
  available(3, 2, null, [35.7, -83.4]),
  available(4, 3, 0, [35.7, -83.4]),
]);

let navigateTo: (to: string) => void = () => undefined;
function Navigator() {
  const navigate = useNavigate();
  navigateTo = (to) => void navigate(to);
  return null;
}

/**
 * Records, in EVERY commit (layout effects run after the commit's DOM changes
 * and before passive effects), the page heading shown for the token in the
 * URL — so a previous trip shown for even one commit after a token change is
 * caught, not only the state after effects settle.
 */
let commits: { pathname: string; heading: string }[] = [];
function CommitProbe() {
  const location = useLocation();
  useLayoutEffect(() => {
    const heading = document.querySelector("h2")?.textContent ?? "";
    commits.push({ pathname: location.pathname, heading });
  });
  return null;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/shared/trips/:shareToken" element={<SharedTripPage />} />
        <Route path="/landmarks/:id" element={<p>Profile page</p>} />
        <Route path="/" element={<p>Discovery page</p>} />
      </Routes>
      <button type="button">Elsewhere</button>
      <Navigator />
      <CommitProbe />
    </MemoryRouter>,
  );
}

const robotsTags = () => document.head.querySelectorAll('meta[name="robots"]');
const status = () => screen.getByRole("status");
const markerLabels = () =>
  Array.from(document.querySelectorAll<HTMLElement>(".leaflet-marker-icon")).map((m) =>
    m.getAttribute("aria-label"),
  );

beforeEach(() => {
  shared.mockReset();
  for (const tag of Array.from(robotsTags())) tag.remove();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("states", () => {
  it("loading, then the trip: heading, view-only notice, stops in server order", async () => {
    const pending = deferred<SharedTrip>();
    shared.mockReturnValueOnce(pending.promise);
    renderAt(`/shared/trips/${TOKEN_A}`);
    expect(status()).toHaveTextContent("Loading shared trip…");
    expect(screen.getByRole("heading", { level: 2, name: "Shared trip" })).toBeInTheDocument();
    expect(shared).toHaveBeenCalledWith(TOKEN_A);
    await act(async () => pending.resolve(MIXED));
    expect(
      screen.getByRole("heading", { level: 2, name: "Weekend Waterfalls" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Shared trip — view only/)).toBeInTheDocument();
    const items = within(screen.getByRole("list", { name: "Stops" })).getAllByRole("listitem");
    expect(items.map((i) => i.textContent?.slice(0, 6))).toEqual([
      "Stop 1",
      "Stop 2",
      "Stop 3",
      "Stop 4",
    ]);
    expect(status()).toHaveTextContent("");
  });

  it.each(["", "short", `${TOKEN_A}x`, `${TOKEN_A.slice(1)}=`, `${TOKEN_A.slice(3)}%2F`])(
    "a malformed token (%j) is the generic unavailable page, with no request",
    (token) => {
      renderAt(`/shared/trips/${encodeURIComponent(token) || "%20"}`);
      expect(screen.getByText(SHARED_TRIP_UNAVAILABLE_TEXT)).toBeInTheDocument();
      expect(shared).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );

  it.each<[string, ApiError]>([
    ["404", new ApiError(404, "NOT_FOUND", "Resource not found.")],
    ["400", new ApiError(400, "INVALID_REQUEST", "bad")],
  ])("%s is the same generic unavailable page", async (_label, error) => {
    shared.mockRejectedValueOnce(error);
    renderAt(`/shared/trips/${TOKEN_A}`);
    expect(await screen.findByText(SHARED_TRIP_UNAVAILABLE_TEXT)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.body.textContent).not.toContain("Resource not found");
  });

  it.each<[string, Error]>([
    ["a network error", new ApiError(0, "NETWORK_ERROR", "x")],
    ["a 5xx", new ApiError(503, "SERVICE_UNAVAILABLE", "internal detail")],
    ["an invalid response", new ApiError(200, "INVALID_RESPONSE", "x")],
  ])(
    "%s: one alert with Try again, never retried automatically; Try again loads and focuses the heading",
    async (_l, error) => {
      shared.mockRejectedValueOnce(error).mockResolvedValueOnce(MIXED);
      renderAt(`/shared/trips/${TOKEN_A}`);
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Couldn't load this shared trip. Please try again.");
      expect(alert).not.toHaveTextContent("internal detail");
      expect(shared).toHaveBeenCalledTimes(1);
      await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
      const heading = await screen.findByRole("heading", { level: 2, name: "Weekend Waterfalls" });
      expect(heading).toHaveFocus();
      expect(shared).toHaveBeenCalledTimes(2);
      expect(screen.queryByRole("alert")).toBeNull();
    },
  );
});

describe("token lifecycle", () => {
  it("a token change hides the previous trip at once, and a late response for it is ignored", async () => {
    const first = deferred<SharedTrip>();
    const second = deferred<SharedTrip>();
    shared.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    renderAt(`/shared/trips/${TOKEN_A}`);
    act(() => navigateTo(`/shared/trips/${TOKEN_B}`));
    await act(async () => second.resolve(sharedTrip([available(5, 0, null)], "Trip B")));
    expect(screen.getByRole("heading", { level: 2, name: "Trip B" })).toBeInTheDocument();
    await act(async () => first.resolve(sharedTrip([available(1, 0, null)], "Trip A")));
    expect(screen.getByRole("heading", { level: 2, name: "Trip B" })).toBeInTheDocument();
    expect(screen.queryByText("Falls 1")).toBeNull();
  });

  it("the previous trip is never shown while the next token loads or after it fails", async () => {
    const next = deferred<SharedTrip>();
    shared.mockResolvedValueOnce(MIXED).mockReturnValueOnce(next.promise);
    renderAt(`/shared/trips/${TOKEN_A}`);
    await screen.findByRole("heading", { level: 2, name: "Weekend Waterfalls" });
    commits = [];
    act(() => navigateTo(`/shared/trips/${TOKEN_B}`));
    // Not for a single commit: every commit under token B's URL showed no trip A heading.
    const underB = commits.filter((c) => c.pathname.includes(TOKEN_B));
    expect(underB.length).toBeGreaterThan(0);
    expect(underB.every((c) => c.heading === "Shared trip")).toBe(true);
    expect(screen.queryByRole("heading", { level: 2, name: "Weekend Waterfalls" })).toBeNull();
    expect(screen.queryByRole("list", { name: "Stops" })).toBeNull();
    expect(markerLabels()).toEqual([]);
    expect(status()).toHaveTextContent("Loading shared trip…");
    await act(async () => next.reject(new ApiError(404, "NOT_FOUND", "x")));
    expect(screen.getByText(SHARED_TRIP_UNAVAILABLE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText("Falls 1")).toBeNull();
  });

  it("a response after leaving the page writes nothing", async () => {
    const pending = deferred<SharedTrip>();
    shared.mockReturnValueOnce(pending.promise);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    renderAt(`/shared/trips/${TOKEN_A}`);
    act(() => navigateTo("/"));
    await act(async () => pending.resolve(MIXED));
    expect(screen.getByText("Discovery page")).toBeInTheDocument();
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("read-only presentation from the validated shared data", () => {
  it("available stops link to profiles; unavailable stops show only the placeholder", async () => {
    shared.mockResolvedValueOnce(MIXED);
    renderAt(`/shared/trips/${TOKEN_A}`);
    const list = await screen.findByRole("list", { name: "Stops" });
    const items = within(list).getAllByRole("listitem");
    expect(within(items[0]!).getByRole("link", { name: "Falls 1" })).toHaveAttribute(
      "href",
      `/landmarks/${LANDMARK(1)}`,
    );
    expect(items[1]).toHaveTextContent("Stop 2No longer available");
    expect(within(items[1]!).queryByRole("link")).toBeNull();
    expect(items[1]!.textContent).not.toMatch(/Falls 2|falls/i);
    expect(document.body.innerHTML).not.toContain(LANDMARK(2));
  });

  it("no owner control, metadata, or mutation affordance is present", async () => {
    shared.mockResolvedValueOnce(MIXED);
    renderAt(`/shared/trips/${TOKEN_A}`);
    await screen.findByRole("list", { name: "Stops" });
    for (const name of [
      /rename/i,
      /delete/i,
      /remove/i,
      /move (up|down)/i,
      /find nearby/i,
      /add to/i,
      /share link|new link|turn off sharing|copy link/i,
    ]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    expect(screen.queryByRole("region", { name: "Sharing" })).toBeNull();
    expect(screen.queryByLabelText("Trip name")).toBeNull();
    expect(screen.queryByText(/version|updated|created/i)).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("the map shows available stops only, numbered with gaps, one combined marker at a shared point, no route", async () => {
    shared.mockResolvedValueOnce(MIXED);
    renderAt(`/shared/trips/${TOKEN_A}`);
    await screen.findByRole("list", { name: "Stops" });
    const labels = markerLabels();
    expect(labels).toHaveLength(2);
    expect(labels.some((l) => l?.startsWith("Stop 1"))).toBe(true);
    expect(labels.some((l) => l?.includes("Stops 3,4, 2 at the same location"))).toBe(true);
    expect(labels.join(" ")).not.toContain("Stop 2");
    expect(
      document.querySelector(".leaflet-overlay-pane path, .leaflet-overlay-pane svg path"),
    ).toBeNull();
  });

  it("partial distance total, straight-line disclaimer, and no distance bridging an unavailable stop", async () => {
    const trip = sharedTrip([
      available(1, 0, null),
      available(2, 1, 5.24),
      unavailable(3, 2),
      available(4, 3, null),
    ]);
    shared.mockResolvedValueOnce(trip);
    renderAt(`/shared/trips/${TOKEN_A}`);
    await screen.findByRole("list", { name: "Stops" });
    expect(document.body).toHaveTextContent(
      "Straight-line distances, not travel or trail distances.",
    );
    expect(document.body).toHaveTextContent(/1 of 3 legs/);
    const items = within(screen.getByRole("list", { name: "Stops" })).getAllByRole("listitem");
    expect(items[3]!.textContent).not.toMatch(/\d+(\.\d)? mi/);
  });

  it("a complete total for a fully available trip", async () => {
    shared.mockResolvedValueOnce(
      sharedTrip([available(1, 0, null), available(2, 1, 2), available(3, 2, 3)]),
    );
    renderAt(`/shared/trips/${TOKEN_A}`);
    await screen.findByRole("list", { name: "Stops" });
    expect(document.body).toHaveTextContent(/5\.0 mi/);
    expect(document.body).not.toHaveTextContent(/of 2 legs/);
  });

  it("a single stop: no total; an empty trip: the shared empty wording and no map", async () => {
    shared.mockResolvedValueOnce(sharedTrip([available(1, 0, null)]));
    const view = renderAt(`/shared/trips/${TOKEN_A}`);
    await screen.findByRole("list", { name: "Stops" });
    expect(document.body).not.toHaveTextContent(/Straight-line total/);
    view.unmount();

    shared.mockResolvedValueOnce(sharedTrip([], "Empty Trip"));
    renderAt(`/shared/trips/${TOKEN_B}`);
    await screen.findByRole("heading", { level: 2, name: "Empty Trip" });
    expect(screen.getByText("This trip has no stops.")).toBeInTheDocument();
    expect(screen.queryByText(/Find a landmark to add/)).toBeNull();
    expect(screen.queryByRole("heading", { name: "Map" })).toBeNull();
  });

  it("an all-unavailable trip: placeholders and the map's explanation, no markers", async () => {
    shared.mockResolvedValueOnce(sharedTrip([unavailable(1, 0), unavailable(2, 1)]));
    renderAt(`/shared/trips/${TOKEN_A}`);
    await screen.findByRole("list", { name: "Stops" });
    expect(screen.getAllByText("No longer available")).toHaveLength(2);
    expect(markerLabels()).toEqual([]);
    expect(
      screen.getByText(/None of this trip.s stops can be shown on the map/),
    ).toBeInTheDocument();
  });

  it("names are direction-isolated plain text", async () => {
    const hostile = `<b>x</b>${RLO}Trip`;
    shared.mockResolvedValueOnce(sharedTrip([{ ...available(1, 0, null) }], hostile));
    renderAt(`/shared/trips/${TOKEN_A}`);
    const heading = await screen.findByRole("heading", { level: 2, name: hostile });
    expect(heading.querySelector("bdi")?.textContent).toBe(hostile);
    expect(document.querySelector("b")).toBeNull();
    expect(screen.getByRole("link", { name: "Falls 1" }).querySelector("bdi")).not.toBeNull();
  });
});

describe("map identity", () => {
  it("a new token never inherits the previous map's markers or a focused marker", async () => {
    shared
      .mockResolvedValueOnce(sharedTrip([available(1, 0, null)], "Trip A"))
      .mockResolvedValueOnce(sharedTrip([available(9, 0, null, [36.1, -84.2])], "Trip B"));
    renderAt(`/shared/trips/${TOKEN_A}`);
    await screen.findByRole("heading", { level: 2, name: "Trip A" });
    const markerA = document.querySelector<HTMLElement>(".leaflet-marker-icon")!;
    markerA.focus();
    expect(markerA).toHaveFocus();
    act(() => navigateTo(`/shared/trips/${TOKEN_B}`));
    expect(markerA.isConnected).toBe(false);
    await screen.findByRole("heading", { level: 2, name: "Trip B" });
    expect(markerLabels()).toEqual([expect.stringContaining("Falls 9")]);
    expect(document.activeElement).not.toBe(markerA);
  });
});

describe("robots metadata", () => {
  it.each<[string, () => void]>([
    ["loading", () => shared.mockReturnValueOnce(new Promise(() => undefined))],
    ["ready", () => shared.mockResolvedValueOnce(MIXED)],
    ["unavailable", () => shared.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "x"))],
    ["error", () => shared.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x"))],
  ])("one noindex, nofollow tag while %s", async (_label, arrange) => {
    arrange();
    renderAt(`/shared/trips/${TOKEN_A}`);
    await waitFor(() => expect(robotsTags()).toHaveLength(1));
    expect(robotsTags()[0]).toHaveAttribute("content", SHARED_TRIP_ROBOTS);
  });

  it("present for a malformed token too, never duplicated across token changes, removed when leaving", async () => {
    shared.mockResolvedValue(MIXED);
    renderAt("/shared/trips/bad");
    expect(robotsTags()).toHaveLength(1);
    act(() => navigateTo(`/shared/trips/${TOKEN_A}`));
    act(() => navigateTo(`/shared/trips/${TOKEN_B}`));
    expect(robotsTags()).toHaveLength(1);
    act(() => navigateTo("/"));
    expect(robotsTags()).toHaveLength(0);
  });

  it("an existing robots tag is restored, not removed, when leaving; no other head element is touched", async () => {
    const existing = document.createElement("meta");
    existing.setAttribute("name", "robots");
    existing.setAttribute("content", "index, follow");
    document.head.appendChild(existing);
    const before = Array.from(document.head.children)
      .filter((e) => e !== existing)
      .map((e) => e.outerHTML);
    shared.mockResolvedValue(MIXED);
    renderAt(`/shared/trips/${TOKEN_A}`);
    expect(robotsTags()).toHaveLength(1);
    expect(existing).toHaveAttribute("content", SHARED_TRIP_ROBOTS);
    act(() => navigateTo("/"));
    expect(robotsTags()).toHaveLength(1);
    expect(existing).toHaveAttribute("content", "index, follow");
    expect(
      Array.from(document.head.children)
        .filter((e) => e !== existing)
        .map((e) => e.outerHTML),
    ).toEqual(before);
    existing.remove();
  });
});

describe("token confidentiality", () => {
  it("the token is not stored, logged, announced, or used in IDs, metadata, or the title", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((l) =>
      vi.spyOn(console, l),
    );
    shared
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", `failed ${TOKEN_A}`))
      .mockResolvedValueOnce(MIXED);
    renderAt(`/shared/trips/${TOKEN_A}`);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain(TOKEN_A);
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    await screen.findByRole("list", { name: "Stops" });
    expect(setItem).not.toHaveBeenCalled();
    for (const spy of logs) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN_A);
    }
    expect(document.body.innerHTML).not.toContain(TOKEN_A);
    expect(document.head.innerHTML).not.toContain(TOKEN_A);
    expect(document.title).not.toContain(TOKEN_A);
    for (const element of Array.from(document.querySelectorAll("[id]"))) {
      expect(element.id).not.toContain(TOKEN_A);
    }
  });
});

describe("owner presentation unchanged", () => {
  it("TripStopList without emptyState keeps the owner's empty state", () => {
    render(
      <MemoryRouter>
        <TripStopList stops={[]} />
      </MemoryRouter>,
    );
    expect(screen.getByText("This trip has no stops yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "landmark discovery" })).toBeInTheDocument();
  });
});
