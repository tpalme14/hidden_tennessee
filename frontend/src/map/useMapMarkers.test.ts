import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { getLandmarkGeoMarkers } from "../api/landmarks";
import type { LandmarkCollectionItem, LandmarkCollectionResponse } from "../api/types";
import { useMapMarkers, type UseMapMarkersParams } from "./useMapMarkers";

vi.mock("../api/landmarks", () => ({ getLandmarkGeoMarkers: vi.fn() }));

const BBOX = { minLng: -90.3, minLat: 34.8, maxLng: -81.6, maxLat: 36.7 };

function fixture(id: string, overrides: Partial<LandmarkCollectionItem> = {}): LandmarkCollectionItem {
  return { id, display_name: `Landmark ${id}`, category: "falls", latitude: 35.1, longitude: -85.1, ...overrides };
}

function response(items: LandmarkCollectionItem[], isTruncated: boolean): LandmarkCollectionResponse {
  return { items, page: 1, limit: 200, has_more: false, is_truncated: isTruncated };
}

function bboxParams(overrides: Partial<UseMapMarkersParams> = {}): UseMapMarkersParams {
  return { q: "", categories: [], geo: { mode: "bbox", bbox: BBOX }, ...overrides };
}

describe("useMapMarkers — fetch shape", () => {
  afterEach(() => vi.resetAllMocks());

  it("requests a single bbox-mode page with the committed q/categories, and never requests a second page", async () => {
    vi.mocked(getLandmarkGeoMarkers).mockResolvedValue(response([fixture("a")], false));

    const { result } = renderHook(() => useMapMarkers(bboxParams({ q: "Coal", categories: ["arch"] })));
    await waitFor(() => expect(result.current[0].kind).toBe("success"));

    expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(1);
    expect(getLandmarkGeoMarkers).toHaveBeenCalledWith({
      q: "Coal",
      categories: ["arch"],
      geo: { mode: "bbox", bbox: "-90.3,34.8,-81.6,36.7" },
    });
  });

  it("requests near-mode with lat,lng ordering and the radius, when geo.mode is near", async () => {
    vi.mocked(getLandmarkGeoMarkers).mockResolvedValue(response([], false));

    renderHook(() =>
      useMapMarkers({ q: "", categories: [], geo: { mode: "near", near: { lat: 35.5, lng: -85.5 }, radius: 25 } }),
    );
    await waitFor(() => expect(getLandmarkGeoMarkers).toHaveBeenCalled());

    expect(getLandmarkGeoMarkers).toHaveBeenCalledWith({
      q: "",
      categories: [],
      geo: { mode: "near", near: "35.5,-85.5", radius: 25 },
    });
  });
});

describe("useMapMarkers — coordinate validation (WGS84 range, not just finite)", () => {
  afterEach(() => vi.resetAllMocks());

  it("excludes records with missing, non-finite, or out-of-WGS84-range coordinates", async () => {
    vi.mocked(getLandmarkGeoMarkers).mockResolvedValue(
      response(
        [
          fixture("a"),
          fixture("b", { latitude: undefined, longitude: undefined }),
          fixture("c", { latitude: Number.NaN, longitude: -85 }),
          fixture("d", { latitude: 35, longitude: Number.POSITIVE_INFINITY }),
          fixture("e", { latitude: 91, longitude: -85 }),
          fixture("f", { latitude: 35, longitude: 181 }),
          fixture("g", { latitude: -91, longitude: -85 }),
          fixture("h", { latitude: 35, longitude: -181 }),
        ],
        false,
      ),
    );

    const { result } = renderHook(() => useMapMarkers(bboxParams()));
    await waitFor(() => expect(result.current[0].kind).toBe("success"));

    if (result.current[0].kind === "success") {
      expect(result.current[0].markers.map((m) => m.id)).toEqual(["a"]);
    }
  });
});

describe("useMapMarkers — is_truncated read directly from the response, not inferred from items.length", () => {
  afterEach(() => vi.resetAllMocks());

  it("reflects is_truncated: true even when fewer than 200 items are returned", async () => {
    vi.mocked(getLandmarkGeoMarkers).mockResolvedValue(response([fixture("a")], true));
    const { result } = renderHook(() => useMapMarkers(bboxParams()));
    await waitFor(() => expect(result.current[0].kind).toBe("success"));
    expect(result.current[0]).toMatchObject({ isTruncated: true });
  });

  it("reflects is_truncated: false even when exactly 200 items are returned", async () => {
    const items = Array.from({ length: 200 }, (_, i) => fixture(`p${i}`));
    vi.mocked(getLandmarkGeoMarkers).mockResolvedValue(response(items, false));
    const { result } = renderHook(() => useMapMarkers(bboxParams()));
    await waitFor(() => expect(result.current[0].kind).toBe("success"));
    expect(result.current[0]).toMatchObject({ isTruncated: false });
    if (result.current[0].kind === "success") {
      expect(result.current[0].markers).toHaveLength(200);
    }
  });
});

describe("useMapMarkers — stale-response protection across every axis of the composite key", () => {
  afterEach(() => vi.resetAllMocks());

  it("discards an older response when q changes before it resolves", async () => {
    let resolveFirst: (value: LandmarkCollectionResponse) => void = () => {};
    const firstPromise = new Promise<LandmarkCollectionResponse>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(getLandmarkGeoMarkers)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(response([fixture("second")], false));

    const { result, rerender } = renderHook((params: UseMapMarkersParams) => useMapMarkers(params), {
      initialProps: bboxParams({ q: "Coal" }),
    });
    await waitFor(() => expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(1));

    rerender(bboxParams({ q: "Falls" }));
    await waitFor(() => expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current[0].kind).toBe("success"));

    await act(async () => {
      resolveFirst(response([fixture("first-stale")], false));
      await Promise.resolve();
    });

    expect(result.current[0]).toMatchObject({ kind: "success", markers: [{ id: "second" }] });
  });

  it("discards an older response when the geo mode/bbox changes before it resolves", async () => {
    let resolveFirst: (value: LandmarkCollectionResponse) => void = () => {};
    const firstPromise = new Promise<LandmarkCollectionResponse>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(getLandmarkGeoMarkers)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(response([fixture("second")], false));

    const { result, rerender } = renderHook((params: UseMapMarkersParams) => useMapMarkers(params), {
      initialProps: bboxParams(),
    });
    await waitFor(() => expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(1));

    rerender({ q: "", categories: [], geo: { mode: "near", near: { lat: 35, lng: -85 }, radius: 10 } });
    await waitFor(() => expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current[0].kind).toBe("success"));

    await act(async () => {
      resolveFirst(response([fixture("first-stale")], false));
      await Promise.resolve();
    });

    expect(result.current[0]).toMatchObject({ kind: "success", markers: [{ id: "second" }] });
  });

  it("does not update state after unmounting", async () => {
    let resolveFetch: (value: LandmarkCollectionResponse) => void = () => {};
    vi.mocked(getLandmarkGeoMarkers).mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );

    const { unmount } = renderHook(() => useMapMarkers(bboxParams()));
    unmount();

    await act(async () => {
      resolveFetch(response([fixture("a")], false));
      await Promise.resolve();
    });
  });
});

describe("useMapMarkers — retaining the previous successful result during loading/error (M02-T07 final verification correction)", () => {
  afterEach(() => vi.resetAllMocks());

  it("the initial loading state, before any success has ever landed, has no previous result", () => {
    vi.mocked(getLandmarkGeoMarkers).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useMapMarkers(bboxParams()));
    expect(result.current[0]).toEqual({ kind: "loading" });
  });

  it("retains the last successful markers as `previous` while a subsequent request is loading", async () => {
    let resolveSecond: (value: LandmarkCollectionResponse) => void = () => {};
    const secondPromise = new Promise<LandmarkCollectionResponse>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(getLandmarkGeoMarkers)
      .mockResolvedValueOnce(response([fixture("a")], true))
      .mockReturnValueOnce(secondPromise);

    const { result, rerender } = renderHook((params: UseMapMarkersParams) => useMapMarkers(params), {
      initialProps: bboxParams({ q: "Coal" }),
    });
    await waitFor(() => expect(result.current[0].kind).toBe("success"));

    rerender(bboxParams({ q: "Falls" }));
    await waitFor(() => expect(result.current[0].kind).toBe("loading"));
    expect(result.current[0]).toMatchObject({
      kind: "loading",
      previous: { markers: [{ id: "a" }], isTruncated: true },
    });

    await act(async () => {
      resolveSecond(response([fixture("b")], false));
      await Promise.resolve();
    });
    expect(result.current[0]).toMatchObject({ kind: "success", markers: [{ id: "b" }] });
  });

  it("retains the last successful markers as `previous` when a subsequent request fails", async () => {
    vi.mocked(getLandmarkGeoMarkers)
      .mockResolvedValueOnce(response([fixture("a")], false))
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL", "Server error."));

    const { result, rerender } = renderHook((params: UseMapMarkersParams) => useMapMarkers(params), {
      initialProps: bboxParams({ q: "Coal" }),
    });
    await waitFor(() => expect(result.current[0].kind).toBe("success"));

    rerender(bboxParams({ q: "Falls" }));
    await waitFor(() => expect(result.current[0].kind).toBe("error"));
    expect(result.current[0]).toMatchObject({
      kind: "error",
      message: "Server error.",
      previous: { markers: [{ id: "a" }], isTruncated: false },
    });
  });

  it("a successful response replaces the retained previous markers outright, including when the new response is empty", async () => {
    vi.mocked(getLandmarkGeoMarkers)
      .mockResolvedValueOnce(response([fixture("a")], false))
      .mockResolvedValueOnce(response([], false));

    const { result, rerender } = renderHook((params: UseMapMarkersParams) => useMapMarkers(params), {
      initialProps: bboxParams({ q: "Coal" }),
    });
    await waitFor(() => expect(result.current[0].kind).toBe("success"));

    rerender(bboxParams({ q: "NoMatches" }));
    await waitFor(() => expect(result.current[0]).toMatchObject({ kind: "success", markers: [] }));
    // `success` is always authoritative — it never carries a `previous` field itself.
    expect(result.current[0]).not.toHaveProperty("previous");
  });

  it("a subsequent error after an EMPTY success retains that empty result as previous (nothing stale to show)", async () => {
    vi.mocked(getLandmarkGeoMarkers)
      .mockResolvedValueOnce(response([], false))
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL", "Server error."));

    const { result, rerender } = renderHook((params: UseMapMarkersParams) => useMapMarkers(params), {
      initialProps: bboxParams({ q: "Coal" }),
    });
    await waitFor(() => expect(result.current[0].kind).toBe("success"));

    rerender(bboxParams({ q: "Falls" }));
    await waitFor(() => expect(result.current[0].kind).toBe("error"));
    expect(result.current[0]).toMatchObject({ kind: "error", previous: { markers: [] } });
  });
});

describe("useMapMarkers — error and retry", () => {
  afterEach(() => vi.resetAllMocks());

  it("reports an error state when the fetch fails, and retry re-issues the same request", async () => {
    vi.mocked(getLandmarkGeoMarkers)
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL", "Server error."))
      .mockResolvedValueOnce(response([fixture("a")], false));

    const { result } = renderHook(() => useMapMarkers(bboxParams({ q: "Coal" })));
    await waitFor(() => expect(result.current[0]).toEqual({ kind: "error", message: "Server error." }));

    act(() => result.current[1]());
    await waitFor(() => expect(result.current[0].kind).toBe("success"));
    expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(2);
  });
});
