import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LandmarkMap } from "./LandmarkMap";

/**
 * M02-T08 Increment 5d — `describedById` against REAL react-leaflet/Leaflet in
 * jsdom: the attribute must land on Leaflet's own focusable container element
 * (which react-leaflet creates and does not accept arbitrary attributes for),
 * not on the wrapper, and must be removed when the prop goes away.
 */
describe("LandmarkMap — accessible description on the focusable Leaflet container (real Leaflet)", () => {
  it("applies aria-describedby to the Leaflet container itself, keeping the wrapper's region name unchanged", () => {
    const { container } = render(
      <LandmarkMap
        initialViewport={{ center: [35.75, -85.95], zoom: 7 }}
        describedById="map-keyboard-help"
      />,
    );

    const leafletContainer = container.querySelector(".leaflet-container")!;
    expect(leafletContainer).toHaveAttribute("aria-describedby", "map-keyboard-help");
    expect(leafletContainer).toHaveAttribute("tabindex", "0"); // Leaflet's keyboard handler made it focusable
    const region = container.querySelector('[role="region"]')!;
    expect(region).toHaveAttribute("aria-label", "Map of Tennessee natural landmarks");
    expect(region).not.toHaveAttribute("aria-describedby");
  });

  it("sets no aria-describedby when no describedById is given", () => {
    const { container } = render(
      <LandmarkMap initialViewport={{ center: [35.75, -85.95], zoom: 7 }} />,
    );
    expect(container.querySelector(".leaflet-container")).not.toHaveAttribute("aria-describedby");
  });

  it("removes the attribute when the prop is withdrawn", () => {
    const { container, rerender } = render(
      <LandmarkMap
        initialViewport={{ center: [35.75, -85.95], zoom: 7 }}
        describedById="map-keyboard-help"
      />,
    );
    rerender(<LandmarkMap initialViewport={{ center: [35.75, -85.95], zoom: 7 }} />);
    expect(container.querySelector(".leaflet-container")).not.toHaveAttribute("aria-describedby");
  });
});
