import { useCallback, useContext, useMemo } from "react";
import {
  UNSAFE_DataRouterContext,
  UNSAFE_NavigationContext,
  useLocation,
  useSearchParams,
  type SetURLSearchParams,
} from "react-router";
import {
  formatBboxParam,
  formatNearParam,
  type AllowedRadiusMiles,
  type GeoBbox,
  type GeoOrigin,
} from "../map/geo";
import { parseDiscoveryParams, type DiscoveryUrlState } from "./discoveryUrlState";

export interface DiscoveryUrlActions {
  /** Debounced/committed text search — `replaceState` (spec §9.6: grouped with "debounced typing"). */
  commitText: (q: string) => void;
  /** Immediate category-filter commit — `replaceState`, same character as a text commit. */
  commitCategories: (categories: string[]) => void;
  /** "Search this area" — `pushState` (spec §9.6's own example of a committed-navigation action). */
  commitBbox: (bbox: GeoBbox) => void;
  /** "Find near map center" / "Near me" (map-center-derived only) — `pushState` ("changing search mode"). */
  commitNearOrigin: (origin: GeoOrigin, radius: AllowedRadiusMiles) => void;
  /** A radius change while already in `near` mode — `replaceState` (an in-place filter tweak, not a mode change). */
  commitRadius: (radius: AllowedRadiusMiles) => void;
  /** Returns to `bbox` mode using the already-present, last-committed `bbox` param — `pushState`. */
  exitProximity: () => void;
  /** Frequent pan/zoom camera-position updates — `replaceState` (spec §9.6: "frequent viewport changes"). */
  updateViewport: (center: [number, number], zoom: number) => void;
}

/**
 * URL-backed source of truth for committed discovery state (M02-T07), per
 * spec §9.6 and the approved decision to use the existing `react-router`
 * dependency (already in use for routing since M02-T01) rather than a new
 * library or hand-rolled `history.pushState` calls. `near`/`radius` set via
 * `commitNearOrigin` must never be a device-geolocation origin — callers
 * handling "Near me" keep that origin in local component state instead (see
 * `useGeographicDiscovery`), so a device-derived coordinate is never written
 * here, per spec §5.2's "device-derived origins are not placed in shareable
 * URLs."
 */
/**
 * Route ownership (M06-T02 Increment 5a). `setSearchParams` navigates relative
 * to the route this hook was rendered under, so a delayed write from Discover
 * (a Leaflet `zoomend`/`moveend` viewport report, or the text debounce) that
 * runs after the user has navigated elsewhere would replace the new location
 * with `/?…` — observed when the browser router had already moved (history is
 * updated synchronously; React's commit follows in a transition) before the
 * page's cleanup ran. Every write therefore checks, at the moment it is made,
 * that the router's CURRENT pathname is still the one this hook belongs to;
 * otherwise it is dropped. Query-only changes on the same pathname are
 * unaffected.
 *
 * The current location is read from the router itself, synchronously: a data
 * router's `state.location`, or the history object a `BrowserRouter`/
 * `MemoryRouter` provides as its navigator. Browser and memory locations are
 * never compared with each other. Where neither exposes a location, writes
 * proceed as before.
 */
function useOwnedSearchParamsWriter(setSearchParams: SetURLSearchParams): SetURLSearchParams {
  const { pathname: ownerPathname } = useLocation();
  const dataRouter = useContext(UNSAFE_DataRouterContext)?.router;
  const { navigator } = useContext(UNSAFE_NavigationContext);
  return useCallback<SetURLSearchParams>(
    (nextInit, navigateOptions) => {
      const currentPathname =
        dataRouter?.state.location.pathname ??
        (navigator as { location?: { pathname?: string } }).location?.pathname;
      if (currentPathname !== undefined && currentPathname !== ownerPathname) return;
      setSearchParams(nextInit, navigateOptions);
    },
    [dataRouter, navigator, ownerPathname, setSearchParams],
  );
}

export function useDiscoveryUrlState(): [DiscoveryUrlState, DiscoveryUrlActions] {
  const [searchParams, setUnownedSearchParams] = useSearchParams();
  const setSearchParams = useOwnedSearchParamsWriter(setUnownedSearchParams);
  const state = useMemo(() => parseDiscoveryParams(searchParams), [searchParams]);

  const commitText = useCallback(
    (q: string) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (q) next.set("q", q);
          else next.delete("q");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const commitCategories = useCallback(
    (categories: string[]) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          if (categories.length > 0) next.set("categories", categories.join(","));
          else next.delete("categories");
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const commitBbox = useCallback(
    (bbox: GeoBbox) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("mode", "bbox");
          next.set("bbox", formatBboxParam(bbox));
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const commitNearOrigin = useCallback(
    (origin: GeoOrigin, radius: AllowedRadiusMiles) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("mode", "near");
          next.set("near", formatNearParam(origin));
          next.set("radius", String(radius));
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );

  const commitRadius = useCallback(
    (radius: AllowedRadiusMiles) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("radius", String(radius));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const exitProximity = useCallback(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("mode", "bbox");
        return next;
      },
      { replace: false },
    );
  }, [setSearchParams]);

  const updateViewport = useCallback(
    (center: [number, number], zoom: number) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set("lat", center[0].toFixed(5));
          next.set("lng", center[1].toFixed(5));
          next.set("zoom", String(zoom));
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  // Memoized so the returned actions object itself stays referentially
  // stable across renders whenever its (already individually memoized)
  // methods don't change — otherwise every `useDiscoveryUrlState` render
  // would hand out a brand-new wrapping object, which would defeat any
  // downstream `useCallback`/`useEffect` dependency array that reasonably
  // depends on "the actions" as a whole (`useDiscoveryFilters`,
  // `useGeographicDiscovery`), re-running them on every render for no
  // actual reason — a real risk of render-loop-adjacent bugs, not just
  // wasted work.
  const actions = useMemo(
    () => ({
      commitText,
      commitCategories,
      commitBbox,
      commitNearOrigin,
      commitRadius,
      exitProximity,
      updateViewport,
    }),
    [
      commitText,
      commitCategories,
      commitBbox,
      commitNearOrigin,
      commitRadius,
      exitProximity,
      updateViewport,
    ],
  );

  return [state, actions];
}
