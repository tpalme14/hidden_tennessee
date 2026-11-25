import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { addTripStop, listTrips, type AddedTripStop, type TripListPage } from "../api/trips";
import type { SessionState } from "../auth/session";
import { deferred } from "../auth/testFixtures";
import { FavoritesAnnouncer } from "../favorites/FavoritesAnnouncer";
import { WithFakeFavorites } from "../favorites/testFavorites";
import type { LandmarkMarker, MapMarkersStatus } from "../map/useMapMarkers";
import { OTHER_USER, WithAuth, authValue, signedIn } from "../reviews/testAuth";
import { TripsAnnouncer, useTripsAnnouncer } from "../trips/TripsAnnouncer";
import { GEO_RESULTS_HEADING_ID, GeographicResultsList } from "./GeographicResultsList";
import type { LandmarkProfileStatus } from "./useLandmarkProfile";

/**
 * M05-T04 Increment 5 — where "Add to trip" appears (decision D2): on the full
 * profile of an active PUBLIC landmark and on each geographic result (PUBLIC
 * only), and nowhere for a redacted, unavailable, loading, or failed profile.
 * The list variant reports through `TripsAnnouncer`, outside the list, which
 * keeps no live regions of its own (M02-T08).
 */

vi.mock("./useLandmarkProfile", () => ({ useLandmarkProfile: vi.fn() }));
vi.mock("../map/LandmarkLocationMap", () => ({
  LandmarkLocationMap: () => <div data-testid="location-map" />,
}));
vi.mock("../reviews/ReviewsSection", () => ({ ReviewsSection: () => null }));
vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  listTrips: vi.fn(),
  addTripStop: vi.fn(),
  createTrip: vi.fn(),
  getTrip: vi.fn(),
}));

const { useLandmarkProfile } = await import("./useLandmarkProfile");
const { LandmarkProfilePage } = await import("./LandmarkProfilePage");
const profileHook = vi.mocked(useLandmarkProfile);
const list = vi.mocked(listTrips);
const add = vi.mocked(addTripStop);

const A = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const B = "4a3c9d2f-0b5e-4f70-9c8b-2d3e4f5a6b7c";
const TRIP = "00000000-0000-4000-8000-000000000001";

const FULL: LandmarkProfileStatus = {
  kind: "full",
  profile: {
    id: A,
    display_name: "Alpha Falls",
    category: "falls",
    latitude: 35.6,
    longitude: -83.5,
    source_description: null,
    source_access_label: null,
    source_url: null,
  },
};

function renderProfile(status: LandmarkProfileStatus, session: SessionState = signedIn()) {
  profileHook.mockReturnValue([status, vi.fn()]);
  return render(
    <WithAuth value={authValue(session)}>
      <WithFakeFavorites>
        <MemoryRouter initialEntries={[`/landmarks/${A}`]}>
          <Routes>
            <Route path="/landmarks/:id" element={<LandmarkProfilePage />} />
          </Routes>
        </MemoryRouter>
      </WithFakeFavorites>
    </WithAuth>,
  );
}

const marker = (id: string, name: string): LandmarkMarker => ({
  id,
  display_name: name,
  category: "falls",
  latitude: 35.6,
  longitude: -83.5,
});

function renderResults(markers: LandmarkMarker[], session: SessionState = signedIn()) {
  const status: MapMarkersStatus = { kind: "success", markers, isTruncated: false };
  const ui = (s: SessionState) => (
    <WithAuth value={authValue(s)}>
      <WithFakeFavorites>
        <MemoryRouter>
          <FavoritesAnnouncer>
            <TripsAnnouncer>
              <GeographicResultsList status={status} onRetry={vi.fn()} />
            </TripsAnnouncer>
          </FavoritesAnnouncer>
        </MemoryRouter>
      </WithFakeFavorites>
    </WithAuth>
  );
  const view = render(ui(session));
  return { ...view, setSession: (s: SessionState) => view.rerender(ui(s)) };
}

const section = () =>
  document.getElementById(GEO_RESULTS_HEADING_ID)!.closest("section") as HTMLElement;

beforeEach(() => {
  list.mockReset();
  add.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("landmark profile", () => {
  it("a full (PUBLIC) profile offers Add to trip beside Favorite", () => {
    renderProfile(FULL);
    expect(screen.getByRole("button", { name: "Add to trip: Alpha Falls" })).toBeInTheDocument();
  });

  it.each<[string, LandmarkProfileStatus]>([
    [
      "a redacted (UNREVIEWED or SENSITIVE) profile",
      {
        kind: "minimal",
        profile: { id: A, display_name: "Hidden", category: "falls", redacted: true },
      },
    ],
    ["an unavailable landmark", { kind: "unavailable" }],
    ["a loading profile", { kind: "loading" }],
    ["a failed profile", { kind: "error", message: "x" }],
  ])("%s offers no add control at all", (_label, status) => {
    renderProfile(status);
    expect(screen.queryByRole("button", { name: /to (a )?trip/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /to (a )?trip/ })).toBeNull();
    expect(list).not.toHaveBeenCalled();
  });

  it("signed out, the full profile offers sign-in returning to the profile", () => {
    renderProfile(FULL, { status: "anonymous" });
    expect(
      screen.getByRole("link", { name: "Sign in to add to a trip: Alpha Falls" }),
    ).toHaveAttribute("href", `/sign-in?returnTo=${encodeURIComponent(`/landmarks/${A}`)}`);
  });
});

describe("geographic results list", () => {
  it("each (PUBLIC) result offers Add to trip", () => {
    renderResults([marker(A, "Alpha Falls"), marker(B, "Bravo Arch")]);
    const items = within(section()).getAllByRole("listitem");
    expect(
      within(items[0]!).getByRole("button", { name: "Add to trip: Alpha Falls" }),
    ).toBeTruthy();
    expect(within(items[1]!).getByRole("button", { name: "Add to trip: Bravo Arch" })).toBeTruthy();
  });

  it("announces outside the list — the list keeps no live regions before, during, or after an add", async () => {
    renderResults([marker(A, "Alpha Falls")]);
    const liveInList = () =>
      section().querySelectorAll('[role="status"], [role="alert"], [aria-live]');
    expect(liveInList()).toHaveLength(0);

    list.mockResolvedValue({
      trips: [
        {
          id: TRIP,
          name: "Weekend",
          stop_count: 0,
          updated_at: "2026-11-23T16:00:00.000Z",
          is_shared: false,
        },
      ],
      page: 1,
      limit: 100,
      has_more: false,
    } satisfies TripListPage);
    await userEvent.click(screen.getByRole("button", { name: "Add to trip: Alpha Falls" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Weekend/ }));
    const pending = deferred<AddedTripStop>();
    add.mockReturnValueOnce(pending.promise);
    await userEvent.click(
      screen.getByRole("button", { name: "Add to the selected trip: Alpha Falls" }),
    );
    expect(liveInList()).toHaveLength(0);
    const polite = document.querySelectorAll('[aria-live="polite"]');
    const tripsRegion = Array.from(polite).find((r) => r.textContent?.includes("Adding"))!;
    expect(tripsRegion).toHaveTextContent("Alpha Falls: Adding to the trip…");
    expect(section().contains(tripsRegion)).toBe(false);

    await act(async () =>
      pending.resolve({
        id: TRIP,
        position: 0,
        is_available: true,
        landmark: {
          id: A,
          display_name: "Alpha Falls",
          category: "falls",
          latitude: 35.6,
          longitude: -83.5,
        },
      }),
    );
    expect(tripsRegion).toHaveTextContent("Added Alpha Falls to Weekend — View trip");
    expect(
      within(tripsRegion as HTMLElement).getByRole("link", { name: "View trip" }),
    ).toHaveAttribute("href", `/trips/${TRIP}`);
    expect(liveInList()).toHaveLength(0);
  });

  it("failures are named and shown in the shared alert, outside the list", async () => {
    renderResults([marker(A, "Alpha Falls")]);
    list.mockResolvedValue({
      trips: [
        {
          id: TRIP,
          name: "Weekend",
          stop_count: 25,
          updated_at: "2026-11-23T16:00:00.000Z",
          is_shared: false,
        },
      ],
      page: 1,
      limit: 100,
      has_more: false,
    });
    await userEvent.click(screen.getByRole("button", { name: "Add to trip: Alpha Falls" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Weekend/ }));
    add.mockRejectedValueOnce(new ApiError(409, "TRIP_STOP_LIMIT_REACHED", "x"));
    await userEvent.click(
      screen.getByRole("button", { name: "Add to the selected trip: Alpha Falls" }),
    );
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Alpha Falls: This trip has 25 stops.");
    expect(section().contains(alert)).toBe(false);
  });

  it("trip messages are cleared when the verified user changes", async () => {
    const view = renderResults([marker(A, "Alpha Falls")]);
    list.mockResolvedValue({
      trips: [
        {
          id: TRIP,
          name: "Private Trip",
          stop_count: 0,
          updated_at: "2026-11-23T16:00:00.000Z",
          is_shared: false,
        },
      ],
      page: 1,
      limit: 100,
      has_more: false,
    });
    await userEvent.click(screen.getByRole("button", { name: "Add to trip: Alpha Falls" }));
    await userEvent.click(await screen.findByRole("radio", { name: /Private Trip/ }));
    add.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    await userEvent.click(
      screen.getByRole("button", { name: "Add to the selected trip: Alpha Falls" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/Private Trip/);
    view.setSession(signedIn(OTHER_USER));
    expect(screen.queryByText(/Private Trip/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("the announcer itself drops every trip message when the verified user changes or is lost", () => {
    let announce: (() => void) | null = null;
    function Probe() {
      const announcer = useTripsAnnouncer()!;
      announce = () =>
        announcer.announce(A, { tone: "alert", parts: ["Private Trip: failed"], viewTripId: TRIP });
      return null;
    }
    const ui = (s: SessionState) => (
      <WithAuth value={authValue(s)}>
        <MemoryRouter>
          <TripsAnnouncer>
            <Probe />
          </TripsAnnouncer>
        </MemoryRouter>
      </WithAuth>
    );
    const view = render(ui(signedIn()));
    act(() => announce!());
    expect(screen.getByRole("alert")).toHaveTextContent("Private Trip: failed");
    view.rerender(ui(signedIn(OTHER_USER)));
    expect(screen.queryByText(/Private Trip/)).toBeNull();
    act(() => announce!());
    expect(screen.getByRole("alert")).toBeInTheDocument();
    view.rerender(ui({ status: "unavailable", retry: vi.fn() }));
    expect(screen.queryByText(/Private Trip/)).toBeNull();
  });

  it("without a TripsAnnouncer the list variant renders no add control (fail closed)", () => {
    const status: MapMarkersStatus = {
      kind: "success",
      markers: [marker(A, "Alpha Falls")],
      isTruncated: false,
    };
    render(
      <WithAuth value={authValue(signedIn())}>
        <WithFakeFavorites>
          <MemoryRouter>
            <FavoritesAnnouncer>
              <GeographicResultsList status={status} onRetry={vi.fn()} />
            </FavoritesAnnouncer>
          </MemoryRouter>
        </WithFakeFavorites>
      </WithAuth>,
    );
    expect(screen.queryByRole("button", { name: /to (a )?trip/ })).toBeNull();
  });
});
