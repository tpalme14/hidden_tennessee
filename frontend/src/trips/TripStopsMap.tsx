import {
  divIcon,
  latLngBounds,
  type DivIcon,
  type LeafletKeyboardEvent,
  type Marker as LeafletMarker,
  type PopupEvent,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import "../map/leaflet-overrides.css";
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { Link } from "react-router";
import type { TripStop } from "../api/trips";
import { categoryLabel } from "../map/categoryMarkerStyle";
import { TEMPORARY_DEV_TILE_ATTRIBUTION, TEMPORARY_DEV_TILE_URL } from "../map/tile-config";
import {
  mappedLocationsKey,
  tripMapMarkers,
  tripMarkerBadge,
  tripMarkerName,
  tripPopupLabel,
  type TripMapMarker,
} from "./tripMapMarkers";
import styles from "./TripStopsMap.module.css";

/**
 * The supplementary trip map (M05-T04 Increment 4; spec v1.1 §8; ADR-014
 * decision 8; decision D4). The ordered list stays the primary, complete
 * representation; the trip is fully usable without the map.
 *
 * - Derived from the page's single validated trip state (`stops`) — no fetch
 *   and no stop state of its own. The page mounts it with `key={trip.id}`, and
 *   unmounts it whenever the trip is not `ready` (loading, failed re-read,
 *   authentication loss), so another trip's markers or viewport never carry
 *   over and stale data never reappears.
 * - Numbered markers for AVAILABLE stops only (`position + 1`, matching the
 *   list, with gaps for unavailable stops). No line, route, or distance is
 *   drawn: the map shows ordered locations, not a route.
 * - One marker per unique coordinate pair (Increment 6 correction): stops at
 *   EXACTLY the same location share one marker at that true location, whose
 *   badge shows their numbers (`tripMarkerBadge`: up to two, then "+k"),
 *   whose accessible name lists every stop, and whose popup lists each stop
 *   with its own profile link. Marker identity is the coordinate pair, so a
 *   member joining or leaving keeps the same marker (and its focus).
 * - The view is fitted to the mapped stops when the map first appears and
 *   whenever the SET of mapped locations changes; renumbering alone (a
 *   reorder) keeps the user's viewport.
 * - Nothing is rendered for a trip with no stops; a non-empty trip with no
 *   available stop shows an explanation instead of a map.
 *
 * Marker accessibility follows the M02-T08 discovery markers
 * (`map/LandmarkMarkersRenderer.tsx`): Leaflet's own focusable icon element
 * carries the accessible name; Enter (Leaflet) and Space open the popup,
 * which takes focus; Escape closes it and returns focus to the marker;
 * Shift+Tab at the popup's start returns to the marker; a closing popup
 * returns stranded focus to its marker; and a focused marker (or its open
 * popup) that disappears reports `onFocusLost`, so the page can move focus to
 * the Stops heading. That logic is repeated here rather than shared, because
 * sharing it would change the discovery renderer (outside this increment).
 */

/**
 * Popup width cap (M05-T06 Increment 6 correction). Leaflet's default caps a
 * popup's CONTENT at 300px and adds ~46px of wrapper margins, so at a 320px
 * viewport (a 288px-wide map) a single-stop popup was 327px wide — wider than
 * the map and the viewport, which auto-pan cannot fix. The content is now
 * capped at the map's width minus that chrome and Leaflet's 5px auto-pan
 * padding on each side (64px in all), between 160px and Leaflet's 300px.
 */
const POPUP_DEFAULT_MAX_WIDTH = 300;
const POPUP_MIN_MAX_WIDTH = 160;
const POPUP_HORIZONTAL_CHROME = 64;

function popupMaxWidth(mapWidth: number): number {
  return Math.max(
    POPUP_MIN_MAX_WIDTH,
    Math.min(POPUP_DEFAULT_MAX_WIDTH, mapWidth - POPUP_HORIZONTAL_CHROME),
  );
}

const SINGLE_STOP_ZOOM = 13;
const MAX_FIT_ZOOM = 13;
const FIT_PADDING: [number, number] = [24, 24];
const ICON_SIZE = 28;
const FOCUSED_Z_INDEX_OFFSET = 1000;
const POPUP_TAB_STOP_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One icon per badge text, built once. The HTML holds only this module's class
 * names and the badge text, which is checked to contain only digits, commas,
 * spaces, and "+" — never landmark data. Wider badges get a wider (still
 * 28px-high, centred) icon so the whole badge is the pointer target.
 */
const BADGE_SYNTAX = /^[0-9]+(,[0-9]+)?( [+][0-9]+)?$/;
const iconCache = new Map<string, DivIcon>();

function numberedIcon(badge: string): DivIcon {
  const cached = iconCache.get(badge);
  if (cached) return cached;
  if (!BADGE_SYNTAX.test(badge)) throw new RangeError("unexpected marker badge text");
  const width = Math.max(ICON_SIZE, 14 + 7 * badge.length);
  const icon = divIcon({
    className: styles.icon,
    html: `<span class="${styles.badge}" aria-hidden="true">${badge}</span>`,
    iconSize: [width, ICON_SIZE],
    iconAnchor: [width / 2, ICON_SIZE / 2],
    popupAnchor: [0, -ICON_SIZE / 2],
  });
  iconCache.set(badge, icon);
  return icon;
}

function focusMarkerElement(marker: LeafletMarker | null): void {
  const element = marker?.getElement();
  if (element && element.isConnected) element.focus({ preventScroll: true });
}

/** Fits the view to the mapped stops on first render and when the set of locations changes. */
function FitToStops({ markers }: { markers: readonly TripMapMarker[] }) {
  const map = useMap();
  const key = mappedLocationsKey(markers);
  const markersRef = useRef(markers);
  markersRef.current = markers;

  useEffect(() => {
    const current = markersRef.current;
    if (current.length === 0) return;
    const bounds = latLngBounds(current.map((m) => [m.latitude, m.longitude] as [number, number]));
    if (current.length === 1 || bounds.getNorthEast().equals(bounds.getSouthWest())) {
      // One stop, or several at the same point: a bounded zoom on that point.
      map.setView(bounds.getCenter(), SINGLE_STOP_ZOOM);
    } else {
      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM });
    }
  }, [map, key]);

  return null;
}

function StopPopupContent({
  marker,
  leafletMarkerRef,
}: {
  marker: TripMapMarker;
  leafletMarkerRef: RefObject<LeafletMarker | null>;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  /** Index of the profile link that last had focus inside this popup, if any. */
  const lastFocusedLink = useRef<number | null>(null);

  // A server-confirmed change can remove the stop whose link has focus (or turn
  // a combined marker into a single one). If focus was lost with it — and not
  // moved elsewhere by the user — it goes to the surviving link at the same
  // index (or the last one), else to the popup group itself.
  useLayoutEffect(() => {
    const index = lastFocusedLink.current;
    const group = contentRef.current;
    if (index === null || group === null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const links = group.querySelectorAll<HTMLElement>("a[href]");
    const target = links[Math.min(index, links.length - 1)] ?? group;
    target.focus({ preventScroll: true });
  }, [marker]);

  useEffect(() => {
    const leafletMarker = leafletMarkerRef.current;
    const focusContent = () => contentRef.current?.focus({ preventScroll: true });
    if (leafletMarker?.isPopupOpen()) focusContent();
    leafletMarker?.on("popupopen", focusContent);
    return () => {
      leafletMarker?.off("popupopen", focusContent);
    };
  }, [leafletMarkerRef]);

  const single = marker.stops.length === 1 ? marker.stops[0]! : null;
  return (
    <div
      ref={contentRef}
      tabIndex={-1}
      className={styles.popupContent}
      role="group"
      aria-label={tripPopupLabel(marker)}
      onFocus={(event) => {
        const index = event.target.getAttribute("data-link-index");
        lastFocusedLink.current = index === null ? null : Number(index);
      }}
      onBlur={(event) => {
        // Focus moved to something outside this popup (not merely lost with a removed link).
        const next = event.relatedTarget;
        if (next !== null && !event.currentTarget.contains(next)) lastFocusedLink.current = null;
      }}
    >
      {single !== null ? (
        <>
          <strong>
            Stop {single.number}: <bdi>{single.displayName}</bdi>
          </strong>
          <br />
          {categoryLabel(single.category)}
          <br />
          <Link data-link-index={0} to={`/landmarks/${encodeURIComponent(single.landmarkId)}`}>
            View profile
          </Link>
        </>
      ) : (
        <>
          <strong>Stops at this location</strong>
          <ul className={styles.popupList}>
            {marker.stops.map((stop, index) => (
              <li key={stop.stopId}>
                Stop {stop.number}: <bdi>{stop.displayName}</bdi>
                <br />
                {categoryLabel(stop.category)}
                {" — "}
                <Link
                  data-link-index={index}
                  to={`/landmarks/${encodeURIComponent(stop.landmarkId)}`}
                  aria-label={`View profile: Stop ${stop.number}, ${stop.displayName}`}
                >
                  View profile
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TripStopMarker({
  marker,
  onFocusLost,
}: {
  marker: TripMapMarker;
  onFocusLost?: () => void;
}) {
  const map = useMap();
  const leafletMarkerRef = useRef<LeafletMarker | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const onFocusLostRef = useRef(onFocusLost);
  onFocusLostRef.current = onFocusLost;
  const accessibleName = tripMarkerName(marker);
  const focusOwnedAtUnmountRef = useRef<{
    element: HTMLElement | null;
    popupElement: HTMLElement | null;
  } | null>(null);

  // Focus loss on removal, in two phases exactly as the discovery markers do
  // (see LandmarkMarkersRenderer): detect ownership in the layout cleanup,
  // report in the passive cleanup — only if focus is still stranded there.
  useLayoutEffect(() => {
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body) return;
      const element = elementRef.current ?? leafletMarkerRef.current?.getElement() ?? null;
      const popupElement = leafletMarkerRef.current?.getPopup()?.getElement() ?? null;
      const owns =
        (element !== null && element.contains(active)) ||
        (popupElement !== null && popupElement.contains(active));
      focusOwnedAtUnmountRef.current = owns ? { element, popupElement } : null;
    };
  }, []);

  useEffect(() => {
    return () => {
      const owned = focusOwnedAtUnmountRef.current;
      focusOwnedAtUnmountRef.current = null;
      if (!owned) return;
      const active = document.activeElement;
      const stranded =
        !active ||
        active === document.body ||
        (owned.element !== null && owned.element.contains(active)) ||
        (owned.popupElement !== null && owned.popupElement.contains(active));
      if (stranded) onFocusLostRef.current?.();
    };
  }, []);

  // The accessible name goes on Leaflet's own focusable icon element. A new
  // number replaces the icon element, so this re-runs with the name.
  useEffect(() => {
    const leafletMarker = leafletMarkerRef.current;
    const element = leafletMarker?.getElement();
    if (!leafletMarker || !element) return;
    elementRef.current = element;
    element.setAttribute("aria-label", accessibleName);
    const onFocus = () => leafletMarker.setZIndexOffset(FOCUSED_Z_INDEX_OFFSET);
    const onBlur = () => leafletMarker.setZIndexOffset(0);
    element.addEventListener("focus", onFocus);
    element.addEventListener("blur", onBlur);
    return () => {
      element.removeEventListener("focus", onFocus);
      element.removeEventListener("blur", onBlur);
    };
  }, [accessibleName]);

  const eventHandlers = useMemo(() => {
    const onPopupKeyDown = (event: KeyboardEvent) => {
      const leafletMarker = leafletMarkerRef.current;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        leafletMarker?.closePopup();
        focusMarkerElement(leafletMarker);
        return;
      }
      if (
        event.key === "Tab" &&
        event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const popupElement = event.currentTarget as HTMLElement;
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || !popupElement.contains(active)) return;
        const firstTabStop = popupElement.querySelector<HTMLElement>(POPUP_TAB_STOP_SELECTOR);
        if (!(active === firstTabStop || active.tabIndex < 0)) return;
        event.preventDefault();
        focusMarkerElement(leafletMarker);
      }
    };

    return {
      keydown: (event: LeafletKeyboardEvent) => {
        const key = event.originalEvent.key;
        const leafletMarker = leafletMarkerRef.current;
        if (!leafletMarker) return;
        if (key === " " || key === "Spacebar") {
          event.originalEvent.preventDefault();
          leafletMarker.togglePopup();
        } else if (key === "Escape") {
          event.originalEvent.preventDefault();
          map.closePopup();
        }
      },
      popupopen: (event: PopupEvent) => {
        event.popup.getElement()?.addEventListener("keydown", onPopupKeyDown);
      },
      popupclose: (event: PopupEvent) => {
        const popupElement = event.popup.getElement();
        popupElement?.removeEventListener("keydown", onPopupKeyDown);
        const active = document.activeElement;
        const lost =
          active === null || active === document.body || (popupElement?.contains(active) ?? false);
        if (lost) focusMarkerElement(leafletMarkerRef.current);
      },
    };
  }, [map]);

  return (
    <Marker
      ref={leafletMarkerRef}
      position={[marker.latitude, marker.longitude]}
      icon={numberedIcon(tripMarkerBadge(marker))}
      eventHandlers={eventHandlers}
    >
      <Popup maxWidth={popupMaxWidth(map.getSize().x)}>
        <StopPopupContent marker={marker} leafletMarkerRef={leafletMarkerRef} />
      </Popup>
    </Marker>
  );
}

export interface TripStopsMapProps {
  stops: readonly TripStop[];
  /** Called when a focused marker (or its open popup) disappears; the page focuses the Stops heading. */
  onFocusLost?: () => void;
}

export function TripStopsMap({ stops, onFocusLost }: TripStopsMapProps) {
  const markers = useMemo(() => tripMapMarkers(stops), [stops]);
  if (stops.length === 0) return null;

  return (
    <section aria-labelledby="trip-map-heading" className={styles.section}>
      <h3 id="trip-map-heading" className={styles.heading}>
        Map
      </h3>
      {markers.length === 0 ? (
        <p className={styles.note}>
          None of this trip&apos;s stops can be shown on the map, because they are no longer
          available.
        </p>
      ) : (
        <>
          <p className={styles.note}>
            Numbered markers match the stop list. The map shows each available stop&apos;s location,
            not a route.
          </p>
          <div
            role="region"
            aria-label="Map of the trip's available stops"
            className={styles.wrapper}
          >
            <MapContainer
              center={[markers[0]!.latitude, markers[0]!.longitude]}
              zoom={SINGLE_STOP_ZOOM}
              scrollWheelZoom={false}
              className={styles.map}
            >
              <TileLayer
                url={TEMPORARY_DEV_TILE_URL}
                attribution={TEMPORARY_DEV_TILE_ATTRIBUTION}
              />
              <FitToStops markers={markers} />
              {markers.map((marker) => (
                <TripStopMarker key={marker.key} marker={marker} onFocusLost={onFocusLost} />
              ))}
            </MapContainer>
          </div>
        </>
      )}
    </section>
  );
}
