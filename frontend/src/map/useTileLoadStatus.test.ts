import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createTileErrorTracker, useTileLoadStatus } from "./useTileLoadStatus";

describe("createTileErrorTracker", () => {
  it("does not cross the threshold before enough errors land", () => {
    const tracker = createTileErrorTracker(3, 5000);
    expect(tracker.recordError(0)).toBe(false);
    expect(tracker.recordError(100)).toBe(false);
  });

  it("crosses the threshold once enough errors land within the window", () => {
    const tracker = createTileErrorTracker(3, 5000);
    tracker.recordError(0);
    tracker.recordError(100);
    expect(tracker.recordError(200)).toBe(true);
  });

  it("does not count errors older than the window toward the threshold", () => {
    const tracker = createTileErrorTracker(3, 1000);
    tracker.recordError(0);
    tracker.recordError(100);
    // This error arrives well after the window has expired for the first two.
    expect(tracker.recordError(5000)).toBe(false);
  });
});

describe("useTileLoadStatus", () => {
  it("starts not degraded, and flips to degraded only after enough tile errors", () => {
    const { result } = renderHook(() => useTileLoadStatus());

    expect(result.current.degraded).toBe(false);

    act(() => {
      result.current.onTileError();
      result.current.onTileError();
    });
    expect(result.current.degraded).toBe(false);

    act(() => {
      result.current.onTileError();
    });
    expect(result.current.degraded).toBe(true);
  });
});
