import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { LandmarkMap } from "../map/LandmarkMap";
import { LandmarkMarkersRenderer } from "../map/LandmarkMarkersRenderer";
import { MapViewportTracker } from "../map/MapViewportTracker";
import { useMapMarkers } from "../map/useMapMarkers";
import styles from "./DiscoveryPage.module.css";
import { DiscoveryFilters } from "./DiscoveryFilters";
import { GeoDiscoveryControls } from "./GeoDiscoveryControls";
import { GEO_RESULTS_HEADING_ID, GeographicResultsList } from "./GeographicResultsList";
import { LandmarkSearch } from "./LandmarkSearch";
import { useDiscoveryFilters } from "./useDiscoveryFilters";
import { useDiscoveryUrlState } from "./useDiscoveryUrlState";
import { useGeographicDiscovery } from "./useGeographicDiscovery";

/**
 * Discovery route (M02-T02 added the base map; M02-T03 added markers;
 * M02-T05 added name search; M02-T06 added category filters; M02-T07 adds
 * viewport-committed bbox discovery, proximity discovery, and URL-state
 * restoration). Loading/error/empty/truncation messaging is deliberately
 * kept in normal page layout, outside <LandmarkMap>'s Leaflet tree — only
 * validated markers are passed into the map itself.
 *
 * `useDiscoveryFilters` and `useGeographicDiscovery` are each called exactly
 * once here, on top of the single URL-backed `useDiscoveryUrlState` source
 * of truth — both `useMapMarkers` (geographic, PUBLIC-only, with
 * coordinates) and `<LandmarkSearch>` (plain, any status, name/category
 * only) consume the SAME committed `q`/`categories`, per the M02-T07 shared-
 * filter decision, while keeping their separate privacy regimes
 * (`useLandmarkSearch`'s docstring; established in M01-T05).
 *
 * While a live marker refetch is loading or has failed, the last
 * successful marker set is kept on screen (via `useMapMarkers`'s
 * `previous`) rather than going blank, with an explicit "from your
 * previous search" notice distinguishing it from a confirmed match for
 * the current query (M02-T07 final verification correction). `LandmarkSearch`
 * does the same for its own list independently (M02-T08, via
 * `useLandmarkSearch`'s `previous`) — see its own docstring.
 *
 * `GeographicResultsList` (M02-T08) is a second, accessible rendering of
 * this SAME `markerStatus` the map already uses — no new fetch, no new
 * privacy surface, spec §3.3's non-map discovery requirement for whatever
 * is currently shown on the map. It is deliberately kept separate from
 * `LandmarkSearch` (different privacy-scoped queries; see
 * `GeographicResultsList`'s own docstring for why its status text is
 * non-live, avoiding duplicate announcements of what this page already
 * announces above). Two visually-hidden-until-focused skip links, extending
 * `AppLayout`'s existing "Skip to content" pattern, let a keyboard user jump
 * straight to either list without tabbing through the map/geo-controls
 * section — including, in particular, without tabbing through however many
 * individual markers are on the map.
 */
/** Id of the visible keyboard-controls instruction, referenced by the map container's `aria-describedby`. */
export const MAP_KEYBOARD_HELP_ID = "map-keyboard-help";

export function DiscoveryPage() {
  const [urlState, urlActions] = useDiscoveryUrlState();
  const filters = useDiscoveryFilters(urlState, urlActions);
  const geo = useGeographicDiscovery(urlState, urlActions);
  const [markerStatus, retryMarkers] = useMapMarkers({
    q: filters.committedQuery,
    categories: filters.selectedCategories,
    geo: geo.effectiveGeo,
  });

  // While a refetch is loading or has failed, keep showing the last
  // successful marker set (if any) rather than letting the map go blank —
  // clearly labeled as previous, never as confirmed matches for the current
  // committed query (M02-T07 final verification correction).
  const previousResult = markerStatus.kind !== "success" ? markerStatus.previous : undefined;
  const isShowingPrevious = Boolean(previousResult && previousResult.markers.length > 0);
  const markersToRender =
    markerStatus.kind === "success" ? markerStatus.markers : (previousResult?.markers ?? []);

  // When a results update removes the marker (or open popup) that holds
  // keyboard focus, land on the geographic-results heading — the accessible
  // list of exactly the markers now on the map — rather than on <body>
  // (M02-T08 Increment 5a). `LandmarkMarkersRenderer` only calls this when
  // focus was genuinely inside the removed marker, never when the user has
  // already moved to another control.
  const focusGeoResultsHeading = () => {
    document.getElementById(GEO_RESULTS_HEADING_ID)?.focus();
  };

  return (
    <section aria-labelledby="discovery-heading">
      <h2 id="discovery-heading">Discover Landmarks</h2>
      <a href={`#${GEO_RESULTS_HEADING_ID}`} className={styles.skipLink}>
        Skip to landmarks on the map
      </a>
      <a href="#search-heading" className={styles.skipLink}>
        Skip to name search results
      </a>
      <p>
        Pan or zoom the map, then choose &quot;Search this area&quot;, or use proximity search to
        find landmarks near the map center or near you. The map shows only publicly viewable
        landmark locations; the list below can also surface landmarks that don&apos;t have a public
        location yet. A landmark can legitimately appear in both the &quot;Landmarks on the
        map&quot; list and the &quot;Name search results&quot; list below when it matches both —
        that&apos;s expected, not an error.
      </p>

      {urlState.wasNormalized ? (
        <p role="status">
          Some of the search settings in this page&apos;s link weren&apos;t valid, so they were
          reset to the default Tennessee-wide view.
        </p>
      ) : null}

      {markerStatus.kind === "loading" ? (
        <LoadingState label={isShowingPrevious ? "Updating landmarks…" : "Loading landmarks…"} />
      ) : null}
      {markerStatus.kind === "error" ? (
        <ErrorState message={markerStatus.message} onRetry={retryMarkers} />
      ) : null}
      {isShowingPrevious ? (
        <p role="status">
          Showing landmarks from your previous search while{" "}
          {markerStatus.kind === "error" ? "the update failed" : "the update loads"} — these may not
          match your current filters or area.
        </p>
      ) : null}
      {markerStatus.kind === "success" && markerStatus.markers.length === 0 ? (
        <EmptyState message="No publicly viewable landmarks are available for this area yet." />
      ) : null}
      {markerStatus.kind === "success" && markerStatus.isTruncated ? (
        <p role="status">Showing up to 200 results; zoom in or refine your search to see more.</p>
      ) : null}

      {/* One visible keyboard instruction (M02-T08 Increment 5d), also linked to the
          focusable map container as its accessible description — plain text, no live
          region, so it is read once on focusing the map and never re-announced. */}
      <p id={MAP_KEYBOARD_HELP_ID}>
        Keyboard controls: Use arrow keys to pan the focused map. Press Tab to move between markers,
        Enter or Space to open a marker, and Escape to close its popup.
      </p>

      <LandmarkMap
        initialViewport={urlState.viewport ?? undefined}
        showCenterCrosshair={geo.effectiveGeo.mode === "bbox"}
        describedById={MAP_KEYBOARD_HELP_ID}
      >
        <MapViewportTracker onViewportChange={geo.onViewportChange} />
        {markerStatus.kind === "success" || isShowingPrevious ? (
          <LandmarkMarkersRenderer markers={markersToRender} onFocusLost={focusGeoResultsHeading} />
        ) : null}
      </LandmarkMap>

      <GeoDiscoveryControls controls={geo} />
      <GeographicResultsList status={markerStatus} onRetry={retryMarkers} />
      <DiscoveryFilters controls={filters} />
      <LandmarkSearch
        committedQuery={filters.committedQuery}
        categories={filters.selectedCategories}
      />
    </section>
  );
}
