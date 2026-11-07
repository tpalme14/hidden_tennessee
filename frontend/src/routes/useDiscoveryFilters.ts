import { useEffect, useRef, useState } from "react";
import type { DiscoveryUrlActions } from "./useDiscoveryUrlState";
import type { DiscoveryUrlState } from "./discoveryUrlState";

const DEBOUNCE_MS = 300;
const MAX_QUERY_LENGTH = 100;

export interface DiscoveryFiltersControls {
  inputValue: string;
  committedQuery: string;
  selectedCategories: string[];
  onInputChange: (value: string) => void;
  onSubmitNow: () => void;
  onToggleCategory: (slug: string) => void;
  onClearAll: () => void;
}

function normalizeQuery(raw: string): string {
  return raw.trim().slice(0, MAX_QUERY_LENGTH);
}

/**
 * Lifts the debounced-text/immediate-category commit logic that used to live
 * inside `useLandmarkSearch` (M02-T05/M02-T06) into a hook called once in
 * `DiscoveryPage`, so the map's markers and the results list consume the
 * SAME committed `q`/`categories` — the central M02-T07 architectural
 * decision. The two stay two separate queries with two separate visibility
 * rules (plain vs. geographic, per M01-T05); only the commit logic is
 * shared, not the result sets themselves.
 *
 * Committed values now live in the URL via `useDiscoveryUrlState`
 * (`commitText`/`commitCategories`), not local component state — this is
 * what makes them restorable on refresh/Back/Forward (spec §9.6).
 */
export function useDiscoveryFilters(
  urlState: DiscoveryUrlState,
  urlActions: DiscoveryUrlActions,
): DiscoveryFiltersControls {
  const [inputValue, setInputValue] = useState(urlState.q);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputValueRef = useRef(inputValue);
  inputValueRef.current = inputValue;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => urlActions.commitText(normalizeQuery(inputValue)), DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // Only `inputValue` should retrigger the debounce timer; `urlActions.commitText` is a stable callback.
  }, [inputValue, urlActions]);

  return {
    inputValue,
    committedQuery: urlState.q,
    selectedCategories: urlState.categories,
    onInputChange: setInputValue,
    onSubmitNow: () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      urlActions.commitText(normalizeQuery(inputValueRef.current));
    },
    onToggleCategory: (slug) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      urlActions.commitText(normalizeQuery(inputValueRef.current));
      const current = urlState.categories;
      const next = (current.includes(slug) ? current.filter((existing) => existing !== slug) : [...current, slug]).sort();
      urlActions.commitCategories(next);
    },
    onClearAll: () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setInputValue("");
      urlActions.commitText("");
      urlActions.commitCategories([]);
    },
  };
}
