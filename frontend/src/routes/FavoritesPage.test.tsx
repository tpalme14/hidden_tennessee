import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigationType } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../api/auth";
import { ApiError } from "../api/client";
import {
  listFavorites,
  removeFavorite,
  type FavoriteEntry,
  type FavoritesPage as FavoritesPageData,
  type FavoritesQuery,
} from "../api/favorites";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { FavoritesProvider } from "../favorites/FavoritesProvider";
import { FavoritesPage } from "./FavoritesPage";

/**
 * M03-T06 Increment 5 — the My Favorites page with the REAL favorites
 * provider and list hook (API module mocked, auth context supplied): every
 * page state, each entry type's exact content, removal with focus, the M5
 * re-fetch, paging and the URL, and the single status/alert regions.
 */

vi.mock("../api/favorites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/favorites")>()),
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}));

const list = vi.mocked(listFavorites);
const del = vi.mocked(removeFavorite);

const OTHER_USER: AuthUser = { ...TEST_USER, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function available(n: number, name = `Falls ${n}`): FavoriteEntry {
  return {
    landmark_id: uuid(n),
    availability: "available",
    landmark: {
      id: uuid(n),
      display_name: name,
      category: "falls",
      latitude: 35.678912,
      longitude: -83.591234,
    },
  };
}

function redacted(n: number, name = `Hidden ${n}`): FavoriteEntry {
  return {
    landmark_id: uuid(n),
    availability: "redacted",
    landmark: { id: uuid(n), display_name: name, category: "sink", redacted: true },
  };
}

function unavailable(n: number): FavoriteEntry {
  return { landmark_id: uuid(n), availability: "unavailable" };
}

function pageOf(entries: FavoriteEntry[], hasMore = false, page = 1): FavoritesPageData {
  return { favorites: entries, page, limit: 50, has_more: hasMore };
}

/**
 * Page requests (limit 50) are answered from `pageResponses`, in order; the
 * provider's membership requests (limit 100) always answer "nothing saved".
 */
let pageResponses: Array<() => Promise<FavoritesPageData>>;

function respond(...responses: Array<FavoritesPageData | Promise<FavoritesPageData> | Error>) {
  for (const r of responses) {
    pageResponses.push(() =>
      r instanceof Error ? Promise.reject(r) : r instanceof Promise ? r : Promise.resolve(r),
    );
  }
}

const pageCalls = () =>
  list.mock.calls.map(([q]) => q as FavoritesQuery).filter((q) => q.limit === 50);

function LocationProbe() {
  const location = useLocation();
  const type = useNavigationType();
  return (
    <div data-testid="location" data-nav={type}>
      {`${location.pathname}${location.search}`}
    </div>
  );
}

function Harness({ session, refresh }: { session: SessionState; refresh: () => Promise<void> }) {
  const auth: AuthContextValue = {
    session,
    checking: false,
    refresh,
    signOut: vi.fn(() => Promise.resolve()),
  };
  return (
    <AuthContext.Provider value={auth}>
      <FavoritesProvider>
        <Routes>
          <Route path="/favorites" element={<FavoritesPage />} />
          <Route path="/sign-in" element={<p>Sign-in page</p>} />
          <Route path="/" element={<p>Discovery page</p>} />
          <Route path="/landmarks/:id" element={<p>Profile page</p>} />
        </Routes>
        <LocationProbe />
      </FavoritesProvider>
    </AuthContext.Provider>
  );
}

function renderPage(
  path = "/favorites",
  session: SessionState = { status: "authenticated", user: TEST_USER },
) {
  const refresh = vi.fn(() => Promise.resolve());
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Harness session={session} refresh={refresh} />
    </MemoryRouter>,
  );
  return {
    refresh,
    setSession(next: SessionState) {
      view.rerender(
        <MemoryRouter initialEntries={[path]}>
          <Harness session={next} refresh={refresh} />
        </MemoryRouter>,
      );
    },
  };
}

const heading = () => screen.getByRole("heading", { level: 2, name: "My Favorites" });
const status = () => screen.getByRole("status");
const location = () => screen.getByTestId("location");
const removeButton = (name: string) => screen.getByRole("button", { name });
const items = () =>
  within(screen.getByRole("list", { name: "My Favorites" })).getAllByRole("listitem");

async function renderReady(entries: FavoriteEntry[], hasMore = false, path = "/favorites") {
  const page = Number(new URLSearchParams(path.split("?")[1] ?? "").get("page") ?? "1");
  respond(pageOf(entries, hasMore, page));
  const harness = renderPage(path);
  await screen.findByRole("list", { name: "My Favorites" });
  return harness;
}

let fetchSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  pageResponses = [];
  list.mockReset();
  del.mockReset();
  list.mockImplementation((query?: FavoritesQuery) => {
    if (query?.limit === 100) {
      return Promise.resolve({ favorites: [], page: query.page ?? 1, limit: 100, has_more: false });
    }
    const next = pageResponses.shift();
    if (!next) throw new Error(`unexpected favorites page request ${JSON.stringify(query)}`);
    return next();
  });
  // Nothing on this page may reach the network except through the mocked API.
  fetchSpy = vi.spyOn(globalThis, "fetch");
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  fetchSpy.mockRestore();
});

describe("FavoritesPage — session states (M6, K6)", () => {
  it("session loading: a checking message, nothing fetched", () => {
    renderPage("/favorites", { status: "loading" });
    expect(heading()).toBeInTheDocument();
    expect(status()).toHaveTextContent("Checking whether you're signed in…");
    expect(pageCalls()).toHaveLength(0);
    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("session unavailable: a distinct message, no sign-in prompt, nothing fetched", () => {
    renderPage("/favorites", { status: "unavailable", retry: () => Promise.resolve() });
    expect(
      screen.getByText(
        "We couldn't check whether you're signed in, so your favorites can't be shown right now. Use Retry in the account area to check again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign in/i })).not.toBeInTheDocument();
    expect(status()).toHaveTextContent("");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it("signed out: a sign-in link that returns to /favorites, nothing fetched", async () => {
    renderPage("/favorites", { status: "anonymous" });
    const link = screen.getByRole("link", { name: "Sign in to see your favorites" });
    expect(link).toHaveAttribute("href", "/sign-in?returnTo=%2Ffavorites");
    expect(list).not.toHaveBeenCalled();
    await userEvent.click(link);
    expect(location()).toHaveTextContent("/sign-in?returnTo=%2Ffavorites");
  });
});

describe("FavoritesPage — loading, empty, and error states", () => {
  it("loading: one status region says so; no list", async () => {
    const d = deferred<FavoritesPageData>();
    respond(d.promise);
    renderPage();
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(status()).toHaveTextContent("Loading your favorites…");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    await act(async () => d.resolve(pageOf([])));
    expect(status()).toHaveTextContent("");
  });

  it("empty first page: an informative message and a way back to discovery", async () => {
    respond(pageOf([]));
    renderPage();
    expect(await screen.findByText("You haven't saved any landmarks yet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Discover landmarks" })).toHaveAttribute("href", "/");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(pageCalls()).toEqual([{ page: 1, limit: 50 }]);
  });

  it("error: one alert with Try again, which re-requests the page", async () => {
    respond(new ApiError(500, "INTERNAL_ERROR", "x"), pageOf([available(1)]));
    renderPage();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't load your favorites. Please try again.");
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: "Falls 1" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("401: explains, asks the session to be re-checked, does not sign out by itself", async () => {
    respond(new ApiError(401, "UNAUTHENTICATED", "x"));
    const { refresh } = renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't load your favorites because your session may have ended.",
    );
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: /sign in to see/i })).not.toBeInTheDocument();
  });

  it("401 followed by a verified sign-out shows the sign-in prompt", async () => {
    respond(new ApiError(401, "UNAUTHENTICATED", "x"));
    const harness = renderPage();
    await screen.findByRole("alert");
    harness.setSession({ status: "anonymous" });
    expect(screen.getByRole("link", { name: "Sign in to see your favorites" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("429: shows how long to wait", async () => {
    respond(new ApiError(429, "RATE_LIMITED", "x", 30));
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Too many requests. Please try again in 30 seconds.",
    );
  });
});

describe("FavoritesPage — entries (M1, M3, K9; spec §6.2)", () => {
  it("available: profile link, category, Remove — and no coordinates anywhere", async () => {
    await renderReady([available(1, "Laurel Falls")]);
    const [item] = items();
    const link = within(item!).getByRole("link", { name: "Laurel Falls" });
    expect(link).toHaveAttribute("href", `/landmarks/${uuid(1)}`);
    expect(item).toHaveTextContent("Laurel FallsWaterfallRemove");
    expect(
      within(item!).getByRole("button", { name: "Remove Laurel Falls from favorites" }),
    ).toHaveTextContent("Remove");
    expect(document.body.textContent).not.toMatch(/35\.67|83\.59|latitude|longitude/i);
  });

  it("redacted: link to the redacted profile, category, explanatory note, Remove", async () => {
    await renderReady([redacted(2, "Hidden Sink")]);
    const [item] = items();
    expect(within(item!).getByRole("link", { name: "Hidden Sink" })).toHaveAttribute(
      "href",
      `/landmarks/${uuid(2)}`,
    );
    expect(item).toHaveTextContent(
      "Hidden SinkSinkholeFull details aren't currently available.Remove",
    );
    expect(
      within(item!).getByRole("button", { name: "Remove Hidden Sink from favorites" }),
    ).toBeInTheDocument();
  });

  it("unavailable: 'No longer available' only — no link, name, or category; numbered Remove", async () => {
    await renderReady([available(1), unavailable(2), unavailable(3)]);
    const [, second, third] = items();
    expect(second).toHaveTextContent(/^No longer availableRemove$/);
    expect(within(second!).queryByRole("link")).not.toBeInTheDocument();
    expect(
      within(second!).getByRole("button", {
        name: "Remove unavailable favorite, item 2 on this page",
      }),
    ).toBeInTheDocument();
    expect(
      within(third!).getByRole("button", {
        name: "Remove unavailable favorite, item 3 on this page",
      }),
    ).toBeInTheDocument();
  });

  it("every Remove button has a distinct accessible name", async () => {
    await renderReady([available(1), redacted(2), unavailable(3), unavailable(4)]);
    const names = screen
      .getAllByRole("button", { name: /^Remove/ })
      .map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(4);
  });

  it("renders only what the list response contains — one request, no other", async () => {
    await renderReady([available(1), redacted(2), unavailable(3)]);
    expect(pageCalls()).toEqual([{ page: 1, limit: 50 }]);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("FavoritesPage — removal and focus (K5, K8)", () => {
  it("the entry stays until DELETE succeeds; pending is focusable but inactive", async () => {
    await renderReady([available(1), available(2)]);
    const d = deferred<{ landmarkId: string }>();
    del.mockReturnValueOnce(d.promise);
    const button = removeButton("Remove Falls 1 from favorites");
    await userEvent.click(button);
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveFocus();
    await userEvent.click(button);
    await userEvent.keyboard("{Enter}");
    expect(del).toHaveBeenCalledTimes(1);
    expect(items()).toHaveLength(2);

    await act(async () => d.resolve({ landmarkId: uuid(1) }));
    expect(items()).toHaveLength(1);
    expect(status()).toHaveTextContent("Removed Falls 1 from favorites.");
    expect(removeButton("Remove Falls 2 from favorites")).toHaveFocus();
  });

  it("focus goes to the previous Remove button when the last entry is removed", async () => {
    await renderReady([available(1), unavailable(2)]);
    del.mockResolvedValueOnce({ landmarkId: uuid(2) });
    await userEvent.click(removeButton("Remove unavailable favorite, item 2 on this page"));
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(status()).toHaveTextContent("Removed an unavailable favorite.");
    expect(removeButton("Remove Falls 1 from favorites")).toHaveFocus();
  });

  it("removing the only entry on page 1 focuses the heading and shows the empty state", async () => {
    await renderReady([available(1)]);
    del.mockResolvedValueOnce({ landmarkId: uuid(1) });
    await userEvent.click(removeButton("Remove Falls 1 from favorites"));
    expect(await screen.findByText("You haven't saved any landmarks yet.")).toBeInTheDocument();
    expect(heading()).toHaveFocus();
    expect(location()).toHaveTextContent(/^\/favorites$/);
  });

  it("keyboard removal works and moves focus the same way", async () => {
    await renderReady([available(1), available(2)]);
    del.mockResolvedValueOnce({ landmarkId: uuid(1) });
    removeButton("Remove Falls 1 from favorites").focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(removeButton("Remove Falls 2 from favorites")).toHaveFocus();
  });

  it("does not move focus if the user moved it elsewhere while the removal was pending", async () => {
    await renderReady([available(1), available(2)]);
    const d = deferred<{ landmarkId: string }>();
    del.mockReturnValueOnce(d.promise);
    await userEvent.click(removeButton("Remove Falls 1 from favorites"));
    await userEvent.tab(); // to Falls 2's link
    const link = screen.getByRole("link", { name: "Falls 2" });
    expect(link).toHaveFocus();
    await act(async () => d.resolve({ landmarkId: uuid(1) }));
    expect(link).toHaveFocus();
  });

  it("a failed removal keeps the entry and focus, and reports one named alert", async () => {
    await renderReady([available(1), available(2)]);
    del.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "x", 5));
    const button = removeButton("Remove Falls 1 from favorites");
    await userEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Falls 1: Too many requests. Please try again in 5 seconds.",
    );
    expect(items()).toHaveLength(2);
    expect(button).toHaveFocus();
    expect(button).not.toHaveAttribute("aria-disabled");
    expect(status()).toHaveTextContent("");

    // A new attempt clears the old alert first; success is announced.
    del.mockResolvedValueOnce({ landmarkId: uuid(1) });
    await userEvent.click(button);
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(status()).toHaveTextContent("Removed Falls 1 from favorites.");
  });

  it("a removal 401 asks the session to be re-checked and explains", async () => {
    const { refresh } = await renderReady([unavailable(1)]);
    del.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "x"));
    await userEvent.click(removeButton("Remove unavailable favorite, item 1 on this page"));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unavailable favorite: Couldn't update favorites because your session may have ended.",
    );
    expect(refresh).toHaveBeenCalled();
    expect(items()).toHaveLength(1);
  });
});

describe("FavoritesPage — M5 re-fetch after a confirmed removal", () => {
  it("re-fetches the current page when later pages exist; next-page entries move up", async () => {
    await renderReady([available(1), available(2)], true);
    const refetch = deferred<FavoritesPageData>();
    respond(refetch.promise);
    del.mockResolvedValueOnce({ landmarkId: uuid(1) });
    await userEvent.click(removeButton("Remove Falls 1 from favorites"));
    await waitFor(() => expect(items()).toHaveLength(1));
    const next = removeButton("Remove Falls 2 from favorites");
    expect(next).toHaveFocus();
    expect(pageCalls()).toEqual([
      { page: 1, limit: 50 },
      { page: 1, limit: 50 },
    ]);

    await act(async () => refetch.resolve(pageOf([available(2), available(3)], false)));
    expect(items()).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Falls 3" })).toBeInTheDocument();
    // The re-fetch kept the same element focused and announced nothing new.
    expect(next).toHaveFocus();
    expect(status()).toHaveTextContent("Removed Falls 1 from favorites.");
  });

  it("no re-fetch on the last page", async () => {
    await renderReady([available(1), available(2)], false);
    del.mockResolvedValueOnce({ landmarkId: uuid(1) });
    await userEvent.click(removeButton("Remove Falls 1 from favorites"));
    await waitFor(() => expect(items()).toHaveLength(1));
    expect(pageCalls()).toHaveLength(1);
  });

  it("a stale re-fetch response cannot bring back a removal confirmed after it started", async () => {
    await renderReady([available(1), available(2), available(3)], true);
    const first = deferred<FavoritesPageData>();
    respond(first.promise, pageOf([available(3), available(4)], false));
    del.mockResolvedValueOnce({ landmarkId: uuid(1) }).mockResolvedValueOnce({
      landmarkId: uuid(2),
    });
    await userEvent.click(removeButton("Remove Falls 1 from favorites"));
    await waitFor(() => expect(items()).toHaveLength(2));
    await userEvent.click(removeButton("Remove Falls 2 from favorites"));
    await waitFor(() => expect(items()).toHaveLength(1));
    // The first re-fetch started before Falls 2 was removed and still lists it.
    await act(async () => first.resolve(pageOf([available(2), available(3), available(4)], true)));
    expect(screen.queryByRole("link", { name: "Falls 2" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("link", { name: "Falls 4" })).toBeInTheDocument());
    expect(pageCalls()).toHaveLength(3); // initial + in flight + one queued
    expect(removeButton("Remove Falls 3 from favorites")).toHaveFocus();
  });

  it("a failed re-fetch keeps the list and removal, and offers Refresh list", async () => {
    await renderReady([available(1), available(2)], true);
    respond(new ApiError(503, "SERVICE_UNAVAILABLE", "x"));
    del.mockResolvedValueOnce({ landmarkId: uuid(1) });
    await userEvent.click(removeButton("Remove Falls 1 from favorites"));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't refresh your favorites list.");
    expect(items()).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "Falls 1" })).not.toBeInTheDocument();
    expect(removeButton("Remove Falls 2 from favorites")).toHaveFocus();

    respond(pageOf([available(2), available(3)], false));
    await userEvent.click(within(alert).getByRole("button", { name: "Refresh list" }));
    await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
    expect(screen.getByRole("link", { name: "Falls 3" })).toBeInTheDocument();
  });
});

describe("FavoritesPage — paging and the URL (K7, M4)", () => {
  it("Next and Previous change ?page= and focus the heading", async () => {
    await renderReady([available(1)], true);
    const pager = screen.getByRole("navigation", { name: "Favorites pages" });
    expect(within(pager).queryByRole("link", { name: "Previous page" })).not.toBeInTheDocument();
    const nextLink = within(pager).getByRole("link", { name: "Next page" });
    expect(nextLink).toHaveAttribute("href", "/favorites?page=2");

    respond(pageOf([available(51)], false, 2));
    await userEvent.click(nextLink);
    expect(location()).toHaveTextContent("/favorites?page=2");
    expect(location()).toHaveAttribute("data-nav", "PUSH");
    expect(heading()).toHaveFocus();
    expect(await screen.findByRole("link", { name: "Falls 51" })).toBeInTheDocument();
    expect(pageCalls()).toEqual([
      { page: 1, limit: 50 },
      { page: 2, limit: 50 },
    ]);

    const prev = screen.getByRole("link", { name: "Previous page" });
    expect(prev).toHaveAttribute("href", "/favorites");
    expect(screen.queryByRole("link", { name: "Next page" })).not.toBeInTheDocument();
    respond(pageOf([available(1)], true));
    await userEvent.click(prev);
    expect(location()).toHaveTextContent(/^\/favorites$/);
    expect(heading()).toHaveFocus();
  });

  it("a page above 1 emptied by removal goes to the preceding page with history replace", async () => {
    await renderReady([available(51)], false, "/favorites?page=2");
    respond(pageOf([available(1)], true));
    del.mockResolvedValueOnce({ landmarkId: uuid(51) });
    await userEvent.click(removeButton("Remove Falls 51 from favorites"));
    await waitFor(() => expect(location()).toHaveTextContent(/^\/favorites$/));
    expect(location()).toHaveAttribute("data-nav", "REPLACE");
    expect(heading()).toHaveFocus();
    expect(await screen.findByRole("link", { name: "Falls 1" })).toBeInTheDocument();
    expect(status()).not.toHaveTextContent("Removed Falls 51");
  });

  it.each(["page=0", "page=abc", "page=01", "page=1&page=2"])(
    "invalid ?%s is replaced by page 1",
    async (query) => {
      respond(pageOf([available(1)]));
      renderPage(`/favorites?${query}`);
      await waitFor(() => expect(location()).toHaveTextContent(/^\/favorites$/));
      expect(location()).toHaveAttribute("data-nav", "REPLACE");
      expect(await screen.findByRole("link", { name: "Falls 1" })).toBeInTheDocument();
      expect(pageCalls()).toEqual([{ page: 1, limit: 50 }]);
    },
  );

  it("a valid page past the end explains and links to page 1", async () => {
    respond(pageOf([], false, 7));
    renderPage("/favorites?page=7");
    expect(await screen.findByText("There are no favorites on this page.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Go to the first page of your favorites" }),
    ).toHaveAttribute("href", "/favorites");
    expect(location()).toHaveTextContent("/favorites?page=7");
  });
});

describe("FavoritesPage — user isolation", () => {
  it("switching users replaces the list and drops the previous user's messages", async () => {
    const harness = await renderReady([available(1), available(2)]);
    del.mockResolvedValueOnce({ landmarkId: uuid(1) });
    await userEvent.click(removeButton("Remove Falls 1 from favorites"));
    await waitFor(() => expect(status()).toHaveTextContent("Removed Falls 1"));

    respond(pageOf([available(9, "Other Users Falls")]));
    harness.setSession({ status: "authenticated", user: OTHER_USER });
    expect(await screen.findByRole("link", { name: "Other Users Falls" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Falls 2" })).not.toBeInTheDocument();
    expect(status()).toHaveTextContent("");
  });

  it("a verified sign-out removes the list at once", async () => {
    const harness = await renderReady([available(1)]);
    harness.setSession({ status: "anonymous" });
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Sign in to see your favorites" })).toBeInTheDocument();
  });
});
