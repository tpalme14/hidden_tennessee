import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { LandmarkReviewsPage, Review } from "../api/reviews";

vi.mock("../api/reviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/reviews")>()),
  listLandmarkReviews: vi.fn(),
}));

const { listLandmarkReviews } = await import("../api/reviews");
const { useLandmarkReviews, REVIEWS_LOAD_ERROR, MORE_REVIEWS_LOAD_ERROR } =
  await import("./useLandmarkReviews");
const list = vi.mocked(listLandmarkReviews);

/** M04-T03 Increment 2 — the public review list hook: loading, paging, dedupe, staleness, errors. */

const L1 = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const L2 = "4a3c9d2f-0b5e-4f70-9c8b-2d3e4f5a6b7c";

function review(n: number): Review {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    rating: (n % 5) + 1,
    body: `Review ${n}`,
    created_at: "2026-11-21T16:31:04.123Z",
    updated_at: "2026-11-21T16:31:04.123Z",
    author_label: "Community Member",
  };
}

function page(
  reviews: Review[],
  options: { page?: number; hasMore?: boolean; count?: number; average?: number | null } = {},
): LandmarkReviewsPage {
  const count = options.count ?? reviews.length;
  return {
    reviews,
    aggregate: { average_rating: count === 0 ? null : (options.average ?? 3), rating_count: count },
    page: options.page ?? 1,
    limit: 20,
    has_more: options.hasMore ?? false,
  };
}

/** A controllable promise for ordering tests. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const notFound = () => new ApiError(404, "NOT_FOUND", "Resource not found.");

afterEach(() => {
  vi.clearAllMocks();
});

describe("useLandmarkReviews", () => {
  it("starts loading, requests page 1 for the landmark, then is ready with reviews and aggregate", async () => {
    list.mockResolvedValueOnce(page([review(1), review(2)], { count: 2, average: 4.5 }));
    const { result } = renderHook(() => useLandmarkReviews(L1));
    expect(result.current.state).toEqual({ kind: "loading" });
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    expect(list).toHaveBeenCalledWith(L1);
    expect(result.current.state).toMatchObject({
      kind: "ready",
      reviews: [review(1), review(2)],
      aggregate: { average_rating: 4.5, rating_count: 2 },
      hasMore: false,
      page: 1,
      loadingMore: false,
      loadMoreError: null,
      firstNewIndex: null,
    });
  });

  it("is ready and empty for a landmark with no reviews", async () => {
    list.mockResolvedValueOnce(page([], { count: 0 }));
    const { result } = renderHook(() => useLandmarkReviews(L1));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    expect(result.current.state).toMatchObject({
      reviews: [],
      aggregate: { average_rating: null, rating_count: 0 },
    });
  });

  it("a 404 is 'unavailable', with no review data kept", async () => {
    list.mockRejectedValueOnce(notFound());
    const { result } = renderHook(() => useLandmarkReviews(L1));
    await waitFor(() => expect(result.current.state).toEqual({ kind: "unavailable" }));
  });

  it.each([
    ["a server error", new ApiError(500, "INTERNAL_ERROR", "secret internal detail")],
    [
      "a malformed response",
      new ApiError(200, "INVALID_RESPONSE", "The server returned an unexpected response."),
    ],
    ["a network failure", new ApiError(0, "NETWORK_ERROR", "Unable to reach the server.")],
    ["an unexpected error", new Error("boom")],
  ])(
    "%s on the first page is 'error' with a fixed message; retry reloads",
    async (_label, error) => {
      list.mockRejectedValueOnce(error);
      const { result } = renderHook(() => useLandmarkReviews(L1));
      await waitFor(() =>
        expect(result.current.state).toEqual({ kind: "error", message: REVIEWS_LOAD_ERROR }),
      );

      list.mockResolvedValueOnce(page([review(1)]));
      act(() => result.current.reload());
      expect(result.current.state).toEqual({ kind: "loading" });
      await waitFor(() => expect(result.current.state.kind).toBe("ready"));
      expect(list).toHaveBeenCalledTimes(2);
    },
  );

  it("Show more appends the next page, updates the aggregate and hasMore, and marks the first new review", async () => {
    list.mockResolvedValueOnce(
      page([review(1), review(2)], { hasMore: true, count: 3, average: 3 }),
    );
    const { result } = renderHook(() => useLandmarkReviews(L1));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    const next = deferred<LandmarkReviewsPage>();
    list.mockReturnValueOnce(next.promise);
    act(() => result.current.loadMore());
    expect(list).toHaveBeenLastCalledWith(L1, { page: 2 });
    expect(result.current.state).toMatchObject({ loadingMore: true, loadMoreError: null });

    await act(async () =>
      next.resolve(page([review(3)], { page: 2, hasMore: false, count: 3, average: 2.5 })),
    );
    expect(result.current.state).toMatchObject({
      kind: "ready",
      reviews: [review(1), review(2), review(3)],
      aggregate: { average_rating: 2.5, rating_count: 3 },
      hasMore: false,
      page: 2,
      loadingMore: false,
      firstNewIndex: 2,
    });
  });

  it("skips reviews already shown (deduplicates by ID across pages)", async () => {
    list.mockResolvedValueOnce(page([review(1), review(2)], { hasMore: true, count: 4 }));
    const { result } = renderHook(() => useLandmarkReviews(L1));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    // A review added meanwhile shifted page 2 by one: review(2) appears again.
    list.mockResolvedValueOnce(page([review(2), review(3)], { page: 2, hasMore: true, count: 4 }));
    await act(async () => result.current.loadMore());
    expect(
      result.current.state.kind === "ready" && result.current.state.reviews.map((r) => r.id),
    ).toEqual([review(1).id, review(2).id, review(3).id]);
    expect(result.current.state).toMatchObject({ firstNewIndex: 2 });

    // A page made entirely of duplicates adds nothing and points focus nowhere.
    list.mockResolvedValueOnce(page([review(3)], { page: 3, hasMore: false, count: 4 }));
    await act(async () => result.current.loadMore());
    expect(result.current.state).toMatchObject({ firstNewIndex: null, hasMore: false, page: 3 });
    expect(result.current.state.kind === "ready" && result.current.state.reviews).toHaveLength(3);
  });

  it("ignores Show more while a page is loading, when no more exist, or before ready", async () => {
    const first = deferred<LandmarkReviewsPage>();
    list.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useLandmarkReviews(L1));
    act(() => result.current.loadMore()); // still loading
    expect(list).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(page([review(1)], { hasMore: true, count: 2 })));
    const second = deferred<LandmarkReviewsPage>();
    list.mockReturnValueOnce(second.promise);
    act(() => result.current.loadMore());
    act(() => result.current.loadMore()); // already loading more
    expect(list).toHaveBeenCalledTimes(2);

    await act(async () => second.resolve(page([review(2)], { page: 2, hasMore: false, count: 2 })));
    act(() => result.current.loadMore()); // nothing more
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("a failed Show more keeps what is shown and reports loadMoreError; a later attempt succeeds", async () => {
    list.mockResolvedValueOnce(page([review(1)], { hasMore: true, count: 2 }));
    const { result } = renderHook(() => useLandmarkReviews(L1));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    list.mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "x"));
    await act(async () => result.current.loadMore());
    expect(result.current.state).toMatchObject({
      reviews: [review(1)],
      loadingMore: false,
      loadMoreError: MORE_REVIEWS_LOAD_ERROR,
      hasMore: true,
      page: 1,
    });

    list.mockResolvedValueOnce(page([review(2)], { page: 2, hasMore: false, count: 2 }));
    await act(async () => result.current.loadMore());
    expect(list).toHaveBeenLastCalledWith(L1, { page: 2 });
    expect(result.current.state).toMatchObject({ loadMoreError: null, page: 2, hasMore: false });
  });

  it("a 404 during Show more makes the list unavailable, dropping the shown reviews", async () => {
    list.mockResolvedValueOnce(page([review(1)], { hasMore: true, count: 2 }));
    const { result } = renderHook(() => useLandmarkReviews(L1));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    list.mockRejectedValueOnce(notFound());
    await act(async () => result.current.loadMore());
    expect(result.current.state).toEqual({ kind: "unavailable" });
  });

  it("never shows a previous landmark's reviews: a late first-page response for it is discarded", async () => {
    const forL1 = deferred<LandmarkReviewsPage>();
    const forL2 = deferred<LandmarkReviewsPage>();
    list.mockReturnValueOnce(forL1.promise).mockReturnValueOnce(forL2.promise);
    const { result, rerender } = renderHook(({ id }) => useLandmarkReviews(id), {
      initialProps: { id: L1 },
    });
    rerender({ id: L2 });
    expect(result.current.state).toEqual({ kind: "loading" });

    await act(async () => forL2.resolve(page([review(2)])));
    await act(async () => forL1.resolve(page([review(1)])));
    expect(result.current.state.kind === "ready" && result.current.state.reviews).toEqual([
      review(2),
    ]);
  });

  it("resets to loading on a landmark change, so the previous landmark's reviews disappear at once", async () => {
    list.mockResolvedValueOnce(page([review(1)]));
    const { result, rerender } = renderHook(({ id }) => useLandmarkReviews(id), {
      initialProps: { id: L1 },
    });
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    list.mockReturnValueOnce(new Promise(() => undefined));
    rerender({ id: L2 });
    expect(result.current.state).toEqual({ kind: "loading" });
  });

  it("discards a Show more response that arrives after the landmark changed", async () => {
    list.mockResolvedValueOnce(page([review(1)], { hasMore: true, count: 2 }));
    const { result, rerender } = renderHook(({ id }) => useLandmarkReviews(id), {
      initialProps: { id: L1 },
    });
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));

    const more = deferred<LandmarkReviewsPage>();
    list.mockReturnValueOnce(more.promise);
    act(() => result.current.loadMore());
    list.mockResolvedValueOnce(page([review(9)], { count: 1 }));
    rerender({ id: L2 });
    await waitFor(() =>
      expect(result.current.state.kind === "ready" && result.current.state.reviews).toEqual([
        review(9),
      ]),
    );

    await act(async () => more.resolve(page([review(2)], { page: 2 })));
    expect(result.current.state.kind === "ready" && result.current.state.reviews).toEqual([
      review(9),
    ]);
  });

  it("discards an older first-page response after a reload", async () => {
    const stale = deferred<LandmarkReviewsPage>();
    list.mockReturnValueOnce(stale.promise);
    const { result } = renderHook(() => useLandmarkReviews(L1));
    list.mockResolvedValueOnce(page([review(5)]));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(async () => stale.resolve(page([review(1)])));
    expect(result.current.state.kind === "ready" && result.current.state.reviews).toEqual([
      review(5),
    ]);
  });

  it("ignores responses that arrive after unmount", async () => {
    const late = deferred<LandmarkReviewsPage>();
    list.mockReturnValueOnce(late.promise);
    const { result, unmount } = renderHook(() => useLandmarkReviews(L1));
    unmount();
    await act(async () => late.resolve(page([review(1)])));
    expect(result.current.state).toEqual({ kind: "loading" });
  });
});

describe("useLandmarkReviews — refresh (Increment 3)", () => {
  it("reloads page 1 without clearing what is shown, then replaces it", async () => {
    list.mockResolvedValueOnce(page([review(1), review(2)], { hasMore: true, count: 3 }));
    const { result } = renderHook(() => useLandmarkReviews(L1));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    list.mockResolvedValueOnce(page([review(2)], { page: 2, hasMore: true, count: 3 }));
    await act(async () => result.current.loadMore());

    const fresh = deferred<LandmarkReviewsPage>();
    list.mockReturnValueOnce(fresh.promise);
    act(() => result.current.refresh());
    expect(list).toHaveBeenLastCalledWith(L1);
    // Still showing the previous data while the refresh is in flight.
    expect(result.current.state).toMatchObject({ kind: "ready", page: 2 });

    await act(async () =>
      fresh.resolve(page([review(9), review(1)], { hasMore: true, count: 4, average: 3.5 })),
    );
    expect(result.current.state).toMatchObject({
      kind: "ready",
      reviews: [review(9), review(1)],
      aggregate: { average_rating: 3.5, rating_count: 4 },
      page: 1,
      firstNewIndex: null,
    });
  });

  it("a 404 during refresh becomes unavailable; a failure becomes error", async () => {
    list.mockResolvedValueOnce(page([review(1)]));
    const { result } = renderHook(() => useLandmarkReviews(L1));
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    list.mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "x"));
    await act(async () => result.current.refresh());
    expect(result.current.state).toEqual({ kind: "error", message: REVIEWS_LOAD_ERROR });

    list.mockResolvedValueOnce(page([review(1)]));
    await act(async () => result.current.reload());
    list.mockRejectedValueOnce(notFound());
    await act(async () => result.current.refresh());
    expect(result.current.state).toEqual({ kind: "unavailable" });
  });

  it("refresh before the first page has loaded behaves like a normal load", async () => {
    const first = deferred<LandmarkReviewsPage>();
    list.mockReturnValueOnce(first.promise);
    const { result } = renderHook(() => useLandmarkReviews(L1));
    list.mockResolvedValueOnce(page([review(4)]));
    act(() => result.current.refresh());
    expect(result.current.state).toEqual({ kind: "loading" });
    await waitFor(() => expect(result.current.state.kind).toBe("ready"));
    await act(async () => first.resolve(page([review(1)])));
    expect(result.current.state.kind === "ready" && result.current.state.reviews).toEqual([
      review(4),
    ]);
  });
});
