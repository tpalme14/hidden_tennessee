import { EmptyState } from "../components/EmptyState";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { useCategoryOptions } from "./useCategoryOptions";
import type { DiscoveryFiltersControls } from "./useDiscoveryFilters";

const SEARCH_INPUT_ID = "landmark-search-input";

export interface DiscoveryFiltersProps {
  controls: DiscoveryFiltersControls;
}

/**
 * The name-search input and category checkboxes (originally M02-T05/M02-T06,
 * lifted out of `LandmarkSearch` in M02-T07): rendered once, shared by both
 * the results list and the map's markers via the same committed
 * `q`/`categories` state (`useDiscoveryFilters`). This is the UI half of the
 * central M02-T07 decision — one filter control surface, two separately
 * privacy-scoped consumers.
 */
export function DiscoveryFilters({ controls }: DiscoveryFiltersProps) {
  const { inputValue, selectedCategories, onInputChange, onSubmitNow, onToggleCategory, onClearAll } = controls;
  const categoryOptions = useCategoryOptions();

  return (
    <section aria-labelledby="filters-heading">
      <h3 id="filters-heading">Search and filter</h3>
      <p>
        These filters apply to both the map above and the results list below — the map only ever shows
        publicly viewable landmark locations, while the list can also surface landmarks that don&apos;t have a
        public location yet.
      </p>

      <div>
        <label htmlFor={SEARCH_INPUT_ID}>Search landmarks by name</label>
        <input
          id={SEARCH_INPUT_ID}
          type="text"
          value={inputValue}
          maxLength={100}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onSubmitNow();
          }}
        />
      </div>

      <fieldset>
        <legend>Filter by category</legend>
        {categoryOptions.status.kind === "loading" ? <LoadingState label="Loading categories…" /> : null}
        {categoryOptions.status.kind === "error" ? (
          <ErrorState message={categoryOptions.status.message} onRetry={categoryOptions.retry} />
        ) : null}
        {categoryOptions.status.kind === "success" && categoryOptions.status.categories.length === 0 ? (
          <EmptyState message="No category filters are available right now." />
        ) : null}
        {categoryOptions.status.kind === "success"
          ? categoryOptions.status.categories.map((category) => (
              <label key={category.slug}>
                <input
                  type="checkbox"
                  checked={selectedCategories.includes(category.slug)}
                  onChange={() => onToggleCategory(category.slug)}
                />
                {category.label}
              </label>
            ))
          : null}
      </fieldset>

      <button type="button" onClick={onClearAll}>
        Clear all filters
      </button>
    </section>
  );
}
