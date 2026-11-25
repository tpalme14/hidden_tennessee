import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../api/auth";
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
import { VERSION_CONFLICT_TEXT } from "../trips/tripMessages";
import { TripDetailPage } from "./TripDetailPage";

/**
 * M05-T04 Increment 3 — stop removal, Move up/down, the single-change lock,
 * required re-reads, version conflicts, failure recovery, focus, and
 * announcements, with the REAL `useTrip` hook (API module mocked). No change
 * is ever shown before the server confirms it, and no request is replayed.
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

const OTHER_USER: AuthUser = { ...TEST_USER, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const TRIP_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TRIP_B = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const TIME = "2026-11-23T16:00:00.000Z";
const STOP = (key: string) =>
  `00000000-0000-4000-8000-${key.charCodeAt(0).toString().padStart(12, "0")}`;
const LANDMARK = (key: string) =>
  `11111111-1111-4111-8111-${key.charCodeAt(0).toString().padStart(12, "0")}`;

const NAMES: Record<string, string> = {
  A: "Alpha Falls",
  B: "Beta Arch",
  D: "Delta Falls",
  E: "Echo Falls",
};

/** Builds a stop for key `A`…`E` at `position`; `C` is the unavailable one. */
function stop(key: string, position: number, distance: number | null = null): TripStop {
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
    distance_from_previous_miles: position === 0 ? null : distance,
    landmark: {
      id: LANDMARK(key),
      display_name: NAMES[key]!,
      category: "falls",
      latitude: 35.678912,
      longitude: -83.591234,
    },
  };
}

/** A trip whose stops are `keys` in order; available neighbours get a 1.5-mile leg unless given. */
function trip(keys: string[], version = 3, legs: Record<string, number> = {}): OwnerTrip {
  const stops = keys.map((key, i) => {
    const previous = keys[i - 1];
    const measured = previous !== undefined && previous !== "C" && key !== "C";
    return stop(key, i, measured ? (legs[key] ?? 1.5) : null);
  });
  const measured = stops
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
      total_miles: measured.length === 0 ? null : measured.reduce((a, b) => a + b, 0),
      measured_legs: measured.length,
      total_legs: Math.max(stops.length - 1, 0),
    },
  };
}

let navigateTo: (path: string) => void = () => undefined;
function Navigator() {
  const navigate = useNavigate();
  navigateTo = (path) => void navigate(path);
  return null;
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
        <Route path="/landmarks/:id" element={<p>Profile page</p>} />
      </Routes>
      <button type="button">Elsewhere</button>
      <Navigator />
    </AuthContext.Provider>
  );
}

async function renderReady(initial: OwnerTrip = trip(["A", "B", "C", "D"])) {
  get.mockResolvedValueOnce(initial);
  const refresh = vi.fn(() => Promise.resolve());
  const path = `/trips/${TRIP_A}`;
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Harness session={{ status: "authenticated", user: TEST_USER }} refresh={refresh} />
    </MemoryRouter>,
  );
  await screen.findByRole("list", { name: "Stops" });
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

const btn = (name: string) => screen.getByRole("button", { name });
const status = () => screen.getByRole("status");
const stopsHeading = () => screen.getByRole("heading", { level: 3, name: "Stops" });
const stopIds = () =>
  within(screen.getByRole("list", { name: "Stops" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent?.match(/^Stop \d+/)?.[0]);
const listedNames = () =>
  within(screen.getByRole("list", { name: "Stops" }))
    .queryAllByRole("link")
    .map((a) => a.textContent);

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
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("remove", () => {
  it("removes, shows 'Removing…' then 'Updating…' with controls disabled, re-reads, announces, and focuses the next stop's Remove", async () => {
    await renderReady();
    const removal = deferred<void>();
    remove.mockReturnValueOnce(removal.promise);
    const reread = deferred<OwnerTrip>();
    get.mockReturnValueOnce(reread.promise);

    await userEvent.click(btn("Remove Beta Arch from the trip"));
    expect(remove).toHaveBeenCalledWith(TRIP_A, STOP("B"));
    expect(status()).toHaveTextContent("Removing stop…");
    expect(btn("Remove Alpha Falls from the trip")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("list", { name: "Stops" })).toHaveAttribute("aria-busy", "true");
    expect(listedNames()).toContain("Beta Arch"); // nothing optimistic

    await act(async () => removal.resolve());
    expect(get).toHaveBeenCalledTimes(2);
    expect(status()).toHaveTextContent("Updating the trip…");

    await act(async () => reread.resolve(trip(["A", "C", "D"], 4)));
    expect(listedNames()).toEqual(["Alpha Falls", "Delta Falls"]);
    expect(stopIds()).toEqual(["Stop 1", "Stop 2", "Stop 3"]);
    expect(status()).toHaveTextContent("Removed Beta Arch from the trip. The trip has 3 stops.");
    // The next surviving stop (the unavailable one, now stop 2) gets focus.
    expect(btn("Remove stop 2 (no longer available) from the trip")).toHaveFocus();
    expect(btn("Remove Alpha Falls from the trip")).not.toHaveAttribute("aria-disabled");
  });

  it("removes an unavailable stop, naming it by position only", async () => {
    await renderReady();
    remove.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce(trip(["A", "B", "D"], 4));
    await userEvent.click(btn("Remove stop 3 (no longer available) from the trip"));
    expect(remove).toHaveBeenCalledWith(TRIP_A, STOP("C"));
    expect(await findMessage(/Removed stop 3, which was no longer available\./)).toBeTruthy();
    expect(status().textContent).not.toContain(LANDMARK("C"));
    expect(btn("Remove Delta Falls from the trip")).toHaveFocus();
  });

  it("removing the last listed stop focuses the previous stop's Remove", async () => {
    await renderReady();
    remove.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce(trip(["A", "B", "C"], 4));
    await userEvent.click(btn("Remove Delta Falls from the trip"));
    await findMessage(/Removed Delta Falls/);
    expect(btn("Remove stop 3 (no longer available) from the trip")).toHaveFocus();
  });

  it("removing the only stop shows the empty state and focuses the Stops heading", async () => {
    await renderReady(trip(["A"]));
    remove.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce(trip([], 4));
    await userEvent.click(btn("Remove Alpha Falls from the trip"));
    expect(await screen.findByText("This trip has no stops yet.")).toBeInTheDocument();
    expect(status()).toHaveTextContent("Removed Alpha Falls from the trip. The trip has no stops.");
    expect(stopsHeading()).toHaveFocus();
  });

  it("removal succeeded but the re-read failed: says so (not 'removal failed'), hides the outdated list, never repeats the DELETE, and Reload recovers", async () => {
    await renderReady();
    remove.mockResolvedValueOnce(undefined);
    get.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    await userEvent.click(btn("Remove Beta Arch from the trip"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The stop was removed, but the updated trip couldn't be loaded. Reload the trip before making more changes.",
    );
    expect(alert.textContent).not.toMatch(/couldn't remove|failed to remove/i);
    expect(screen.queryByRole("list", { name: "Stops" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move|^Remove/ })).toBeNull();
    const reload = within(alert).getByRole("button", { name: "Reload trip" });
    expect(reload).toHaveFocus();
    expect(remove).toHaveBeenCalledTimes(1);

    get.mockResolvedValueOnce(trip(["A", "C", "D"], 4));
    await userEvent.click(reload);
    await screen.findByRole("list", { name: "Stops" });
    expect(listedNames()).toEqual(["Alpha Falls", "Delta Falls"]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("a 404 for a stop already removed elsewhere re-reads and says so", async () => {
    await renderReady();
    remove.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    get.mockResolvedValueOnce(trip(["A", "C", "D"], 5));
    await userEvent.click(btn("Remove Beta Arch from the trip"));
    expect(
      await screen.findByText(/That stop had already been removed\. The latest trip is shown\./),
    ).toBeTruthy();
    expect(listedNames()).toEqual(["Alpha Falls", "Delta Falls"]);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("a 404 because the trip itself is gone ends in the generic not-found state", async () => {
    await renderReady();
    remove.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    get.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    await userEvent.click(btn("Remove Beta Arch from the trip"));
    expect(await screen.findByText(/This trip couldn't be found/)).toBeInTheDocument();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("an uncertain failure (network) re-reads without replaying the DELETE", async () => {
    await renderReady();
    remove.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    get.mockResolvedValueOnce(trip(["A", "C", "D"], 4));
    await userEvent.click(btn("Remove Beta Arch from the trip"));
    expect(
      await screen.findByText(
        /Couldn't confirm whether your change was saved\. The latest trip is shown/,
      ),
    ).toBeTruthy();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledTimes(2);
    expect(stopsHeading()).toHaveFocus();
  });

  it("an unexpected 500 is treated as uncertain too: re-read, never replayed", async () => {
    await renderReady();
    remove.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "Something went wrong."));
    get.mockResolvedValueOnce(trip(["A", "B", "C", "D"], 3));
    await userEvent.click(btn("Remove Beta Arch from the trip"));
    await screen.findByText(/Couldn't confirm whether your change was saved/);
    expect(listedNames()).toContain("Beta Arch");
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("429 keeps the trip, shows the wait, and does not re-read", async () => {
    await renderReady();
    remove.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "Too many", 30));
    const target = btn("Remove Beta Arch from the trip");
    await userEvent.click(target);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't change the trip. Too many requests. Please try again in 30 seconds.",
    );
    expect(listedNames()).toContain("Beta Arch");
    expect(get).toHaveBeenCalledTimes(1);
    expect(target).toHaveFocus();
    expect(target).not.toHaveAttribute("aria-disabled");
  });

  it("401 clears the trip at once and re-checks the session", async () => {
    const { refresh } = await renderReady();
    remove.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "Authentication required."));
    await userEvent.click(btn("Remove Beta Arch from the trip"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load this trip because your session may have ended.",
    );
    expect(screen.queryByText("Beta Arch")).toBeNull();
    expect(screen.queryByText("Weekend Waterfalls")).toBeNull();
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});

describe("move up / move down", () => {
  it("sends the complete new order with the current version and shows the server's trip, keeping focus on the same Move button", async () => {
    await renderReady();
    reorder.mockResolvedValueOnce(trip(["A", "C", "B", "D"], 4));
    const down = btn("Move down: Beta Arch");
    await userEvent.click(down);
    expect(reorder).toHaveBeenCalledWith(TRIP_A, [STOP("A"), STOP("C"), STOP("B"), STOP("D")], 3);
    expect(await findMessage("Moved Beta Arch to position 3 of 4.")).toBeTruthy();
    expect(listedNames()).toEqual(["Alpha Falls", "Beta Arch", "Delta Falls"]);
    expect(btn("Move down: Beta Arch")).toHaveFocus();
    expect(get).toHaveBeenCalledTimes(1); // the 200 trip is used as-is
  });

  it("Move up sends the swapped order", async () => {
    await renderReady();
    reorder.mockResolvedValueOnce(trip(["A", "B", "D", "C"], 4));
    await userEvent.click(btn("Move up: Delta Falls"));
    expect(reorder).toHaveBeenCalledWith(TRIP_A, [STOP("A"), STOP("B"), STOP("D"), STOP("C")], 3);
  });

  it("disables Move up on the first stop and Move down on the last", async () => {
    await renderReady();
    expect(btn("Move up: Alpha Falls")).toBeDisabled();
    expect(btn("Move down: Alpha Falls")).toBeEnabled();
    expect(btn("Move down: Delta Falls")).toBeDisabled();
    expect(btn("Move up: Delta Falls")).toBeEnabled();
  });

  it("reaching the top moves focus to the stop's other (enabled) Move button", async () => {
    await renderReady();
    reorder.mockResolvedValueOnce(trip(["B", "A", "C", "D"], 4));
    await userEvent.click(btn("Move up: Beta Arch"));
    await findMessage("Moved Beta Arch to position 1 of 4.");
    expect(btn("Move up: Beta Arch")).toBeDisabled();
    expect(btn("Move down: Beta Arch")).toHaveFocus();
  });

  it("uses the version from the latest server trip for the next move", async () => {
    await renderReady();
    reorder.mockResolvedValueOnce(trip(["A", "C", "B", "D"], 4));
    await userEvent.click(btn("Move down: Beta Arch"));
    await findMessage("Moved Beta Arch to position 3 of 4.");
    reorder.mockResolvedValueOnce(trip(["A", "C", "D", "B"], 5));
    await userEvent.click(btn("Move down: Beta Arch"));
    expect(reorder).toHaveBeenLastCalledWith(
      TRIP_A,
      [STOP("A"), STOP("C"), STOP("D"), STOP("B")],
      4,
    );
    // A repeated kind of message is announced again (a fresh node in the status region).
    expect(await findMessage("Moved Beta Arch to position 4 of 4.")).toBeTruthy();
  });

  it("shows the server's distances after a move (never recalculated)", async () => {
    await renderReady(trip(["A", "B", "D"]));
    reorder.mockResolvedValueOnce(trip(["B", "A", "D"], 4, { A: 7.77, D: 2.22 }));
    await userEvent.click(btn("Move up: Beta Arch"));
    await findMessage("Moved Beta Arch to position 1 of 3.");
    expect(screen.getByText("7.8 mi (12.5 km) straight-line from the previous stop")).toBeTruthy();
    expect(screen.getByText("Straight-line total: 10.0 mi (16.1 km).")).toBeTruthy();
  });

  it("an unavailable stop is moved and announced by position only", async () => {
    await renderReady();
    reorder.mockResolvedValueOnce(trip(["A", "C", "B", "D"], 4));
    await userEvent.click(btn("Move up: stop 3 (no longer available)"));
    expect(
      await findMessage("Moved the stop that is no longer available to position 2 of 4."),
    ).toBeTruthy();
    expect(btn("Move up: stop 2 (no longer available)")).toHaveFocus();
  });

  it("409 TRIP_VERSION_CONFLICT re-reads, shows the latest order, announces the exact wording, focuses Stops, and never replays", async () => {
    await renderReady();
    reorder.mockRejectedValueOnce(
      new ApiError(409, "TRIP_VERSION_CONFLICT", "This trip has changed. Reload it and try again."),
    );
    const reread = deferred<OwnerTrip>();
    get.mockReturnValueOnce(reread.promise);
    await userEvent.click(btn("Move down: Beta Arch"));
    expect(status()).toHaveTextContent("Updating the trip…");
    expect(status()).not.toHaveTextContent(VERSION_CONFLICT_TEXT);
    await act(async () => reread.resolve(trip(["D", "A", "B", "C", "E"], 7)));
    expect(status()).toHaveTextContent(VERSION_CONFLICT_TEXT);
    expect(listedNames()).toEqual(["Delta Falls", "Alpha Falls", "Beta Arch", "Echo Falls"]);
    expect(stopsHeading()).toHaveFocus();
    expect(reorder).toHaveBeenCalledTimes(1);
  });

  it("409 with a failed re-read: no conflict-resolved wording, no controls, Reload offered and focused", async () => {
    await renderReady();
    reorder.mockRejectedValueOnce(new ApiError(409, "TRIP_VERSION_CONFLICT", "changed"));
    get.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x"));
    await userEvent.click(btn("Move down: Beta Arch"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "This trip changed since you loaded it, and the latest version couldn't be loaded. Reload the trip before making more changes.",
    );
    expect(status()).not.toHaveTextContent(VERSION_CONFLICT_TEXT);
    expect(screen.queryByRole("button", { name: /^Move/ })).toBeNull();
    expect(within(alert).getByRole("button", { name: "Reload trip" })).toHaveFocus();
    expect(reorder).toHaveBeenCalledTimes(1);
  });

  it("400 (the stop set changed) re-reads and says the stops changed", async () => {
    await renderReady();
    reorder.mockRejectedValueOnce(new ApiError(400, "INVALID_REQUEST", "stop_ids must list…"));
    get.mockResolvedValueOnce(trip(["A", "B", "D"], 3));
    await userEvent.click(btn("Move down: Beta Arch"));
    expect(
      await screen.findByText(
        "This trip's stops changed since you loaded it. The latest order is shown — try again.",
      ),
    ).toBeTruthy();
    expect(reorder).toHaveBeenCalledTimes(1);
  });

  it("404 during a reorder shows the generic not-found state", async () => {
    await renderReady();
    reorder.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    await userEvent.click(btn("Move down: Beta Arch"));
    expect(await screen.findByText(/This trip couldn't be found/)).toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("an uncertain failure (network, or an unreadable response) re-reads without replaying", async () => {
    await renderReady();
    reorder.mockRejectedValueOnce(new ApiError(200, "INVALID_RESPONSE", "unexpected"));
    get.mockResolvedValueOnce(trip(["A", "C", "B", "D"], 4));
    await userEvent.click(btn("Move down: Beta Arch"));
    await screen.findByText(/Couldn't confirm whether your change was saved/);
    expect(listedNames()).toEqual(["Alpha Falls", "Beta Arch", "Delta Falls"]);
    expect(reorder).toHaveBeenCalledTimes(1);
  });

  it("429 keeps the order and shows the wait", async () => {
    await renderReady();
    reorder.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "Too many", 1));
    await userEvent.click(btn("Move down: Beta Arch"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't change the trip. Too many requests. Please try again in 1 second.",
    );
    expect(listedNames()).toEqual(["Alpha Falls", "Beta Arch", "Delta Falls"]);
    expect(get).toHaveBeenCalledTimes(1);
  });

  it("works from the keyboard", async () => {
    await renderReady();
    reorder.mockResolvedValueOnce(trip(["B", "A", "C", "D"], 4));
    const user = userEvent.setup();
    btn("Move down: Alpha Falls").focus();
    await user.keyboard("{Enter}");
    expect(reorder).toHaveBeenCalledTimes(1);
    await findMessage("Moved Alpha Falls to position 2 of 4.");
    expect(btn("Move down: Alpha Falls")).toHaveFocus();
    reorder.mockResolvedValueOnce(trip(["B", "C", "A", "D"], 5));
    await user.keyboard(" ");
    expect(reorder).toHaveBeenCalledTimes(2);
    expect(await findMessage("Moved Alpha Falls to position 3 of 4.")).toBeTruthy();
  });
});

describe("one change at a time", () => {
  it("rapid repeated clicks send exactly one request (before React re-renders the disabled state)", async () => {
    await renderReady();
    const removal = deferred<void>();
    remove.mockReturnValueOnce(removal.promise);
    const target = btn("Remove Beta Arch from the trip");
    act(() => {
      fireEvent.click(target);
      fireEvent.click(target);
      fireEvent.click(btn("Move down: Alpha Falls"));
      fireEvent.click(btn("Remove Delta Falls from the trip"));
    });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(reorder).not.toHaveBeenCalled();
    get.mockResolvedValueOnce(trip(["A", "C", "D"], 4));
    await act(async () => removal.resolve());
    await findMessage(/Removed Beta Arch/);
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("no change can start during the required re-read", async () => {
    await renderReady();
    remove.mockResolvedValueOnce(undefined);
    const reread = deferred<OwnerTrip>();
    get.mockReturnValueOnce(reread.promise);
    await userEvent.click(btn("Remove Beta Arch from the trip"));
    expect(status()).toHaveTextContent("Updating the trip…");
    fireEvent.click(btn("Move down: Alpha Falls"));
    fireEvent.click(btn("Remove Delta Falls from the trip"));
    expect(reorder).not.toHaveBeenCalled();
    expect(remove).toHaveBeenCalledTimes(1);
    await act(async () => reread.resolve(trip(["A", "C", "D"], 4)));
  });
});

describe("stale responses never write", () => {
  it("a session check failing during a removal clears the trip; the late result is ignored and nothing is re-read; re-verifying fetches fresh", async () => {
    const harness = await renderReady();
    const removal = deferred<void>();
    remove.mockReturnValueOnce(removal.promise);
    await userEvent.click(btn("Remove Beta Arch from the trip"));
    harness.setSession({ status: "unavailable", retry: vi.fn() });
    expect(screen.queryByText("Beta Arch")).toBeNull();
    await act(async () => removal.resolve());
    expect(get).toHaveBeenCalledTimes(1); // no re-read for an invalidated change
    get.mockResolvedValueOnce(trip(["A", "C", "D"], 4));
    harness.setSession({ status: "authenticated", user: TEST_USER });
    expect(get).toHaveBeenCalledTimes(2);
    await screen.findByRole("list", { name: "Stops" });
    expect(listedNames()).toEqual(["Alpha Falls", "Delta Falls"]);
    expect(status()).not.toHaveTextContent(/Removed/);
  });

  it("a different user during a move: the old user's reorder result is dropped", async () => {
    const harness = await renderReady();
    const move = deferred<OwnerTrip>();
    reorder.mockReturnValueOnce(move.promise);
    await userEvent.click(btn("Move down: Beta Arch"));
    get.mockReturnValueOnce(new Promise(() => undefined));
    harness.setSession({ status: "authenticated", user: OTHER_USER });
    await act(async () => move.resolve(trip(["A", "C", "B", "D"], 4)));
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByText(/Moved/)).toBeNull();
  });

  it("a route change during a removal: the old trip's results never show, and the new trip's controls work", async () => {
    await renderReady();
    const removal = deferred<void>();
    remove.mockReturnValueOnce(removal.promise);
    await userEvent.click(btn("Remove Beta Arch from the trip"));
    get.mockResolvedValueOnce({ ...trip(["E"], 9), id: TRIP_B, name: "Other trip" });
    act(() => navigateTo(`/trips/${TRIP_B}`));
    await screen.findByText("Echo Falls");
    await act(async () => removal.resolve());
    expect(get).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(/Removed/)).toBeNull();
    expect(btn("Remove Echo Falls from the trip")).not.toHaveAttribute("aria-disabled");
  });

  it("unmounting during a change writes nothing and logs no error", async () => {
    const { view } = await renderReady();
    const move = deferred<OwnerTrip>();
    reorder.mockReturnValueOnce(move.promise);
    await userEvent.click(btn("Move down: Beta Arch"));
    const consoleError = vi.spyOn(console, "error");
    view.unmount();
    await act(async () => move.resolve(trip(["A", "C", "B", "D"], 4)));
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("focus is not stolen", () => {
  it("leaves focus where the user moved it while the change was pending", async () => {
    await renderReady();
    const removal = deferred<void>();
    remove.mockReturnValueOnce(removal.promise);
    await userEvent.click(btn("Remove Beta Arch from the trip"));
    const elsewhere = btn("Elsewhere");
    elsewhere.focus();
    get.mockResolvedValueOnce(trip(["A", "C", "D"], 4));
    await act(async () => removal.resolve());
    await findMessage(/Removed Beta Arch/);
    expect(elsewhere).toHaveFocus();
  });
});

describe("no hidden landmark information", () => {
  it("control names and announcements for an unavailable stop never contain its landmark ID or data", async () => {
    const { view } = await renderReady();
    reorder.mockResolvedValueOnce(trip(["A", "C", "B", "D"], 4));
    await userEvent.click(btn("Move up: stop 3 (no longer available)"));
    await findMessage(/Moved the stop that is no longer available/);
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? "");
    for (const text of [...names, status().textContent ?? "", view.container.innerHTML]) {
      expect(text).not.toContain(LANDMARK("C"));
      expect(text).not.toContain("35.678912");
    }
  });
});

describe("label in name (WCAG 2.5.3; Increment 6 correction)", () => {
  it("every stop control's accessible name starts with its visible text", async () => {
    await renderReady();
    const controls = within(screen.getByRole("list", { name: "Stops" })).getAllByRole("button");
    // 12 editing controls, plus Find nearby on the 3 available stops (M05-T05 Increment 2).
    expect(controls.length).toBe(15);
    for (const control of controls) {
      const visible = control.textContent ?? "";
      expect(control.getAttribute("aria-label")!.startsWith(visible), visible).toBe(true);
    }
  });
});

describe("names in announcements are direction-isolated (Increment 6 correction)", () => {
  it("a landmark name with a right-to-left override stays inside its own <bdi>", async () => {
    const spoofed = trip(["A", "B"]);
    const rlo = String.fromCodePoint(0x202e);
    const b = spoofed.stops[1]!;
    if (b.is_available) b.landmark = { ...b.landmark, display_name: `Beta ${rlo}hcrA` };
    await renderReady(spoofed);
    const moved = trip(["B", "A"], 4);
    const first = moved.stops[0]!;
    if (first.is_available) first.landmark = { ...first.landmark, display_name: `Beta ${rlo}hcrA` };
    reorder.mockResolvedValueOnce(moved);
    await userEvent.click(btn(`Move up: Beta ${rlo}hcrA`));
    await screen.findByText(/to position 1 of 2\./);
    const isolated = Array.from(status().querySelectorAll("bdi")).map((n) => n.textContent);
    expect(isolated).toEqual([`Beta ${rlo}hcrA`]);
    expect(status().textContent).toBe(`Moved Beta ${rlo}hcrA to position 1 of 2.`);
  });
});
