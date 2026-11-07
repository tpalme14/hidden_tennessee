import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState";
import { categoryLabel } from "../map/categoryMarkerStyle";
import type { MapMarkersStatus } from "../map/useMapMarkers";

export interface GeographicResultsListProps {
  status: MapMarkersStatus;
  onRetry: () => void;
}

/**
 * The id of this section's heading — a `tabIndex={-1}` programmatic focus
 * target used by `DiscoveryPage`'s skip link and, since M02-T08 Increment 5a,
 * as the fallback focus destination when a focused map marker is removed by
 * a results update.
 */
export const GEO_RESULTS_HEADING_ID = "geo-results-heading";

/**
 * Accessible, non-map rendering of the SAME geographic result set the map
 * already shows (M02-T08, spec §3.3) — consumes `useMapMarkers`'s status
 * directly, with no fetch of its own: no new network requests, no
 * independent geographic filtering, no change to the server-side
 * `PUBLIC`-only restriction on `bbox`/`near` queries (M01-T05). This is a
 * second presentation of already-fetched, already-privacy-filtered data,
 * exactly like `LandmarkSearch` is for plain-mode results — the two lists
 * stay deliberately separate (different privacy-scoped queries), and a
 * landmark legitimately appearing in both is expected, not an error (see
 * `DiscoveryPage`'s explanatory copy).
 *
 * Deliberately does NOT reuse the shared `LoadingState`/`ErrorState`
 * components (which render `role="status"`/`role="alert"`) for its own
 * loading/error text: `DiscoveryPage` already renders a live-announcing
 * status/alert for this exact same `status` value, above the map. Using
 * live-announcing roles here too would fire a second, duplicate screen-
 * reader announcement for the same event. This section's own text is
 * plain (non-live) — fully readable by anyone who navigates directly into
 * or reads through this section (including via the skip link), without
 * re-announcing what was already announced once at the page level.
 * `EmptyState` is still reused as-is: it has no live-announcing role to
 * begin with, so reusing it introduces no duplication.
 *
 * No pagination — geographic results are always a single page (`page=1`,
 * `limit=200`), matching the map's own M02-T07 design; `isTruncated` alone
 * (never inferred from the marker count) drives the "zoom in or refine"
 * message, consistent with the map's identical messaging.
 */
export function GeographicResultsList({ status, onRetry }: GeographicResultsListProps) {
  const previousResult =
    status.kind === "loading" || status.kind === "error" ? status.previous : undefined;
  const isShowingPrevious = Boolean(previousResult && previousResult.markers.length > 0);
  const itemsToRender =
    status.kind === "success" ? status.markers : (previousResult?.markers ?? []);
  const isTruncatedToRender =
    status.kind === "success" ? status.isTruncated : (previousResult?.isTruncated ?? false);

  return (
    <section aria-labelledby={GEO_RESULTS_HEADING_ID}>
      <h3 id={GEO_RESULTS_HEADING_ID} tabIndex={-1}>
        Landmarks on the map
      </h3>

      {status.kind === "loading" ? <p>{isShowingPrevious ? "Updating…" : "Loading…"}</p> : null}
      {status.kind === "error" ? (
        <div>
          <p>{status.message}</p>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
      {isShowingPrevious ? (
        <p>
          Showing landmarks from your previous search while{" "}
          {status.kind === "error" ? "the update failed" : "the update loads"} — these may not match
          your current filters or area.
        </p>
      ) : null}
      {status.kind === "success" && status.markers.length === 0 ? (
        <EmptyState message="No publicly viewable landmarks are currently shown on the map." />
      ) : null}

      {(status.kind === "success" && status.markers.length > 0) || isShowingPrevious ? (
        <>
          <p>
            {itemsToRender.length} landmark{itemsToRender.length === 1 ? "" : "s"} shown on the map
            {isTruncatedToRender
              ? " — more results exist; zoom in or refine your search to see more."
              : ""}
          </p>
          <ul>
            {itemsToRender.map((marker) => (
              <li key={marker.id}>
                <Link to={`/landmarks/${marker.id}`} state={{ fromDiscovery: true }}>
                  {marker.display_name}
                </Link>{" "}
                — <span>{categoryLabel(marker.category)}</span>
                {marker.distance_miles !== undefined ? (
                  <> — Approx. {marker.distance_miles.toFixed(1)} mi (straight-line distance)</>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
