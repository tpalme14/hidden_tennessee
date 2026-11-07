import { useCallback, useRef, useState } from "react";
import {
  DEFAULT_RADIUS_MILES,
  boundsEqual,
  type AllowedRadiusMiles,
  type GeoBbox,
  type GeoOrigin,
} from "../map/geo";
import type { DiscoveryUrlState } from "./discoveryUrlState";
import type { DiscoveryUrlActions } from "./useDiscoveryUrlState";

export type EffectiveGeo =
  | { mode: "bbox"; bbox: GeoBbox }
  | { mode: "near"; near: GeoOrigin; radius: AllowedRadiusMiles };

export interface GeographicDiscoveryControls {
  effectiveGeo: EffectiveGeo;
  /** True only in `bbox` mode, once the map has panned/zoomed away from the last committed bounds. */
  hasPendingAreaChange: boolean;
  /** True while a device-geolocation origin (not written to the URL) is active for this session. */
  isDeviceOrigin: boolean;
  geolocationPending: boolean;
  geolocationError: string | null;
  onViewportChange: (bounds: GeoBbox, center: [number, number], zoom: number) => void;
  onSearchThisArea: () => void;
  onFindNearMapCenter: () => void;
  onNearMe: () => void;
  onRadiusChange: (radius: AllowedRadiusMiles) => void;
  onExitProximity: () => void;
}

/**
 * Orchestrates geographic (map-area/proximity) discovery (M02-T07) on top of
 * `useDiscoveryUrlState`. Owns exactly the state that must NOT live in the
 * URL:
 *
 * - `pendingBbox`/`currentCenter`: the map's live, uncommitted viewport.
 *   Panning/zooming never auto-commits a new search (spec §3.2) — only
 *   `onSearchThisArea` does, via `urlActions.commitBbox`. The raw camera
 *   position is still mirrored into the URL on every change via
 *   `updateViewport` (replaceState), independent of the committed query.
 * - `baselineBboxRef`: what "pending" is actually compared against — the
 *   map's own last-observed settled bounds, NOT the raw committed `bbox`
 *   value. Leaflet's real `fitBounds` result (used for the default
 *   Tennessee-wide view and whenever `bounds`, not `center`+`zoom`, drives
 *   the initial view) snaps to the nearest whole zoom level and is commonly
 *   and SUBSTANTIALLY larger than the exact requested bbox — not a tiny
 *   floating-point artifact, a real, expected Leaflet behavior. Comparing
 *   `pendingBbox` directly against the committed bbox constant showed
 *   "Search this area" immediately on every fresh page load, with no actual
 *   interaction — found during M02-T07 real-browser verification. The
 *   baseline is established once from the first viewport report (covering
 *   both the default fit and a restored `center`/`zoom` viewport) and
 *   explicitly re-anchored by `onSearchThisArea`/`onExitProximity` at the
 *   exact moment they commit, rather than re-derived reactively.
 * - `deviceOrigin`/`deviceRadius`: a "Near me" origin, which per spec §5.2
 *   must never be written to a shareable URL. While active, it overrides
 *   `urlState`'s mode/near/radius for fetching purposes (`effectiveGeo`)
 *   without ever calling a URL-writing action. On refresh/direct navigation
 *   this state is simply absent (starts `null`), so the view falls back to
 *   whatever committed `bbox`/`near` the URL actually holds — exactly the
 *   "requires a new permission request" behavior the spec requires, with no
 *   special-cased recovery logic needed.
 */
export function useGeographicDiscovery(
  urlState: DiscoveryUrlState,
  urlActions: DiscoveryUrlActions,
): GeographicDiscoveryControls {
  const [pendingBbox, setPendingBbox] = useState<GeoBbox | null>(null);
  const [currentCenter, setCurrentCenter] = useState<[number, number] | null>(null);
  const baselineBboxRef = useRef<GeoBbox | null>(null);
  const [deviceOrigin, setDeviceOrigin] = useState<GeoOrigin | null>(null);
  const [deviceRadius, setDeviceRadius] = useState<AllowedRadiusMiles>(DEFAULT_RADIUS_MILES);
  const [geolocationPending, setGeolocationPending] = useState(false);
  const [geolocationError, setGeolocationError] = useState<string | null>(null);

  const effectiveGeo: EffectiveGeo = deviceOrigin
    ? { mode: "near", near: deviceOrigin, radius: deviceRadius }
    : urlState.mode === "near" && urlState.near && urlState.radius
      ? { mode: "near", near: urlState.near, radius: urlState.radius }
      : { mode: "bbox", bbox: urlState.bbox };

  const hasPendingAreaChange =
    effectiveGeo.mode === "bbox" &&
    pendingBbox !== null &&
    baselineBboxRef.current !== null &&
    !boundsEqual(pendingBbox, baselineBboxRef.current);

  const onViewportChange = useCallback(
    (bounds: GeoBbox, center: [number, number], zoom: number) => {
      if (baselineBboxRef.current === null) {
        baselineBboxRef.current = bounds;
      }
      setPendingBbox(bounds);
      setCurrentCenter(center);
      urlActions.updateViewport(center, zoom);
    },
    [urlActions],
  );

  const onSearchThisArea = useCallback(() => {
    if (!pendingBbox) return;
    baselineBboxRef.current = pendingBbox;
    setDeviceOrigin(null);
    setGeolocationError(null);
    urlActions.commitBbox(pendingBbox);
  }, [pendingBbox, urlActions]);

  const onFindNearMapCenter = useCallback(() => {
    if (!currentCenter) return;
    setDeviceOrigin(null);
    setGeolocationError(null);
    const radius = urlState.radius ?? DEFAULT_RADIUS_MILES;
    urlActions.commitNearOrigin({ lat: currentCenter[0], lng: currentCenter[1] }, radius);
  }, [currentCenter, urlActions, urlState.radius]);

  const onNearMe = useCallback(() => {
    if (!navigator.geolocation) {
      setGeolocationError("Geolocation is not available in this browser. Try \"Find near map center\" instead.");
      return;
    }
    setGeolocationPending(true);
    setGeolocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGeolocationPending(false);
        setDeviceRadius(urlState.radius ?? DEFAULT_RADIUS_MILES);
        setDeviceOrigin({ lat: position.coords.latitude, lng: position.coords.longitude });
      },
      () => {
        setGeolocationPending(false);
        setGeolocationError(
          "Location access was denied or unavailable. Your previous results are unchanged — try \"Find near map center\" instead.",
        );
      },
    );
  }, [urlState.radius]);

  const onRadiusChange = useCallback(
    (radius: AllowedRadiusMiles) => {
      if (deviceOrigin) {
        setDeviceRadius(radius);
      } else {
        urlActions.commitRadius(radius);
      }
    },
    [deviceOrigin, urlActions],
  );

  const onExitProximity = useCallback(() => {
    // Re-anchor the baseline to whatever the map currently shows (or the
    // last committed bbox, if no report has landed since switching modes),
    // so "Search this area" doesn't immediately reappear right after exiting.
    baselineBboxRef.current = pendingBbox ?? urlState.bbox;
    setDeviceOrigin(null);
    setGeolocationError(null);
    urlActions.exitProximity();
  }, [pendingBbox, urlState.bbox, urlActions]);

  return {
    effectiveGeo,
    hasPendingAreaChange,
    isDeviceOrigin: deviceOrigin !== null,
    geolocationPending,
    geolocationError,
    onViewportChange,
    onSearchThisArea,
    onFindNearMapCenter,
    onNearMe,
    onRadiusChange,
    onExitProximity,
  };
}
