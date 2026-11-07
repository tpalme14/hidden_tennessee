import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { DivIcon } from "leaflet";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import type { MarkerProps, PopupProps } from "react-leaflet";
import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { categoryColor } from "./categoryMarkerStyle";
import type { LandmarkMarker } from "./useMapMarkers";

/**
 * Mocked react-leaflet (the project's established pattern for map
 * components): asserts the props this renderer passes to `Marker`/`Popup`
 * and the popup's rendered content. The real Leaflet DOM, keyboard
 * activation, focus management, and stacking are covered by
 * `LandmarkMarkersRenderer.leaflet.test.tsx` against real Leaflet.
 */
vi.mock("react-leaflet", () => ({
  Marker: (props: MarkerProps) => {
    const icon = props.icon as DivIcon | undefined;
    return (
      <div
        data-testid="marker"
        data-position={JSON.stringify(props.position)}
        data-icon-class={icon?.options.className}
        data-icon-html={String(icon?.options.html)}
        data-icon-size={JSON.stringify(icon?.options.iconSize)}
        data-icon-anchor={JSON.stringify(icon?.options.iconAnchor)}
        data-has-keydown={String(typeof props.eventHandlers?.keydown === "function")}
        data-has-popupclose={String(typeof props.eventHandlers?.popupclose === "function")}
      >
        {props.children}
      </div>
    );
  },
  Popup: (props: PopupProps) => <div data-testid="popup">{props.children}</div>,
  useMap: () => ({ closePopup: () => undefined }),
}));

const { LandmarkMarkersRenderer } = await import("./LandmarkMarkersRenderer");

const markers: LandmarkMarker[] = [
  { id: "a", display_name: "Open Falls", category: "falls", latitude: 35.1, longitude: -85.1 },
  { id: "b", display_name: "Open Peak", category: "peak", latitude: 35.2, longitude: -85.2 },
];

function renderWithRouter(ui: ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("LandmarkMarkersRenderer", () => {
  it("renders one Marker per landmark, positioned at its own coordinates", () => {
    renderWithRouter(<LandmarkMarkersRenderer markers={markers} />);

    const rendered = screen.getAllByTestId("marker");
    expect(rendered).toHaveLength(2);
    expect(rendered[0]).toHaveAttribute("data-position", JSON.stringify([35.1, -85.1]));
    expect(rendered[1]).toHaveAttribute("data-position", JSON.stringify([35.2, -85.2]));
  });

  it("uses a DivIcon with a 24px focus/hit area, centre anchor, and a category-coloured 16px dot built only from the fixed palette", () => {
    renderWithRouter(<LandmarkMarkersRenderer markers={markers} />);

    const [falls, peak] = screen.getAllByTestId("marker");
    expect(falls).toHaveAttribute("data-icon-size", JSON.stringify([24, 24]));
    expect(falls).toHaveAttribute("data-icon-anchor", JSON.stringify([12, 12]));
    expect(falls!.getAttribute("data-icon-class")).toBeTruthy();
    expect(falls!.getAttribute("data-icon-html")).toContain(
      `background-color:${categoryColor("falls")}`,
    );
    expect(peak!.getAttribute("data-icon-html")).toContain(
      `background-color:${categoryColor("peak")}`,
    );
    // Landmark data never reaches icon HTML — the name is applied as an attribute on the real element instead.
    expect(falls!.getAttribute("data-icon-html")).not.toContain("Open Falls");
    expect(falls!.getAttribute("data-icon-html")).toContain('aria-hidden="true"');
  });

  it("wires keyboard (keydown) and popupclose handlers onto each Marker", () => {
    renderWithRouter(<LandmarkMarkersRenderer markers={[markers[0]!]} />);
    const marker = screen.getByTestId("marker");
    expect(marker).toHaveAttribute("data-has-keydown", "true");
    expect(marker).toHaveAttribute("data-has-popupclose", "true");
  });

  it("shows only the approved name, category label, and a working profile link in each popup", () => {
    renderWithRouter(<LandmarkMarkersRenderer markers={[markers[0]!]} />);

    expect(screen.getByText("Open Falls")).toBeInTheDocument();
    expect(screen.getByText("Waterfall")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /view profile/i });
    expect(link).toHaveAttribute("href", "/landmarks/a");
  });

  it("wraps popup content in a programmatically focusable group named for the landmark", () => {
    renderWithRouter(<LandmarkMarkersRenderer markers={[markers[0]!]} />);
    const group = screen.getByRole("group", { name: "Open Falls details" });
    expect(group).toHaveAttribute("tabindex", "-1");
  });

  it("renders nothing for an empty marker list", () => {
    renderWithRouter(<LandmarkMarkersRenderer markers={[]} />);
    expect(screen.queryByTestId("marker")).not.toBeInTheDocument();
  });

  it("shows the straight-line distance, clearly labeled, only when distance_miles is present (proximity mode)", () => {
    renderWithRouter(
      <LandmarkMarkersRenderer markers={[{ ...markers[0]!, distance_miles: 3.456 }]} />,
    );
    expect(screen.getByText(/3\.5 mi \(straight-line distance\)/i)).toBeInTheDocument();
  });

  it("shows no distance text when distance_miles is absent (bbox mode)", () => {
    renderWithRouter(<LandmarkMarkersRenderer markers={[markers[0]!]} />);
    expect(screen.queryByText(/straight-line/i)).not.toBeInTheDocument();
  });

  it("marks the profile link with fromDiscovery navigation state, so the profile page can return via navigate(-1)", async () => {
    function LocationProbe() {
      const location = useLocation();
      const state = location.state as { fromDiscovery?: boolean } | null;
      return <div>fromDiscovery: {String(Boolean(state?.fromDiscovery))}</div>;
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<LandmarkMarkersRenderer markers={[markers[0]!]} />} />
          <Route path="/landmarks/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("link", { name: /view profile/i }));

    expect(await screen.findByText("fromDiscovery: true")).toBeInTheDocument();
  });
});
