import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { useLandmarkProfile } from "./useLandmarkProfile";

vi.mock("./useLandmarkProfile", () => ({ useLandmarkProfile: vi.fn() }));
vi.mock("../map/LandmarkLocationMap", () => ({
  LandmarkLocationMap: (props: { latitude: number; longitude: number }) => (
    <div data-testid="location-map" data-lat={props.latitude} data-lng={props.longitude} />
  ),
}));

const { LandmarkProfilePage } = await import("./LandmarkProfilePage");

function renderPage() {
  return render(
    <MemoryRouter>
      <LandmarkProfilePage />
    </MemoryRouter>,
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
    <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
      <Routes>
        <Route
          path="/"
          element={
            <DiscoveryRouteProbe />
          }
        />
        <Route path="/landmarks/:id" element={<LandmarkProfilePage />} />
      </Routes>
    </MemoryRouter>,
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
    vi.mocked(useLandmarkProfile).mockReturnValue([{ kind: "full", profile: FULL_PROFILE }, vi.fn()]);

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
      { kind: "full", profile: { ...FULL_PROFILE, source_description: null, source_access_label: null, source_url: null } },
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
      { kind: "minimal", profile: { id: "b", display_name: "Hidden Falls", category: "falls", redacted: true } },
      vi.fn(),
    ]);

    renderPage();

    expect(screen.getByRole("heading", { name: "Hidden Falls" })).toBeInTheDocument();
    expect(screen.getByText("Waterfall")).toBeInTheDocument();
    expect(screen.getByText("Full details for this landmark are not currently available.")).toBeInTheDocument();
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument();
    expect(screen.queryByText(/redacted/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unreviewed/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/sensitive/i)).not.toBeInTheDocument();
  });

  it("renders the identical minimal profile for a SENSITIVE-shaped record — no distinguishing content", () => {
    vi.mocked(useLandmarkProfile).mockReturnValue([
      { kind: "minimal", profile: { id: "c", display_name: "Secret Peak", category: "peak", redacted: true } },
      vi.fn(),
    ]);

    renderPage();

    expect(screen.getByText("Full details for this landmark are not currently available.")).toBeInTheDocument();
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument();
    expect(screen.queryByText(/sensitive/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/unreviewed/i)).not.toBeInTheDocument();
  });

  it("renders the exact generic unavailable heading and text for an unknown/retired/inactive landmark", () => {
    vi.mocked(useLandmarkProfile).mockReturnValue([{ kind: "unavailable" }, vi.fn()]);

    renderPage();

    expect(screen.getByRole("heading", { name: "Landmark unavailable" })).toBeInTheDocument();
    expect(screen.getByText("This landmark is no longer available in the explorer.")).toBeInTheDocument();
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument();
  });

  it("shows a real error state with a working retry action for a genuine failure", async () => {
    const retry = vi.fn();
    vi.mocked(useLandmarkProfile).mockReturnValue([{ kind: "error", message: "Server error." }, retry]);

    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("Server error.");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
    expect(screen.queryByTestId("location-map")).not.toBeInTheDocument();
  });

  describe("return navigation (M02-T07)", () => {
    it("navigates back (preserving the prior discovery URL/state) when reached via an in-app discovery link", async () => {
      vi.mocked(useLandmarkProfile).mockReturnValue([
        { kind: "minimal", profile: { id: "a", display_name: "Hidden Falls", category: "falls", redacted: true } },
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
        { kind: "minimal", profile: { id: "a", display_name: "Hidden Falls", category: "falls", redacted: true } },
        vi.fn(),
      ]);

      renderRouted(false);

      await userEvent.click(screen.getByRole("button", { name: /back to discover/i }));

      expect(await screen.findByText("Discovery page (query: none)")).toBeInTheDocument();
    });
  });
});
