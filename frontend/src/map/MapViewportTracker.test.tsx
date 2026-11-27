import { render } from "@testing-library/react";
import { StrictMode, useEffect } from "react";
import { useMap, useMapEvents } from "react-leaflet";
import { describe, expect, it, vi } from "vitest";
import { MapViewportTracker } from "./MapViewportTracker";

type MapEventHandlers = Record<string, (event: unknown) => void>;

vi.mock("react-leaflet", () => ({
  useMap: vi.fn(),
  useMapEvents: vi.fn(),
}));

function fakeMap(
  bounds: { west: number; south: number; east: number; north: number },
  center: [number, number],
  zoom: number,
) {
  return {
    getBounds: () => ({
      getWest: () => bounds.west,
      getSouth: () => bounds.south,
      getEast: () => bounds.east,
      getNorth: () => bounds.north,
    }),
    getCenter: () => ({ lat: center[0], lng: center[1] }),
    getZoom: () => zoom,
    // Leaflet's own "the initial view is actually established" hook — invokes
    // its callback immediately once ready (synchronously here, simulating an
    // already-ready map), which is what this component relies on instead of
    // a bare mount effect (see this file's docstring for why).
    whenReady: (callback: () => void) => callback(),
  };
}

describe("MapViewportTracker", () => {
  it("reports the viewport once on mount, derived from the map's current state", () => {
    vi.mocked(useMap).mockReturnValue(
      fakeMap({ west: -86, south: 35, east: -85, north: 36 }, [35.5, -85.5], 8) as never,
    );
    vi.mocked(useMapEvents).mockReturnValue(undefined as never);

    const onViewportChange = vi.fn();
    render(<MapViewportTracker onViewportChange={onViewportChange} />);

    expect(onViewportChange).toHaveBeenCalledTimes(1);
    expect(onViewportChange).toHaveBeenCalledWith(
      { minLng: -86, minLat: 35, maxLng: -85, maxLat: 36 },
      [35.5, -85.5],
      8,
    );
  });

  it("reports again on moveend and zoomend, using the map's state at that moment — never on intermediate frames", () => {
    let capturedHandlers: MapEventHandlers = {};
    const map = fakeMap({ west: -86, south: 35, east: -85, north: 36 }, [35.5, -85.5], 8);
    vi.mocked(useMap).mockReturnValue(map as never);
    vi.mocked(useMapEvents).mockImplementation((handlers) => {
      capturedHandlers = handlers as unknown as MapEventHandlers;
      return undefined as never;
    });

    const onViewportChange = vi.fn();
    render(<MapViewportTracker onViewportChange={onViewportChange} />);
    expect(onViewportChange).toHaveBeenCalledTimes(1);

    // Simulate the user panning: the map's own state has changed by the time `moveend` fires.
    map.getBounds = () => ({
      getWest: () => -87,
      getSouth: () => 34,
      getEast: () => -84,
      getNorth: () => 37,
    });
    map.getCenter = () => ({ lat: 35.6, lng: -85.6 });
    map.getZoom = () => 9;

    capturedHandlers.moveend?.({});
    expect(onViewportChange).toHaveBeenCalledTimes(2);
    expect(onViewportChange).toHaveBeenLastCalledWith(
      { minLng: -87, minLat: 34, maxLng: -84, maxLat: 37 },
      [35.6, -85.6],
      9,
    );

    capturedHandlers.zoomend?.({});
    expect(onViewportChange).toHaveBeenCalledTimes(3);
  });

  it("waits for Leaflet's whenReady before reporting, rather than reading the view synchronously on mount (regression: previously read the pre-fit default view)", () => {
    let deferredReady: () => void = () => {};
    const map = fakeMap({ west: -86, south: 35, east: -85, north: 36 }, [35.5, -85.5], 8);
    map.whenReady = (callback: () => void) => {
      deferredReady = callback;
    };
    vi.mocked(useMap).mockReturnValue(map as never);
    vi.mocked(useMapEvents).mockReturnValue(undefined as never);

    const onViewportChange = vi.fn();
    render(<MapViewportTracker onViewportChange={onViewportChange} />);

    // Not yet reported — Leaflet hasn't signaled its initial view is ready.
    expect(onViewportChange).not.toHaveBeenCalled();

    deferredReady();
    expect(onViewportChange).toHaveBeenCalledTimes(1);
    expect(onViewportChange).toHaveBeenCalledWith(
      { minLng: -86, minLat: 35, maxLng: -85, maxLat: 36 },
      [35.5, -85.5],
      8,
    );
  });

  it("renders no visible output", () => {
    vi.mocked(useMap).mockReturnValue(
      fakeMap({ west: -86, south: 35, east: -85, north: 36 }, [35.5, -85.5], 8) as never,
    );
    vi.mocked(useMapEvents).mockReturnValue(undefined as never);

    const { container } = render(<MapViewportTracker onViewportChange={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * M06-T02 Increment 5a — stale reports after the tracker's lifecycle ends.
 * `useMapEvents` is mocked, so listeners are NEVER removed here: invoking a
 * captured handler after unmount exercises the lifecycle guard itself, not
 * ordinary listener removal (in the browser, Leaflet was observed delivering
 * `zoomend`/`moveend` after the layout cleanup and before the passive one).
 */
describe("MapViewportTracker — no stale reports after its lifecycle ends (Increment 5a)", () => {
  function setup() {
    let handlers: MapEventHandlers = {};
    const ready: (() => void)[] = [];
    const map = fakeMap({ west: -86, south: 35, east: -85, north: 36 }, [35.5, -85.5], 8);
    map.whenReady = (callback: () => void) => {
      ready.push(callback);
    };
    vi.mocked(useMap).mockReturnValue(map as never);
    vi.mocked(useMapEvents).mockImplementation((h) => {
      handlers = h as unknown as MapEventHandlers;
      return undefined as never;
    });
    return { handlers: () => handlers, ready };
  }

  it("reports legitimately while mounted (whenReady, moveend, zoomend)", () => {
    const t = setup();
    const onViewportChange = vi.fn();
    render(<MapViewportTracker onViewportChange={onViewportChange} />);
    t.ready[0]!();
    t.handlers().moveend?.({});
    t.handlers().zoomend?.({});
    expect(onViewportChange).toHaveBeenCalledTimes(3);
  });

  it.each(["moveend", "zoomend"])(
    "a captured %s handler invoked after unmount reports nothing",
    (event) => {
      const t = setup();
      const onViewportChange = vi.fn();
      const { unmount } = render(<MapViewportTracker onViewportChange={onViewportChange} />);
      const handler = t.handlers()[event]!;
      unmount();
      handler({});
      expect(onViewportChange).not.toHaveBeenCalled();
    },
  );

  it("a previously registered whenReady callback that runs after unmount reports nothing", () => {
    const t = setup();
    const onViewportChange = vi.fn();
    const { unmount } = render(<MapViewportTracker onViewportChange={onViewportChange} />);
    expect(t.ready).toHaveLength(1);
    unmount();
    t.ready[0]!();
    expect(onViewportChange).not.toHaveBeenCalled();
  });

  it("an event delivered during the passive cleanup phase (after the layout cleanup) reports nothing", () => {
    const t = setup();
    const onViewportChange = vi.fn();
    // A sibling whose passive cleanup fires the captured handler, the way Leaflet
    // can deliver zoomend while the route is being torn down.
    function FireOnPassiveCleanup() {
      useEffect(() => () => t.handlers().zoomend?.({}), []);
      return null;
    }
    const { unmount } = render(
      <>
        <MapViewportTracker onViewportChange={onViewportChange} />
        <FireOnPassiveCleanup />
      </>,
    );
    unmount();
    expect(onViewportChange).not.toHaveBeenCalled();
  });

  it("StrictMode setup → cleanup → setup keeps legitimate reporting working", () => {
    const t = setup();
    const onViewportChange = vi.fn();
    render(
      <StrictMode>
        <MapViewportTracker onViewportChange={onViewportChange} />
      </StrictMode>,
    );
    for (const callback of t.ready) callback();
    expect(onViewportChange).toHaveBeenCalled();
    onViewportChange.mockClear();
    t.handlers().moveend?.({});
    expect(onViewportChange).toHaveBeenCalledTimes(1);
  });

  it("a stale handler from an ended lifecycle never publishes into a later lifecycle", () => {
    const t = setup();
    const first = vi.fn();
    const { unmount } = render(<MapViewportTracker onViewportChange={first} />);
    const staleMoveend = t.handlers().moveend!;
    const staleReady = t.ready[0]!;
    unmount();
    const second = vi.fn();
    render(<MapViewportTracker onViewportChange={second} />);
    staleMoveend({});
    staleReady();
    expect(first).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    t.handlers().moveend?.({}); // the new lifecycle's own handler works
    expect(second).toHaveBeenCalledTimes(1);
  });
});
