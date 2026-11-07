import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryUrlState } from "./discoveryUrlState";
import { useGeographicDiscovery } from "./useGeographicDiscovery";
import type { DiscoveryUrlActions } from "./useDiscoveryUrlState";

const DEFAULT_BBOX = { minLng: -90.3, minLat: 34.8, maxLng: -81.6, maxLat: 36.7 };

function urlState(overrides: Partial<DiscoveryUrlState> = {}): DiscoveryUrlState {
  return {
    q: "",
    categories: [],
    mode: "bbox",
    bbox: DEFAULT_BBOX,
    near: null,
    radius: null,
    viewport: null,
    wasNormalized: false,
    ...overrides,
  };
}

function urlActions(overrides: Partial<DiscoveryUrlActions> = {}): DiscoveryUrlActions {
  return {
    commitText: vi.fn(),
    commitCategories: vi.fn(),
    commitBbox: vi.fn(),
    commitNearOrigin: vi.fn(),
    commitRadius: vi.fn(),
    exitProximity: vi.fn(),
    updateViewport: vi.fn(),
    ...overrides,
  };
}

describe("useGeographicDiscovery — pending vs. committed bbox", () => {
  it("has no pending area change before any viewport report", () => {
    const { result } = renderHook(() => useGeographicDiscovery(urlState(), urlActions()));
    expect(result.current.hasPendingAreaChange).toBe(false);
    expect(result.current.effectiveGeo).toEqual({ mode: "bbox", bbox: DEFAULT_BBOX });
  });

  it("reports no pending change when the viewport reports back the same bounds already committed", () => {
    const { result } = renderHook(() => useGeographicDiscovery(urlState(), urlActions()));
    act(() => result.current.onViewportChange(DEFAULT_BBOX, [35.75, -85.95], 7));
    expect(result.current.hasPendingAreaChange).toBe(false);
  });

  it("treats the FIRST viewport report as the baseline, never itself a pending change — even when it differs substantially from the committed bbox constant (regression: Leaflet's real fitBounds result commonly differs substantially, not just by floating-point noise, from the hardcoded DEFAULT_BBOX used to request it — found on every fresh page load during M02-T07 real-browser verification)", () => {
    const { result } = renderHook(() => useGeographicDiscovery(urlState(), urlActions()));
    const substantiallyDifferentFit = { minLng: -95, minLat: 30, maxLng: -78, maxLat: 40 };
    act(() => result.current.onViewportChange(substantiallyDifferentFit, [35, -86.5], 6));
    expect(result.current.hasPendingAreaChange).toBe(false);
  });

  it("restoring a saved, NON-default committed bbox (e.g. after a refresh following a prior 'Search this area') does not flag a pending change before any further interaction", () => {
    const restoredBbox = { minLng: -86, minLat: 35, maxLng: -85, maxLat: 36 };
    const { result } = renderHook(() => useGeographicDiscovery(urlState({ bbox: restoredBbox }), urlActions()));

    // The restored viewport's actual rendered bounds, as Leaflet would report
    // them for that exact center/zoom — not required to be byte-identical to
    // `restoredBbox` for this to hold, since the baseline is taken from this
    // report itself, not compared against `restoredBbox` directly.
    act(() => result.current.onViewportChange(restoredBbox, [35.5, -85.5], 9));

    expect(result.current.hasPendingAreaChange).toBe(false);
    expect(result.current.effectiveGeo).toEqual({ mode: "bbox", bbox: restoredBbox });
  });

  it("flags a pending area change once the map pans away from its own established baseline, without auto-committing", () => {
    const actions = urlActions();
    const { result } = renderHook(() => useGeographicDiscovery(urlState(), actions));

    act(() => result.current.onViewportChange(DEFAULT_BBOX, [35.75, -85.95], 7)); // establishes the baseline
    const panned = { minLng: -86, minLat: 35, maxLng: -85, maxLat: 36 };
    act(() => result.current.onViewportChange(panned, [35.5, -85.5], 10)); // a real subsequent pan

    expect(result.current.hasPendingAreaChange).toBe(true);
    expect(actions.commitBbox).not.toHaveBeenCalled();
    // The raw camera position is still mirrored into the URL (replaceState), independent of the committed query.
    expect(actions.updateViewport).toHaveBeenLastCalledWith([35.5, -85.5], 10);
  });

  it("onSearchThisArea commits exactly the last-reported pending bounds, and re-anchors the baseline so the prompt doesn't immediately reappear once the commit's URL update flows back in", () => {
    const actions = urlActions();
    const { result, rerender } = renderHook((state: DiscoveryUrlState) => useGeographicDiscovery(state, actions), {
      initialProps: urlState(),
    });

    act(() => result.current.onViewportChange(DEFAULT_BBOX, [35.75, -85.95], 7));
    const panned = { minLng: -86, minLat: 35, maxLng: -85, maxLat: 36 };
    act(() => result.current.onViewportChange(panned, [35.5, -85.5], 10));
    act(() => result.current.onSearchThisArea());
    expect(actions.commitBbox).toHaveBeenCalledWith(panned);

    // Simulate the real app's natural consequence of that commit: the URL
    // changes, and the next render passes back an updated `urlState.bbox`.
    rerender(urlState({ bbox: panned }));

    expect(result.current.hasPendingAreaChange).toBe(false);
  });
});

describe("useGeographicDiscovery — map-center proximity", () => {
  it("onFindNearMapCenter commits the current map center with the committed (or default) radius", () => {
    const actions = urlActions();
    const { result } = renderHook(() => useGeographicDiscovery(urlState(), actions));

    act(() => result.current.onViewportChange(DEFAULT_BBOX, [35.5, -85.5], 10));
    act(() => result.current.onFindNearMapCenter());

    expect(actions.commitNearOrigin).toHaveBeenCalledWith({ lat: 35.5, lng: -85.5 }, 25);
  });

  it("does nothing if no viewport has been reported yet", () => {
    const actions = urlActions();
    const { result } = renderHook(() => useGeographicDiscovery(urlState(), actions));

    act(() => result.current.onFindNearMapCenter());
    expect(actions.commitNearOrigin).not.toHaveBeenCalled();
  });

  it("reflects a committed near/radius from the URL in effectiveGeo", () => {
    const { result } = renderHook(() =>
      useGeographicDiscovery(urlState({ mode: "near", near: { lat: 36, lng: -84 }, radius: 50 }), urlActions()),
    );
    expect(result.current.effectiveGeo).toEqual({ mode: "near", near: { lat: 36, lng: -84 }, radius: 50 });
    expect(result.current.isDeviceOrigin).toBe(false);
  });
});

describe("useGeographicDiscovery — device geolocation ('Near me'), never written to the URL", () => {
  const originalGeolocation = navigator.geolocation;

  afterEach(() => {
    Object.defineProperty(navigator, "geolocation", { value: originalGeolocation, configurable: true });
  });

  it("on success, overrides effectiveGeo locally without ever calling a URL-writing action", () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 36.1, longitude: -84.2 } } as GeolocationPosition);
    });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });

    const actions = urlActions();
    const { result } = renderHook(() => useGeographicDiscovery(urlState(), actions));

    act(() => result.current.onNearMe());

    expect(result.current.effectiveGeo).toEqual({ mode: "near", near: { lat: 36.1, lng: -84.2 }, radius: 25 });
    expect(result.current.isDeviceOrigin).toBe(true);
    expect(actions.commitNearOrigin).not.toHaveBeenCalled();
    expect(actions.commitBbox).not.toHaveBeenCalled();
    expect(result.current.geolocationError).toBeNull();
  });

  it("on denial/error, leaves the existing (bbox) results untouched and surfaces a message", () => {
    const getCurrentPosition = vi.fn((_success: PositionCallback, error: PositionErrorCallback) => {
      error({ code: 1, message: "denied" } as GeolocationPositionError);
    });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });

    const actions = urlActions();
    const { result } = renderHook(() => useGeographicDiscovery(urlState(), actions));

    act(() => result.current.onNearMe());

    expect(result.current.effectiveGeo).toEqual({ mode: "bbox", bbox: DEFAULT_BBOX });
    expect(result.current.isDeviceOrigin).toBe(false);
    expect(result.current.geolocationError).toMatch(/denied or unavailable/i);
  });

  it("surfaces a message, without throwing, when the Geolocation API is unavailable", () => {
    Object.defineProperty(navigator, "geolocation", { value: undefined, configurable: true });

    const { result } = renderHook(() => useGeographicDiscovery(urlState(), urlActions()));
    act(() => result.current.onNearMe());

    expect(result.current.geolocationError).toMatch(/not available/i);
  });

  it("a radius change while a device origin is active updates the local radius, not the URL", () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 36.1, longitude: -84.2 } } as GeolocationPosition);
    });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });

    const actions = urlActions();
    const { result } = renderHook(() => useGeographicDiscovery(urlState(), actions));

    act(() => result.current.onNearMe());
    act(() => result.current.onRadiusChange(100));

    expect(result.current.effectiveGeo).toMatchObject({ radius: 100 });
    expect(actions.commitRadius).not.toHaveBeenCalled();
  });

  it("onExitProximity clears the device origin and falls back to the committed URL state", () => {
    const getCurrentPosition = vi.fn((success: PositionCallback) => {
      success({ coords: { latitude: 36.1, longitude: -84.2 } } as GeolocationPosition);
    });
    Object.defineProperty(navigator, "geolocation", { value: { getCurrentPosition }, configurable: true });

    const actions = urlActions();
    const { result } = renderHook(() => useGeographicDiscovery(urlState(), actions));

    act(() => result.current.onNearMe());
    expect(result.current.isDeviceOrigin).toBe(true);

    act(() => result.current.onExitProximity());

    expect(result.current.isDeviceOrigin).toBe(false);
    expect(result.current.effectiveGeo).toEqual({ mode: "bbox", bbox: DEFAULT_BBOX });
    expect(actions.exitProximity).toHaveBeenCalledOnce();
  });

  it("onExitProximity re-anchors the baseline so 'Search this area' doesn't immediately reappear", () => {
    const actions = urlActions();
    const { result, rerender } = renderHook((state: DiscoveryUrlState) => useGeographicDiscovery(state, actions), {
      initialProps: urlState(),
    });

    act(() => result.current.onViewportChange(DEFAULT_BBOX, [35.75, -85.95], 7)); // baseline
    const panned = { minLng: -86, minLat: 35, maxLng: -85, maxLat: 36 };
    act(() => result.current.onViewportChange(panned, [35.5, -85.5], 10)); // real pan, now pending
    expect(result.current.hasPendingAreaChange).toBe(true);

    act(() => result.current.onExitProximity());
    // Force the hook to re-evaluate with the (ref-only) baseline mutation applied.
    rerender(urlState());

    expect(result.current.hasPendingAreaChange).toBe(false);
  });
});

describe("useGeographicDiscovery — radius change while a URL-committed near origin is active (not device-derived)", () => {
  it("delegates to urlActions.commitRadius", () => {
    const actions = urlActions();
    const { result } = renderHook(() =>
      useGeographicDiscovery(urlState({ mode: "near", near: { lat: 36, lng: -84 }, radius: 25 }), actions),
    );

    act(() => result.current.onRadiusChange(50));

    expect(actions.commitRadius).toHaveBeenCalledWith(50);
  });
});
