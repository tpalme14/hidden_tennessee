import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  FavoritesContext,
  type FavoriteStatus,
  type FavoritesContextValue,
} from "../favorites/favoritesContext";
import { useLandmarkProfile, type LandmarkProfileStatus } from "./useLandmarkProfile";

vi.mock("./useLandmarkProfile", () => ({ useLandmarkProfile: vi.fn() }));
vi.mock("../map/LandmarkLocationMap", () => ({
  LandmarkLocationMap: (props: { latitude: number; longitude: number }) => (
    <div data-testid="location-map" data-lat={props.latitude} data-lng={props.longitude} />
  ),
}));

const { LandmarkProfilePage } = await import("./LandmarkProfilePage");

/**
 * A test favorites context (M03-T06 Increment 3): full profiles render the
 * favorite control, which needs one. Every landmark reports `status`; the
 * mutations are spies that resolve as "busy" (nothing sent).
 */
function favoritesValue(status: FavoriteStatus = "unsaved"): FavoritesContextValue {
  return {
    membership: { status: "complete" },
    statusOf: vi.fn(() => status),
    isPending: vi.fn(() => false),
    save: vi.fn(() => Promise.resolve({ kind: "busy" as const })),
    remove: vi.fn(() => Promise.resolve({ kind: "busy" as const })),
    retry: vi.fn(),
    refresh: vi.fn(),
  };
}

function withFavorites(children: ReactNode, value = favoritesValue()) {
  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

function renderPage(favorites?: FavoritesContextValue) {
  return render(
    withFavorites(
      <MemoryRouter>
        <LandmarkProfilePage />
      </MemoryRouter>,
      favorites,
    ),
  );
}

/**
 * Full routing setup, used only by the return-navigation tests below. The
 * `fromDiscovery` case puts a distinct discovery-route history entry (with
 * its own query string, standing in for committed search/filter/viewport
 * state) BEFORE the profile entry, so a real `navigate(-1)` is observably
 * different from a fresh `navigate("/")`.
 */
function renderRouted(fromDiscovery: boolean) {
  const entries = fromDiscovery
    ? [
        { pathname: "/", search: "?q=Coal" },
        { pathname: "/landmarks/a", state: { fromDiscovery: true } },
      ]
    : [{ pathname: "/landmarks/a" }];
  return render(
    withFavorites(
      <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
        <Routes>
          <Route path="/" element={<DiscoveryRouteProbe />} />
          <Route path="/landmarks/:id" element={<LandmarkProfilePage />} />
        </Routes>
      </MemoryRouter>,
    ),
  );
}

function DiscoveryRouteProbe() {
  const location = useLocation();
  return <div>Discovery page (query: {location.search || "none"})</div>;
}

const FULL_PROFILE = {
  id: "a",
  display_name: "Public Arch",
  category: "arch",
  latitude: 36.2,
  longitude: -84.1,
  source_description: "Anderson",
  source_access_label: "private",
  source_url: "http://example.com/arch",
};

describe("LandmarkProfilePage", () => {
  it("shows a loading state and always offers a Back to Discover action", () => {
    vi.mocked(useLandmarkProfile).mockReturnValue([{ kind: "loading" }, vi.fn()]);

    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent(/loading/i);
    expect(screen.getByRole("button", { name: /back to discover/i })).toBeInTheDocument();
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument();
  });

  it("renders the full profile with all approved fields, the mini-map, and the safety disclaimer", () => {
    vi.mocked(useLandmarkProfile).mockReturnValue([
      { kind: "full", profile: FULL_PROFILE },
      vi.fn(),
    ]);

    renderPage();

    expect(screen.getByRole("heading", { name: "Public Arch" })).toBeInTheDocument();
    expect(screen.getByText("Natural Arch")).toBeInTheDocument();
    expect(screen.getByText("Anderson")).toBeInTheDocument();
    expect(screen.getByText("private")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "http://example.com/arch" })).toHaveAttribute(
      "href",
      "http://example.com/arch",
    );
    expect(screen.getByText(/do not establish public access/i)).toBeInTheDocument();

    const map = screen.getByTestId("location-map");
    expect(map).toHaveAttribute("data-lat", "36.2");
    expect(map).toHaveAttribute("data-lng", "-84.1");
  });

  it("omits optional fields that are null, without showing placeholder text", () => {
    vi.mocked(useLandmarkProfile).mockReturnValue([
      {
        kind: "full",
        profile: {
          ...FULL_PROFILE,
          source_description: null,
          source_access_label: null,
          source_url: null,
        },
      },
      vi.fn(),
    ]);

    renderPage();

    expect(screen.queryByText("Anderson")).not.toBeInTheDocument();
    expect(screen.queryByText("private")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /example\.com/i })).not.toBeInTheDocument();
  });

  it("does not render an unsafe source_url as a clickable link", () => {
    vi.mocked(useLandmarkProfile).mockReturnValue([
      { kind: "full", profile: { ...FULL_PROFILE, source_url: "javascript:alert(1)" } },
      vi.fn(),
    ]);

    renderPage();

    expect(screen.queryByRole("link", { name: /javascript/i })).not.toBeInTheDocument();
  });

  it("renders strictly the minimal profile for a redacted (UNREVIEWED-shaped) record, with no map and no protected fields", () => {
    vi.mocked(useLandmarkProfile).mockReturnValue([
      {
        kind: "minimal",
        profile: { id: "b", display_name: "Hidden Falls", category: "falls", redacted: true },
      },
      vi.fn(),
    ]);

    renderPage();

    expect(screen.getByRole("heading", { name: "Hidden Falls" })).toBeInTheDocument();
    expect(screen.getByText("Waterfall")).toBeInTheDocument();
    expect(
      screen.getByText("Full details for this landmark are not currently available."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument();
    expect(screen.queryByText(/redacted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unreviewed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sensitive/i)).not.toBeInTheDocument();
  });

  it("renders the identical minimal profile for a SENSITIVE-shaped record — no distinguishing content", () => {
    vi.mocked(useLandmarkProfile).mockReturnValue([
      {
        kind: "minimal",
        profile: { id: "c", display_name: "Secret Peak", category: "peak", redacted: true },
      },
      vi.fn(),
    ]);

    renderPage();

    expect(
      screen.getByText("Full details for this landmark are not currently available."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument();
    expect(screen.queryByText(/sensitive/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unreviewed/i)).not.toBeInTheDocument();
  });

  it("renders the exact generic unavailable heading and text for an unknown/retired/inactive landmark", () => {
    vi.mocked(useLandmarkProfile).mockReturnValue([{ kind: "unavailable" }, vi.fn()]);

    renderPage();

    expect(screen.getByRole("heading", { name: "Landmark unavailable" })).toBeInTheDocument();
    expect(
      screen.getByText("This landmark is no longer available in the explorer."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument();
  });

  it("shows a real error state with a working retry action for a genuine failure", async () => {
    const retry = vi.fn();
    vi.mocked(useLandmarkProfile).mockReturnValue([
      { kind: "error", message: "Server error." },
      retry,
    ]);

    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("Server error.");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument();
  });

  describe("favorite action (M03-T06 Increment 3)", () => {
    const favoriteControls = () => [
      ...screen.queryAllByRole("button", { name: /favorite/i }),
      ...screen.queryAllByRole("link", { name: /sign in to save/i }),
    ];

    it("a full (PUBLIC) profile shows the favorite toggle for that landmark", () => {
      vi.mocked(useLandmarkProfile).mockReturnValue([
        { kind: "full", profile: FULL_PROFILE },
        vi.fn(),
      ]);
      const favorites = favoritesValue("saved");

      renderPage(favorites);

      const toggle = screen.getByRole("button", { name: "Favorite Public Arch" });
      expect(toggle).toHaveAttribute("aria-pressed", "true");
      expect(favorites.statusOf).toHaveBeenCalledWith("a");
    });

    it("signed out on a full profile: the sign-in link returns to this profile", () => {
      vi.mocked(useLandmarkProfile).mockReturnValue([
        { kind: "full", profile: FULL_PROFILE },
        vi.fn(),
      ]);
      render(
        withFavorites(
          <MemoryRouter initialEntries={["/landmarks/a?from=search"]}>
            <Routes>
              <Route path="/landmarks/:id" element={<LandmarkProfilePage />} />
            </Routes>
          </MemoryRouter>,
          favoritesValue("signed-out"),
        ),
      );

      expect(screen.getByRole("link", { name: "Sign in to save Public Arch" })).toHaveAttribute(
        "href",
        `/sign-in?returnTo=${encodeURIComponent("/landmarks/a?from=search")}`,
      );
    });

    it.each([
      [
        "minimal (redacted)",
        {
          kind: "minimal",
          profile: { id: "b", display_name: "Hidden Falls", category: "falls", redacted: true },
        },
      ],
      ["unavailable", { kind: "unavailable" }],
      ["loading", { kind: "loading" }],
      ["error", { kind: "error", message: "Server error." }],
    ] as const)("no favorite control on a %s profile", (_label, status) => {
      vi.mocked(useLandmarkProfile).mockReturnValue([status as LandmarkProfileStatus, vi.fn()]);
      const favorites = favoritesValue("unsaved");

      renderPage(favorites);

      expect(favoriteControls()).toEqual([]);
      expect(favorites.statusOf).not.toHaveBeenCalled();
    });

    it("the Back to Discover action still works alongside the favorite control", async () => {
      vi.mocked(useLandmarkProfile).mockReturnValue([
        { kind: "full", profile: FULL_PROFILE },
        vi.fn(),
      ]);

      renderRouted(true);

      expect(screen.getByRole("button", { name: "Favorite Public Arch" })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: /back to discover/i }));
      expect(await screen.findByText("Discovery page (query: ?q=Coal)")).toBeInTheDocument();
    });
  });

  describe("return navigation (M02-T07)", () => {
    it("navigates back (preserving the prior discovery URL/state) when reached via an in-app discovery link", async () => {
      vi.mocked(useLandmarkProfile).mockReturnValue([
        {
          kind: "minimal",
          profile: { id: "a", display_name: "Hidden Falls", category: "falls", redacted: true },
        },
        vi.fn(),
      ]);

      renderRouted(true);

      await userEvent.click(screen.getByRole("button", { name: /back to discover/i }));

      // A real `navigate(-1)` lands back on the exact prior discovery history
      // entry, query string (committed search/filter/viewport state) intact.
      expect(await screen.findByText("Discovery page (query: ?q=Coal)")).toBeInTheDocument();
    });

    it("falls back to the plain discovery route for a direct profile visit with no discovery history", async () => {
      vi.mocked(useLandmarkProfile).mockReturnValue([
        {
          kind: "minimal",
          profile: { id: "a", display_name: "Hidden Falls", category: "falls", redacted: true },
        },
        vi.fn(),
      ]);

      renderRouted(false);

      await userEvent.click(screen.getByRole("button", { name: /back to discover/i }));

      expect(await screen.findByText("Discovery page (query: none)")).toBeInTheDocument();
    });
  });
});
