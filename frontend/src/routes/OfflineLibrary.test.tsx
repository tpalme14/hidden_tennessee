import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { LandmarkEntry, TripEntry } from "../offline/snapshots";
import { COORDINATE_DISCLAIMER, EMPTY_LIBRARY, OUTDATED_WARNING } from "../offline/offlineText";
import {
  availableLandmark,
  fakeAccount,
  landmarkMarker,
  LM,
  renderWithAccount,
  savedTrip,
  TRIP,
} from "../offline/offlineTestContext";
import { STRAIGHT_LINE_DISCLAIMER } from "../trips/formatTripDistance";
import { OfflineLandmarkPage } from "./OfflineLandmarkPage";
import { OfflineLibraryPage } from "./OfflineLibraryPage";
import { OfflineTripPage } from "./OfflineTripPage";

/**
 * M06-T03 Increment 3e — the offline library and saved-copy views (OFF-UX-2–4,
 * OFF-UX-6, OFF-SNAP-4–8, AC-28, AC-39) and the rendered side of DR-3. A
 * stubbed account context with a REAL view store.
 */

/** List operations that publish like the real ones (inside their own call). */
function publishingLists(
  landmarks: LandmarkEntry[],
  trips: TripEntry[] = [],
  view: { apply(changes: unknown): void },
) {
  return {
    listLandmarks: vi.fn(() => {
      view.apply({ landmarks: landmarks.map((e) => [idOf(e), e]), replaceLandmarks: true });
      return Promise.resolve({ kind: "ok" as const, entries: landmarks });
    }),
    listTrips: vi.fn(() => {
      view.apply({ trips: trips.map((e) => [idOf(e), e]), replaceTrips: true });
      return Promise.resolve({ kind: "ok" as const, entries: trips });
    }),
  };
}
function idOf(e: LandmarkEntry | TripEntry): string {
  if (e.status === "unreadable") return e.id;
  return "landmark_id" in e.record ? e.record.landmark_id : e.record.trip_id;
}

describe("OfflineLibraryPage", () => {
  it("an empty library is described neutrally (OFF-STORE-7)", async () => {
    const { value } = fakeAccount();
    render(renderWithAccount(<OfflineLibraryPage />, value));
    expect(await screen.findByText(EMPTY_LIBRARY)).toBeVisible();
  });

  it("lists available copies, markers, and unreadable copies", async () => {
    const holder = fakeAccount();
    Object.assign(
      holder.snapshots,
      publishingLists(
        [
          availableLandmark(),
          landmarkMarker("11111111-1111-4111-8111-111111111119"),
          { status: "unreadable", id: "11111111-1111-4111-8111-11111111111a" },
        ],
        [savedTrip()],
        holder.view,
      ),
    );
    render(renderWithAccount(<OfflineLibraryPage />, holder.value));
    const landmarks = await screen.findByRole("region", { name: "Landmarks" });
    expect(within(landmarks).getByRole("link", { name: "Saved Falls" })).toHaveAttribute(
      "href",
      `/offline/landmarks/${LM}`,
    );
    expect(within(landmarks).getByText(/No longer available — recorded/)).toBeVisible();
    expect(within(landmarks).getByText(/can't be read/)).toBeVisible();
    expect(within(landmarks).getByRole("button", { name: "Remove this saved copy" })).toBeVisible();
    const trips = screen.getByRole("region", { name: "Trips" });
    expect(within(trips).getByRole("link", { name: "Weekend trip" })).toBeVisible();
    expect(within(trips).getByText("2 stops")).toBeVisible();
  });

  it("DR-3: renders only what was PUBLISHED, never an operation's return value", async () => {
    const holder = fakeAccount(
      {},
      {
        listLandmarks: vi.fn(() =>
          Promise.resolve({ kind: "ok" as const, entries: [availableLandmark()] }),
        ),
      },
    );
    render(renderWithAccount(<OfflineLibraryPage />, holder.value));
    expect(await screen.findByText(EMPTY_LIBRARY)).toBeVisible();
    expect(screen.queryByText("Saved Falls")).toBeNull();
  });

  it("DR-3: clearing the view withdraws rendered content synchronously", async () => {
    const holder = fakeAccount();
    Object.assign(holder.snapshots, publishingLists([availableLandmark()], [], holder.view));
    render(renderWithAccount(<OfflineLibraryPage />, holder.value));
    expect(await screen.findByText("Saved Falls")).toBeVisible();
    act(() => holder.view.clear());
    expect(screen.queryByText("Saved Falls")).toBeNull();
  });

  it("without eligibility, explains and links to Offline data on this device", () => {
    const { value } = fakeAccount({ offline: "locked" });
    render(renderWithAccount(<OfflineLibraryPage />, value));
    expect(screen.getByText("Saved copies aren't available right now.")).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Offline data on this device" })[0]).toHaveAttribute(
      "href",
      "/offline-data",
    );
  });

  it("reports unavailable storage, never an empty library (AC-24)", async () => {
    const { value } = fakeAccount(
      {},
      {
        listLandmarks: vi.fn(() => Promise.resolve({ kind: "storage-unavailable" as const })),
      },
    );
    render(renderWithAccount(<OfflineLibraryPage />, value));
    expect(await screen.findByRole("alert")).toHaveTextContent("Offline storage isn't available");
    expect(screen.queryByText(EMPTY_LIBRARY)).toBeNull();
  });

  it("offline-read says it doesn't sign you in", async () => {
    const { value } = fakeAccount({ offline: "offline-read" });
    render(renderWithAccount(<OfflineLibraryPage />, value));
    expect(
      screen.getByText(/without a connection to the server\. This doesn't sign you in/),
    ).toBeVisible();
    await waitFor(() => expect(value.snapshots.listLandmarks).toHaveBeenCalled());
  });
});

describe("OfflineLandmarkPage", () => {
  const route = { path: `/offline/landmarks/${LM}`, route: "/offline/landmarks/:id" };

  it("shows the saved fields, coordinates as text with the disclaimer, freshness, the warning, and no map", async () => {
    const holder = fakeAccount();
    holder.snapshots.getLandmark = vi.fn(() => {
      holder.view.apply({ landmarks: [[LM, availableLandmark()]] });
      return Promise.resolve({ kind: "ok" as const, entry: availableLandmark() });
    });
    const { container } = render(renderWithAccount(<OfflineLandmarkPage />, holder.value, route));
    expect(await screen.findByRole("heading", { name: "Saved Falls" })).toBeVisible();
    expect(screen.getByText("Latitude 36.123456, longitude -84.654321")).toBeVisible();
    expect(screen.getByText(COORDINATE_DISCLAIMER)).toBeVisible();
    expect(screen.getByText(OUTDATED_WARNING)).toBeVisible();
    // The page's freshness line and the control's status both say it.
    expect(screen.getAllByText(/Last synced about/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("A waterfall on the creek.")).toBeVisible();
    expect(container.querySelector(".leaflet-container, [data-testid*='map']")).toBeNull();
    expect(
      screen.getByRole("link", { name: "Online profile (needs a connection)" }),
    ).toHaveAttribute("href", `/landmarks/${LM}`);
  });

  it("Remove on the saved-copy page keeps the control mounted, so its result is announced", async () => {
    const user = userEvent.setup();
    const holder = fakeAccount();
    holder.snapshots.getLandmark = vi.fn(() => {
      holder.view.apply({ landmarks: [[LM, availableLandmark()]] });
      return Promise.resolve({ kind: "ok" as const, entry: availableLandmark() });
    });
    holder.snapshots.removeLandmark = vi.fn(() => {
      holder.view.apply({ landmarks: [[LM, null]] }); // published like the real removal
      return Promise.resolve({ kind: "removed" as const });
    });
    render(renderWithAccount(<OfflineLandmarkPage />, holder.value, route));
    await user.click(await screen.findByRole("button", { name: "Remove offline copy" }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "The offline copy was removed from this device.",
    );
    expect(screen.getByText("This landmark isn't saved on this device.")).toBeVisible();
    expect(screen.queryByText(/Latitude/)).toBeNull();
  });

  it("a marker shows only that it is no longer available", async () => {
    const holder = fakeAccount();
    holder.snapshots.getLandmark = vi.fn(() => {
      holder.view.apply({ landmarks: [[LM, landmarkMarker()]] });
      return Promise.resolve({ kind: "ok" as const, entry: landmarkMarker() });
    });
    render(renderWithAccount(<OfflineLandmarkPage />, holder.value, route));
    expect((await screen.findAllByText(/No longer available — recorded/))[0]).toBeVisible();
    expect(screen.getByRole("heading", { name: "Saved landmark" })).toBeVisible();
    expect(screen.queryByText(/Latitude/)).toBeNull();
  });
});

describe("OfflineTripPage", () => {
  const route = { path: `/offline/trips/${TRIP}`, route: "/offline/trips/:tripId" };
  function withTrip(entry: TripEntry) {
    const holder = fakeAccount();
    holder.snapshots.getTrip = vi.fn(() => {
      holder.view.apply({ trips: [[TRIP, entry]] });
      return Promise.resolve({ kind: "ok" as const, entry });
    });
    return holder;
  }

  it("stops in server order, straight-line legs, the server summary, and no map", async () => {
    const { container } = render(
      renderWithAccount(<OfflineTripPage />, withTrip(savedTrip()).value, route),
    );
    const stops = await screen.findByRole("list", { name: "Stops" });
    const items = within(stops).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("First Stop");
    expect(items[1]).toHaveTextContent("Second Stop");
    expect(items[1]).toHaveTextContent(/straight-line from the previous stop/);
    expect(screen.getByText(STRAIGHT_LINE_DISCLAIMER)).toBeVisible();
    expect(screen.getByText(OUTDATED_WARNING)).toBeVisible();
    expect(container.querySelector(".leaflet-container")).toBeNull();
  });

  it("an invalidated trip: the placeholder, the unavailable summary, and the partial-update notice", async () => {
    render(
      renderWithAccount(
        <OfflineTripPage />,
        withTrip(savedTrip({ invalidated: true })).value,
        route,
      ),
    );
    expect(await screen.findByText("This stop is no longer available.")).toBeVisible();
    expect(
      screen.getByText("The distance summary is unavailable until you refresh this trip."),
    ).toBeVisible();
    expect(screen.getByText(/Part of this trip was updated on this device/)).toBeVisible();
    expect(screen.queryByText(/mi\b.*total|Total/)).toBeNull();
  });
});
