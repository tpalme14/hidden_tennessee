import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { addFavorite, listFavorites, removeFavorite } from "../api/favorites";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { FavoriteButton } from "../favorites/FavoriteButton";
import { FavoritesAnnouncer } from "../favorites/FavoritesAnnouncer";
import { FavoritesProvider } from "../favorites/FavoritesProvider";
import { WithFakeFavorites } from "../favorites/testFavorites";
import type { LandmarkMarker, MapMarkersStatus } from "../map/useMapMarkers";
import { GEO_RESULTS_HEADING_ID, GeographicResultsList } from "./GeographicResultsList";

/**
 * M03-T06 Increment 4 — favorite controls in the geographic results list
 * (PUBLIC-only results), with the REAL provider, the shared announcer that
 * DiscoveryPage renders outside the list, and a real router. The API module
 * is mocked; the auth context is supplied.
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

const ALPHA_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const BRAVO_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const alpha: LandmarkMarker = {
  id: ALPHA_ID,
  display_name: "Alpha Falls",
  category: "falls",
  latitude: 35.6,
  longitude: -85.6,
};
const bravo: LandmarkMarker = {
  id: BRAVO_ID,
  display_name: "Bravo Peak",
  category: "peak",
  latitude: 35.9,
  longitude: -84.9,
};

const DISCOVERY_URL = "/?q=falls&categories=falls&lat=35.75&lng=-85.95&zoom=7";

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>;
}

function renderList(
  status: MapMarkersStatus = { kind: "success", markers: [alpha, bravo], isTruncated: false },
  session: SessionState = { status: "authenticated", user: TEST_USER },
) {
  const auth: AuthContextValue = {
    session,
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  const utils = render(
    <AuthContext.Provider value={auth}>
      <FavoritesProvider>
        <MemoryRouter initialEntries={[DISCOVERY_URL]}>
          <Routes>
            <Route
              path="/"
              element={
                <>
                  <FavoritesAnnouncer>
                    <GeographicResultsList status={status} onRetry={vi.fn()} />
                  </FavoritesAnnouncer>
                  <LocationProbe />
                </>
              }
            />
            <Route path="/landmarks/:id" element={<p>Profile page</p>} />
            <Route path="/sign-in" element={<p>Sign-in page</p>} />
          </Routes>
        </MemoryRouter>
      </FavoritesProvider>
    </AuthContext.Provider>,
  );
  const section = () =>
    document.getElementById(GEO_RESULTS_HEADING_ID)!.closest("section") as HTMLElement;
  const polite = () => utils.container.querySelector<HTMLElement>('[aria-live="polite"]')!;
  return { ...utils, section, polite };
}

const favoriteFor = (name: string) => screen.getByRole("button", { name: `Favorite ${name}` });

async function ready(savedIds: string[] = []) {
  list.mockResolvedValueOnce({
    favorites: savedIds.map((landmark_id) => ({
      landmark_id,
      availability: "unavailable" as const,
    })),
    page: 1,
    limit: 100,
    has_more: false,
  });
  const harness = renderList();
  await waitFor(() => expect(favoriteFor("Alpha Falls")).toHaveAttribute("aria-pressed"));
  return harness;
}

function expectNoLiveRegionsInside(section: HTMLElement) {
  expect(within(section).queryByRole("status")).not.toBeInTheDocument();
  expect(within(section).queryByRole("alert")).not.toBeInTheDocument();
  expect(section.querySelector("[aria-live]")).toBeNull();
}

beforeEach(() => {
  list.mockReset();
  add.mockReset();
  del.mockReset();
});

describe("GeographicResultsList — favorite controls", () => {
  it("one control per result, with a distinct accessible name per landmark, outside its link", async () => {
    await ready();
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    for (const [item, name] of [
      [items[0]!, "Alpha Falls"],
      [items[1]!, "Bravo Peak"],
    ] as const) {
      const link = within(item).getByRole("link", { name });
      const button = within(item).getByRole("button", { name: `Favorite ${name}` });
      expect(link.contains(button)).toBe(false);
      expect(button.contains(link)).toBe(false);
      expect(link.querySelector("button, a, input, select, textarea")).toBeNull();
    }
  });

  it("the profile link still navigates as before", async () => {
    await ready();
    await userEvent.click(screen.getByRole("link", { name: "Alpha Falls" }));
    expect(await screen.findByText("Profile page")).toBeInTheDocument();
  });

  it("no live regions inside the list section — before and after actions, including failures", async () => {
    const { section } = await ready();
    expectNoLiveRegionsInside(section());
    add.mockResolvedValueOnce({ landmarkId: ALPHA_ID, created: true });
    add.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x"));
    await userEvent.click(favoriteFor("Alpha Falls"));
    await userEvent.click(favoriteFor("Bravo Peak"));
    await screen.findByRole("alert");
    expectNoLiveRegionsInside(section());
  });

  it("saving one landmark changes only that landmark; the URL never changes and nothing navigates", async () => {
    const { polite } = await ready();
    const before = screen.getByTestId("location").textContent;
    expect(before).toBe(DISCOVERY_URL);
    add.mockResolvedValueOnce({ landmarkId: ALPHA_ID, created: true });

    await userEvent.click(favoriteFor("Alpha Falls"));

    await waitFor(() => expect(favoriteFor("Alpha Falls")).toHaveAttribute("aria-pressed", "true"));
    expect(favoriteFor("Bravo Peak")).toHaveAttribute("aria-pressed", "false");
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(ALPHA_ID);
    expect(screen.getByTestId("location")).toHaveTextContent(DISCOVERY_URL);
    expect(screen.queryByText("Profile page")).not.toBeInTheDocument();
    expect(polite()).toHaveTextContent("Saved Alpha Falls to favorites.");
  });

  it("removing announces with the landmark's name", async () => {
    const { polite } = await ready([BRAVO_ID]);
    del.mockResolvedValueOnce({ landmarkId: BRAVO_ID });
    await userEvent.click(favoriteFor("Bravo Peak"));
    await waitFor(() => expect(polite()).toHaveTextContent("Removed Bravo Peak from favorites."));
    expect(favoriteFor("Bravo Peak")).toHaveAttribute("aria-pressed", "false");
  });

  it("concurrent actions on two landmarks: independent requests; the newest outcome is announced, never both concatenated", async () => {
    const { polite } = await ready();
    const a = deferred<{ landmarkId: string; created: boolean }>();
    const b = deferred<{ landmarkId: string; created: boolean }>();
    add.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);

    await userEvent.click(favoriteFor("Alpha Falls"));
    await userEvent.click(favoriteFor("Bravo Peak"));
    expect(add).toHaveBeenCalledTimes(2);
    expect(favoriteFor("Alpha Falls")).toHaveAttribute("aria-busy", "true");
    expect(favoriteFor("Bravo Peak")).toHaveAttribute("aria-busy", "true");
    expect(polite()).toBeEmptyDOMElement(); // nothing before confirmation

    await act(async () => b.resolve({ landmarkId: BRAVO_ID, created: true }));
    expect(polite()).toHaveTextContent(/^Saved Bravo Peak to favorites\.$/);
    await act(async () => a.resolve({ landmarkId: ALPHA_ID, created: false }));
    expect(polite()).toHaveTextContent(/^Alpha Falls is already in your favorites\.$/);
    expect(favoriteFor("Alpha Falls")).toHaveAttribute("aria-pressed", "true");
    expect(favoriteFor("Bravo Peak")).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("concurrent success and failure: one named alert and one named status, neither misleading", async () => {
    const { polite } = await ready();
    const a = deferred<{ landmarkId: string; created: boolean }>();
    const b = deferred<{ landmarkId: string; created: boolean }>();
    add.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise);
    await userEvent.click(favoriteFor("Alpha Falls"));
    await userEvent.click(favoriteFor("Bravo Peak"));

    await act(async () => a.reject(new ApiError(429, "RATE_LIMITED", "x", 12)));
    await act(async () => b.resolve({ landmarkId: BRAVO_ID, created: true }));

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Alpha Falls: Too many requests. Please try again in 12 seconds.",
    );
    expect(polite()).toHaveTextContent("Saved Bravo Peak to favorites.");
    expect(favoriteFor("Alpha Falls")).toHaveAttribute("aria-pressed", "false");
  });

  it("keyboard: Tab moves from a result's link to its control; Enter activates it and focus stays", async () => {
    await ready();
    add.mockResolvedValueOnce({ landmarkId: ALPHA_ID, created: true });
    screen.getByRole("link", { name: "Alpha Falls" }).focus();
    await userEvent.tab();
    expect(favoriteFor("Alpha Falls")).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(favoriteFor("Alpha Falls")).toHaveAttribute("aria-pressed", "true"));
    expect(favoriteFor("Alpha Falls")).toHaveFocus();
    expect(screen.getByTestId("location")).toHaveTextContent(DISCOVERY_URL);
  });

  it("signed out: per-landmark sign-in links whose returnTo keeps the full discovery URL", () => {
    renderList(undefined, { status: "anonymous" });
    const link = screen.getByRole("link", { name: "Sign in to save Alpha Falls" });
    expect(link).toHaveAttribute("href", `/sign-in?returnTo=${encodeURIComponent(DISCOVERY_URL)}`);
    expect(screen.getByRole("link", { name: "Sign in to save Bravo Peak" })).toBeInTheDocument();
    expect(list).not.toHaveBeenCalled();
  });

  it("previous results retained during a reload still carry working controls", async () => {
    list.mockResolvedValueOnce({ favorites: [], page: 1, limit: 100, has_more: false });
    renderList({ kind: "loading", previous: { markers: [alpha], isTruncated: false } });
    await waitFor(() =>
      expect(favoriteFor("Alpha Falls")).toHaveAttribute("aria-pressed", "false"),
    );
    expect(screen.getByText(/previous search/i)).toBeInTheDocument();
  });

  it("a list-variant control without the shared announcer is refused (never falls back to per-row regions)", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() =>
      render(
        <WithFakeFavorites>
          <MemoryRouter>
            <FavoriteButton landmarkId={ALPHA_ID} displayName="Alpha Falls" variant="list" />
          </MemoryRouter>
        </WithFakeFavorites>,
      ),
    ).toThrow(/inside <FavoritesAnnouncer>/);
    spy.mockRestore();
  });
});
