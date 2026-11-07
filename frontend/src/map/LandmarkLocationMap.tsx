import { CircleMarker, MapContainer, TileLayer } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import "./leaflet-overrides.css";
import { categoryColor } from "./categoryMarkerStyle";
import { TEMPORARY_DEV_TILE_ATTRIBUTION, TEMPORARY_DEV_TILE_URL } from "./tile-config";
import styles from "./LandmarkLocationMap.module.css";

export interface LandmarkLocationMapProps {
  latitude: number;
  longitude: number;
  category: string;
  displayName: string;
}

const SINGLE_POINT_ZOOM = 13;

/**
 * A minimal single-point map for one landmark's profile (M02-T04) — distinct
 * from the Tennessee-wide discovery map (`LandmarkMap`, M02-T02). The caller
 * (`LandmarkProfilePage`) mounts this only for a validated full `PUBLIC`
 * profile with valid coordinates; it never fetches data itself, shows no
 * other markers, and has no nearby-landmark discovery or routing.
 */
export function LandmarkLocationMap({
  latitude,
  longitude,
  category,
  displayName,
}: LandmarkLocationMapProps) {
  return (
    <div
      className={styles.mapWrapper}
      role="region"
      aria-label={`Map showing the location of ${displayName}`}
    >
      <MapContainer
        center={[latitude, longitude]}
        zoom={SINGLE_POINT_ZOOM}
        scrollWheelZoom={false}
        className={styles.mapContainer}
      >
        <TileLayer url={TEMPORARY_DEV_TILE_URL} attribution={TEMPORARY_DEV_TILE_ATTRIBUTION} />
        <CircleMarker
          center={[latitude, longitude]}
          radius={8}
          pathOptions={{
            color: "#1f2937",
            weight: 1,
            fillColor: categoryColor(category),
            fillOpacity: 0.85,
          }}
        />
      </MapContainer>
    </div>
  );
}
