import { fireEvent, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MapContainer } from "react-leaflet";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { LandmarkMarkersRenderer } from "./LandmarkMarkersRenderer";
import type { LandmarkMarker } from "./useMapMarkers";

/**
 * REAL Leaflet + REAL react-leaflet in jsdom (M02-T08 Increment 3) — unlike
 * the project's other map tests, nothing here is mocked. jsdom gives Leaflet
 * a zero-size container and no real layout, which is enough to exercise the
 * DOM Leaflet actually produces (the focusable icon element, its attributes,
 * popup open/close, z-index) and the keyboard/focus wiring on top of it.
 * What jsdom cannot prove — real pixel positions, visible focus rings, the
 * browser's own Enter-keypress behavior — is covered by real-browser
 * verification recorded in the implementation plan.
 *
 * Enter: Leaflet opens a marker's popup from a `keypress` whose
 * `keyCode === 13`. Real browsers set `keyCode` on that event; user-event's
 * synthetic keypress sets only `charCode`, so Enter is dispatched here with
 * `fireEvent.keyPress` carrying the browser-accurate `keyCode`. Space (a
 * `keydown` handled by this project's own code) and Escape use user-event.
 */

const openFalls: LandmarkMarker = {
  id: "a",
  display_name: "Open Falls",
  category: "falls",
  latitude: 35.1,
  longitude: -85.1,
};
const openPeak: LandmarkMarker = {
  id: "b",
  display_name: "Open Peak",
  category: "peak",
  latitude: 35.2,
  longitude: -85.2,
};

function pressEnter(element: HTMLElement) {
  fireEvent.keyPress(element, { key: "Enter", code: "Enter", keyCode: 13, charCode: 13 });
}

function renderOnRealMap(markers: LandmarkMarker[]) {
  const ui = (list: LandmarkMarker[]) => (
    <MemoryRouter>
      <MapContainer center={[35.15, -85.15]} zoom={10} style={{ height: 400, width: 400 }}>
        <LandmarkMarkersRenderer markers={list} />
      </MapContainer>
    </MemoryRouter>
  );
  const utils = render(ui(markers));
  const mapContainer = utils.container.querySelector(".leaflet-container") as HTMLElement;
  const markerElements = () =>
    Array.from(mapContainer.querySelectorAll<HTMLElement>(".leaflet-marker-icon"));
  const openPopup = () => mapContainer.querySelector<HTMLElement>(".leaflet-popup");
  const rerenderWith = (list: LandmarkMarker[]) => utils.rerender(ui(list));
  return { mapContainer, markerElements, openPopup, rerenderWith };
}

describe("LandmarkMarkersRenderer on a real Leaflet map (jsdom)", () => {
  it("renders each marker as Leaflet's own focusable button element with the accessible name on that element", () => {
    const { markerElements } = renderOnRealMap([openFalls, openPeak]);

    const icons = markerElements();
    expect(icons).toHaveLength(2);
    for (const icon of icons) {
      // Set by Leaflet itself (Marker option `keyboard: true`).
      expect(icon).toHaveAttribute("tabindex", "0");
      expect(icon).toHaveAttribute("role", "button");
    }
    // Set by this increment on the SAME element Leaflet made focusable — not on nested icon HTML.
    expect(icons[0]).toHaveAttribute("aria-label", "Open Falls, Waterfall");
    expect(icons[1]).toHaveAttribute("aria-label", "Open Peak, Mountain Peak");
    // The visible dot inside is decorative; the name lives on the focusable parent.
    expect(icons[0]!.querySelector("span")).toHaveAttribute("aria-hidden", "true");
    expect(icons[0]!.textContent).toBe("");
  });

  it("includes the straight-line distance in the accessible name in proximity mode", () => {
    const { markerElements } = renderOnRealMap([{ ...openFalls, distance_miles: 3.456 }]);
    expect(markerElements()[0]).toHaveAttribute(
      "aria-label",
      "Open Falls, Waterfall, approx. 3.5 mi straight-line distance",
    );
  });

  it("uses an enlarged 24px hit/focus area around the 16px dot, with the icon anchored at its centre", () => {
    const { markerElements } = renderOnRealMap([openFalls]);
    const icon = markerElements()[0]!;
    expect(icon.style.width).toBe("24px");
    expect(icon.style.height).toBe("24px");
    expect(icon.style.marginLeft).toBe("-12px");
    expect(icon.style.marginTop).toBe("-12px");
  });

  it("Enter opens the popup, moves focus into its content, and the profile link is reachable inside it", async () => {
    const { markerElements, openPopup } = renderOnRealMap([openFalls]);
    const icon = markerElements()[0]!;

    icon.focus();
    expect(document.activeElement).toBe(icon);
    pressEnter(icon);

    const popup = openPopup();
    expect(popup).not.toBeNull();
    const content = await within(popup!).findByRole("group", { name: "Open Falls details" });
    await waitFor(() => expect(document.activeElement).toBe(content));
    const link = within(popup!).getByRole("link", { name: /view profile/i });
    expect(link).toHaveAttribute("href", "/landmarks/a");
    expect(within(popup!).getByText("Waterfall")).toBeInTheDocument();
  });

  it("Space toggles the popup and prevents the page-scroll default", async () => {
    const user = userEvent.setup();
    const { markerElements, openPopup } = renderOnRealMap([openFalls]);
    const icon = markerElements()[0]!;

    let scrollDefaultPrevented: boolean | undefined;
    document.addEventListener(
      "keydown",
      (event) => {
        if (event.key === " ") scrollDefaultPrevented = event.defaultPrevented;
      },
      { once: true },
    );

    icon.focus();
    await user.keyboard(" ");
    expect(openPopup()).not.toBeNull();
    expect(scrollDefaultPrevented).toBe(true);

    icon.focus();
    await user.keyboard(" ");
    await waitFor(() => expect(openPopup()).toBeNull());
  });

  it("Escape inside the popup closes it and returns focus to the originating marker", async () => {
    const user = userEvent.setup();
    const { markerElements, openPopup } = renderOnRealMap([openFalls, openPeak]);
    const peak = markerElements()[1]!;

    peak.focus();
    pressEnter(peak);
    const content = await within(openPopup()!).findByRole("group", { name: "Open Peak details" });
    await waitFor(() => expect(document.activeElement).toBe(content));

    await user.keyboard("{Escape}");

    await waitFor(() => expect(openPopup()).toBeNull());
    expect(document.activeElement).toBe(peak);
  });

  it("Escape on the focused marker itself closes its open popup", async () => {
    const user = userEvent.setup();
    const { markerElements, openPopup } = renderOnRealMap([openFalls]);
    const icon = markerElements()[0]!;

    icon.focus();
    await user.keyboard(" ");
    expect(openPopup()).not.toBeNull();

    icon.focus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(openPopup()).toBeNull());
    expect(document.activeElement).toBe(icon);
  });

  it("activating the popup's own close button returns focus to the marker instead of stranding it on <body>", async () => {
    const user = userEvent.setup();
    const { markerElements, openPopup } = renderOnRealMap([openFalls]);
    const icon = markerElements()[0]!;

    icon.focus();
    pressEnter(icon);
    const closeButton = within(openPopup()!).getByRole("button", { name: /close popup/i });
    closeButton.focus();
    // Leaflet's close control is an <a href>; Enter on it is a click, which Leaflet handles by closing.
    await user.keyboard("{Enter}");

    await waitFor(() => expect(openPopup()).toBeNull());
    expect(document.activeElement).toBe(icon);
  });

  it("Escape on a different, focused marker closes the map's open popup without moving focus away from that marker", async () => {
    const user = userEvent.setup();
    const { markerElements, openPopup } = renderOnRealMap([openFalls, openPeak]);
    const [falls, peak] = markerElements() as [HTMLElement, HTMLElement];

    falls.focus();
    pressEnter(falls);
    await within(openPopup()!).findByRole("group", { name: "Open Falls details" });

    peak.focus(); // Tab-style move to another marker while Falls' popup stays open
    await user.keyboard("{Escape}");

    await waitFor(() => expect(openPopup()).toBeNull());
    expect(document.activeElement).toBe(peak);
  });

  it("Escape while Leaflet's own close button (outside the content node) has focus closes the popup and returns focus to the marker", async () => {
    const user = userEvent.setup();
    const { markerElements, openPopup } = renderOnRealMap([openFalls]);
    const icon = markerElements()[0]!;

    icon.focus();
    pressEnter(icon);
    const closeButton = within(openPopup()!).getByRole("button", { name: /close popup/i });
    closeButton.focus();
    expect(document.activeElement).toBe(closeButton);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(openPopup()).toBeNull());
    expect(document.activeElement).toBe(icon);
  });

  it("does not steal focus when the popup closes because the user moved to another marker", async () => {
    const { markerElements, openPopup } = renderOnRealMap([openFalls, openPeak]);
    const [falls, peak] = markerElements() as [HTMLElement, HTMLElement];

    falls.focus();
    pressEnter(falls);
    await within(openPopup()!).findByRole("group", { name: "Open Falls details" });

    // Opening the second marker's popup auto-closes the first (Leaflet `autoClose`).
    peak.focus();
    pressEnter(peak);
    const peakContent = await within(openPopup()!).findByRole("group", {
      name: "Open Peak details",
    });

    // Focus belongs to the Peak flow now; the Falls `popupclose` must not pull it back.
    await waitFor(() => expect(document.activeElement).toBe(peakContent));
  });

  it("re-focuses popup content on a second open of the same popup (react-leaflet keeps the content mounted between opens)", async () => {
    const user = userEvent.setup();
    const { markerElements, openPopup } = renderOnRealMap([openFalls]);
    const icon = markerElements()[0]!;

    icon.focus();
    pressEnter(icon);
    const first = await within(openPopup()!).findByRole("group", { name: "Open Falls details" });
    await waitFor(() => expect(document.activeElement).toBe(first));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(openPopup()).toBeNull());
    expect(document.activeElement).toBe(icon);

    pressEnter(icon);
    const second = await within(openPopup()!).findByRole("group", { name: "Open Falls details" });
    await waitFor(() => expect(document.activeElement).toBe(second));
  });

  it("raises a focused marker above an overlapping neighbour via z-index and restores normal stacking on blur", () => {
    // Two markers at the SAME coordinates share the same base z-index (Leaflet derives it from
    // the icon's y position). Leaflet's `autoPanOnFocus` may move the map on focus, shifting
    // both base values equally, so assertions compare the pair rather than fixed numbers.
    const { markerElements } = renderOnRealMap([
      openFalls,
      { ...openPeak, latitude: openFalls.latitude, longitude: openFalls.longitude },
    ]);
    const [falls, peak] = markerElements() as [HTMLElement, HTMLElement];
    const z = (el: HTMLElement) => Number(el.style.zIndex);
    expect(Number.isFinite(z(falls)) && Number.isFinite(z(peak))).toBe(true);
    expect(z(falls)).toBe(z(peak));

    falls.focus();
    expect(z(falls) - z(peak)).toBe(1000);

    peak.focus(); // blurs falls → falls back to base; peak raised
    expect(z(peak) - z(falls)).toBe(1000);

    peak.blur();
    expect(z(peak)).toBe(z(falls));
  });

  it("removes a marker's DOM (and its open popup) cleanly when it leaves the result set", async () => {
    const { markerElements, openPopup, rerenderWith } = renderOnRealMap([openFalls, openPeak]);
    const falls = markerElements()[0]!;
    falls.focus();
    pressEnter(falls);
    expect(openPopup()).not.toBeNull();

    rerenderWith([openPeak]);

    await waitFor(() => expect(markerElements()).toHaveLength(1));
    expect(markerElements()[0]).toHaveAttribute("aria-label", "Open Peak, Mountain Peak");
    expect(openPopup()).toBeNull();
  });
});
