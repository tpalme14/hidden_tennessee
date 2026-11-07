import { useCallback, useEffect } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import type { GeoBbox } from "./geo";

export interface MapViewportTrackerProps {
  onViewportChange: (bounds: GeoBbox, center: [number, number], zoom: number) => void;
}

/**
 * Reports the map's live viewport (M02-T07) — rendered as a `<LandmarkMap>`
 * child, reusing the existing `children` extension point rather than
 * changing `LandmarkMap`'s own signature (consistent with how
 * `LandmarkMarkersRenderer` is already composed). Reports once the map's
 * initial view is actually established (via Leaflet's own `whenReady`,
 * NOT a bare mount `useEffect` — a plain `useEffect` here was found during
 * M02-T07 browser verification to fire before react-leaflet finishes
 * applying the initial `bounds`-fit, reading Leaflet's pre-fit default view
 * (world view, zoom 0) and writing that bogus viewport into the URL;
 * `whenReady` is Leaflet's documented mechanism for exactly this ordering
 * problem) and again on every `moveend`/`zoomend` — never on intermediate
 * drag/zoom frames, so this never fires more often than a real settled
 * viewport change. Panning/zooming alone never commits a new search (spec
 * §3.2); the parent (`useGeographicDiscovery`) decides what to do with each
 * report.
 */
export function MapViewportTracker({ onViewportChange }: MapViewportTrackerProps) {
  const map = useMap();

  const report = useCallback(() => {
    const bounds = map.getBounds();
    const bbox: GeoBbox = {
      minLng: bounds.getWest(),
      minLat: bounds.getSouth(),
      maxLng: bounds.getEast(),
      maxLat: bounds.getNorth(),
    };
    const center = map.getCenter();
    onViewportChange(bbox, [center.lat, center.lng], map.getZoom());
  }, [map, onViewportChange]);

  useEffect(() => {
    map.whenReady(report);
  }, [map, report]);

  useMapEvents({ moveend: report, zoomend: report });

  return null;
}
