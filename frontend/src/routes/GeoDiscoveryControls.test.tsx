import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { GeoDiscoveryControls } from "./GeoDiscoveryControls";
import type { GeographicDiscoveryControls } from "./useGeographicDiscovery";

const DEFAULT_BBOX = { minLng: -90.3, minLat: 34.8, maxLng: -81.6, maxLat: 36.7 };

function baseControls(
  overrides: Partial<GeographicDiscoveryControls> = {},
): GeographicDiscoveryControls {
  return {
    effectiveGeo: { mode: "bbox", bbox: DEFAULT_BBOX },
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

describe("GeoDiscoveryControls", () => {
  it("exposes its wrapper as a named group (role=group + aria-label), containing the proximity controls (M02-T08 5b ARIA correction)", () => {
    render(<GeoDiscoveryControls controls={baseControls()} />);

    const group = screen.getByRole("group", { name: "Geographic discovery controls" });
    expect(group).toContainElement(screen.getByRole("button", { name: /find near map center/i }));
    expect(group).toContainElement(screen.getByRole("button", { name: /^near me$/i }));
  });

  it("hides 'Search this area' when there is no pending change", () => {
    render(<GeoDiscoveryControls controls={baseControls()} />);
    expect(screen.queryByRole("button", { name: /search this area/i })).not.toBeInTheDocument();
  });

  it("shows 'Search this area' once the map has panned away from the committed bounds, and wires it up", async () => {
    const onSearchThisArea = vi.fn();
    render(
      <GeoDiscoveryControls
        controls={baseControls({ hasPendingAreaChange: true, onSearchThisArea })}
      />,
    );

    const button = screen.getByRole("button", { name: /search this area/i });
    await userEvent.click(button);
    expect(onSearchThisArea).toHaveBeenCalledOnce();
  });

  it("always shows Find near map center and Near me, in both bbox and near mode", () => {
    const { rerender } = render(<GeoDiscoveryControls controls={baseControls()} />);
    expect(screen.getByRole("button", { name: /find near map center/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^near me$/i })).toBeInTheDocument();

    rerender(
      <GeoDiscoveryControls
        controls={baseControls({
          effectiveGeo: { mode: "near", near: { lat: 35, lng: -85 }, radius: 25 },
        })}
      />,
    );
    expect(screen.getByRole("button", { name: /find near map center/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^near me$/i })).toBeInTheDocument();
  });

  it("calls onFindNearMapCenter and onNearMe when clicked", async () => {
    const onFindNearMapCenter = vi.fn();
    const onNearMe = vi.fn();
    render(<GeoDiscoveryControls controls={baseControls({ onFindNearMapCenter, onNearMe })} />);

    await userEvent.click(screen.getByRole("button", { name: /find near map center/i }));
    expect(onFindNearMapCenter).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: /^near me$/i }));
    expect(onNearMe).toHaveBeenCalledOnce();
  });

  it("disables Near me and shows a pending label while geolocation is in progress", () => {
    render(<GeoDiscoveryControls controls={baseControls({ geolocationPending: true })} />);
    expect(screen.getByRole("button", { name: /finding your location/i })).toBeDisabled();
  });

  it("shows a geolocation error as an alert when present", () => {
    render(
      <GeoDiscoveryControls
        controls={baseControls({ geolocationError: "Location access was denied." })}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Location access was denied.");
  });

  it("shows the radius selector with exactly the five allowed values, and the exit-proximity action, only in near mode", () => {
    render(<GeoDiscoveryControls controls={baseControls()} />);
    expect(screen.queryByLabelText(/radius/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /back to area search/i })).not.toBeInTheDocument();

    render(
      <GeoDiscoveryControls
        controls={baseControls({
          effectiveGeo: { mode: "near", near: { lat: 35, lng: -85 }, radius: 25 },
        })}
      />,
    );
    const select = screen.getByLabelText(/radius/i);
    const options = Array.from(select.querySelectorAll("option")).map((o) =>
      o.getAttribute("value"),
    );
    expect(options).toEqual(["5", "10", "25", "50", "100"]);
    expect(screen.getByRole("button", { name: /back to area search/i })).toBeInTheDocument();
  });

  it("calls onRadiusChange with a number when a new radius is selected", async () => {
    const onRadiusChange = vi.fn();
    render(
      <GeoDiscoveryControls
        controls={baseControls({
          effectiveGeo: { mode: "near", near: { lat: 35, lng: -85 }, radius: 25 },
          onRadiusChange,
        })}
      />,
    );

    await userEvent.selectOptions(screen.getByLabelText(/radius/i), "50");
    expect(onRadiusChange).toHaveBeenCalledWith(50);
  });

  it("calls onExitProximity when 'Back to area search' is clicked", async () => {
    const onExitProximity = vi.fn();
    render(
      <GeoDiscoveryControls
        controls={baseControls({
          effectiveGeo: { mode: "near", near: { lat: 35, lng: -85 }, radius: 25 },
          onExitProximity,
        })}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /back to area search/i }));
    expect(onExitProximity).toHaveBeenCalledOnce();
  });

  it("labels the origin as 'your location' for a device origin, and 'the map center you chose' otherwise", () => {
    const { rerender } = render(
      <GeoDiscoveryControls
        controls={baseControls({
          effectiveGeo: { mode: "near", near: { lat: 35, lng: -85 }, radius: 25 },
          isDeviceOrigin: true,
        })}
      />,
    );
    expect(screen.getByText(/your location/i)).toBeInTheDocument();

    rerender(
      <GeoDiscoveryControls
        controls={baseControls({
          effectiveGeo: { mode: "near", near: { lat: 35, lng: -85 }, radius: 25 },
          isDeviceOrigin: false,
        })}
      />,
    );
    expect(screen.getByText(/the map center you chose/i)).toBeInTheDocument();
  });
});
