import { useCallback, useRef, useState } from "react";

const DEFAULT_ERROR_THRESHOLD = 3;
const DEFAULT_WINDOW_MS = 5000;

export interface TileErrorTracker {
  /** Records one tile error; returns true the moment the threshold is reached. */
  recordError(now?: number): boolean;
}

/**
 * Plain, framework-free tracking logic (kept separate from the hook below so
 * it's directly unit-testable without rendering React). A single dropped
 * edge tile shouldn't trigger a persistent error message — only enough
 * errors landing within a short window should.
 */
export function createTileErrorTracker(
  thresholdCount = DEFAULT_ERROR_THRESHOLD,
  windowMs = DEFAULT_WINDOW_MS,
): TileErrorTracker {
  const timestamps: number[] = [];
  return {
    recordError(now = Date.now()) {
      timestamps.push(now);
      while (timestamps.length > 0 && now - timestamps[0]! > windowMs) {
        timestamps.shift();
      }
      return timestamps.length >= thresholdCount;
    },
  };
}

/**
 * Exposes a one-way `degraded` flag (never resets once set, so the fallback
 * message doesn't flicker or re-announce) driven by TileLayer `tileerror`
 * events, per M02-T02's "simple, nonblocking, no repeated announcements"
 * requirement.
 */
export function useTileLoadStatus(): { degraded: boolean; onTileError: () => void } {
  const [degraded, setDegraded] = useState(false);
  const trackerRef = useRef<TileErrorTracker | null>(null);
  if (!trackerRef.current) {
    trackerRef.current = createTileErrorTracker();
  }

  const onTileError = useCallback(() => {
    if (trackerRef.current?.recordError()) {
      setDegraded(true);
    }
  }, []);

  return { degraded, onTileError };
}
