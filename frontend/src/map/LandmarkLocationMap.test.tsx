import { render, screen } from "@testing-library/react";
import type { CircleMarkerProps, MapContainerProps, TileLayerProps } from "react-leaflet";
import { describe, expect, it, vi } from "vitest";

vi.mock("react-leaflet", () => ({
  MapContainer: (props: MapContainerProps) => (
    <div
      data-testid="map-container"
      data-center={JSON.stringify(props.center)}
      data-zoom={props.zoom}
      className={props.className}
    >
      {props.children}
    </div>
  ),
  TileLayer: (props: TileLayerProps) => (
    <div data-testid="tile-layer" data-url={props.url} data-attribution={props.attribution} />
  ),
  CircleMarker: (props: CircleMarkerProps) => (
    <div data-testid="circle-marker" data-center={JSON.stringify(props.center)} />
  ),
}));

const { LandmarkLocationMap } = await import("./LandmarkLocationMap");

describe("LandmarkLocationMap", () => {
  it("centers the map and marker on the given coordinates, at a fixed single-point zoom", () => {
    render(<LandmarkLocationMap latitude={36.2} longitude={-84.1} category="arch" displayName="Public Arch" />);

    const map = screen.getByTestId("map-container");
    expect(map).toHaveAttribute("data-center", JSON.stringify([36.2, -84.1]));
    expect(map).toHaveAttribute("data-zoom", "13");
    expect(screen.getByTestId("circle-marker")).toHaveAttribute("data-center", JSON.stringify([36.2, -84.1]));
  });

  it("exposes an accessible, landmark-specific region name", () => {
    render(<LandmarkLocationMap latitude={36.2} longitude={-84.1} category="arch" displayName="Public Arch" />);

    expect(screen.getByRole("region", { name: /map showing the location of public arch/i })).toBeInTheDocument();
  });
});
