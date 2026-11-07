import { fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapContainer } from "react-leaflet";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { LandmarkMarkersRenderer } from "./LandmarkMarkersRenderer";
import type { LandmarkMarker } from "./useMapMarkers";

/**
 * M02-T08 Increment 5c — Shift+Tab from the popup's backward boundary returns
 * focus to the marker that opened it, against REAL Leaflet + react-leaflet in
 * jsdom (nothing mocked). user-event moves focus for Tab/Shift+Tab in DOM
 * order only when the keydown was NOT default-prevented, so these tests
 * exercise exactly the interception boundary: where the handler prevents the
 * default, focus goes to the marker; everywhere else the natural order holds.
 *
 * The MIDDLE marker's popup is opened so both a previous and a next marker
 * exist, making "natural backward/forward from the marker" observable.
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

async function renderWithOpenPopup() {
  const utils = render(
    <MemoryRouter>
      <MapContainer center={[35.2, -85.2]} zoom={10} style={{ height: 400, width: 400 }}>
        <LandmarkMarkersRenderer markers={[a, b, c]} />
      </MapContainer>
    </MemoryRouter>,
  );
  const mapContainer = utils.container.querySelector(".leaflet-container") as HTMLElement;
  const icons = () =>
    Array.from(mapContainer.querySelectorAll<HTMLElement>(".leaflet-marker-icon"));
  const iconFor = (m: LandmarkMarker) =>
    icons().find((el) => el.getAttribute("aria-label")?.startsWith(m.display_name))!;
  const popup = () => mapContainer.querySelector<HTMLElement>(".leaflet-popup");

  const origin = iconFor(b);
  origin.focus();
  pressEnter(origin);
  const group = await within(popup()!).findByRole("group", { name: "Bravo Peak details" });
  await waitFor(() => expect(document.activeElement).toBe(group));
  const link = within(popup()!).getByRole("link", { name: /view profile/i });
  const closeButton = within(popup()!).getByRole("button", { name: /close popup/i });
  return {
    user: userEvent.setup(),
    mapContainer,
    iconFor,
    popup,
    origin,
    group,
    link,
    closeButton,
  };
}

describe("LandmarkMarkersRenderer — Shift+Tab from the popup's backward boundary (real Leaflet, 5c)", () => {
  it("from the content group (focused on open): Shift+Tab returns to the originating marker and keeps the popup open", async () => {
    const { user, origin, popup } = await renderWithOpenPopup();

    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(document.activeElement).toBe(origin);
    expect(popup()).not.toBeNull();
  });

  it("from the profile link (the popup's first Tab stop): Shift+Tab returns to the originating marker and keeps the popup open", async () => {
    const { user, origin, link, popup } = await renderWithOpenPopup();
    link.focus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(document.activeElement).toBe(origin);
    expect(popup()).not.toBeNull();
  });

  it("from the close button: Shift+Tab still reaches the profile link (normal order inside the popup is untouched)", async () => {
    const { user, link, closeButton, popup } = await renderWithOpenPopup();
    closeButton.focus();

    await user.keyboard("{Shift>}{Tab}{/Shift}");

    expect(document.activeElement).toBe(link);
    expect(popup()).not.toBeNull();
  });

  it("after returning to the marker: Shift+Tab goes to the PREVIOUS marker, Tab goes to the NEXT marker (natural order, no trap)", async () => {
    const { user, origin, iconFor, popup } = await renderWithOpenPopup();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(origin);

    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(iconFor(a));

    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(origin);
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(iconFor(c));
    expect(popup()).not.toBeNull(); // tabbing away never closes it
  });

  it("after returning to the marker: Escape closes the popup and focus stays on the marker", async () => {
    const { user, origin, popup } = await renderWithOpenPopup();
    await user.keyboard("{Shift>}{Tab}{/Shift}");
    expect(document.activeElement).toBe(origin);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(popup()).toBeNull());
    expect(document.activeElement).toBe(origin);
  });

  it("forward Tab is never intercepted: group → profile link → close button → out of the popup", async () => {
    const { user, link, closeButton, popup } = await renderWithOpenPopup();

    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(link);
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(closeButton);
    await user.keyboard("{Tab}");
    expect(popup()!.contains(document.activeElement)).toBe(false);
    expect(popup()).not.toBeNull();
  });

  it("Escape from inside the popup still closes it and returns focus to the marker (unchanged)", async () => {
    const { user, origin, link, popup } = await renderWithOpenPopup();
    link.focus();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(popup()).toBeNull());
    expect(document.activeElement).toBe(origin);
  });

  it("does not intercept other Shift-modified keys or a Shift+Tab with another modifier held", async () => {
    const { group, origin } = await renderWithOpenPopup();

    const shiftArrow = fireEvent.keyDown(group, { key: "ArrowLeft", shiftKey: true });
    const ctrlShiftTab = fireEvent.keyDown(group, { key: "Tab", shiftKey: true, ctrlKey: true });

    // fireEvent returns false when preventDefault() was called.
    expect(shiftArrow).toBe(true);
    expect(ctrlShiftTab).toBe(true);
    expect(document.activeElement).toBe(group);
    expect(document.activeElement).not.toBe(origin);
  });
});
