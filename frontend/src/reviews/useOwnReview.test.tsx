import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { Review } from "../api/reviews";
import type { AuthContextValue } from "../auth/session";
import { TEST_USER, deferred } from "../auth/testFixtures";
import { OTHER_USER, WithAuth, authValue, signedIn } from "./testAuth";

vi.mock("../api/reviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/reviews")>()),
  getOwnReview: vi.fn(),
}));

const { getOwnReview } = await import("../api/reviews");
const { useOwnReview, OWN_REVIEW_LOAD_ERROR } = await import("./useOwnReview");
const lookup = vi.mocked(getOwnReview);

/** M04-T03 Increment 3 — the own-review lookup: session states, 401 re-check, staleness, account switches. */

const L1 = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const L2 = "4a3c9d2f-0b5e-4f70-9c8b-2d3e4f5a6b7c";

function review(body: string): Review {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    rating: 4,
    body,
    created_at: "2026-11-21T16:31:04.123Z",
    updated_at: "2026-11-21T16:31:04.123Z",
    author_label: "Community Member",
  };
}

/** Renders the hook under a session context the test can replace. */
function setup(initial: AuthContextValue, landmarkId = L1) {
  let auth = initial;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WithAuth value={auth}>{children}</WithAuth>
  );
  const view = renderHook(({ id }) => useOwnReview(id), {
    wrapper,
    initialProps: { id: landmarkId },
  });
  return {
    ...view,
    setAuth(next: AuthContextValue, id = landmarkId) {
      auth = next;
      view.rerender({ id });
    },
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("useOwnReview — session states", () => {
  it("session loading: checking, and nothing is requested", () => {
    const { result } = setup(authValue({ status: "loading" }));
    expect(result.current.state).toEqual({ kind: "checking" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("anonymous: signed-out, and nothing is requested", () => {
    const { result } = setup(authValue({ status: "anonymous" }));
    expect(result.current.state).toEqual({ kind: "signed-out" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("session unavailable: session-unavailable, and nothing is requested", () => {
    const { result } = setup(authValue({ status: "unavailable", retry: vi.fn() }));
    expect(result.current.state).toEqual({ kind: "session-unavailable" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("authenticated with a review: found, tied to that user", async () => {
    lookup.mockResolvedValueOnce(review("mine"));
    const { result } = setup(authValue(signedIn()));
    expect(result.current.state).toEqual({ kind: "checking" });
    await waitFor(() => expect(result.current.state.kind).toBe("found"));
    expect(result.current.state).toEqual({
      kind: "found",
      userId: TEST_USER.id,
      review: review("mine"),
    });
    expect(lookup).toHaveBeenCalledWith(L1);
  });

  it("authenticated without a review: none", async () => {
    lookup.mockResolvedValueOnce(null);
    const { result } = setup(authValue(signedIn()));
    await waitFor(() =>
      expect(result.current.state).toEqual({ kind: "none", userId: TEST_USER.id }),
    );
  });

  it("a 404 is unavailable (landmark missing, retired, or not public)", async () => {
    lookup.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    const { result } = setup(authValue(signedIn()));
    await waitFor(() =>
      expect(result.current.state).toEqual({ kind: "unavailable", userId: TEST_USER.id }),
    );
  });

  it.each([
    ["a server error", new ApiError(500, "INTERNAL_ERROR", "secret detail")],
    ["a malformed response", new ApiError(200, "INVALID_RESPONSE", "x")],
    ["a network failure", new ApiError(0, "NETWORK_ERROR", "x")],
    ["a rate limit", new ApiError(429, "RATE_LIMITED", "x", 30)],
  ])("%s is an error with a fixed message; reload repeats the lookup", async (_l, error) => {
    lookup.mockRejectedValueOnce(error);
    const { result } = setup(authValue(signedIn()));
    await waitFor(() =>
      expect(result.current.state).toEqual({
        kind: "error",
        userId: TEST_USER.id,
        message: OWN_REVIEW_LOAD_ERROR,
      }),
    );
    lookup.mockResolvedValueOnce(null);
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state.kind).toBe("none"));
    expect(lookup).toHaveBeenCalledTimes(2);
  });
});

describe("useOwnReview — 401", () => {
  it("re-checks the session; a still-valid session gets a fresh lookup", async () => {
    const value = authValue(signedIn());
    lookup.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "Authentication required."));
    lookup.mockResolvedValueOnce(review("after refresh"));
    const { result } = setup(value);
    await waitFor(() => expect(result.current.state.kind).toBe("found"));
    expect(value.refresh).toHaveBeenCalledTimes(1);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it("re-checks the session; an ended session becomes signed-out (never decided by the 401 alone)", async () => {
    const refreshDone = deferred<void>();
    const value = authValue(signedIn(), { refresh: vi.fn(() => refreshDone.promise) });
    lookup.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "Authentication required."));
    const { result, setAuth } = setup(value);
    await waitFor(() => expect(value.refresh).toHaveBeenCalled());
    expect(result.current.state).toEqual({ kind: "checking" });

    setAuth(authValue({ status: "anonymous" }));
    await act(async () => refreshDone.resolve());
    expect(result.current.state).toEqual({ kind: "signed-out" });
    expect(lookup).toHaveBeenCalledTimes(1);
  });
});

describe("useOwnReview — staleness and account switches", () => {
  it("a late response for a previous landmark is discarded", async () => {
    const first = deferred<Review | null>();
    lookup.mockReturnValueOnce(first.promise);
    lookup.mockResolvedValueOnce(null);
    const { result, setAuth } = setup(authValue(signedIn()), L1);
    setAuth(authValue(signedIn()), L2);
    await waitFor(() => expect(result.current.state.kind).toBe("none"));
    await act(async () => first.resolve(review("for the first landmark")));
    expect(result.current.state).toEqual({ kind: "none", userId: TEST_USER.id });
    expect(lookup).toHaveBeenLastCalledWith(L2);
  });

  it("a late response for a previous user is discarded after an account switch", async () => {
    const forFirstUser = deferred<Review | null>();
    lookup.mockReturnValueOnce(forFirstUser.promise);
    lookup.mockResolvedValueOnce(null);
    const { result, setAuth } = setup(authValue(signedIn(TEST_USER)));
    setAuth(authValue(signedIn(OTHER_USER)));
    await waitFor(() =>
      expect(result.current.state).toEqual({ kind: "none", userId: OTHER_USER.id }),
    );
    await act(async () => forFirstUser.resolve(review("the first user's review")));
    expect(result.current.state).toEqual({ kind: "none", userId: OTHER_USER.id });
  });

  it("a found review is never shown to the next account, even before its own lookup answers", async () => {
    lookup.mockResolvedValueOnce(review("first user's"));
    const { result, setAuth } = setup(authValue(signedIn(TEST_USER)));
    await waitFor(() => expect(result.current.state.kind).toBe("found"));

    const pending = deferred<Review | null>();
    lookup.mockReturnValueOnce(pending.promise);
    setAuth(authValue(signedIn(OTHER_USER)));
    expect(result.current.state).toEqual({ kind: "checking" });
    await act(async () => pending.resolve(null));
    expect(result.current.state).toEqual({ kind: "none", userId: OTHER_USER.id });
  });

  it("signing out clears the review at once", async () => {
    lookup.mockResolvedValueOnce(review("mine"));
    const { result, setAuth } = setup(authValue(signedIn()));
    await waitFor(() => expect(result.current.state.kind).toBe("found"));
    setAuth(authValue({ status: "anonymous" }));
    expect(result.current.state).toEqual({ kind: "signed-out" });
  });

  it("a response arriving after unmount is ignored", async () => {
    const late = deferred<Review | null>();
    lookup.mockReturnValueOnce(late.promise);
    const { result, unmount } = setup(authValue(signedIn()));
    unmount();
    await act(async () => late.resolve(review("late")));
    expect(result.current.state).toEqual({ kind: "checking" });
  });
});

describe("useOwnReview — silent reload (Increment 4)", () => {
  it("keeps the current review shown until the reloaded one replaces it", async () => {
    lookup.mockResolvedValueOnce(review("before"));
    const { result } = setup(authValue(signedIn()));
    await waitFor(() => expect(result.current.state.kind).toBe("found"));
    const next = deferred<Review | null>();
    lookup.mockReturnValueOnce(next.promise);
    act(() => result.current.reload({ silent: true }));
    expect(result.current.state).toEqual({
      kind: "found",
      userId: TEST_USER.id,
      review: review("before"),
    });
    await act(async () => next.resolve(review("after")));
    expect(result.current.state).toEqual({
      kind: "found",
      userId: TEST_USER.id,
      review: review("after"),
    });
  });

  it("a plain reload shows checking first", async () => {
    lookup.mockResolvedValueOnce(review("before"));
    const { result } = setup(authValue(signedIn()));
    await waitFor(() => expect(result.current.state.kind).toBe("found"));
    lookup.mockReturnValueOnce(new Promise(() => undefined));
    act(() => result.current.reload());
    expect(result.current.state).toEqual({ kind: "checking" });
  });

  it("a silent reload never keeps another account's result (after a switch it shows checking)", async () => {
    lookup.mockResolvedValueOnce(review("first user's"));
    const { result, setAuth } = setup(authValue(signedIn(TEST_USER)));
    await waitFor(() => expect(result.current.state.kind).toBe("found"));
    lookup.mockReturnValue(new Promise(() => undefined));
    setAuth(authValue(signedIn(OTHER_USER)));
    act(() => result.current.reload({ silent: true }));
    expect(result.current.state).toEqual({ kind: "checking" });
  });
});
