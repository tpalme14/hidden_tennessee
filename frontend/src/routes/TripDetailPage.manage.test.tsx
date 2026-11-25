import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../api/auth";
import { ApiError } from "../api/client";
import {
  deleteTrip,
  getTrip,
  listTrips,
  removeTripStop,
  renameTrip,
  reorderTripStops,
  type OwnerTrip,
  type TripStop,
} from "../api/trips";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { TRIP_NAME_MESSAGES } from "../trips/tripNameRule";
import { RENAME_CONFLICT_TEXT } from "../trips/tripMessages";
import { MyTripsPage } from "./MyTripsPage";
import { TripDetailPage } from "./TripDetailPage";

/**
 * M05-T06 Increment 3 — rename and delete on the trip page, with the REAL
 * `useTrip` hook, trip page, and My Trips page (API module mocked): the inline
 * rename form, conflicts and uncertain outcomes (refinement R3), the delete
 * confirmation, the terminal deleted state, navigation with the one-time
 * notice, the shared single-change lock in both directions, and stale
 * responses after session or page changes. Nothing is optimistic and nothing
 * is replayed.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  getTrip: vi.fn(),
  renameTrip: vi.fn(),
  deleteTrip: vi.fn(),
  removeTripStop: vi.fn(),
  reorderTripStops: vi.fn(),
  listTrips: vi.fn(),
}));

const get = vi.mocked(getTrip);
const rename = vi.mocked(renameTrip);
const del = vi.mocked(deleteTrip);
const remove = vi.mocked(removeTripStop);
const reorder = vi.mocked(reorderTripStops);
const list = vi.mocked(listTrips);

const OTHER_USER: AuthUser = { ...TEST_USER, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const TRIP_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TIME = "2026-11-23T16:00:00.000Z";
const RLO = String.fromCodePoint(0x202e);
const STOP = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function stop(n: number, position: number): TripStop {
  return {
    id: STOP(n),
    position,
    is_available: true,
    distance_from_previous_miles: null,
    landmark: {
      id: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
      display_name: `Falls ${n}`,
      category: "falls",
      latitude: 35.6 + n / 100,
      longitude: -83.5,
    },
  };
}

function tripOf(extra: Partial<OwnerTrip> = {}, stopNumbers = [1, 2]): OwnerTrip {
  const stops = stopNumbers.map((n, i) => stop(n, i));
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
      total_miles: null,
      measured_legs: 0,
      total_legs: Math.max(stops.length - 1, 0),
    },
    ...extra,
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
        <Route path="/trips" element={<MyTripsPage />} />
        <Route path="/trips/:tripId" element={<TripDetailPage />} />
        <Route path="/other" element={<p>Other page</p>} />
        <Route path="/landmarks/:id" element={<p>Profile page</p>} />
      </Routes>
      <button type="button">Elsewhere</button>
      <Probe />
    </AuthContext.Provider>
  );
}

async function renderReady(initial: OwnerTrip = tripOf()) {
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
    setSession(next: SessionState) {
      view.rerender(
        <MemoryRouter initialEntries={[path]}>
          <Harness session={next} refresh={refresh} />
        </MemoryRouter>,
      );
    },
  };
}

const heading = () => screen.getByRole("heading", { level: 2 });
const status = () => screen.getByRole("status");
const renameButton = () => screen.getByRole("button", { name: "Rename" });
const deleteButton = () => screen.getByRole("button", { name: "Delete trip" });
const nameField = () => screen.getByLabelText("Trip name");
const saveButton = () => screen.getByRole("button", { name: "Save name" });
const confirmButton = () => screen.getByRole("button", { name: "Delete trip permanently" });
const location = () => screen.getByTestId("location");
const removeButton = (n: number) =>
  screen.getByRole("button", { name: `Remove Falls ${n} from the trip` });

async function openRenameWith(value: string) {
  await userEvent.click(renameButton());
  fireEvent.change(nameField(), { target: { value } });
}

beforeEach(() => {
  for (const mock of [get, rename, del, remove, reorder, list]) mock.mockReset();
  list.mockResolvedValue({ trips: [], page: 1, limit: 20, has_more: false });
});

afterEach(() => vi.restoreAllMocks());

describe("rename — form", () => {
  it("opens prefilled with the authoritative name and focuses the input; Cancel sends nothing", async () => {
    await renderReady();
    await userEvent.click(renameButton());
    expect(nameField()).toHaveValue("Weekend Waterfalls");
    expect(nameField()).toHaveFocus();
    expect(screen.queryByRole("button", { name: "Rename" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Trip name")).toBeNull();
    expect(renameButton()).toHaveFocus();
    expect(rename).not.toHaveBeenCalled();
  });

  it.each<[string, string, string]>([
    ["empty", "   ", TRIP_NAME_MESSAGES.noVisible],
    ["an internal tab", "Day\t1", TRIP_NAME_MESSAGES.characters],
    ["101 code points", "a".repeat(101), TRIP_NAME_MESSAGES.tooLong],
  ])("refuses %s on the client: field error, focus, no request", async (_label, value, message) => {
    await renderReady();
    await openRenameWith(value);
    await userEvent.click(saveButton());
    const error = screen.getByText(message);
    expect(nameField()).toHaveAttribute("aria-invalid", "true");
    expect(nameField().getAttribute("aria-describedby")).toContain(error.id);
    expect(nameField()).toHaveFocus();
    expect(rename).not.toHaveBeenCalled();
  });

  it("success: sends the trimmed name and current version, applies the server's trip, announces, refocuses Rename", async () => {
    await renderReady();
    rename.mockResolvedValueOnce(tripOf({ name: `${RLO}Fall Loop`, version: 4 }, [2, 1]));
    await openRenameWith(`  ${RLO}Fall Loop  `);
    await userEvent.click(saveButton());
    expect(rename).toHaveBeenCalledWith(TRIP_A, `${RLO}Fall Loop`, 3);
    expect(heading().querySelector("bdi")?.textContent).toBe(`${RLO}Fall Loop`);
    expect(status()).toHaveTextContent(`Renamed the trip to ${RLO}Fall Loop.`);
    expect(status().querySelector("bdi")?.textContent).toBe(`${RLO}Fall Loop`);
    expect(screen.queryByLabelText("Trip name")).toBeNull();
    expect(renameButton()).toHaveFocus();
    // The whole validated trip is the state: the server's stop order too.
    const items = within(screen.getByRole("list", { name: "Stops" })).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Falls 2");
    expect(location()).toHaveTextContent(`/trips/${TRIP_A}`);
  });

  it("the server's name error stays on the field with the draft, focusing the input", async () => {
    await renderReady();
    rename.mockRejectedValueOnce(
      new ApiError(400, "INVALID_REQUEST", TRIP_NAME_MESSAGES.characters),
    );
    await openRenameWith("Server says no");
    await userEvent.click(saveButton());
    expect(screen.getByText(TRIP_NAME_MESSAGES.characters)).toBeInTheDocument();
    expect(nameField()).toHaveValue("Server says no");
    expect(nameField()).toHaveFocus();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each<[string, ApiError, string]>([
    [
      "429",
      new ApiError(429, "RATE_LIMITED", "x", 4),
      "Couldn't change the trip. Too many requests. Please try again in 4 seconds.",
    ],
    [
      "403",
      new ApiError(403, "INVALID_ORIGIN", "internal detail"),
      "Couldn't change the trip. Please try again.",
    ],
  ])("%s: one alert, the draft kept, nothing replayed", async (_label, error, text) => {
    await renderReady();
    rename.mockRejectedValueOnce(error);
    await openRenameWith("Kept draft");
    await userEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getByRole("alert")).not.toHaveTextContent("internal detail");
    expect(nameField()).toHaveValue("Kept draft");
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("401 clears the trip and re-checks the session", async () => {
    const { refresh } = await renderReady();
    rename.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "x"));
    await openRenameWith("Name");
    await userEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load this trip because your session may have ended.",
    );
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByLabelText("Trip name")).toBeNull();
  });

  it("404 shows the generic not-found message", async () => {
    await renderReady();
    rename.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "x"));
    await openRenameWith("Name");
    await userEvent.click(saveButton());
    expect(await screen.findByText(/This trip couldn.t be found/)).toBeInTheDocument();
  });
});

describe("rename — conflict (409)", () => {
  it("re-reads, keeps the draft and form, explains, and the next explicit Save uses the latest version", async () => {
    await renderReady();
    rename.mockRejectedValueOnce(new ApiError(409, "TRIP_VERSION_CONFLICT", "x"));
    get.mockResolvedValueOnce(
      tripOf({ name: "Renamed elsewhere", version: 7, is_shared: true }, [1, 2, 3]),
    );
    await openRenameWith("My draft");
    await userEvent.click(saveButton());
    expect(heading()).toHaveTextContent("Renamed elsewhere");
    expect(
      within(screen.getByRole("list", { name: "Stops" })).getAllByRole("listitem"),
    ).toHaveLength(3);
    expect(nameField()).toHaveValue("My draft");
    expect(screen.getByText(RENAME_CONFLICT_TEXT)).toBeInTheDocument();
    expect(status()).toHaveTextContent(
      "Its current name is Renamed elsewhere. Review it, then save again.",
    );
    expect(nameField()).toHaveFocus();
    expect(rename).toHaveBeenCalledTimes(1);

    rename.mockResolvedValueOnce(tripOf({ name: "My draft", version: 8 }, [1, 2, 3]));
    await userEvent.click(saveButton());
    expect(rename).toHaveBeenLastCalledWith(TRIP_A, "My draft", 7);
    expect(heading()).toHaveTextContent("My draft");
  });

  it("a failed re-read leaves the stale state; Reload only reads, and the draft returns", async () => {
    await renderReady();
    rename.mockRejectedValueOnce(new ApiError(409, "TRIP_VERSION_CONFLICT", "x"));
    get.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    await openRenameWith("My draft");
    await userEvent.click(saveButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This trip changed since you loaded it");
    const reload = within(alert).getByRole("button", { name: "Reload trip" });
    expect(reload).toHaveFocus();
    expect(screen.queryByLabelText("Trip name")).toBeNull();
    get.mockResolvedValueOnce(tripOf({ version: 9 }));
    await userEvent.click(reload);
    expect(await screen.findByLabelText("Trip name")).toHaveValue("My draft");
    expect(rename).toHaveBeenCalledTimes(1);
  });
});

describe("rename — uncertain outcome", () => {
  it("the trip now has the requested name: confirms the current name without claiming cause", async () => {
    await renderReady();
    rename.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    get.mockResolvedValueOnce(tripOf({ name: "Fall Loop", version: 4 }));
    await openRenameWith("Fall Loop");
    await userEvent.click(saveButton());
    expect(status()).toHaveTextContent(
      "Couldn't confirm the rename, but the trip is now named Fall Loop.",
    );
    expect(screen.queryByLabelText("Trip name")).toBeNull();
    expect(renameButton()).toHaveFocus();
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("a different current name: the new name may not have been saved; the draft stays", async () => {
    await renderReady();
    rename.mockRejectedValueOnce(new ApiError(502, "BAD_GATEWAY", "x"));
    get.mockResolvedValueOnce(tripOf({ version: 3 }));
    await openRenameWith("Fall Loop");
    await userEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't confirm whether the new name was saved.",
    );
    expect(nameField()).toHaveValue("Fall Loop");
    expect(heading()).toHaveTextContent("Weekend Waterfalls");
    expect(rename).toHaveBeenCalledTimes(1);
  });

  it("an unreadable success whose re-read fails: stale ('renamed'); Reload only reads", async () => {
    await renderReady();
    rename.mockRejectedValueOnce(new ApiError(200, "INVALID_RESPONSE", "x"));
    get.mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "x"));
    await openRenameWith("Fall Loop");
    await userEvent.click(saveButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't confirm whether the trip was renamed");
    get.mockResolvedValueOnce(tripOf({ name: "Fall Loop", version: 4 }));
    await userEvent.click(within(alert).getByRole("button", { name: "Reload trip" }));
    expect(await screen.findByRole("heading", { level: 2, name: "Fall Loop" })).toBeInTheDocument();
    expect(rename).toHaveBeenCalledTimes(1);
  });
});

describe("delete — confirmation", () => {
  it("opens naming the current trip (isolated), focuses its text, and Cancel sends nothing", async () => {
    await renderReady(tripOf({ name: `${RLO}Weekend` }));
    await userEvent.click(deleteButton());
    const text = screen.getByText(/permanently\? This can.t be undone/);
    expect(text).toHaveFocus();
    expect(text.querySelector("bdi")?.textContent).toBe(`${RLO}Weekend`);
    expect(text).toHaveTextContent("the landmarks themselves aren't deleted");
    expect(del).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("button", { name: "Delete trip permanently" })).toBeNull();
    expect(deleteButton()).toHaveFocus();
    expect(del).not.toHaveBeenCalled();
  });

  it("closes when the trip stops being ready (never stands over an unverified trip)", async () => {
    await renderReady();
    await userEvent.click(deleteButton());
    remove.mockResolvedValueOnce(undefined);
    get.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    await userEvent.click(removeButton(1));
    expect(await screen.findByRole("button", { name: "Reload trip" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete trip permanently" })).toBeNull();
  });
});

describe("delete — confirmed and unavailable outcomes", () => {
  it("204: one request (synchronous guard), My Trips with a one-time notice, heading focused, history cleared", async () => {
    await renderReady();
    const pending = deferred<void>();
    del.mockReturnValueOnce(pending.promise);
    await userEvent.click(deleteButton());
    act(() => {
      fireEvent.click(confirmButton());
      fireEvent.click(confirmButton());
    });
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith(TRIP_A);
    expect(status()).toHaveTextContent("Deleting trip…");
    await act(async () => pending.resolve());
    expect(await screen.findByRole("heading", { level: 2, name: "My Trips" })).toHaveFocus();
    expect(location()).toHaveTextContent(/^\/trips$/);
    await waitFor(() => expect(status()).toHaveTextContent("Deleted trip Weekend Waterfalls."));
    expect(status().querySelector("bdi")?.textContent).toBe("Weekend Waterfalls");
    // The router replaces the history entry asynchronously (after the notice is read).
    await waitFor(() => expect(location()).toHaveAttribute("data-state", "null"));
    // Away and back again: the notice is not repeated.
    act(() => navigateTo("/other"));
    act(() => navigateTo(-1));
    await screen.findByRole("heading", { level: 2, name: "My Trips" });
    await screen.findByText(/You don.t have any trips yet/);
    expect(status()).not.toHaveTextContent("Deleted trip");
  });

  it("404: generic 'no longer available' — not 'deleted'", async () => {
    await renderReady();
    del.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "x"));
    await userEvent.click(deleteButton());
    await userEvent.click(confirmButton());
    expect(await screen.findByText("That trip is no longer available.")).toBeInTheDocument();
    expect(status()).not.toHaveTextContent("Deleted");
    expect(location()).toHaveTextContent(/^\/trips$/);
  });

  it("uncertain, then the re-read finds no trip: qualified 'no longer available'", async () => {
    await renderReady();
    del.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    get.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "x"));
    await userEvent.click(deleteButton());
    await userEvent.click(confirmButton());
    expect(
      await screen.findByText(
        "We couldn't confirm the result of your delete request. That trip is no longer available.",
      ),
    ).toBeInTheDocument();
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("uncertain, and the trip still exists: kept, explained, and another delete needs a new confirmation", async () => {
    await renderReady();
    del.mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "x"));
    get.mockResolvedValueOnce(tripOf({ version: 3 }));
    await userEvent.click(deleteButton());
    await userEvent.click(confirmButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't confirm that the trip was deleted. It still exists.",
    );
    expect(screen.queryByRole("button", { name: "Delete trip permanently" })).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Stops" })).toHaveFocus();
    expect(location()).toHaveTextContent(`/trips/${TRIP_A}`);
    expect(del).toHaveBeenCalledTimes(1);
    del.mockResolvedValueOnce(undefined);
    await userEvent.click(deleteButton());
    expect(del).toHaveBeenCalledTimes(1);
    await userEvent.click(confirmButton());
    expect(del).toHaveBeenCalledTimes(2);
  });

  it("uncertain with a failed re-read: stale ('delete_uncertain'); Reload only reads", async () => {
    await renderReady();
    del.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    get.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    await userEvent.click(deleteButton());
    await userEvent.click(confirmButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't confirm whether the trip was deleted");
    expect(alert).toHaveTextContent("Reload the trip to see whether it still exists.");
    get.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "x"));
    await userEvent.click(within(alert).getByRole("button", { name: "Reload trip" }));
    expect(await screen.findByText(/This trip couldn.t be found/)).toBeInTheDocument();
    expect(del).toHaveBeenCalledTimes(1);
  });

  it.each<[string, ApiError]>([
    ["429", new ApiError(429, "RATE_LIMITED", "x")],
    ["403", new ApiError(403, "INVALID_ORIGIN", "x")],
  ])("%s: an alert, the confirmation stays, no navigation", async (_label, error) => {
    await renderReady();
    del.mockRejectedValueOnce(error);
    await userEvent.click(deleteButton());
    await userEvent.click(confirmButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't change the trip.");
    expect(confirmButton()).toBeInTheDocument();
    expect(location()).toHaveTextContent(`/trips/${TRIP_A}`);
  });
});

describe("the shared single-change lock", () => {
  it("a pending rename blocks remove and delete", async () => {
    await renderReady();
    const pending = deferred<OwnerTrip>();
    rename.mockReturnValueOnce(pending.promise);
    await openRenameWith("Fall Loop");
    await userEvent.click(saveButton());
    expect(status()).toHaveTextContent("Renaming trip…");
    expect(deleteButton()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(removeButton(1));
    await userEvent.click(deleteButton());
    await userEvent.click(confirmButton());
    expect(remove).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    await act(async () => pending.resolve(tripOf({ name: "Fall Loop", version: 4 })));
  });

  it("a pending delete blocks rename and remove", async () => {
    await renderReady();
    const pending = deferred<void>();
    del.mockReturnValueOnce(pending.promise);
    await userEvent.click(deleteButton());
    await userEvent.click(confirmButton());
    await userEvent.click(renameButton());
    fireEvent.change(nameField(), { target: { value: "Other" } });
    await userEvent.click(saveButton());
    await userEvent.click(removeButton(2));
    expect(rename).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    await act(async () => pending.reject(new ApiError(429, "RATE_LIMITED", "x")));
  });

  it("a pending move blocks rename and delete", async () => {
    await renderReady();
    const pending = deferred<OwnerTrip>();
    reorder.mockReturnValueOnce(pending.promise);
    await userEvent.click(screen.getByRole("button", { name: "Move down: Falls 1" }));
    await openRenameWith("Other");
    await userEvent.click(saveButton());
    await userEvent.click(deleteButton());
    await userEvent.click(confirmButton());
    expect(rename).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    await act(async () => pending.resolve(tripOf({ version: 4 }, [2, 1])));
  });

  it("the lock is held through the required re-read after a conflict", async () => {
    await renderReady();
    const reread = deferred<OwnerTrip>();
    rename.mockRejectedValueOnce(new ApiError(409, "TRIP_VERSION_CONFLICT", "x"));
    get.mockReturnValueOnce(reread.promise);
    await openRenameWith("Draft");
    await userEvent.click(saveButton());
    expect(status()).toHaveTextContent("Updating the trip…");
    await userEvent.click(removeButton(1));
    await userEvent.click(saveButton());
    expect(remove).not.toHaveBeenCalled();
    expect(rename).toHaveBeenCalledTimes(1);
    await act(async () => reread.resolve(tripOf({ version: 5 })));
  });

  it("same-task activations of rename and delete before React re-renders send one request", async () => {
    await renderReady();
    const pending = deferred<OwnerTrip>();
    rename.mockReturnValue(pending.promise);
    await openRenameWith("Fall Loop");
    act(() => {
      fireEvent.click(saveButton());
      fireEvent.click(saveButton());
      fireEvent.click(saveButton());
    });
    expect(rename).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(tripOf({ name: "Fall Loop", version: 4 })));
  });
});

describe("session and lifecycle", () => {
  it("a different user drops the draft and the confirmation, and a late rename changes nothing", async () => {
    const { setSession } = await renderReady();
    const pending = deferred<OwnerTrip>();
    rename.mockReturnValueOnce(pending.promise);
    await openRenameWith("Alice's name");
    await userEvent.click(saveButton());
    get.mockResolvedValueOnce(tripOf({ name: "Bob's trip" }));
    setSession({ status: "authenticated", user: OTHER_USER });
    expect(screen.queryByLabelText("Trip name")).toBeNull();
    await screen.findByRole("heading", { level: 2, name: "Bob's trip" });
    await act(async () => pending.resolve(tripOf({ name: "Alice's name", version: 4 })));
    expect(heading()).toHaveTextContent("Bob's trip");
    expect(status()).not.toHaveTextContent("Renamed");
    expect(screen.queryByLabelText("Trip name")).toBeNull();
  });

  it("a delete confirmed after the session became unconfirmed does not navigate", async () => {
    const { setSession } = await renderReady();
    const pending = deferred<void>();
    del.mockReturnValueOnce(pending.promise);
    await userEvent.click(deleteButton());
    await userEvent.click(confirmButton());
    setSession({ status: "loading" });
    await act(async () => pending.resolve());
    expect(location()).toHaveTextContent(`/trips/${TRIP_A}`);
  });

  it("a delete confirmed after leaving the page does not navigate back", async () => {
    await renderReady();
    const pending = deferred<void>();
    del.mockReturnValueOnce(pending.promise);
    await userEvent.click(deleteButton());
    await userEvent.click(confirmButton());
    act(() => navigateTo("/other"));
    await act(async () => pending.resolve());
    expect(location()).toHaveTextContent("/other");
  });

  it("the stop list, map, and nearby controls are unchanged around the new controls", async () => {
    await renderReady();
    expect(
      screen.getByRole("button", { name: "Find nearby: Stop 1, Falls 1" }),
    ).toBeInTheDocument();
    expect(removeButton(1)).toBeInTheDocument();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
