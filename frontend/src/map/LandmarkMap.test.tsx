import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { MapContainerProps, TileLayerProps } from "react-leaflet";
import { describe, expect, it, vi } from "vitest";
import { TEMPORARY_DEV_TILE_ATTRIBUTION, TEMPORARY_DEV_TILE_URL, TENNESSEE_BOUNDS } from "./tile-config";
import { LandmarkMap } from "./LandmarkMap";

// react-leaflet's real MapContainer/TileLayer need actual DOM layout
// (getBoundingClientRect, etc.) that jsdom doesn't provide — mocked here to
// assert the props this component passes, per the project's testing
// approach for map components (see M02-T02 planning).
vi.mock("react-leaflet", () => ({
  MapContainer: (props: MapContainerProps) => (
    <div
      data-testid="map-container"
      data-bounds={JSON.stringify(props.bounds)}
      data-center={JSON.stringify(props.center)}
      data-zoom={String(props.zoom)}
      data-scroll-wheel-zoom={String(props.scrollWheelZoom)}
      className={props.className}
    >
      {props.children}
    </div>
  ),
  TileLayer: (props: TileLayerProps) => (
    <div data-testid="tile-layer" data-url={props.url} data-attribution={props.attribution}>
      <button type="button" onClick={() => props.eventHandlers?.tileerror?.(null as never)}>
        simulate tile error
      </button>
    </div>
  ),
}));

describe("LandmarkMap", () => {
  it("configures the map with the Tennessee bounds, disabled scroll-wheel zoom, and the temporary tile source", () => {
    render(<LandmarkMap />);

    const mapContainer = screen.getByTestId("map-container");
    expect(mapContainer).toHaveAttribute("data-bounds", JSON.stringify(TENNESSEE_BOUNDS));
    expect(mapContainer).toHaveAttribute("data-scroll-wheel-zoom", "false");

    const tileLayer = screen.getByTestId("tile-layer");
    expect(tileLayer).toHaveAttribute("data-url", TEMPORARY_DEV_TILE_URL);
    expect(tileLayer).toHaveAttribute("data-attribution", TEMPORARY_DEV_TILE_ATTRIBUTION);
  });

  it("exposes an accessible region name for the map, without an application role", () => {
    render(<LandmarkMap />);

    expect(screen.getByRole("region", { name: /map of tennessee natural landmarks/i })).toBeInTheDocument();
    expect(screen.queryByRole("application")).not.toBeInTheDocument();
  });

  it("shows a nonblocking status message only after enough tile errors, and never an alert", async () => {
    render(<LandmarkMap />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: /simulate tile error/i });
    await userEvent.click(trigger);
    await userEvent.click(trigger);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    await userEvent.click(trigger);
    expect(screen.getByRole("status")).toHaveTextContent(/having trouble loading/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("uses a restored viewport's center/zoom instead of the Tennessee bounds fit, when one is provided (M02-T07)", () => {
    render(<LandmarkMap initialViewport={{ center: [35.9, -85.1], zoom: 9 }} />);

    const mapContainer = screen.getByTestId("map-container");
    expect(mapContainer).toHaveAttribute("data-center", JSON.stringify([35.9, -85.1]));
    expect(mapContainer).toHaveAttribute("data-zoom", "9");
    expect(mapContainer).not.toHaveAttribute("data-bounds", JSON.stringify(TENNESSEE_BOUNDS));
  });

  it("shows a decorative, non-interactive center crosshair only when requested", () => {
    const { rerender } = render(<LandmarkMap />);
    expect(document.querySelector('[aria-hidden="true"]')).not.toBeInTheDocument();

    rerender(<LandmarkMap showCenterCrosshair />);
    const crosshair = document.querySelector('[aria-hidden="true"]');
    expect(crosshair).toBeInTheDocument();
  });
});
