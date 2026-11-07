import {
  divIcon,
  type DivIcon,
  type LeafletKeyboardEvent,
  type Marker as LeafletMarker,
  type PopupEvent,
} from "leaflet";
import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from "react";
import { Marker, Popup, useMap } from "react-leaflet";
import { Link } from "react-router";
import { categoryColor, categoryLabel } from "./categoryMarkerStyle";
import styles from "./LandmarkMarkersRenderer.module.css";
import { markerAccessibleName } from "./markerAccessibleName";
import type { LandmarkMarker } from "./useMapMarkers";

export interface LandmarkMarkersRendererProps {
  markers: LandmarkMarker[];
  /**
   * Called when a marker that currently holds keyboard focus — on its icon
   * element or anywhere inside its open popup — is removed from the map by a
   * results update (M02-T08 Increment 5a). Without this, focus would fall to
   * `<body>`. The caller decides the fallback destination (e.g. the
   * geographic-results heading); never called when focus is elsewhere.
   */
  onFocusLost?: () => void;
}

/** Outer focusable icon element size (px): larger than the 16px visible dot to enlarge the hit/focus target. */
const ICON_SIZE = 24;
/** Visible dot radius (px) — matches the former `CircleMarker` `radius={8}`. */
const DOT_RADIUS = 8;
/** Z-index offset applied while a marker has keyboard focus, so it rises above neighbours it overlaps. */
const FOCUSED_Z_INDEX_OFFSET = 1000;
/** Elements that are real Tab stops inside a popup (the content group has tabindex="-1" and is deliberately not one). */
const POPUP_TAB_STOP_SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * One `DivIcon` per category, built once. The HTML is assembled only from
 * this module's own CSS-module class names and the fixed category palette
 * (`categoryMarkerStyle`) — never from landmark data — so no landmark field
 * is ever interpolated into icon HTML.
 */
const iconCache = new Map<string, DivIcon>();

function categoryIcon(category: string): DivIcon {
  const color = categoryColor(category);
  const cached = iconCache.get(color);
  if (cached) return cached;
  const icon = divIcon({
    className: styles.icon,
    html: `<span class="${styles.dot}" style="background-color:${color}" aria-hidden="true"></span>`,
    iconSize: [ICON_SIZE, ICON_SIZE],
    iconAnchor: [ICON_SIZE / 2, ICON_SIZE / 2],
    // Popup tip sits just above the visible dot, not over its centre.
    popupAnchor: [0, -DOT_RADIUS],
  });
  iconCache.set(color, icon);
  return icon;
}

function focusMarkerElement(marker: LeafletMarker | null): void {
  const element = marker?.getElement();
  if (element && element.isConnected) {
    element.focus({ preventScroll: true });
  }
}

interface LandmarkPopupContentProps {
  marker: LandmarkMarker;
  leafletMarkerRef: RefObject<LeafletMarker | null>;
}

/**
 * The popup's content, rendered by react-leaflet into Leaflet's popup
 * content node. Takes focus when its popup opens so a keyboard user lands
 * inside the popup (the profile link is then one Tab away). Escape handling
 * lives on the whole popup element (see `AccessibleLandmarkMarker`), not
 * here, so it also covers Leaflet's own close button, which sits outside
 * this content node.
 *
 * Why two focus paths: react-leaflet only mounts this component on the
 * popup's FIRST open (after Leaflet's `popupopen` has already fired), and
 * then keeps it mounted — in a detached content node — across later
 * close/open cycles. So the first open is handled by the mount effect, and
 * every later open by subscribing to the marker's own `popupopen` event.
 */
function LandmarkPopupContent({ marker, leafletMarkerRef }: LandmarkPopupContentProps) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const leafletMarker = leafletMarkerRef.current;
    const focusContent = () => contentRef.current?.focus({ preventScroll: true });
    if (leafletMarker?.isPopupOpen()) {
      focusContent();
    }
    leafletMarker?.on("popupopen", focusContent);
    return () => {
      leafletMarker?.off("popupopen", focusContent);
    };
  }, [leafletMarkerRef]);

  return (
    // The wrapper is focusable only programmatically (tabindex=-1), never a Tab stop of its own.
    <div
      ref={contentRef}
      tabIndex={-1}
      className={styles.popupContent}
      role="group"
      aria-label={`${marker.display_name} details`}
    >
      <strong>{marker.display_name}</strong>
      <br />
      {categoryLabel(marker.category)}
      {marker.distance_miles !== undefined ? (
        <>
          <br />
          Approx. {marker.distance_miles.toFixed(1)} mi (straight-line distance)
        </>
      ) : null}
      <br />
      <Link to={`/landmarks/${marker.id}`} state={{ fromDiscovery: true }}>
        View profile
      </Link>
    </div>
  );
}

interface AccessibleLandmarkMarkerProps {
  marker: LandmarkMarker;
  onFocusLost?: () => void;
}

/**
 * One keyboard-accessible landmark marker (M02-T08 Increment 3).
 *
 * Leaflet's own `Marker` (with its default `keyboard: true`) makes the icon
 * element itself focusable (`tabindex="0"`, `role="button"`) and opens the
 * bound popup on Enter. On top of that, this component:
 * - sets the accessible name (`aria-label`) on that actual focusable element
 *   — a `DivIcon` gets no name from Leaflet's `alt` option, which only
 *   applies to `<img>` icons;
 * - toggles the popup on Space (which Leaflet ignores), preventing the
 *   page-scroll default;
 * - closes the map's open popup on Escape, whether focus is on this marker
 *   (even when the open popup belongs to a different marker — the same
 *   "dismiss whatever is open" behavior Leaflet gives the map container) or
 *   anywhere inside this marker's popup (its content, the profile link, or
 *   Leaflet's own close button), returning focus to the marker that owned
 *   the popup. Leaflet's built-in Escape handling only runs while the map
 *   container itself is focused, so it never applies in those cases;
 * - raises the marker above overlapping neighbours while focused, via
 *   `setZIndexOffset` (the real `Marker` API — `bringToFront` belongs to
 *   `Path`/`CircleMarker` only), and restores normal stacking on blur;
 * - when the popup closes and focus was left stranded (e.g. the popup's own
 *   close button was activated, or Escape was pressed inside it), returns
 *   focus to this marker — but never steals focus from an element the user
 *   has moved to (another marker, the map, a control);
 * - when this marker is removed from the map while it (or its open popup)
 *   holds focus, reports that through `onFocusLost` so the page can move
 *   focus somewhere sensible instead of letting it fall to `<body>`
 *   (Increment 5a). This is deliberately two-phase, based on the measured
 *   React 19 + react-leaflet 5 unmount sequence: (1) ownership is DETECTED
 *   in the layout-effect cleanup, the only point where the marker ref is
 *   still set, the icon is still in the DOM, and the popup's portal content
 *   is still attached with focus intact (by the passive cleanup the ref is
 *   detached and the popup content already removed, with focus on <body>);
 *   (2) the report is MADE in the passive-effect cleanup, because React
 *   restores focus at the end of every commit to whichever element was
 *   focused before it, if that element is still in the document — and the
 *   Leaflet icon still is, since react-leaflet only removes the layer in its
 *   own, later passive cleanup. Moving focus during the layout cleanup is
 *   therefore silently undone by React (observed directly: the heading was
 *   focused, then React's `flushMutationEffects` re-focused the icon, which
 *   Leaflet then removed, leaving <body>). Reporting in the passive cleanup
 *   lands after that restoration and before the icon disappears.
 */
function AccessibleLandmarkMarker({ marker, onFocusLost }: AccessibleLandmarkMarkerProps) {
  const map = useMap();
  const leafletMarkerRef = useRef<LeafletMarker | null>(null);
  const elementRef = useRef<HTMLElement | null>(null);
  const onFocusLostRef = useRef(onFocusLost);
  onFocusLostRef.current = onFocusLost;
  const accessibleName = markerAccessibleName(marker);

  // Focus-loss detection and reporting are split across the two unmount
  // cleanups (both empty-deps, so unmount-only). See the docstring for why.
  const focusOwnedAtUnmountRef = useRef<{
    element: HTMLElement | null;
    popupElement: HTMLElement | null;
  } | null>(null);

  // Phase 1 — DETECT, at layout cleanup: the marker ref is still set, the
  // icon is still in the DOM, and the popup's portal content (if any) is
  // still attached with focus intact, so ownership can be decided.
  useLayoutEffect(() => {
    return () => {
      const active = document.activeElement;
      if (!active || active === document.body) return;
      const element = elementRef.current ?? leafletMarkerRef.current?.getElement() ?? null;
      const popupElement = leafletMarkerRef.current?.getPopup()?.getElement() ?? null;
      const ownsFocus =
        (element !== null && element.contains(active)) ||
        (popupElement !== null && popupElement.contains(active));
      focusOwnedAtUnmountRef.current = ownsFocus ? { element, popupElement } : null;
    };
  }, []);

  // Phase 2 — ACT, at passive cleanup: this runs after React's commit has
  // finished (including its own end-of-commit focus restoration), but still
  // before react-leaflet's child cleanup removes the Leaflet layer. Only
  // reports if focus is still stranded on the doomed marker/popup or has
  // already fallen to <body> — never if something else took focus meanwhile.
  useEffect(() => {
    return () => {
      const owned = focusOwnedAtUnmountRef.current;
      focusOwnedAtUnmountRef.current = null;
      if (!owned) return;
      const active = document.activeElement;
      const stillStranded =
        !active ||
        active === document.body ||
        (owned.element !== null && owned.element.contains(active)) ||
        (owned.popupElement !== null && owned.popupElement.contains(active));
      if (stillStranded) {
        onFocusLostRef.current?.();
      }
    };
  }, []);

  // Runs after react-leaflet's own (child) effects have added the layer to
  // the map, so the icon element exists. Re-runs only if the name changes.
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
    // Keyboard handling for the popup element itself (content, profile link,
    // and Leaflet's close button). Attached per open / detached per close:
    // Leaflet reuses the same popup element across opens, so this never
    // accumulates duplicate listeners.
    // - Escape anywhere inside closes the popup and returns focus to the marker.
    // - Shift+Tab at the popup's BACKWARD BOUNDARY only — i.e. from the
    //   programmatically focused content group or from the popup's first Tab
    //   stop (the profile link) — returns focus to the marker that opened it,
    //   leaving the popup open (M02-T08 Increment 5c). Without this, the
    //   browser's natural backward order lands on the LAST marker in the
    //   marker pane, because Leaflet renders popups in a pane after all
    //   markers. Shift+Tab anywhere else in the popup (e.g. from the close
    //   button back to the profile link), forward Tab, and every other key
    //   are left to the browser, so there is no trap and nothing unrelated
    //   is intercepted.
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
        const atBackwardBoundary = active === firstTabStop || active.tabIndex < 0;
        if (!atBackwardBoundary) return;
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
          event.originalEvent.preventDefault(); // no page scroll
          leafletMarker.togglePopup();
        } else if (key === "Escape") {
          event.originalEvent.preventDefault();
          // Closes whichever popup is open on the map (a no-op if none is).
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
        const focusWasLost =
          active === null || active === document.body || (popupElement?.contains(active) ?? false);
        if (focusWasLost) {
          focusMarkerElement(leafletMarkerRef.current);
        }
      },
    };
  }, [map]);

  return (
    <Marker
      ref={leafletMarkerRef}
      position={[marker.latitude, marker.longitude]}
      icon={categoryIcon(marker.category)}
      eventHandlers={eventHandlers}
    >
      <Popup>
        <LandmarkPopupContent marker={marker} leafletMarkerRef={leafletMarkerRef} />
      </Popup>
    </Marker>
  );
}

/**
 * Pure rendering of an already-fetched, already-validated marker list inside
 * the Leaflet map context (M02-T03; extended in M02-T07 for proximity-mode
 * distance; converted from `CircleMarker` to keyboard-accessible
 * `Marker`+`DivIcon` in M02-T08). Owns no data fetching and no
 * loading/error/empty/truncation UI — see `useMapMarkers` (data) and
 * `DiscoveryPage` (status messaging, kept outside the MapContainer). Popup
 * content is intentionally limited to the approved public fields: display
 * name, category label, straight-line distance when present (proximity mode
 * only), and a profile link — nothing else. The profile link carries
 * `state.fromDiscovery` so the profile page's return navigation can reliably
 * use `navigate(-1)` instead of guessing from browser history (M02-T07).
 */
export function LandmarkMarkersRenderer({ markers, onFocusLost }: LandmarkMarkersRendererProps) {
  return (
    <>
      {markers.map((marker) => (
        <AccessibleLandmarkMarker key={marker.id} marker={marker} onFocusLost={onFocusLost} />
      ))}
    </>
  );
}
