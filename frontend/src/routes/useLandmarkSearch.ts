import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { searchLandmarks } from "../api/landmarks";
import type { LandmarkCollectionItem } from "../api/types";

export const RESULTS_PAGE_SIZE = 20;

export interface PreviousSearchResult {
  items: LandmarkCollectionItem[];
  page: number;
  hasMore: boolean;
  isTruncated: boolean;
}

export type LandmarkSearchStatus =
  | { kind: "idle" }
  | { kind: "loading"; previous?: PreviousSearchResult }
  | { kind: "error"; message: string; previous?: PreviousSearchResult }
  | { kind: "success"; items: LandmarkCollectionItem[]; page: number; hasMore: boolean; isTruncated: boolean };

export interface LandmarkSearchControls {
  status: LandmarkSearchStatus;
  onNextPage: () => void;
  onPreviousPage: () => void;
  retry: () => void;
}

/**
 * Plain-mode (name/category, any sensitivity status, never coordinates)
 * results-list fetch (M02-T05/M02-T06), rebuilt in M02-T07 to take the
 * already-committed `committedQuery`/`categories` as arguments rather than
 * owning its own debounce/commit logic — that logic moved to
 * `useDiscoveryFilters`, shared with the map's `useMapMarkers`, which is the
 * central M02-T07 architectural decision (see that hook's docstring). This
 * hook now owns only pagination and the plain-mode fetch itself.
 *
 * Idle only when both `committedQuery` and `categories` are empty — "do not
 * automatically fetch and display all landmarks" (M02-T05) still applies.
 * Stale responses are discarded via the same cancelled-flag idiom used
 * elsewhere in this codebase (`useLandmarkProfile`, `useMapMarkers`).
 *
 * Previous results are retained (M02-T08, closing the M02-T07 follow-up)
 * using the same pattern proven in `useMapMarkers`: the last successful page
 * is held in a ref (not component state that would itself need clearing)
 * and surfaced as `previous` on the `loading`/`error` variants, so a filter
 * change or pagination click doesn't make the list go blank while the next
 * page loads or if it fails. `previous` is intentionally absent from
 * `idle` — clearing filters is a deliberate reset to "no query," not a
 * transient hiccup, so showing stale results there would be misleading
 * rather than helpful. A new `success` always replaces `previous` outright,
 * including with an empty page.
 */
export function useLandmarkSearch(committedQuery: string, categories: string[]): LandmarkSearchControls {
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<LandmarkSearchStatus>({ kind: "idle" });
  const [retryToken, setRetryToken] = useState(0);
  const lastGoodRef = useRef<PreviousSearchResult | undefined>(undefined);

  const categoriesKey = categories.join(",");

  // Reset to page 1 the moment the committed filters change, during render
  // (React's documented "adjusting state when a prop changes" pattern) —
  // not in a separate effect, which would run the fetch effect below once
  // with the stale page before a corrective re-render, wasting a request.
  const filtersKey = `${committedQuery}::${categoriesKey}`;
  const [prevFiltersKey, setPrevFiltersKey] = useState(filtersKey);
  if (filtersKey !== prevFiltersKey) {
    setPrevFiltersKey(filtersKey);
    setPage(1);
  }

  useEffect(() => {
    if (committedQuery.length === 0 && categories.length === 0) {
      lastGoodRef.current = undefined;
      setStatus({ kind: "idle" });
      return;
    }

    let cancelled = false;
    setStatus({ kind: "loading", previous: lastGoodRef.current });

    searchLandmarks({ q: committedQuery, categories, page, limit: RESULTS_PAGE_SIZE })
      .then((response) => {
        if (cancelled) return;
        const result: PreviousSearchResult = {
          items: response.items,
          page: response.page,
          hasMore: response.has_more,
          isTruncated: response.is_truncated,
        };
        lastGoodRef.current = result;
        setStatus({ kind: "success", ...result });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof ApiError ? error.message : "Unable to search landmarks.";
        setStatus({ kind: "error", message, previous: lastGoodRef.current });
      });

    return () => {
      cancelled = true;
    };
    // `categoriesKey` stands in for `categories`'s contents, since the array reference changes every render.
  }, [committedQuery, categoriesKey, page, retryToken]);

  return {
    status,
    onNextPage: () => setPage((p) => p + 1),
    onPreviousPage: () => setPage((p) => Math.max(1, p - 1)),
    retry: () => setRetryToken((t) => t + 1),
  };
}
