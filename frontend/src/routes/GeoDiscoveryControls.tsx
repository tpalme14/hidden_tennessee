import { ALLOWED_RADII_MILES, milesToKm, type AllowedRadiusMiles } from "../map/geo";
import type { GeographicDiscoveryControls } from "./useGeographicDiscovery";

export interface GeoDiscoveryControlsProps {
  controls: GeographicDiscoveryControls;
}

/**
 * Geographic-discovery action controls (M02-T07): "Search this area" (bbox
 * mode, shown only once the map has panned away from the last committed
 * bounds), "Find near map center" and "Near me" (always available — the
 * latter never requests geolocation until clicked, spec §5.2), and, only
 * while in `near` mode, the allowed-radius selector and an exit-proximity
 * action. Rendered outside `<LandmarkMap>`'s Leaflet tree, consistent with
 * how this page already keeps status/control UI out of the map itself.
 */
export function GeoDiscoveryControls({ controls }: GeoDiscoveryControlsProps) {
  const {
    effectiveGeo,
    hasPendingAreaChange,
    isDeviceOrigin,
    geolocationPending,
    geolocationError,
    onSearchThisArea,
    onFindNearMapCenter,
    onNearMe,
    onRadiusChange,
    onExitProximity,
  } = controls;

  return (
    // `role="group"`: `aria-label` is prohibited on a role-less (generic) div
    // and its name would not be exposed reliably (axe `aria-prohibited-attr`,
    // found by the M02-T08 Increment 5b scans). An explicit group role keeps
    // the same accessible name, now actually conveyed to assistive technology.
    <div role="group" aria-label="Geographic discovery controls">
      {effectiveGeo.mode === "bbox" && hasPendingAreaChange ? (
        <p role="status">
          The map has moved.{" "}
          <button type="button" onClick={onSearchThisArea}>
            Search this area
          </button>
        </p>
      ) : null}

      <button type="button" onClick={onFindNearMapCenter}>
        Find near map center
      </button>
      <button type="button" onClick={onNearMe} disabled={geolocationPending}>
        {geolocationPending ? "Finding your location…" : "Near me"}
      </button>

      {geolocationError ? <p role="alert">{geolocationError}</p> : null}

      {effectiveGeo.mode === "near" ? (
        <div>
          <p role="status">
            Showing landmarks within {effectiveGeo.radius} miles (
            {milesToKm(effectiveGeo.radius).toFixed(1)} km) of{" "}
            {isDeviceOrigin ? "your location" : "the map center you chose"}, by straight-line
            distance.
          </p>
          <label>
            Radius
            <select
              value={effectiveGeo.radius}
              onChange={(event) => onRadiusChange(Number(event.target.value) as AllowedRadiusMiles)}
            >
              {ALLOWED_RADII_MILES.map((radius) => (
                <option key={radius} value={radius}>
                  {radius} mi ({milesToKm(radius).toFixed(1)} km)
                </option>
              ))}
            </select>
          </label>
          <button type="button" onClick={onExitProximity}>
            Back to area search
          </button>
        </div>
      ) : null}
    </div>
  );
}
