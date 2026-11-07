import { useEffect, useState } from "react";
import { getCategories } from "../api/categories";
import { ApiError } from "../api/client";
import type { Category } from "../api/types";

export type CategoryOptionsStatus =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "success"; categories: Category[] };

export interface CategoryOptionsControls {
  status: CategoryOptionsStatus;
  retry: () => void;
}

/**
 * Fetches the fixed category-filter option list once (M02-T06). Entirely
 * independent of `useLandmarkSearch`'s results fetching — a category-list
 * failure must never prevent ordinary name search from working, and this
 * hook never touches the search/results state. `"loading"` is a distinct
 * status from `"success"` with an empty array, so an in-progress request is
 * never mistaken for "there are no categories."
 */
export function useCategoryOptions(): CategoryOptionsControls {
  const [status, setStatus] = useState<CategoryOptionsStatus>({ kind: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading" });

    getCategories()
      .then((categories) => {
        if (!cancelled) setStatus({ kind: "success", categories });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof ApiError ? error.message : "Unable to load categories.";
        setStatus({ kind: "error", message });
      });

    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  return { status, retry: () => setRetryToken((t) => t + 1) };
}
