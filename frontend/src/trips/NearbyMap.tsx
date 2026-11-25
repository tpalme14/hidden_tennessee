import {
  divIcon,
  latLngBounds,
  type DivIcon,
  type LeafletKeyboardEvent,
  type Map as LeafletMapInstance,
  type Marker as LeafletMarker,
  type PopupEvent,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import "../map/leaflet-overrides.css";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
} from "react";
import { MapContainer, Marker, Popup, TileLayer, useMap } from "react-leaflet";
import { Link } from "react-router";
import { categoryLabel } from "../map/categoryMarkerStyle";
import { TEMPORARY_DEV_TILE_ATTRIBUTION, TEMPORARY_DEV_TILE_URL } from "../map/tile-config";
import type { NearbyLandmarkView, NearbyResultSet } from "./nearbyLandmarks";
import {
  nearbyMapMarkers,
  nearbyMarkerBadge,
  nearbyMarkerName,
  nearbyPopupLabel,
  type NearbyMapMarker,
  type NearbyMapOrigin,
} from "./nearbyMapMarkers";
import { nearbyDistanceText } from "./nearbyMessages";
import styles from "./NearbyMap.module.css";

/**
 * The supplementary nearby-results map (M05-T05 Increment 3; N2). The results
 * list above it stays the primary, complete representation.
 *
 * - Renders exactly the result set it is given (the nearby hook's shown set)
 *   and the origin; it never fetches and keeps no result state. Panning and
 *   zooming request nothing.
 * - A dark square "Stop N" marker for the search origin; round markers for
 *   results (no text for one, a count for several at one point). One marker
 *   per exact coordinate pair; a result at the origin's point joins the
 *   origin's marker ("Stop N +k"). Marker HTML holds only the badge text,
 *   checked against a fixed pattern — never a name or category.
 * - The view fits the origin and results when a NEW result set arrives (the
 *   set object changes); renumbering, membership changes, a pending radius
 *   update (earlier set kept), and a failure that keeps the earlier set leave
 *   the viewport alone.
 * - No radius circle, line, route, or distance calculation.
 *
 * Marker accessibility repeats the trip map's (an approved third, narrowly
 * scoped copy — see the maintainability follow-up): the name is on Leaflet's
 * focusable icon element; Enter (Leaflet) and Space open the popup, which
 * takes focus; Escape in the popup closes it and returns focus to the marker;
 * Shift+Tab at the popup's start returns to the marker; a closing popup
 * returns stranded focus to its marker; a focused marker (or its popup) that
 * disappears reports `onFocusLost`. Escape is consumed by the map only while a
 * popup is open, so the panel's own Escape still works otherwise.
 */

const SINGLE_LOCATION_ZOOM = 13;
const MAX_FIT_ZOOM = 13;
const FIT_PADDING: [number, number] = [24, 24];
const ICON_SIZE = 28;
const FOCUSED_Z_INDEX_OFFSET = 1000;
/**
 * Popup size limits from the map's own size (M05-T05 Increment 5 correction).
 * Leaflet's defaults (300px wide, unlimited height) let a large group's popup
 * outgrow this compact map: Leaflet could not pan it into view, so its top —
 * the close button included — sat above the map, under the legend (pointer
 * clicks never reached it), and at 320–375px it was wider than the map. With
 * these limits Leaflet scrolls the WHOLE popup content in one region.
 * Allowances: the content's horizontal margins (≈44px) and the vertical space
 * taken by the tip, padding, and the marker above the anchor (≈96px).
 */
const POPUP_WIDTH_ALLOWANCE = 72;
const POPUP_HEIGHT_ALLOWANCE = 96;
const POPUP_MIN_WIDTH = 160;
const POPUP_DEFAULT_MAX_WIDTH = 300;
const POPUP_MIN_HEIGHT = 120;

const POPUP_TAB_STOP_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const BADGE_SYNTAX = /^(Stop [0-9]+( [+][0-9]+)?|[0-9]*)$/;
const iconCache = new Map<string, DivIcon>();

function nearbyIcon(badge: string, isOrigin: boolean): DivIcon {
  const cacheKey = `${isOrigin ? "o" : "r"}:${badge}`;
  const cached = iconCache.get(cacheKey);
  if (cached) return cached;
  if (!BADGE_SYNTAX.test(badge)) throw new RangeError("unexpected marker badge text");
  const width = badge === "" ? 20 : Math.max(ICON_SIZE, 14 + 7 * badge.length);
  const height = badge === "" ? 20 : ICON_SIZE;
  const badgeClass = isOrigin ? styles.originBadge : styles.resultBadge;
  const icon = divIcon({
    className: styles.icon,
    html: `<span class="${badgeClass}" aria-hidden="true">${badge}</span>`,
    iconSize: [width, height],
    iconAnchor: [width / 2, height / 2],
    popupAnchor: [0, -height / 2],
  });
  iconCache.set(cacheKey, icon);
  return icon;
}

function focusMarkerElement(marker: LeafletMarker | null): void {
  const element = marker?.getElement();
  if (element && element.isConnected) element.focus({ preventScroll: true });
}

/** Fits the view once per result set (a new `set` object), never on renumbering or updates. */
function FitToResults({ set, markers }: { set: NearbyResultSet; markers: NearbyMapMarker[] }) {
  const map = useMap();
  const markersRef = useRef(markers);
  markersRef.current = markers;

  useEffect(() => {
    const current = markersRef.current;
    const bounds = latLngBounds(current.map((m) => [m.latitude, m.longitude] as [number, number]));
    if (current.length === 1 || bounds.getNorthEast().equals(bounds.getSouthWest())) {
      map.setView(bounds.getCenter(), SINGLE_LOCATION_ZOOM);
    } else {
      map.fitBounds(bounds, { padding: FIT_PADDING, maxZoom: MAX_FIT_ZOOM });
    }
  }, [map, set]);

  return null;
}

function ResultDetails({ result }: { result: NearbyLandmarkView }) {
  return (
    <>
      {categoryLabel(result.category)}
      {" — "}
      {nearbyDistanceText(result.distance_miles)}
      {result.inTrip === null ? null : (
        <>
          <br />
          In this trip (Stop {result.inTrip.stopNumber})
        </>
      )}
    </>
  );
}

function PopupContent({
  marker,
  leafletMarkerRef,
}: {
  marker: NearbyMapMarker;
  leafletMarkerRef: RefObject<LeafletMarker | null>;
}) {
  const contentRef = useRef<HTMLDivElement>(null);
  const lastFocusedLink = useRef<number | null>(null);

  // A popup link whose result left this location (a new set) loses focus with
  // it: focus goes to the surviving link at that index (or the last), else the
  // group — only when focus was lost, never taken from elsewhere.
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

  const single = marker.origin === null && marker.results.length === 1 ? marker.results[0]! : null;
  let linkIndex = 0;
  return (
    <div
      ref={contentRef}
      tabIndex={-1}
      className={styles.popupContent}
      role="group"
      aria-label={nearbyPopupLabel(marker)}
      onFocus={(event) => {
        const index = event.target.getAttribute("data-link-index");
        lastFocusedLink.current = index === null ? null : Number(index);
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next !== null && !event.currentTarget.contains(next)) lastFocusedLink.current = null;
      }}
    >
      {single !== null ? (
        <>
          <strong>
            <bdi>{single.display_name}</bdi>
          </strong>
          <br />
          <ResultDetails result={single} />
          <br />
          <Link
            data-link-index={0}
            to={`/landmarks/${encodeURIComponent(single.id)}`}
            aria-label={`View profile: ${single.display_name}`}
          >
            View profile
          </Link>
        </>
      ) : (
        <>
          {marker.origin === null ? null : (
            <p className={styles.popupOrigin}>
              <strong>
                Search origin — Stop {marker.origin.stopNumber}:{" "}
                <bdi>{marker.origin.displayName}</bdi>
              </strong>
              <br />
              <Link
                data-link-index={linkIndex++}
                to={`/landmarks/${encodeURIComponent(marker.origin.landmarkId)}`}
                aria-label={`View profile: Stop ${marker.origin.stopNumber}, ${marker.origin.displayName}`}
              >
                View profile
              </Link>
            </p>
          )}
          {marker.results.length === 0 ? null : (
            <>
              <strong>
                {marker.origin === null
                  ? "Nearby landmarks at this location"
                  : "Also at this location"}
              </strong>
              <ul className={styles.popupList}>
                {marker.results.map((result) => (
                  <li key={result.id}>
                    <bdi>{result.display_name}</bdi>
                    <br />
                    <ResultDetails result={result} />
                    {" — "}
                    <Link
                      data-link-index={linkIndex++}
                      to={`/landmarks/${encodeURIComponent(result.id)}`}
                      aria-label={`View profile: ${result.display_name}`}
                    >
                      View profile
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}

function NearbyMarker({
  marker,
  onFocusLost,
}: {
  marker: NearbyMapMarker;
  onFocusLost?: () => void;
}) {
  const map = useMap();
  const leafletMarkerRef = useRef<LeafletMarker | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const onFocusLostRef = useRef(onFocusLost);
  onFocusLostRef.current = onFocusLost;
  const accessibleName = nearbyMarkerName(marker);
  const focusOwnedAtUnmountRef = useRef<{
    element: HTMLElement | null;
    popupElement: HTMLElement | null;
  } | null>(null);

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
        // Consumed here: the popup closes and the nearby panel stays open.
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
        } else if (key === "Escape" && map.hasLayer(leafletMarker.getPopup()!)) {
          // Only when this marker's popup is open: Escape closes it (and the map
          // wrapper keeps that Escape from also closing the nearby panel). With
          // no popup open, Escape is left for the panel.
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
      icon={nearbyIcon(nearbyMarkerBadge(marker), marker.origin !== null)}
      eventHandlers={eventHandlers}
    >
      <Popup
        maxWidth={Math.max(
          POPUP_MIN_WIDTH,
          Math.min(POPUP_DEFAULT_MAX_WIDTH, map.getSize().x - POPUP_WIDTH_ALLOWANCE),
        )}
        maxHeight={Math.max(POPUP_MIN_HEIGHT, map.getSize().y - POPUP_HEIGHT_ALLOWANCE)}
      >
        <PopupContent marker={marker} leafletMarkerRef={leafletMarkerRef} />
      </Popup>
    </Marker>
  );
}

export interface NearbyMapProps {
  origin: NearbyMapOrigin;
  set: NearbyResultSet;
  landmarks: readonly NearbyLandmarkView[];
  /** A focused marker (or its open popup) disappeared while the panel stays open. */
  onFocusLost?: () => void;
}

export function NearbyMap({ origin, set, landmarks, onFocusLost }: NearbyMapProps) {
  const markers = useMemo(() => nearbyMapMarkers(origin, landmarks), [origin, landmarks]);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMapInstance | null>(null);
  const escapeWhilePopupOpen = useRef(false);

  // Nested Escape: with a popup open, Escape closes that popup ONLY — it must
  // not also close the nearby panel. The capture phase records whether a popup
  // was open before any handler ran. In the bubble phase the map consumes the
  // key and closes the popup itself (the popup's `popupclose` handler then
  // returns focus to its marker). Closing here, rather than relying on the
  // popup element's own native listener, matters because react-leaflet renders
  // popup content through a React portal: React dispatches this handler at the
  // portal container, BEFORE the native event reaches the popup element, so
  // stopping propagation here also stops that listener. With no popup open,
  // Escape is left alone and reaches the panel.
  function onKeyDownCapture(event: ReactKeyboardEvent<HTMLDivElement>) {
    escapeWhilePopupOpen.current =
      event.key === "Escape" && wrapperRef.current?.querySelector(".leaflet-popup") != null;
  }
  function onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key !== "Escape" || !escapeWhilePopupOpen.current) return;
    escapeWhilePopupOpen.current = false;
    event.preventDefault();
    event.stopPropagation();
    mapRef.current?.closePopup();
  }

  return (
    <div
      ref={wrapperRef}
      role="region"
      aria-label="Map of the search origin and nearby landmarks"
      className={styles.wrapper}
      onKeyDownCapture={onKeyDownCapture}
      onKeyDown={onKeyDown}
    >
      <MapContainer
        ref={mapRef}
        center={[origin.latitude, origin.longitude]}
        zoom={SINGLE_LOCATION_ZOOM}
        scrollWheelZoom={false}
        className={styles.map}
      >
        <TileLayer url={TEMPORARY_DEV_TILE_URL} attribution={TEMPORARY_DEV_TILE_ATTRIBUTION} />
        <FitToResults set={set} markers={markers} />
        {markers.map((marker) => (
          <NearbyMarker key={marker.key} marker={marker} onFocusLost={onFocusLost} />
        ))}
      </MapContainer>
    </div>
  );
}
