import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../api/auth";
import { ApiError } from "../api/client";
import { addFavorite, listFavorites, removeFavorite, type FavoritesPage } from "../api/favorites";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { MEMBERSHIP_MAX_PAGES, MEMBERSHIP_PAGE_SIZE, FavoritesProvider } from "./FavoritesProvider";
import { useFavorites, type FavoritesContextValue } from "./favoritesContext";

/**
 * M03-T06 Increment 2 — the saved-state provider: bounded membership loading,
 * the five statuses, confirmed mutations, retry and 429/401 handling, ordering
 * against stale list responses, and isolation between signed-in users. The
 * auth context is supplied directly so tests can change the verified user
 * while requests are in flight.
 */

vi.mock("../api/favorites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/favorites")>()),
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}));

const list = vi.mocked(listFavorites);
const add = vi.mocked(addFavorite);
const del = vi.mocked(removeFavorite);

const USER_B: AuthUser = {
  ...TEST_USER,
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  email: "other@example.test",
};

/** Deterministic landmark IDs: id(1) → "00000001-0000-4000-8000-000000000000". */
const id = (n: number) => `${n.toString(16).padStart(8, "0")}-0000-4000-8000-000000000000`;

function pageOf(ids: string[], opts: { page?: number; hasMore?: boolean } = {}): FavoritesPage {
  return {
    favorites: ids.map((landmark_id) => ({ landmark_id, availability: "unavailable" as const })),
    page: opts.page ?? 1,
    limit: MEMBERSHIP_PAGE_SIZE,
    has_more: opts.hasMore ?? false,
  };
}

const signedIn = (user: AuthUser = TEST_USER): SessionState => ({
  status: "authenticated",
  user,
});
const anonymous: SessionState = { status: "anonymous" };
const loading: SessionState = { status: "loading" };

let ctx: FavoritesContextValue;
function Probe() {
  ctx = useFavorites();
  return null;
}

function setup(initial: SessionState) {
  const refresh = vi.fn(() => Promise.resolve());
  const auth = (session: SessionState): AuthContextValue => ({
    session,
    checking: false,
    refresh,
    signOut: vi.fn(() => Promise.resolve()),
  });
  const tree = (session: SessionState) => (
    <AuthContext.Provider value={auth(session)}>
      <FavoritesProvider>
        <Probe />
      </FavoritesProvider>
    </AuthContext.Provider>
  );
  const utils = render(tree(initial));
  return {
    refresh,
    rerenderAs: (session: SessionState) => utils.rerender(tree(session)),
  };
}

const rateLimited = (seconds?: number) =>
  new ApiError(429, "RATE_LIMITED", "Too many requests. Please try again later.", seconds);
const unauthenticated = () => new ApiError(401, "UNAUTHENTICATED", "Authentication required.");
const serverError = () =>
  new ApiError(500, "INTERNAL_ERROR", "Something went wrong. Please try again.");
const notFound = () => new ApiError(404, "NOT_FOUND", "Resource not found.");

beforeEach(() => {
  list.mockReset();
  add.mockReset();
  del.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("FavoritesProvider — membership loading (L1)", () => {
  it("anonymous: signed-out, inactive, and no request is made", () => {
    setup(anonymous);
    expect(ctx.statusOf(id(1))).toBe("signed-out");
    expect(ctx.membership).toEqual({ status: "inactive" });
    expect(list).not.toHaveBeenCalled();
  });

  it("session still loading: checking (L4), and no request is made", () => {
    setup(loading);
    expect(ctx.statusOf(id(1))).toBe("checking");
    expect(list).not.toHaveBeenCalled();
  });

  it("complete in one page: listed → saved, everything else → known unsaved", async () => {
    list.mockResolvedValueOnce(pageOf([id(1), id(2)]));
    setup(signedIn());
    expect(ctx.membership.status).toBe("loading");
    expect(ctx.statusOf(id(1))).toBe("checking");

    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    expect(list).toHaveBeenCalledTimes(1);
    expect(list).toHaveBeenCalledWith({ page: 1, limit: 100 });
    expect(ctx.statusOf(id(1))).toBe("saved");
    expect(ctx.statusOf(id(2).toUpperCase())).toBe("saved");
    expect(ctx.statusOf(id(9))).toBe("unsaved");
  });

  it("complete across three pages, requested in order", async () => {
    list
      .mockResolvedValueOnce(pageOf([id(1)], { page: 1, hasMore: true }))
      .mockResolvedValueOnce(pageOf([id(2)], { page: 2, hasMore: true }))
      .mockResolvedValueOnce(pageOf([id(3)], { page: 3 }));
    setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    expect(list.mock.calls.map(([q]) => q?.page)).toEqual([1, 2, 3]);
    for (const n of [1, 2, 3]) expect(ctx.statusOf(id(n))).toBe("saved");
    expect(ctx.statusOf(id(9))).toBe("unsaved");
  });

  it(`partial at the ${MEMBERSHIP_MAX_PAGES}-page cap: stops loading; unlisted → unknown, never unsaved`, async () => {
    for (let p = 1; p <= 7; p += 1) {
      list.mockResolvedValueOnce(pageOf([id(p)], { page: p, hasMore: true }));
    }
    setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("partial"));
    expect(list).toHaveBeenCalledTimes(MEMBERSHIP_MAX_PAGES);
    expect(ctx.statusOf(id(5))).toBe("saved");
    expect(ctx.statusOf(id(6))).toBe("unknown");
    expect(ctx.statusOf(id(99))).toBe("unknown");
  });

  it("while loading: already-listed landmarks are saved, others are checking", async () => {
    const second = deferred<FavoritesPage>();
    list
      .mockResolvedValueOnce(pageOf([id(1)], { page: 1, hasMore: true }))
      .mockReturnValueOnce(second.promise);
    setup(signedIn());
    await waitFor(() => expect(ctx.statusOf(id(1))).toBe("saved"));
    expect(ctx.membership.status).toBe("loading");
    expect(ctx.statusOf(id(2))).toBe("checking");
    await act(async () => second.resolve(pageOf([id(2)], { page: 2 })));
    expect(ctx.membership.status).toBe("complete");
  });

  it("a failed later page keeps earlier pages as saved; everything else is unknown", async () => {
    list
      .mockResolvedValueOnce(pageOf([id(1)], { page: 1, hasMore: true }))
      .mockRejectedValueOnce(serverError());
    setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("failed"));
    expect(ctx.membership.failure).toEqual({
      kind: "error",
      message: "Something went wrong. Please try again.",
    });
    expect(ctx.statusOf(id(1))).toBe("saved");
    expect(ctx.statusOf(id(2))).toBe("unknown");
  });

  it("429 records Retry-After and does NOT retry automatically; explicit retry loads again", async () => {
    list.mockRejectedValueOnce(rateLimited(30)).mockResolvedValueOnce(pageOf([id(1)]));
    setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("failed"));
    expect(ctx.membership.failure).toEqual({ kind: "rate-limited", retryAfterSeconds: 30 });
    await new Promise((r) => setTimeout(r, 20));
    expect(list).toHaveBeenCalledTimes(1);

    act(() => ctx.retry());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    expect(list).toHaveBeenCalledTimes(2);
    expect(ctx.statusOf(id(1))).toBe("saved");
  });

  it("retry is ignored while a load is in flight", async () => {
    const first = deferred<FavoritesPage>();
    list.mockReturnValueOnce(first.promise);
    setup(signedIn());
    act(() => ctx.retry());
    expect(list).toHaveBeenCalledTimes(1);
    await act(async () => first.resolve(pageOf([])));
  });

  it("a 401 on load asks auth to re-check, but does not sign the user out by itself", async () => {
    list.mockRejectedValueOnce(unauthenticated());
    const { refresh } = setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("failed"));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(ctx.membership.failure).toEqual({ kind: "unauthenticated" });
    // The verified session is unchanged, so the user is still treated as signed in.
    expect(ctx.statusOf(id(1))).toBe("unknown");
  });

  it("a 401 followed by a VERIFIED anonymous session clears everything", async () => {
    list.mockRejectedValueOnce(unauthenticated());
    const { rerenderAs } = setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("failed"));
    rerenderAs(anonymous);
    expect(ctx.statusOf(id(1))).toBe("signed-out");
    expect(ctx.membership).toEqual({ status: "inactive" });
  });
});

describe("FavoritesProvider — mutations", () => {
  async function ready(ids: string[] = []) {
    list.mockResolvedValueOnce(pageOf(ids));
    const harness = setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    return harness;
  }

  it("save: 201 → saved (created), 200 → saved (already); both confirmed by the server", async () => {
    await ready();
    add.mockResolvedValueOnce({ landmarkId: id(1), created: true });
    add.mockResolvedValueOnce({ landmarkId: id(2), created: false });
    await act(async () => expect(await ctx.save(id(1))).toEqual({ kind: "saved", created: true }));
    await act(async () => expect(await ctx.save(id(2))).toEqual({ kind: "saved", created: false }));
    expect(ctx.statusOf(id(1))).toBe("saved");
    expect(ctx.statusOf(id(2))).toBe("saved");
  });

  it("no optimistic update: status changes only after confirmation; pending meanwhile", async () => {
    await ready();
    const d = deferred<{ landmarkId: string; created: boolean }>();
    add.mockReturnValueOnce(d.promise);
    let outcome!: Promise<unknown>;
    act(() => {
      outcome = ctx.save(id(1));
    });
    expect(ctx.isPending(id(1))).toBe(true);
    expect(ctx.statusOf(id(1))).toBe("unsaved");
    await act(async () => d.resolve({ landmarkId: id(1), created: true }));
    await act(async () => void (await outcome));
    expect(ctx.isPending(id(1))).toBe(false);
    expect(ctx.statusOf(id(1))).toBe("saved");
  });

  it("a second request for the same landmark while one is pending is 'busy' and sends nothing", async () => {
    await ready();
    const d = deferred<{ landmarkId: string; created: boolean }>();
    add.mockReturnValueOnce(d.promise);
    let first!: Promise<unknown>;
    let second: unknown;
    let third: unknown;
    await act(async () => {
      first = ctx.save(id(1));
      second = await ctx.save(id(1).toUpperCase());
      third = await ctx.remove(id(1));
    });
    expect(second).toEqual({ kind: "busy" });
    expect(third).toEqual({ kind: "busy" });
    expect(add).toHaveBeenCalledTimes(1);
    expect(del).not.toHaveBeenCalled();
    await act(async () => d.resolve({ landmarkId: id(1), created: true }));
    await act(async () => void (await first));
  });

  it("remove → known unsaved", async () => {
    await ready([id(1)]);
    del.mockResolvedValueOnce({ landmarkId: id(1) });
    await act(async () => expect(await ctx.remove(id(1))).toEqual({ kind: "removed" }));
    expect(ctx.statusOf(id(1))).toBe("unsaved");
  });

  it("save 404 → not-saveable; status becomes unknown", async () => {
    await ready();
    add.mockRejectedValueOnce(notFound());
    await act(async () => expect(await ctx.save(id(1))).toEqual({ kind: "not-saveable" }));
    expect(ctx.statusOf(id(1))).toBe("unknown");
  });

  it("save/remove 429 → failed with Retry-After; status unchanged", async () => {
    await ready([id(1)]);
    add.mockRejectedValueOnce(rateLimited(12));
    del.mockRejectedValueOnce(rateLimited());
    await act(async () =>
      expect(await ctx.save(id(2))).toEqual({
        kind: "failed",
        failure: { kind: "rate-limited", retryAfterSeconds: 12 },
      }),
    );
    await act(async () =>
      expect(await ctx.remove(id(1))).toEqual({
        kind: "failed",
        failure: { kind: "rate-limited" },
      }),
    );
    expect(ctx.statusOf(id(1))).toBe("saved");
    expect(ctx.statusOf(id(2))).toBe("unsaved");
    expect(ctx.isPending(id(1))).toBe(false);
  });

  it("save 401 → failed unauthenticated and an auth re-check; no independent sign-out", async () => {
    const { refresh } = await ready();
    add.mockRejectedValueOnce(unauthenticated());
    await act(async () =>
      expect(await ctx.save(id(1))).toEqual({
        kind: "failed",
        failure: { kind: "unauthenticated" },
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(ctx.statusOf(id(1))).toBe("unsaved");
    expect(ctx.membership.status).toBe("complete");
  });

  it("a non-ApiError failure is reported generically", async () => {
    await ready();
    del.mockRejectedValueOnce(new TypeError("boom"));
    await act(async () =>
      expect(await ctx.remove(id(1))).toEqual({
        kind: "failed",
        failure: { kind: "error", message: "Couldn't update favorites. Try again." },
      }),
    );
  });

  it("signed out: save/remove return signed-out and send nothing", async () => {
    setup(anonymous);
    await act(async () => {
      expect(await ctx.save(id(1))).toEqual({ kind: "signed-out" });
      expect(await ctx.remove(id(1))).toEqual({ kind: "signed-out" });
    });
    expect(add).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });
});

describe("FavoritesProvider — ordering: stale list responses never overwrite newer confirmed mutations", () => {
  it("a list that STARTED before a confirmed save and finished after it cannot undo the save", async () => {
    const page1 = deferred<FavoritesPage>();
    list.mockReturnValueOnce(page1.promise);
    setup(signedIn());
    add.mockResolvedValueOnce({ landmarkId: id(1), created: true });
    await act(async () => void (await ctx.save(id(1))));
    // The older list snapshot does not contain id(1).
    await act(async () => page1.resolve(pageOf([id(2)])));
    expect(ctx.membership.status).toBe("complete");
    expect(ctx.statusOf(id(1))).toBe("saved");
  });

  it("a list that started before a confirmed removal and still lists it cannot undo the removal", async () => {
    const page1 = deferred<FavoritesPage>();
    list.mockResolvedValueOnce(pageOf([id(1)])).mockReturnValueOnce(page1.promise);
    setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    act(() => ctx.refresh());
    del.mockResolvedValueOnce({ landmarkId: id(1) });
    await act(async () => void (await ctx.remove(id(1))));
    await act(async () => page1.resolve(pageOf([id(1)])));
    expect(ctx.statusOf(id(1))).toBe("unsaved");
  });

  it("a list that started AFTER a confirmed mutation is newer and supersedes it", async () => {
    list.mockResolvedValueOnce(pageOf([]));
    setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    add.mockResolvedValueOnce({ landmarkId: id(1), created: true });
    await act(async () => void (await ctx.save(id(1))));
    expect(ctx.statusOf(id(1))).toBe("saved");
    // Removed elsewhere afterwards; a fresh, complete list no longer contains it.
    list.mockResolvedValueOnce(pageOf([]));
    act(() => ctx.refresh());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    expect(ctx.statusOf(id(1))).toBe("unsaved");
  });

  it("overlapping loads: only the latest load may write; the older response is ignored", async () => {
    const older = deferred<FavoritesPage>();
    const newer = deferred<FavoritesPage>();
    list.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
    setup(signedIn());
    act(() => ctx.refresh());
    await act(async () => newer.resolve(pageOf([id(2)])));
    expect(ctx.statusOf(id(2))).toBe("saved");
    await act(async () => older.resolve(pageOf([id(1)])));
    expect(ctx.statusOf(id(1))).toBe("unsaved");
    expect(ctx.statusOf(id(2))).toBe("saved");
    expect(ctx.membership.status).toBe("complete");
  });

  it("an older load failing after a newer load succeeded does not mark it failed", async () => {
    const older = deferred<FavoritesPage>();
    list.mockReturnValueOnce(older.promise).mockResolvedValueOnce(pageOf([id(1)]));
    setup(signedIn());
    act(() => ctx.refresh());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    await act(async () => older.reject(serverError()));
    expect(ctx.membership.status).toBe("complete");
  });
});

describe("FavoritesProvider — isolation between users", () => {
  it("account switch during a load: user A's late response is discarded; user B gets a fresh load", async () => {
    const aPage = deferred<FavoritesPage>();
    list.mockReturnValueOnce(aPage.promise).mockResolvedValueOnce(pageOf([id(2)]));
    const { rerenderAs } = setup(signedIn(TEST_USER));
    rerenderAs(signedIn(USER_B));
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    await act(async () => aPage.resolve(pageOf([id(1)])));
    expect(list).toHaveBeenCalledTimes(2);
    expect(ctx.statusOf(id(1))).toBe("unsaved");
    expect(ctx.statusOf(id(2))).toBe("saved");
  });

  it("account switch during a mutation: A's result is discarded and B's state is untouched", async () => {
    list.mockResolvedValueOnce(pageOf([])).mockResolvedValueOnce(pageOf([]));
    const { rerenderAs } = setup(signedIn(TEST_USER));
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    const d = deferred<{ landmarkId: string; created: boolean }>();
    add.mockReturnValueOnce(d.promise);
    let outcome!: Promise<unknown>;
    act(() => {
      outcome = ctx.save(id(1));
    });
    rerenderAs(signedIn(USER_B));
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    expect(ctx.isPending(id(1))).toBe(false);
    await act(async () => d.resolve({ landmarkId: id(1), created: true }));
    await act(async () => expect(await outcome).toEqual({ kind: "discarded" }));
    expect(ctx.statusOf(id(1))).toBe("unsaved");
    expect(ctx.isPending(id(1))).toBe(false);
  });

  it("account switch during a failing mutation: the failure is discarded too (no auth re-check)", async () => {
    list.mockResolvedValueOnce(pageOf([])).mockResolvedValueOnce(pageOf([]));
    const { rerenderAs, refresh } = setup(signedIn(TEST_USER));
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    const d = deferred<{ landmarkId: string }>();
    del.mockReturnValueOnce(d.promise);
    let outcome!: Promise<unknown>;
    act(() => {
      outcome = ctx.remove(id(1));
    });
    rerenderAs(signedIn(USER_B));
    await act(async () => d.reject(unauthenticated()));
    await act(async () => expect(await outcome).toEqual({ kind: "discarded" }));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sign-out during a load: state clears and the late response is ignored", async () => {
    const page = deferred<FavoritesPage>();
    list.mockReturnValueOnce(page.promise);
    const { rerenderAs } = setup(signedIn());
    rerenderAs(anonymous);
    expect(ctx.membership).toEqual({ status: "inactive" });
    await act(async () => page.resolve(pageOf([id(1)])));
    expect(ctx.statusOf(id(1))).toBe("signed-out");
    expect(ctx.membership).toEqual({ status: "inactive" });
  });

  it("sign-out during a mutation: outcome discarded; status signed-out", async () => {
    list.mockResolvedValueOnce(pageOf([]));
    const { rerenderAs } = setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    const d = deferred<{ landmarkId: string; created: boolean }>();
    add.mockReturnValueOnce(d.promise);
    let outcome!: Promise<unknown>;
    act(() => {
      outcome = ctx.save(id(1));
    });
    rerenderAs(anonymous);
    await act(async () => d.resolve({ landmarkId: id(1), created: true }));
    await act(async () => expect(await outcome).toEqual({ kind: "discarded" }));
    expect(ctx.statusOf(id(1))).toBe("signed-out");
    expect(ctx.isPending(id(1))).toBe(false);
  });

  it("signing out and back in as the same user starts fresh (no carried-over overrides)", async () => {
    list.mockResolvedValueOnce(pageOf([])).mockResolvedValueOnce(pageOf([]));
    const { rerenderAs } = setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    add.mockResolvedValueOnce({ landmarkId: id(1), created: true });
    await act(async () => void (await ctx.save(id(1))));
    expect(ctx.statusOf(id(1))).toBe("saved");
    rerenderAs(anonymous);
    rerenderAs(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    expect(list).toHaveBeenCalledTimes(2);
    expect(ctx.statusOf(id(1))).toBe("unsaved");
  });

  it("a re-verified session for the SAME user (new object) neither clears nor reloads", async () => {
    list.mockResolvedValueOnce(pageOf([id(1)]));
    const { rerenderAs } = setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    rerenderAs(signedIn({ ...TEST_USER }));
    expect(list).toHaveBeenCalledTimes(1);
    expect(ctx.statusOf(id(1))).toBe("saved");
  });

  it("unverified session states (unavailable, loading) keep the current user's state", async () => {
    list.mockResolvedValueOnce(pageOf([id(1)]));
    const { rerenderAs } = setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    rerenderAs({ status: "unavailable", retry: () => Promise.resolve() });
    expect(ctx.statusOf(id(1))).toBe("saved");
    rerenderAs(loading);
    expect(ctx.statusOf(id(1))).toBe("saved");
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("nothing is written to browser storage", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    list.mockResolvedValueOnce(pageOf([id(1)]));
    setup(signedIn());
    await waitFor(() => expect(ctx.membership.status).toBe("complete"));
    add.mockResolvedValueOnce({ landmarkId: id(2), created: true });
    await act(async () => void (await ctx.save(id(2))));
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

describe("useFavorites", () => {
  it("throws outside FavoritesProvider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => render(<Probe />)).toThrow(/inside <FavoritesProvider>/);
    spy.mockRestore();
  });
});
