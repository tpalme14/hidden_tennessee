import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DiscoveryUrlState } from "./discoveryUrlState";
import { useDiscoveryFilters } from "./useDiscoveryFilters";
import type { DiscoveryUrlActions } from "./useDiscoveryUrlState";

function urlState(overrides: Partial<DiscoveryUrlState> = {}): DiscoveryUrlState {
  return {
    q: "",
    categories: [],
    mode: "bbox",
    bbox: { minLng: -90.3, minLat: 34.8, maxLng: -81.6, maxLat: 36.7 },
    near: null,
    radius: null,
    viewport: null,
    wasNormalized: false,
    ...overrides,
  };
}

function urlActions(overrides: Partial<DiscoveryUrlActions> = {}): DiscoveryUrlActions {
  return {
    commitText: vi.fn(),
    commitCategories: vi.fn(),
    commitBbox: vi.fn(),
    commitNearOrigin: vi.fn(),
    commitRadius: vi.fn(),
    exitProximity: vi.fn(),
    updateViewport: vi.fn(),
    ...overrides,
  };
}

describe("useDiscoveryFilters — debounce timing", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not commit while typing, and does not commit before 300ms have elapsed", () => {
    const actions = urlActions();
    const { result } = renderHook(() => useDiscoveryFilters(urlState(), actions));

    act(() => result.current.onInputChange("Coal"));
    expect(actions.commitText).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(actions.commitText).not.toHaveBeenCalled();
  });

  it("commits 300ms after the user stops typing", () => {
    const actions = urlActions();
    const { result } = renderHook(() => useDiscoveryFilters(urlState(), actions));

    act(() => result.current.onInputChange("Coal"));
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(actions.commitText).toHaveBeenCalledWith("Coal");
  });

  it("Enter submits immediately and cancels the pending debounce (no duplicate commit later)", () => {
    const actions = urlActions();
    const { result } = renderHook(() => useDiscoveryFilters(urlState(), actions));

    act(() => result.current.onInputChange("Coal"));
    act(() => result.current.onSubmitNow());
    expect(actions.commitText).toHaveBeenCalledTimes(1);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(actions.commitText).toHaveBeenCalledTimes(1);
  });

  it("a category toggle commits the current (not-yet-debounced) text immediately and cancels the pending debounce", () => {
    const actions = urlActions();
    const { result } = renderHook(() => useDiscoveryFilters(urlState(), actions));

    act(() => result.current.onInputChange("Coal"));
    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(actions.commitText).not.toHaveBeenCalled();

    act(() => result.current.onToggleCategory("arch"));

    expect(actions.commitText).toHaveBeenCalledWith("Coal");
    expect(actions.commitCategories).toHaveBeenCalledWith(["arch"]);

    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(actions.commitText).toHaveBeenCalledTimes(1);
  });
});

describe("useDiscoveryFilters — category toggling and clearing", () => {
  it("toggling an unselected category adds it (sorted) to the already-committed selection", () => {
    const actions = urlActions();
    const { result } = renderHook(() => useDiscoveryFilters(urlState({ categories: ["falls"] }), actions));

    act(() => result.current.onToggleCategory("arch"));

    expect(actions.commitCategories).toHaveBeenCalledWith(["arch", "falls"]);
  });

  it("toggling an already-selected category removes only that one", () => {
    const actions = urlActions();
    const { result } = renderHook(() =>
      useDiscoveryFilters(urlState({ categories: ["arch", "falls"] }), actions),
    );

    act(() => result.current.onToggleCategory("arch"));

    expect(actions.commitCategories).toHaveBeenCalledWith(["falls"]);
  });

  it("Clear all filters clears both the local input and the committed text/categories", () => {
    const actions = urlActions();
    const { result } = renderHook(() => useDiscoveryFilters(urlState({ q: "Coal", categories: ["arch"] }), actions));

    act(() => result.current.onInputChange("Something else"));
    act(() => result.current.onClearAll());

    expect(result.current.inputValue).toBe("");
    expect(actions.commitText).toHaveBeenCalledWith("");
    expect(actions.commitCategories).toHaveBeenCalledWith([]);
  });

  it("trims whitespace and caps the committed text at 100 characters", () => {
    const actions = urlActions();
    const { result } = renderHook(() => useDiscoveryFilters(urlState(), actions));

    act(() => result.current.onInputChange(`   ${"x".repeat(150)}   `));
    act(() => result.current.onSubmitNow());

    expect(actions.commitText).toHaveBeenCalledWith("x".repeat(100));
  });

  it("exposes the already-committed q/categories from urlState for consumers", () => {
    const actions = urlActions();
    const { result } = renderHook(() => useDiscoveryFilters(urlState({ q: "Falls", categories: ["peak"] }), actions));

    expect(result.current.committedQuery).toBe("Falls");
    expect(result.current.selectedCategories).toEqual(["peak"]);
  });
});
