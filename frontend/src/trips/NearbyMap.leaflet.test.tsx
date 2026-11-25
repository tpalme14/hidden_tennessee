import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Map as LeafletMap } from "leaflet";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLandmarkGeoMarkers } from "../api/landmarks";
import type { NearbyLandmarkView, NearbyResultSet } from "./nearbyLandmarks";
import type { NearbyMapOrigin } from "./nearbyMapMarkers";
import { NearbyMap } from "./NearbyMap";

/**
 * M05-T05 Increment 3 — the supplementary nearby map on REAL Leaflet +
 * react-leaflet in jsdom. jsdom has no layout, so pixel positions, visible
 * focus rings, tiles, and native select behaviour are left to the
 * real-browser checks of Increment 5. Enter is dispatched with the
 * browser-accurate `keyCode`, as Leaflet expects.
 */

vi.mock("../api/landmarks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/landmarks")>()),
  getLandmarkGeoMarkers: vi.fn(),
}));

const id = (n: number) => `22222222-2222-4222-8222-${String(n).padStart(12, "0")}`;
const ORIGIN: NearbyMapOrigin = {
  stopNumber: 2,
  displayName: "Beta Arch",
  landmarkId: id(999),
  latitude: 35.6,
  longitude: -84.6,
};

function result(
  n: number,
  latitude: number,
  longitude: number,
  extra: Partial<NearbyLandmarkView> = {},
): NearbyLandmarkView {
  return {
    id: id(n),
    display_name: `Place ${n}`,
    category: n === 1 ? "arch" : "falls",
    latitude,
    longitude,
    distance_miles: n / 10,
    inTrip: null,
    ...extra,
  };
}

function setOf(results: NearbyLandmarkView[], radius = 25): NearbyResultSet {
  return {
    origin: { stopId: "s", landmarkId: id(999), latitude: 35.6, longitude: -84.6 },
    radius: radius as 25,
    results,
    hasMore: false,
    isTruncated: false,
    malformedCount: 0,
  };
}

const THREE = [result(1, 35.7, -84.7), result(2, 35.8, -84.8), result(3, 35.9, -84.9)];

function renderMap(
  initial: { origin?: NearbyMapOrigin; set: NearbyResultSet },
  onFocusLost = vi.fn(),
) {
  const panelKeyDown = vi.fn();
  const ui = (p: { origin?: NearbyMapOrigin; set: NearbyResultSet }) => (
    <MemoryRouter>
      {/* Stands in for the nearby panel, which closes on an Escape that reaches it. */}
      <section onKeyDown={(e) => !e.defaultPrevented && e.key === "Escape" && panelKeyDown()}>
        <NearbyMap
          origin={p.origin ?? ORIGIN}
          set={p.set}
          landmarks={p.set.results as NearbyLandmarkView[]}
          onFocusLost={onFocusLost}
        />
      </section>
      <button type="button">Outside</button>
    </MemoryRouter>
  );
  const utils = render(ui(initial));
  const icons = () =>
    Array.from(utils.container.querySelectorAll<HTMLElement>(".leaflet-marker-icon"));
  const labels = () => icons().map((icon) => icon.getAttribute("aria-label"));
  const popup = () => utils.container.querySelector<HTMLElement>(".leaflet-popup");
  return {
    ...utils,
    icons,
    labels,
    popup,
    onFocusLost,
    panelKeyDown,
    rerenderWith: (p: { origin?: NearbyMapOrigin; set: NearbyResultSet }) => utils.rerender(ui(p)),
  };
}

function pressEnter(element: HTMLElement) {
  fireEvent.keyPress(element, { key: "Enter", code: "Enter", keyCode: 13, charCode: 13 });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("markers from the shown set", () => {
  it("one origin marker and one marker per result, in order, at exact positions; no request of its own", () => {
    const { icons, labels } = renderMap({ set: setOf(THREE) });
    expect(icons()).toHaveLength(4);
    expect(labels()).toEqual([
      "Stop 2, search origin: Beta Arch",
      "Place 1, Natural Arch, About 0.1 mi (0.2 km), straight-line",
      "Place 2, Waterfall, About 0.2 mi (0.3 km), straight-line",
      "Place 3, Waterfall, About 0.3 mi (0.5 km), straight-line",
    ]);
    expect(icons()[0]!.querySelector("span")!.className).toMatch(/originBadge/);
    expect(icons()[0]!.textContent).toBe("Stop 2");
    expect(icons()[1]!.querySelector("span")!.className).toMatch(/resultBadge/);
    expect(icons()[1]!.textContent).toBe("");
    for (const icon of icons()) {
      expect(icon.getAttribute("aria-label")!.startsWith(icon.textContent!)).toBe(true);
      expect(icon).toHaveAttribute("tabindex", "0");
    }
    expect(vi.mocked(getLandmarkGeoMarkers)).not.toHaveBeenCalled();
  });

  it("never puts names or categories into marker HTML; popups isolate hostile and bidi names", () => {
    const rlo = String.fromCodePoint(0x202e);
    const hostile = result(4, 35.7, -84.7, { display_name: `<img src=x onerror="alert(1)">` });
    const bidi = result(5, 35.8, -84.8, { display_name: `${rlo}evil` });
    const { icons, popup, container } = renderMap({ set: setOf([hostile, bidi]) });
    for (const icon of icons()) {
      expect(icon.innerHTML).not.toMatch(/img|evil|Waterfall/);
    }
    expect(container.querySelector(".leaflet-marker-pane img")).toBeNull();
    icons()[1]!.focus();
    pressEnter(icons()[1]!);
    expect(popup()!.querySelector("img")).toBeNull();
    expect(popup()!.querySelector("bdi")!.textContent).toBe(`<img src=x onerror="alert(1)">`);
    expect(popup()!.textContent).not.toMatch(/35\.7|-84\.7/);
  });

  it("a result popup: name, category, server distance, membership, its own profile link", () => {
    const member = result(1, 35.7, -84.7, { inTrip: { stopId: "x", stopNumber: 4 } });
    const { icons, popup } = renderMap({ set: setOf([member]) });
    icons()[1]!.focus();
    pressEnter(icons()[1]!);
    const group = within(popup()!).getByRole("group", { name: "Place 1 details" });
    expect(group).toHaveFocus();
    expect(group.textContent).toBe(
      "Place 1Natural Arch — About 0.1 mi (0.2 km), straight-lineIn this trip (Stop 4)View profile",
    );
    expect(within(group).getByRole("link", { name: "View profile: Place 1" })).toHaveAttribute(
      "href",
      `/landmarks/${id(1)}`,
    );
  });

  it("draws no line, circle, or route geometry", () => {
    const { container } = renderMap({ set: setOf(THREE) });
    expect(container.querySelector("svg path, path, polyline, circle, canvas")).toBeNull();
    expect(container.querySelectorAll(".leaflet-overlay-pane *")).toHaveLength(0);
  });
});

describe("coincident locations", () => {
  it("groups exact matches only; an origin/result group keeps the origin identity; each result has its own link", () => {
    const { icons, labels, popup } = renderMap({
      set: setOf([
        result(1, 35.6, -84.6, { distance_miles: 0 }),
        result(2, 35.6, -84.6, { distance_miles: 0 }),
        result(3, 35.6000001, -84.6),
        result(4, 35.7, -84.7),
        result(5, 35.7, -84.7),
      ]),
    });
    expect(icons().map((i) => i.textContent)).toEqual(["Stop 2 +2", "", "2"]);
    expect(labels()[0]).toMatch(
      /^Stop 2 \+2, search origin and 2 nearby landmarks at the same location: Beta Arch, search origin; Place 1, /,
    );
    expect(labels()[2]).toMatch(/^2 nearby landmarks at the same location: Place 4, .*; Place 5, /);
    icons()[0]!.focus();
    pressEnter(icons()[0]!);
    const group = within(popup()!).getByRole("group", {
      name: "Search origin and nearby landmarks at this location",
    });
    expect(group.textContent).toMatch(/^Search origin — Stop 2: Beta Arch/);
    expect(
      within(group)
        .getAllByRole("link")
        .map((l) => [l.getAttribute("aria-label"), l.getAttribute("href")]),
    ).toEqual([
      ["View profile: Stop 2, Beta Arch", `/landmarks/${id(999)}`],
      ["View profile: Place 1", `/landmarks/${id(1)}`],
      ["View profile: Place 2", `/landmarks/${id(2)}`],
    ]);
  });

  it("200 results at one point: one marker, a complete name, 200 popup links in a scrolling list", () => {
    const stacked = Array.from({ length: 200 }, (_, i) => result(i + 1, 35.7, -84.7));
    const { icons, popup } = renderMap({ set: setOf(stacked) });
    expect(icons()).toHaveLength(2);
    expect(icons()[1]!.textContent).toBe("200");
    expect(icons()[1]!.getAttribute("aria-label")).toContain("Place 200, Waterfall,");
    icons()[1]!.focus();
    pressEnter(icons()[1]!);
    expect(within(popup()!).getAllByRole("link")).toHaveLength(200);
    expect(popup()!.querySelector("ul")!.className).toMatch(/popupList/);
  });

  it("200 results at 200 points plus the origin: 201 markers", () => {
    const spread = Array.from({ length: 200 }, (_, i) => result(i + 1, 36 + i / 1000, -85));
    const { icons } = renderMap({ set: setOf(spread) });
    expect(icons()).toHaveLength(201);
  });
});

describe("viewport", () => {
  it("a single location is shown at a bounded zoom; several are fitted", () => {
    const setView = vi.spyOn(LeafletMap.prototype, "setView");
    renderMap({ set: setOf([result(1, 35.6, -84.6)]) });
    expect(setView.mock.calls.at(-1)![1]).toBe(13);
    const fit = vi.spyOn(LeafletMap.prototype, "fitBounds");
    renderMap({ set: setOf(THREE) });
    expect(fit).toHaveBeenCalled();
    expect(fit.mock.calls.at(-1)![1]).toMatchObject({ maxZoom: 13 });
  });

  it("refits only for a new result set — not for renumbering, membership, or the same set again; marker elements kept", () => {
    const first = setOf(THREE);
    const { icons, rerenderWith } = renderMap({ set: first });
    const before = icons();
    before[0]!.focus();
    const fit = vi.spyOn(LeafletMap.prototype, "fitBounds");
    const setView = vi.spyOn(LeafletMap.prototype, "setView");
    act(() => rerenderWith({ set: first, origin: { ...ORIGIN, stopNumber: 1 } }));
    expect(icons()[0]!.getAttribute("aria-label")).toBe("Stop 1, search origin: Beta Arch");
    expect(icons()[0]!.textContent).toBe("Stop 1");
    expect(icons()[0]).toBe(before[0]);
    expect(icons()[0]).toHaveFocus();
    const member = {
      ...first,
      results: first.results.map((r, i) =>
        i === 0 ? { ...r, inTrip: { stopId: "x", stopNumber: 3 } } : r,
      ),
    };
    act(() => rerenderWith({ set: first, origin: { ...ORIGIN, stopNumber: 1 } }));
    expect(fit).not.toHaveBeenCalled();
    expect(setView).not.toHaveBeenCalled();
    act(() => rerenderWith({ set: member }));
    expect(fit).toHaveBeenCalledTimes(1);
  });

  it("zoom changes are not animated, so a new result set arriving mid-zoom is still fitted (CI run #30 correction)", () => {
    const setView = vi.spyOn(LeafletMap.prototype, "setView");
    renderMap({ set: setOf(THREE) });
    const map = setView.mock.contexts.at(-1) as LeafletMap;
    expect(map.options.zoomAnimation).toBe(false);
  });

  it("panning and zooming request nothing", () => {
    const { container } = renderMap({ set: setOf(THREE) });
    const zoomIn = container.querySelector<HTMLElement>(".leaflet-control-zoom-in")!;
    fireEvent.click(zoomIn);
    expect(vi.mocked(getLandmarkGeoMarkers)).not.toHaveBeenCalled();
  });
});

describe("keyboard, popups, and nested Escape", () => {
  it("Enter opens with focus inside; Escape in the popup closes it only — the panel stays open", async () => {
    const { icons, popup, panelKeyDown } = renderMap({ set: setOf(THREE) });
    const marker = icons()[1]!;
    marker.focus();
    pressEnter(marker);
    expect(popup()).not.toBeNull();
    within(popup()!).getByRole("link").focus();
    await userEvent.keyboard("{Escape}");
    expect(popup()).toBeNull();
    expect(marker).toHaveFocus();
    expect(panelKeyDown).not.toHaveBeenCalled();
  });

  it("Escape on a marker whose popup is open closes the popup only; with no popup it reaches the panel", async () => {
    const { icons, popup, panelKeyDown } = renderMap({ set: setOf(THREE) });
    const marker = icons()[2]!;
    marker.focus();
    await userEvent.keyboard(" ");
    expect(popup()).not.toBeNull();
    marker.focus();
    await userEvent.keyboard("{Escape}");
    expect(popup()).toBeNull();
    expect(panelKeyDown).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    expect(panelKeyDown).toHaveBeenCalledTimes(1);
  });

  it("Space toggles; Shift+Tab from the popup returns to the marker; the close button returns focus", async () => {
    const { icons, popup } = renderMap({ set: setOf(THREE) });
    const marker = icons()[3]!;
    marker.focus();
    await userEvent.keyboard(" ");
    expect(within(popup()!).getByRole("group")).toHaveFocus();
    await userEvent.keyboard("{Shift>}{Tab}{/Shift}");
    expect(marker).toHaveFocus();
    expect(popup()).not.toBeNull();
    const close = popup()!.querySelector<HTMLElement>(".leaflet-popup-close-button")!;
    close.focus();
    await userEvent.click(close);
    expect(popup()).toBeNull();
    expect(marker).toHaveFocus();
  });
});

describe("focus when markers disappear", () => {
  it("a focused marker that leaves the set reports focus loss", () => {
    const { icons, rerenderWith, onFocusLost } = renderMap({ set: setOf(THREE) });
    icons()[2]!.focus();
    act(() => rerenderWith({ set: setOf([THREE[0]!]) }));
    expect(onFocusLost).toHaveBeenCalledTimes(1);
  });

  it("a focused popup link whose result left a group moves to the surviving link", () => {
    const pair = [result(4, 35.7, -84.7), result(5, 35.7, -84.7), result(6, 35.7, -84.7)];
    const { icons, popup, rerenderWith, onFocusLost } = renderMap({ set: setOf(pair) });
    icons()[1]!.focus();
    pressEnter(icons()[1]!);
    within(popup()!).getByRole("link", { name: "View profile: Place 5" }).focus();
    act(() => rerenderWith({ set: setOf([pair[0]!, pair[2]!]) }));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("View profile: Place 6");
    expect(onFocusLost).not.toHaveBeenCalled();
  });

  it("never reports or steals focus that is elsewhere", () => {
    const { rerenderWith, onFocusLost } = renderMap({ set: setOf(THREE) });
    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    act(() => rerenderWith({ set: setOf([]) }));
    expect(onFocusLost).not.toHaveBeenCalled();
    expect(outside).toHaveFocus();
  });
});
