import { fireEvent, render, waitFor, within } from "@testing-library/react";
import { MapContainer } from "react-leaflet";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { LandmarkMarkersRenderer } from "./LandmarkMarkersRenderer";
import type { LandmarkMarker } from "./useMapMarkers";

/**
 * M02-T08 Increment 5a — `onFocusLost`, against REAL Leaflet + react-leaflet
 * in jsdom (nothing mocked). Covers: a focused marker removed (populated and
 * empty replacements), focus inside the removed marker's open popup (content
 * group and profile link), the no-steal cases (focus on a surviving marker,
 * on a control outside the map, or on a marker that survives), and — the
 * case that matters most — that a focus move made by the callback actually
 * STICKS through React's end-of-commit focus restoration and Leaflet's later
 * removal of the icon.
 */

const a: LandmarkMarker = {
  id: "a",
  display_name: "Alpha Falls",
  category: "falls",
  latitude: 35.1,
  longitude: -85.1,
};
const b: LandmarkMarker = {
  id: "b",
  display_name: "Bravo Peak",
  category: "peak",
  latitude: 35.2,
  longitude: -85.2,
};
const c: LandmarkMarker = {
  id: "c",
  display_name: "Charlie Arch",
  category: "arch",
  latitude: 35.3,
  longitude: -85.3,
};

function pressEnter(element: HTMLElement) {
  fireEvent.keyPress(element, { key: "Enter", code: "Enter", keyCode: 13, charCode: 13 });
}

function renderOnRealMap(markers: LandmarkMarker[], onFocusLost: () => void = vi.fn()) {
  const ui = (list: LandmarkMarker[]) => (
    <MemoryRouter>
      <button type="button">Outside the map</button>
      <h3 tabIndex={-1}>Fallback heading</h3>
      <MapContainer center={[35.15, -85.15]} zoom={10} style={{ height: 400, width: 400 }}>
        <LandmarkMarkersRenderer markers={list} onFocusLost={onFocusLost} />
      </MapContainer>
    </MemoryRouter>
  );
  const utils = render(ui(markers));
  const mapContainer = utils.container.querySelector(".leaflet-container") as HTMLElement;
  const icons = () =>
    Array.from(mapContainer.querySelectorAll<HTMLElement>(".leaflet-marker-icon"));
  const iconFor = (marker: LandmarkMarker) =>
    icons().find((el) => el.getAttribute("aria-label")?.startsWith(marker.display_name))!;
  const openPopup = () => mapContainer.querySelector<HTMLElement>(".leaflet-popup");
  const outsideButton = utils.getByRole("button", { name: "Outside the map" });
  const fallbackHeading = utils.getByRole("heading", { name: "Fallback heading" });
  const update = (list: LandmarkMarker[]) => utils.rerender(ui(list));
  return { onFocusLost, icons, iconFor, openPopup, outsideButton, fallbackHeading, update };
}

describe("LandmarkMarkersRenderer — onFocusLost when a focused marker is removed (real Leaflet)", () => {
  it("fires once when the focused marker is removed and the replacement set is populated", async () => {
    const { onFocusLost, iconFor, icons, update } = renderOnRealMap([a, b, c]);
    iconFor(a).focus();
    expect(document.activeElement).toBe(iconFor(a));

    update([b, c]);

    await waitFor(() => expect(icons()).toHaveLength(2));
    expect(onFocusLost).toHaveBeenCalledTimes(1);
  });

  it("fires once when the focused marker is removed and the replacement set is empty", async () => {
    const { onFocusLost, iconFor, icons, update } = renderOnRealMap([a, b]);
    iconFor(a).focus();

    update([]);

    await waitFor(() => expect(icons()).toHaveLength(0));
    expect(onFocusLost).toHaveBeenCalledTimes(1);
  });

  it("fires once (not once per marker) when several markers including the focused one are removed", async () => {
    const { onFocusLost, iconFor, icons, update } = renderOnRealMap([a, b, c]);
    iconFor(b).focus();

    update([]);

    await waitFor(() => expect(icons()).toHaveLength(0));
    expect(onFocusLost).toHaveBeenCalledTimes(1);
  });

  it("fires when focus is inside the removed marker's open popup (the content group)", async () => {
    const { onFocusLost, iconFor, icons, openPopup, update } = renderOnRealMap([a, b]);
    const icon = iconFor(a);
    icon.focus();
    pressEnter(icon);
    const group = await within(openPopup()!).findByRole("group", { name: "Alpha Falls details" });
    await waitFor(() => expect(document.activeElement).toBe(group));

    update([b]);

    await waitFor(() => expect(icons()).toHaveLength(1));
    expect(openPopup()).toBeNull();
    expect(onFocusLost).toHaveBeenCalledTimes(1);
  });

  it("fires when focus is on the profile link inside the removed marker's open popup", async () => {
    const { onFocusLost, iconFor, icons, openPopup, update } = renderOnRealMap([a, b]);
    const icon = iconFor(a);
    icon.focus();
    pressEnter(icon);
    const link = await within(openPopup()!).findByRole("link", { name: /view profile/i });
    link.focus();
    expect(document.activeElement).toBe(link);

    update([b]);

    await waitFor(() => expect(icons()).toHaveLength(1));
    expect(onFocusLost).toHaveBeenCalledTimes(1);
  });

  it("a focus move made by onFocusLost STICKS when the focused icon is removed (React's commit-time focus restore does not undo it)", async () => {
    const { iconFor, icons, fallbackHeading, update } = renderOnRealMap([a, b], () =>
      fallbackHeading.focus(),
    );
    iconFor(a).focus();

    update([b]);

    await waitFor(() => expect(icons()).toHaveLength(1));
    expect(document.activeElement).toBe(fallbackHeading);
    expect(iconFor(b)).toBeDefined();
  });

  it("a focus move made by onFocusLost STICKS when focus was inside the removed marker's popup", async () => {
    const { iconFor, icons, openPopup, fallbackHeading, update } = renderOnRealMap([a, b], () =>
      fallbackHeading.focus(),
    );
    const icon = iconFor(a);
    icon.focus();
    pressEnter(icon);
    const group = await within(openPopup()!).findByRole("group", { name: "Alpha Falls details" });
    await waitFor(() => expect(document.activeElement).toBe(group));

    update([b]);

    await waitFor(() => expect(icons()).toHaveLength(1));
    expect(document.activeElement).toBe(fallbackHeading);
  });

  it("a focus move made by onFocusLost STICKS when the replacement set is empty", async () => {
    const { iconFor, icons, fallbackHeading, update } = renderOnRealMap([a], () =>
      fallbackHeading.focus(),
    );
    iconFor(a).focus();

    update([]);

    await waitFor(() => expect(icons()).toHaveLength(0));
    expect(document.activeElement).toBe(fallbackHeading);
  });

  it("does not fire when the removed marker was not the focused one (focus on a surviving marker)", async () => {
    const { onFocusLost, iconFor, icons, update } = renderOnRealMap([a, b]);
    iconFor(b).focus();

    update([b]);

    await waitFor(() => expect(icons()).toHaveLength(1));
    expect(onFocusLost).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(iconFor(b));
  });

  it("does not fire when the user has already moved focus to a control outside the map", async () => {
    const { onFocusLost, iconFor, icons, outsideButton, update } = renderOnRealMap([a, b]);
    iconFor(a).focus();
    outsideButton.focus();
    expect(document.activeElement).toBe(outsideButton);

    update([b]);

    await waitFor(() => expect(icons()).toHaveLength(1));
    expect(onFocusLost).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(outsideButton);
  });

  it("does not fire when the focused marker survives the update (keyed by id)", async () => {
    const { onFocusLost, iconFor, icons, update } = renderOnRealMap([a, b]);
    const icon = iconFor(b);
    icon.focus();

    update([b, c]);

    await waitFor(() => expect(icons()).toHaveLength(2));
    expect(onFocusLost).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(icon);
    expect(icon.isConnected).toBe(true);
  });

  it("does not fire when the focused marker's popup is open and the marker survives", async () => {
    const { onFocusLost, iconFor, icons, openPopup, update } = renderOnRealMap([a, b]);
    const icon = iconFor(a);
    icon.focus();
    pressEnter(icon);
    const group = await within(openPopup()!).findByRole("group", { name: "Alpha Falls details" });
    await waitFor(() => expect(document.activeElement).toBe(group));

    update([a]);

    await waitFor(() => expect(icons()).toHaveLength(1));
    expect(onFocusLost).not.toHaveBeenCalled();
  });

  it("is optional: removing a focused marker without onFocusLost neither throws nor steals focus", async () => {
    const ui = (list: LandmarkMarker[]) => (
      <MemoryRouter>
        <MapContainer center={[35.15, -85.15]} zoom={10}>
          <LandmarkMarkersRenderer markers={list} />
        </MapContainer>
      </MemoryRouter>
    );
    const utils = render(ui([a]));
    utils.container.querySelector<HTMLElement>(".leaflet-marker-icon")!.focus();
    expect(() => utils.rerender(ui([]))).not.toThrow();
    await waitFor(() =>
      expect(utils.container.querySelectorAll(".leaflet-marker-icon")).toHaveLength(0),
    );
  });
});
