import { useEffect, type ReactNode } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./leaflet-overrides.css";
import {
  TEMPORARY_DEV_TILE_ATTRIBUTION,
  TEMPORARY_DEV_TILE_URL,
  TENNESSEE_BOUNDS,
} from "./tile-config";
import { useTileLoadStatus } from "./useTileLoadStatus";
import styles from "./LandmarkMap.module.css";

export interface LandmarkMapProps {
  /** Rendered inside the Leaflet `MapContainer` (e.g. `<LandmarkMarkersRenderer/>`, M02-T03) — not page-level UI. */
  children?: ReactNode;
  /** Restores a previously committed camera position (M02-T07, spec §9.6) instead of the default Tennessee-wide fit. */
  initialViewport?: { center: [number, number]; zoom: number };
  /** Shows a decorative, non-interactive crosshair at the map's center (spec §5.2's "visible crosshair"). */
  showCenterCrosshair?: boolean;
  /**
   * The id of a page element describing how to operate the map by keyboard
   * (M02-T08 Increment 5d). Applied as `aria-describedby` on the FOCUSABLE
   * Leaflet container itself — the element a keyboard user actually lands
   * on — so the description is announced once, on focusing the map, and
   * never on the markers or popups inside it.
   */
  describedById?: string;
}

/**
 * Sets/clears `aria-describedby` on Leaflet's own container element. The
 * container is created by react-leaflet, which only forwards `className`,
 * `id`, and `style` to it, so the attribute has to be applied through the
 * map instance after creation.
 */
function MapContainerDescription({ describedById }: { describedById: string }) {
  const map = useMap();
  useEffect(() => {
    const container = map.getContainer();
    container.setAttribute("aria-describedby", describedById);
    return () => {
      container.removeAttribute("aria-describedby");
    };
  }, [map, describedById]);
  return null;
}

/**
 * The base interactive map (M02-T02): Leaflet tiles, pan/zoom, an initial
 * Tennessee-wide view, or a restored viewport when one is available
 * (M02-T07). `bounds`/`center`+`zoom` only set the INITIAL view
 * responsively; neither is a hard restriction, so panning outside Tennessee
 * remains possible.
 */
export function LandmarkMap({
  children,
  initialViewport,
  showCenterCrosshair,
  describedById,
}: LandmarkMapProps) {
  const { degraded, onTileError } = useTileLoadStatus();

  return (
    <div
      className={styles.mapWrapper}
      role="region"
      aria-label="Map of Tennessee natural landmarks"
    >
      {degraded ? (
        <p role="status" className={styles.tileStatus}>
          Map tiles are having trouble loading right now. You can keep panning and zooming.
        </p>
      ) : null}
      <div className={styles.mapPositioner}>
        <MapContainer
          {...(initialViewport
            ? { center: initialViewport.center, zoom: initialViewport.zoom }
            : { bounds: TENNESSEE_BOUNDS })}
          scrollWheelZoom={false}
          className={styles.mapContainer}
        >
          <TileLayer
            url={TEMPORARY_DEV_TILE_URL}
            attribution={TEMPORARY_DEV_TILE_ATTRIBUTION}
            eventHandlers={{ tileerror: onTileError }}
          />
          {describedById ? <MapContainerDescription describedById={describedById} /> : null}
          {children}
        </MapContainer>
        {showCenterCrosshair ? (
          <span className={styles.crosshair} aria-hidden="true">
            +
          </span>
        ) : null}
      </div>
    </div>
  );
}
