import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useMapMarkers } from "../map/useMapMarkers";
import { GeographicResultsList } from "./GeographicResultsList";
import { useDiscoveryFilters } from "./useDiscoveryFilters";
import { useDiscoveryUrlState } from "./useDiscoveryUrlState";
import { useGeographicDiscovery } from "./useGeographicDiscovery";

const DEFAULT_BBOX = { minLng: -90.3, minLat: 34.8, maxLng: -81.6, maxLat: 36.7 };

vi.mock("./useDiscoveryUrlState", () => ({ useDiscoveryUrlState: vi.fn() }));
vi.mock("./useDiscoveryFilters", () => ({ useDiscoveryFilters: vi.fn() }));
vi.mock("./useGeographicDiscovery", () => ({ useGeographicDiscovery: vi.fn() }));
vi.mock("../map/useMapMarkers", () => ({ useMapMarkers: vi.fn() }));

vi.mock("../map/LandmarkMap", () => ({
  LandmarkMap: ({ children, describedById }: { children?: ReactNode; describedById?: string }) => (
    <div data-testid="map" data-described-by={describedById}>
      {children}
    </div>
  ),
}));
vi.mock("../map/LandmarkMarkersRenderer", () => ({
  LandmarkMarkersRenderer: ({
    markers,
    onFocusLost,
  }: {
    markers: unknown[];
    onFocusLost?: () => void;
  }) => (
    <div data-testid="markers-renderer" data-count={markers.length}>
      {/* Lets a test trigger the renderer's focus-lost report without real Leaflet (5a). */}
      <button type="button" onClick={onFocusLost}>
        simulate focused marker removed
      </button>
    </div>
  ),
}));
vi.mock("../map/MapViewportTracker", () => ({
  MapViewportTracker: () => <div data-testid="viewport-tracker" />,
}));
vi.mock("./DiscoveryFilters", () => ({
  DiscoveryFilters: () => <div data-testid="discovery-filters" />,
}));
vi.mock("./GeoDiscoveryControls", () => ({
  GeoDiscoveryControls: () => <div data-testid="geo-controls" />,
}));
vi.mock("./GeographicResultsList", () => ({
  GEO_RESULTS_HEADING_ID: "geo-results-heading",
  GeographicResultsList: vi.fn(() => (
    <div data-testid="geo-results-list">
      <h3 id="geo-results-heading" tabIndex={-1}>
        Landmarks on the map
      </h3>
    </div>
  )),
}));
vi.mock("./LandmarkSearch", () => ({
  LandmarkSearch: (props: Record<string, unknown>) => (
    <div data-testid="landmark-search" data-prop-count={Object.keys(props).length} />
  ),
}));

const { DiscoveryPage } = await import("./DiscoveryPage");

function defaultUrlState(overrides = {}) {
  return {
    q: "",
    categories: [],
    mode: "bbox" as const,
    bbox: DEFAULT_BBOX,
    near: null,
    radius: null,
    viewport: null,
    wasNormalized: false,
    ...overrides,
  };
}

function defaultFilters(overrides = {}) {
  return {
    inputValue: "",
    committedQuery: "",
    selectedCategories: [],
    onInputChange: vi.fn(),
    onSubmitNow: vi.fn(),
    onToggleCategory: vi.fn(),
    onClearAll: vi.fn(),
    ...overrides,
  };
}

function defaultGeo(overrides = {}) {
  return {
    effectiveGeo: { mode: "bbox" as const, bbox: DEFAULT_BBOX },
    hasPendingAreaChange: false,
    isDeviceOrigin: false,
    geolocationPending: false,
    geolocationError: null,
    onViewportChange: vi.fn(),
    onSearchThisArea: vi.fn(),
    onFindNearMapCenter: vi.fn(),
    onNearMe: vi.fn(),
    onRadiusChange: vi.fn(),
    onExitProximity: vi.fn(),
    ...overrides,
  };
}

function setup(
  options: { urlState?: object; filters?: object; geo?: object; markerStatus?: object } = {},
) {
  vi.mocked(useDiscoveryUrlState).mockReturnValue([defaultUrlState(options.urlState), {} as never]);
  vi.mocked(useDiscoveryFilters).mockReturnValue(defaultFilters(options.filters) as never);
  vi.mocked(useGeographicDiscovery).mockReturnValue(defaultGeo(options.geo) as never);
  vi.mocked(useMapMarkers).mockReturnValue([
    options.markerStatus ?? { kind: "loading" },
    vi.fn(),
  ] as never);
}

function renderPage() {
  return render(
    <MemoryRouter>
      <DiscoveryPage />
    </MemoryRouter>,
  );
}

describe("DiscoveryPage composition and marker status messaging (M02-T07)", () => {
  it("shows a loading state outside the map while markers are loading", () => {
    setup({ markerStatus: { kind: "loading" } });
    renderPage();

    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(screen.getByTestId("map")).toBeInTheDocument();
    expect(screen.queryByTestId("markers-renderer")).not.toBeInTheDocument();
  });

  it("shows an error state (with retry) outside the map on failure", () => {
    setup({ markerStatus: { kind: "error", message: "Server error." } });
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("Server error.");
  });

  it("shows an explanatory empty state when there are zero markers", () => {
    setup({ markerStatus: { kind: "success", markers: [], isTruncated: false } });
    renderPage();

    expect(screen.getByText(/no publicly viewable landmarks/i)).toBeInTheDocument();
    expect(screen.getByTestId("markers-renderer")).toHaveAttribute("data-count", "0");
  });

  it("shows the 200-result truncation notice only when is_truncated is true", () => {
    setup({
      markerStatus: {
        kind: "success",
        markers: [{ id: "a", display_name: "A", category: "falls", latitude: 1, longitude: 2 }],
        isTruncated: true,
      },
    });
    renderPage();

    expect(screen.getByText(/showing up to 200 results/i)).toBeInTheDocument();
  });

  it("shows no truncation notice and passes markers through when results are complete and non-empty", () => {
    setup({
      markerStatus: {
        kind: "success",
        markers: [{ id: "a", display_name: "A", category: "falls", latitude: 1, longitude: 2 }],
        isTruncated: false,
      },
    });
    renderPage();

    expect(screen.queryByText(/no publicly viewable landmarks/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/showing up to 200 results/i)).not.toBeInTheDocument();
    expect(screen.getByTestId("markers-renderer")).toHaveAttribute("data-count", "1");
  });

  it("shows an accessible notice when the URL's query parameters had to be normalized", () => {
    setup({
      urlState: { wasNormalized: true },
      markerStatus: { kind: "success", markers: [], isTruncated: false },
    });
    renderPage();

    expect(screen.getByText(/weren't valid, so they were reset/i)).toBeInTheDocument();
  });

  it("shows no normalization notice on an ordinary, valid URL", () => {
    setup({ markerStatus: { kind: "success", markers: [], isTruncated: false } });
    renderPage();

    expect(screen.queryByText(/weren't valid/i)).not.toBeInTheDocument();
  });

  it("renders DiscoveryFilters, GeoDiscoveryControls, and the viewport tracker inside the map, and LandmarkSearch with the committed filters", () => {
    setup({
      filters: { committedQuery: "Coal", selectedCategories: ["arch"] },
      markerStatus: { kind: "success", markers: [], isTruncated: false },
    });
    renderPage();

    expect(screen.getByTestId("discovery-filters")).toBeInTheDocument();
    expect(screen.getByTestId("geo-controls")).toBeInTheDocument();
    expect(screen.getByTestId("viewport-tracker")).toBeInTheDocument();
    expect(screen.getByTestId("landmark-search")).toHaveAttribute("data-prop-count", "2");
  });

  it("feeds useMapMarkers with the SAME committed filters as LandmarkSearch receives (the central M02-T07 decision)", () => {
    setup({ filters: { committedQuery: "Coal", selectedCategories: ["arch"] } });
    renderPage();

    expect(useMapMarkers).toHaveBeenCalledWith(
      expect.objectContaining({ q: "Coal", categories: ["arch"] }),
    );
  });
});

describe("DiscoveryPage — retaining previous markers during loading/error (M02-T07 final verification correction)", () => {
  const previousMarker = {
    id: "a",
    display_name: "A",
    category: "falls",
    latitude: 1,
    longitude: 2,
  };

  it("shows the plain loading label and no markers when there is no previous result", () => {
    setup({ markerStatus: { kind: "loading" } });
    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent(/^loading landmarks/i);
    expect(screen.queryByText(/previous search/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("markers-renderer")).not.toBeInTheDocument();
  });

  it("shows retained markers, labeled as previous (not confirmed), while a subsequent request is loading", () => {
    setup({
      markerStatus: {
        kind: "loading",
        previous: { markers: [previousMarker], isTruncated: false },
      },
    });
    renderPage();

    expect(screen.getByText(/updating landmarks/i)).toBeInTheDocument();
    expect(screen.getByText(/previous search/i)).toHaveTextContent(/the update loads/i);
    expect(screen.getByText(/may not match your current filters/i)).toBeInTheDocument();
    expect(screen.getByTestId("markers-renderer")).toHaveAttribute("data-count", "1");
  });

  it("shows retained markers, labeled as previous, alongside the real error alert when a subsequent request fails", () => {
    setup({
      markerStatus: {
        kind: "error",
        message: "Server error.",
        previous: { markers: [previousMarker], isTruncated: false },
      },
    });
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("Server error.");
    expect(screen.getByText(/previous search/i)).toHaveTextContent(/the update failed/i);
    expect(screen.getByTestId("markers-renderer")).toHaveAttribute("data-count", "1");
  });

  it("shows no previous-results notice or markers on error when nothing was ever successfully fetched", () => {
    setup({ markerStatus: { kind: "error", message: "Server error." } });
    renderPage();

    expect(screen.getByRole("alert")).toHaveTextContent("Server error.");
    expect(screen.queryByText(/previous search/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("markers-renderer")).not.toBeInTheDocument();
  });

  it("does not show a previous-results notice when the retained previous result was itself empty", () => {
    setup({ markerStatus: { kind: "loading", previous: { markers: [], isTruncated: false } } });
    renderPage();

    expect(screen.queryByText(/previous search/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("markers-renderer")).not.toBeInTheDocument();
  });

  it("a successful (even empty) response is never shown as 'previous' — success is always authoritative", () => {
    setup({ markerStatus: { kind: "success", markers: [], isTruncated: false } });
    renderPage();

    expect(screen.queryByText(/previous search/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no publicly viewable landmarks/i)).toBeInTheDocument();
  });
});

describe("DiscoveryPage — GeographicResultsList and skip links (M02-T08 increment 2)", () => {
  it("renders GeographicResultsList with the EXACT SAME markerStatus object passed to useMapMarkers — the central M02-T08 accessible-list decision", () => {
    const markerStatus = { kind: "success" as const, markers: [], isTruncated: false };
    setup({ markerStatus });
    renderPage();

    expect(screen.getByTestId("geo-results-list")).toBeInTheDocument();
    const [props] = vi.mocked(GeographicResultsList).mock.calls.at(-1)!;
    expect(props.status).toBe(markerStatus);
    expect(typeof props.onRetry).toBe("function");
  });

  it("provides skip links to both result sections, targeting their stable, focusable headings", () => {
    setup({ markerStatus: { kind: "success", markers: [], isTruncated: false } });
    renderPage();

    const geoSkipLink = screen.getByRole("link", { name: /skip to landmarks on the map/i });
    expect(geoSkipLink).toHaveAttribute("href", "#geo-results-heading");

    const searchSkipLink = screen.getByRole("link", { name: /skip to name search results/i });
    expect(searchSkipLink).toHaveAttribute("href", "#search-heading");
  });

  it("explains that a landmark can legitimately appear in both lists", () => {
    setup({ markerStatus: { kind: "success", markers: [], isTruncated: false } });
    renderPage();

    expect(screen.getByText(/can legitimately appear in both/i)).toBeInTheDocument();
  });
});

describe("DiscoveryPage — keyboard-controls instruction (M02-T08 increment 5d)", () => {
  const INSTRUCTION =
    "Keyboard controls: Use arrow keys to pan the focused map. Press Tab to move between markers, Enter or Space to open a marker, and Escape to close its popup.";

  it("renders the exact visible instruction before the map, as plain non-live, non-focusable text", () => {
    setup({ markerStatus: { kind: "success", markers: [], isTruncated: false } });
    renderPage();

    const instruction = screen.getByText(INSTRUCTION);
    expect(instruction.tagName).toBe("P");
    expect(instruction).toHaveAttribute("id", "map-keyboard-help");
    expect(instruction).not.toHaveAttribute("role");
    expect(instruction).not.toHaveAttribute("aria-live");
    expect(instruction).not.toHaveAttribute("tabindex");
    // Document order: the instruction precedes the map.
    const map = screen.getByTestId("map");
    expect(
      instruction.compareDocumentPosition(map) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("asks the map to use the instruction as its accessible description (aria-describedby target id)", () => {
    setup({ markerStatus: { kind: "success", markers: [], isTruncated: false } });
    renderPage();

    expect(screen.getByTestId("map")).toHaveAttribute("data-described-by", "map-keyboard-help");
  });
});

describe("DiscoveryPage — focus fallback when a focused marker is removed (M02-T08 increment 5a)", () => {
  it("wires the renderer's onFocusLost to focus the geographic-results heading", async () => {
    setup({
      markerStatus: {
        kind: "success",
        markers: [{ id: "a", display_name: "A", category: "falls", latitude: 1, longitude: 2 }],
        isTruncated: false,
      },
    });
    renderPage();

    const { default: userEvent } = await import("@testing-library/user-event");
    await userEvent.click(screen.getByRole("button", { name: /simulate focused marker removed/i }));

    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Landmarks on the map" }),
    );
  });
});
