import { Link } from "react-router";
import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { categoryLabel } from "../map/categoryMarkerStyle";
import { useLandmarkSearch } from "./useLandmarkSearch";

export interface LandmarkSearchProps {
  committedQuery: string;
  categories: string[];
}

/**
 * Plain-mode results list (M02-T05/M02-T06), independent of the map's
 * marker set — a deliberate, spec-approved separation (different visibility
 * rules, not different filters; see `useDiscoveryFilters`'s docstring).
 * Rebuilt in M02-T07 to take its committed `q`/`categories` as props from
 * the shared `DiscoveryFilters` UI rather than owning its own input/category
 * controls. Every result shows only its display name and category,
 * regardless of whether the underlying record is PUBLIC, UNREVIEWED, or
 * SENSITIVE. Profile links carry `state.fromDiscovery` so the profile page's
 * return navigation can use `navigate(-1)` reliably.
 *
 * While a refetch (a filter change or pagination click) is loading or has
 * failed, the last successful page is kept on screen (via
 * `useLandmarkSearch`'s `previous`) rather than going blank, with an
 * explicit "from your previous search" notice — never presented as a
 * confirmed match for the current committed query (M02-T08, closing the
 * M02-T07 follow-up; same pattern as `useMapMarkers`/`DiscoveryPage`).
 */
export function LandmarkSearch({ committedQuery, categories }: LandmarkSearchProps) {
  const { status, onNextPage, onPreviousPage, retry } = useLandmarkSearch(committedQuery, categories);

  const previousResult = status.kind === "loading" || status.kind === "error" ? status.previous : undefined;
  const isShowingPrevious = Boolean(previousResult && previousResult.items.length > 0);
  const itemsToRender = status.kind === "success" ? status.items : (previousResult?.items ?? []);
  const pageToRender = status.kind === "success" ? status.page : (previousResult?.page ?? 1);
  const hasMoreToRender = status.kind === "success" ? status.hasMore : (previousResult?.hasMore ?? false);
  const isTruncatedToRender = status.kind === "success" ? status.isTruncated : (previousResult?.isTruncated ?? false);

  return (
    <section aria-labelledby="search-heading">
      <h3 id="search-heading" tabIndex={-1}>
        Name search results
      </h3>

      {status.kind === "idle" ? <p>Type a landmark name or choose a category above to search.</p> : null}
      {status.kind === "loading" ? (
        <LoadingState label={isShowingPrevious ? "Updating search results…" : "Searching…"} />
      ) : null}
      {status.kind === "error" ? <ErrorState message={status.message} onRetry={retry} /> : null}
      {isShowingPrevious ? (
        <p role="status">
          Showing results from your previous search while {status.kind === "error" ? "the update failed" : "the update loads"} — these may not match your current search or filters.
        </p>
      ) : null}
      {status.kind === "success" && status.items.length === 0 ? (
        <EmptyState message="No landmarks found matching your search." />
      ) : null}

      {(status.kind === "success" && status.items.length > 0) || isShowingPrevious ? (
        <>
          <p role="status">
            {itemsToRender.length} result{itemsToRender.length === 1 ? "" : "s"} on this page
            {isTruncatedToRender ? " — more results exist; try a more specific search." : ""}
          </p>
          <ul>
            {itemsToRender.map((item) => (
              <li key={item.id}>
                <Link to={`/landmarks/${item.id}`} state={{ fromDiscovery: true }}>
                  {item.display_name}
                </Link>{" "}
                — <span>{categoryLabel(item.category)}</span>
              </li>
            ))}
          </ul>
          <div>
            <button type="button" onClick={onPreviousPage} disabled={pageToRender <= 1}>
              Previous
            </button>
            <button type="button" onClick={onNextPage} disabled={!hasMoreToRender}>
              Next
            </button>
          </div>
        </>
      ) : null}
    </section>
  );
}
