import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { searchLandmarks } from "../api/landmarks";
import type { LandmarkCollectionResponse } from "../api/types";
import { useLandmarkSearch } from "./useLandmarkSearch";

vi.mock("../api/landmarks", () => ({ searchLandmarks: vi.fn() }));

function page(items: unknown[], pageNumber: number, hasMore: boolean, isTruncated = false): LandmarkCollectionResponse {
  return {
    items: items as LandmarkCollectionResponse["items"],
    page: pageNumber,
    limit: 20,
    has_more: hasMore,
    is_truncated: isTruncated,
  };
}

describe("useLandmarkSearch (M02-T07: takes committed q/categories as arguments)", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("starts idle and never fetches when both committedQuery and categories are empty", () => {
    const { result } = renderHook(() => useLandmarkSearch("", []));
    expect(result.current.status).toEqual({ kind: "idle" });
    expect(searchLandmarks).not.toHaveBeenCalled();
  });

  it("fetches as soon as a non-empty committedQuery or categories is passed in", async () => {
    vi.mocked(searchLandmarks).mockResolvedValue(page([{ id: "a" }], 1, false));
    const { result } = renderHook(() => useLandmarkSearch("Coal", []));

    await waitFor(() => expect(result.current.status.kind).toBe("success"));
    expect(searchLandmarks).toHaveBeenCalledWith({ q: "Coal", categories: [], page: 1, limit: 20 });
  });

  it("selecting a category alone (no search text) fetches — idle requires BOTH to be empty", async () => {
    vi.mocked(searchLandmarks).mockResolvedValue(page([{ id: "a" }], 1, false));
    const { result } = renderHook(() => useLandmarkSearch("", ["falls"]));

    await waitFor(() => expect(result.current.status.kind).toBe("success"));
    expect(searchLandmarks).toHaveBeenCalledWith({ q: "", categories: ["falls"], page: 1, limit: 20 });
  });

  it("refetches exactly once when committedQuery changes, resetting to page 1", async () => {
    vi.mocked(searchLandmarks)
      .mockResolvedValueOnce(page([{ id: "a" }], 1, true))
      .mockResolvedValueOnce(page([{ id: "b" }], 2, false))
      .mockResolvedValueOnce(page([{ id: "c" }], 1, false));

    const { result, rerender } = renderHook(({ q, categories }) => useLandmarkSearch(q, categories), {
      initialProps: { q: "Coal", categories: [] as string[] },
    });
    await waitFor(() => expect(searchLandmarks).toHaveBeenCalledTimes(1));

    act(() => result.current.onNextPage());
    await waitFor(() => expect(searchLandmarks).toHaveBeenCalledTimes(2));
    expect(searchLandmarks).toHaveBeenLastCalledWith({ q: "Coal", categories: [], page: 2, limit: 20 });

    rerender({ q: "Falls", categories: [] });
    await waitFor(() => expect(searchLandmarks).toHaveBeenCalledTimes(3));
    expect(searchLandmarks).toHaveBeenCalledTimes(3);
    expect(searchLandmarks).toHaveBeenLastCalledWith({ q: "Falls", categories: [], page: 1, limit: 20 });
  });

  it("does NOT reset the page, and does not refetch, when re-rendered with the identical committedQuery/categories", async () => {
    vi.mocked(searchLandmarks)
      .mockResolvedValueOnce(page([{ id: "a" }], 1, true))
      .mockResolvedValueOnce(page([{ id: "b" }], 2, false));

    const { result, rerender } = renderHook(({ q, categories }) => useLandmarkSearch(q, categories), {
      initialProps: { q: "Coal", categories: [] as string[] },
    });
    await waitFor(() => expect(searchLandmarks).toHaveBeenCalledTimes(1));

    act(() => result.current.onNextPage());
    // Wait for the resolved page-2 status itself, not just the call count —
    // the mock is called synchronously inside the effect, so a call-count
    // check alone can observe the hook before its own `.then()` has run,
    // racing against this assertion (found as a rare, genuine flake here).
    await waitFor(() => expect(result.current.status).toMatchObject({ page: 2 }));
    expect(searchLandmarks).toHaveBeenCalledTimes(2);

    // A new array instance with the same contents is not a "real" change.
    rerender({ q: "Coal", categories: [] });
    expect(searchLandmarks).toHaveBeenCalledTimes(2);
    expect(result.current.status).toMatchObject({ page: 2 });
  });

  it("resets to page 1 when categories change", async () => {
    vi.mocked(searchLandmarks)
      .mockResolvedValueOnce(page([{ id: "a" }], 1, true))
      .mockResolvedValueOnce(page([{ id: "b" }], 2, false))
      .mockResolvedValueOnce(page([{ id: "c" }], 1, false));

    const { result, rerender } = renderHook(({ q, categories }) => useLandmarkSearch(q, categories), {
      initialProps: { q: "", categories: ["falls"] },
    });
    await waitFor(() => expect(searchLandmarks).toHaveBeenCalledTimes(1));

    act(() => result.current.onNextPage());
    await waitFor(() => expect(searchLandmarks).toHaveBeenCalledTimes(2));

    rerender({ q: "", categories: ["arch", "falls"] });
    await waitFor(() => expect(searchLandmarks).toHaveBeenCalledTimes(3));
    expect(searchLandmarks).toHaveBeenLastCalledWith({ q: "", categories: ["arch", "falls"], page: 1, limit: 20 });
  });

  it("discards a stale response when a newer committedQuery was already issued (out-of-order resolution)", async () => {
    let resolveFirst: (value: LandmarkCollectionResponse) => void = () => {};
    const firstPromise = new Promise<LandmarkCollectionResponse>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(searchLandmarks)
      .mockReturnValueOnce(firstPromise)
      .mockResolvedValueOnce(page([{ id: "second" }], 1, false));

    const { result, rerender } = renderHook(({ q, categories }) => useLandmarkSearch(q, categories), {
      initialProps: { q: "Coal", categories: [] as string[] },
    });
    await waitFor(() => expect(searchLandmarks).toHaveBeenCalledTimes(1));

    rerender({ q: "Falls", categories: [] });
    await waitFor(() => expect(searchLandmarks).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.status.kind).toBe("success"));

    await act(async () => {
      resolveFirst(page([{ id: "first-stale" }], 1, false));
      await Promise.resolve();
    });

    expect(result.current.status).toMatchObject({ kind: "success", items: [{ id: "second" }] });
  });

  it("treats a genuine failure as an error, with retry re-invoking the same committedQuery/categories/page", async () => {
    vi.mocked(searchLandmarks)
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL", "Server error."))
      .mockResolvedValueOnce(page([{ id: "a" }], 1, false));

    const { result } = renderHook(() => useLandmarkSearch("Coal", ["arch"]));
    await waitFor(() => expect(result.current.status).toEqual({ kind: "error", message: "Server error." }));

    act(() => result.current.retry());
    await waitFor(() => expect(result.current.status.kind).toBe("success"));
    expect(searchLandmarks).toHaveBeenCalledTimes(2);
    expect(searchLandmarks).toHaveBeenLastCalledWith({ q: "Coal", categories: ["arch"], page: 1, limit: 20 });
  });

  it("reads is_truncated directly from the response, never inferring it from items.length", async () => {
    vi.mocked(searchLandmarks).mockResolvedValueOnce(page([{ id: "a" }], 1, false, true));
    const { result } = renderHook(() => useLandmarkSearch("Coal", []));
    await waitFor(() => expect(result.current.status.kind).toBe("success"));
    expect(result.current.status).toMatchObject({ isTruncated: true });
  });

  it("does not update state after unmounting (no stale-after-unmount write)", async () => {
    let resolveSearch: (value: LandmarkCollectionResponse) => void = () => {};
    vi.mocked(searchLandmarks).mockReturnValue(
      new Promise<LandmarkCollectionResponse>((resolve) => {
        resolveSearch = resolve;
      }),
    );

    const { unmount } = renderHook(() => useLandmarkSearch("Coal", []));
    await waitFor(() => expect(searchLandmarks).toHaveBeenCalledTimes(1));

    unmount();

    await act(async () => {
      resolveSearch(page([{ id: "a" }], 1, false));
      await Promise.resolve();
    });
    // No assertion needed beyond "this doesn't throw" — the cancelled-flag guard discards the late write.
  });
});

describe("useLandmarkSearch — retaining the previous successful page during loading/error (M02-T08, closing the M02-T07 follow-up)", () => {
  afterEach(() => vi.resetAllMocks());

  it("the initial loading state, before any success has ever landed, has no previous result", () => {
    vi.mocked(searchLandmarks).mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useLandmarkSearch("Coal", []));
    expect(result.current.status).toEqual({ kind: "loading" });
  });

  it("retains the last successful page as `previous` while a subsequent request is loading", async () => {
    let resolveSecond: (value: LandmarkCollectionResponse) => void = () => {};
    const secondPromise = new Promise<LandmarkCollectionResponse>((resolve) => {
      resolveSecond = resolve;
    });
    vi.mocked(searchLandmarks)
      .mockResolvedValueOnce(page([{ id: "a" }], 1, false, true))
      .mockReturnValueOnce(secondPromise);

    const { result, rerender } = renderHook(({ q, categories }) => useLandmarkSearch(q, categories), {
      initialProps: { q: "Coal", categories: [] as string[] },
    });
    await waitFor(() => expect(result.current.status.kind).toBe("success"));

    rerender({ q: "Falls", categories: [] });
    await waitFor(() => expect(result.current.status.kind).toBe("loading"));
    expect(result.current.status).toMatchObject({
      kind: "loading",
      previous: { items: [{ id: "a" }], page: 1, hasMore: false, isTruncated: true },
    });

    await act(async () => {
      resolveSecond(page([{ id: "b" }], 1, false));
      await Promise.resolve();
    });
    expect(result.current.status).toMatchObject({ kind: "success", items: [{ id: "b" }] });
  });

  it("retains the last successful page as `previous` when a subsequent request fails", async () => {
    vi.mocked(searchLandmarks)
      .mockResolvedValueOnce(page([{ id: "a" }], 1, false))
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL", "Server error."));

    const { result, rerender } = renderHook(({ q, categories }) => useLandmarkSearch(q, categories), {
      initialProps: { q: "Coal", categories: [] as string[] },
    });
    await waitFor(() => expect(result.current.status.kind).toBe("success"));

    rerender({ q: "Falls", categories: [] });
    await waitFor(() => expect(result.current.status.kind).toBe("error"));
    expect(result.current.status).toMatchObject({
      kind: "error",
      message: "Server error.",
      previous: { items: [{ id: "a" }], page: 1, hasMore: false, isTruncated: false },
    });
  });

  it("a successful response replaces the retained previous page outright, including when the new page is empty", async () => {
    vi.mocked(searchLandmarks)
      .mockResolvedValueOnce(page([{ id: "a" }], 1, false))
      .mockResolvedValueOnce(page([], 1, false));

    const { result, rerender } = renderHook(({ q, categories }) => useLandmarkSearch(q, categories), {
      initialProps: { q: "Coal", categories: [] as string[] },
    });
    await waitFor(() => expect(result.current.status.kind).toBe("success"));

    rerender({ q: "NoMatches", categories: [] });
    await waitFor(() => expect(result.current.status).toMatchObject({ kind: "success", items: [] }));
    expect(result.current.status).not.toHaveProperty("previous");
  });

  it("clearing filters to idle discards any retained previous result — idle is a deliberate reset, not a transient state", async () => {
    vi.mocked(searchLandmarks).mockResolvedValueOnce(page([{ id: "a" }], 1, false));

    const { result, rerender } = renderHook(({ q, categories }) => useLandmarkSearch(q, categories), {
      initialProps: { q: "Coal", categories: [] as string[] },
    });
    await waitFor(() => expect(result.current.status.kind).toBe("success"));

    rerender({ q: "", categories: [] });
    expect(result.current.status).toEqual({ kind: "idle" });

    // A fresh search after clearing starts with no stale previous result.
    vi.mocked(searchLandmarks).mockReturnValueOnce(new Promise(() => {}));
    rerender({ q: "Falls", categories: [] });
    expect(result.current.status).toEqual({ kind: "loading" });
  });
});
