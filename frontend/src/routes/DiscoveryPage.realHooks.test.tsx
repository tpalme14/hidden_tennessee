import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { getCategories } from "../api/categories";
import { getLandmarkGeoMarkers } from "../api/landmarks";
import type { LandmarkCollectionResponse } from "../api/types";

/**
 * Real `useDiscoveryUrlState`/`useDiscoveryFilters`/`useGeographicDiscovery`/
 * `useMapMarkers`/`DiscoveryPage`/`GeoDiscoveryControls`/`LandmarkMarkersRenderer`
 * — only the network boundary (`getLandmarkGeoMarkers`, `getCategories`) and
 * the unavoidable Leaflet/`react-leaflet` dependency are mocked (jsdom can't
 * do real Leaflet layout; see M02-T02's established pattern). This is what
 * actually proves the real "Try again" button, through the real
 * `useMapMarkers` hook, re-issues a real request — and that previously
 * successful markers stay visible, clearly labeled as previous, through a
 * real failed refetch and a real successful retry (M02-T07 final
 * verification correction).
 *
 * Since M02-T08 added `GeographicResultsList` (the same marker data rendered
 * a second time, accessibly, outside the map), every marker name/"previous
 * search" notice/"Try again" button below now legitimately appears TWICE —
 * once in the map's popup, once in the list. Assertions use `getAllByText`/
 * `getAllByRole` accordingly, rather than the single-match `getByText` this
 * test used before that addition.
 */
vi.mock("../api/landmarks", () => ({ getLandmarkGeoMarkers: vi.fn(), searchLandmarks: vi.fn() }));
vi.mock("../api/categories", () => ({ getCategories: vi.fn() }));

interface FakeBounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

vi.mock("react-leaflet", () => {
  const state: {
    bounds: FakeBounds;
    center: { lat: number; lng: number };
    zoom: number;
    handlers: Record<string, (e: unknown) => void>;
  } = {
    bounds: { west: -90.3, south: 34.8, east: -81.6, north: 36.7 },
    center: { lat: 35.75, lng: -85.95 },
    zoom: 6,
    handlers: {},
  };

  const map = {
    getBounds: () => ({
      getWest: () => state.bounds.west,
      getSouth: () => state.bounds.south,
      getEast: () => state.bounds.east,
      getNorth: () => state.bounds.north,
    }),
    getCenter: () => state.center,
    getZoom: () => state.zoom,
    whenReady: (callback: () => void) => callback(),
    // `LandmarkMap` sets aria-describedby on the real container (M02-T08 5d); a detached div stands in here.
    getContainer: () => document.createElement("div"),
  };

  return {
    MapContainer: (props: { children?: ReactNode }) => props.children,
    TileLayer: () => null,
    Marker: (props: { children?: ReactNode }) => props.children,
    Popup: (props: { children?: ReactNode }) => props.children,
    useMap: () => map,
    useMapEvents: (handlers: Record<string, (e: unknown) => void>) => {
      state.handlers = handlers;
      return map;
    },
    __simulatePan: (bounds: FakeBounds, center: { lat: number; lng: number }, zoom: number) => {
      state.bounds = bounds;
      state.center = center;
      state.zoom = zoom;
      state.handlers.moveend?.({});
    },
  };
});

const { __simulatePan } = (await import("react-leaflet")) as unknown as {
  __simulatePan: (bounds: FakeBounds, center: { lat: number; lng: number }, zoom: number) => void;
};
const { DiscoveryPage } = await import("./DiscoveryPage");

function response(
  items: LandmarkCollectionResponse["items"],
  isTruncated = false,
): LandmarkCollectionResponse {
  return { items, page: 1, limit: 200, has_more: false, is_truncated: isTruncated };
}

function renderReal() {
  return render(
    <MemoryRouter>
      <DiscoveryPage />
    </MemoryRouter>,
  );
}

describe("DiscoveryPage — real useMapMarkers + real retry UI (M02-T07 final verification correction)", () => {
  it("retains previously successful markers (clearly labeled as previous) through a real failed refetch, and a real retry replaces them", async () => {
    vi.mocked(getCategories).mockResolvedValue([]);
    vi.mocked(getLandmarkGeoMarkers)
      // 1. initial Tennessee-wide load succeeds
      .mockResolvedValueOnce(
        response([
          {
            id: "a",
            display_name: "Open Falls",
            category: "falls",
            latitude: 35.1,
            longitude: -85.1,
          },
        ]),
      )
      // 2. "Search this area" after a real pan fails
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL", "Server error."))
      // 3. the real retry succeeds with a different marker
      .mockResolvedValueOnce(
        response([
          {
            id: "b",
            display_name: "New Falls",
            category: "falls",
            latitude: 35.2,
            longitude: -85.2,
          },
        ]),
      );

    renderReal();

    await waitFor(() => expect(screen.getAllByText("Open Falls").length).toBeGreaterThan(0));
    expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(1);
    const initialCall = vi.mocked(getLandmarkGeoMarkers).mock.calls[0]![0];

    // A real pan, reported through the real MapViewportTracker/useMapEvents wiring.
    __simulatePan({ west: -86, south: 35, east: -85, north: 36 }, { lat: 35.5, lng: -85.5 }, 10);
    await userEvent.click(await screen.findByRole("button", { name: /search this area/i }));

    await waitFor(() => expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(2));
    const pannedCall = vi.mocked(getLandmarkGeoMarkers).mock.calls[1]![0];
    expect(pannedCall).not.toEqual(initialCall);
    expect(pannedCall.q).toBe(initialCall.q);
    expect(pannedCall.categories).toEqual(initialCall.categories);

    // The failed refetch: the real error alert appears, but the previously
    // successful marker is still visible (in both presentations), clearly labeled as previous.
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Server error."));
    expect(screen.getAllByText("Open Falls").length).toBeGreaterThan(0);
    for (const notice of screen.getAllByText(/previous search/i)) {
      expect(notice).toHaveTextContent(/the update failed/i);
    }

    // A real click on one of the real, visible "Try again" buttons (map's and the list's both wire to the same retry).
    await userEvent.click(screen.getAllByRole("button", { name: /try again/i })[0]!);

    await waitFor(() => expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(3));
    const retryCall = vi.mocked(getLandmarkGeoMarkers).mock.calls[2]![0];
    // Retry sends the identical committed geographic + filter parameters as the failed request.
    expect(retryCall).toEqual(pannedCall);

    // The successful retry replaces the retained markers outright, everywhere they were shown.
    await waitFor(() => expect(screen.getAllByText("New Falls").length).toBeGreaterThan(0));
    expect(screen.queryAllByText("Open Falls")).toHaveLength(0);
    expect(screen.queryAllByText(/previous search/i)).toHaveLength(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
