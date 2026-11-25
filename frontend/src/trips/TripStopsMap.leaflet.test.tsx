import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Map as LeafletMap } from "leaflet";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TripStop } from "../api/trips";
import { TripStopsMap } from "./TripStopsMap";

/**
 * M05-T04 Increment 4 — the trip map on REAL Leaflet + react-leaflet in jsdom
 * (as the M02-T08 marker tests): numbered markers for available stops only,
 * viewport fitting, updates from new stop props, no route geometry, marker
 * keyboard access, popups, and focus. jsdom has no layout, so pixel
 * positions, visible focus rings, and tile rendering are left to the
 * real-browser checks of Increment 6. Enter is dispatched with the
 * browser-accurate `keyCode`, as Leaflet expects (see the M02-T08 tests).
 */

const STOP = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LANDMARK = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const NAMES = ["Alpha Falls", "Beta Arch", "Gamma Hidden", "Delta Falls", "Echo Falls"];

function available(key: number, position: number, latitude = 35 + key / 10): TripStop {
  return {
    id: STOP(key),
    position,
    is_available: true,
    distance_from_previous_miles: null,
    landmark: {
      id: LANDMARK(key),
      display_name: NAMES[key]!,
      category: key === 1 ? "arch" : "falls",
      latitude,
      longitude: -84 - key / 10,
    },
  };
}

function unavailable(key: number, position: number): TripStop {
  return {
    id: STOP(key),
    position,
    is_available: false,
    distance_from_previous_miles: null,
    landmark: { id: LANDMARK(key), is_available: false },
  };
}

const MIXED = [available(0, 0), available(1, 1), unavailable(2, 2), available(3, 3)];

function renderMap(stops: TripStop[], onFocusLost = vi.fn()) {
  const ui = (list: TripStop[]) => (
    <MemoryRouter>
      <TripStopsMap stops={list} onFocusLost={onFocusLost} />
      <button type="button">Outside</button>
    </MemoryRouter>
  );
  const utils = render(ui(stops));
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
    rerenderWith: (l: TripStop[]) => utils.rerender(ui(l)),
  };
}

function pressEnter(element: HTMLElement) {
  fireEvent.keyPress(element, { key: "Enter", code: "Enter", keyCode: 13, charCode: 13 });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("markers", () => {
  it("numbers markers for available stops only, by position + 1, keeping gaps", () => {
    const { icons, labels } = renderMap(MIXED);
    expect(icons()).toHaveLength(3);
    expect(labels()).toEqual([
      "Stop 1: Alpha Falls, Waterfall",
      "Stop 2: Beta Arch, Natural Arch",
      "Stop 4: Delta Falls, Waterfall",
    ]);
    expect(icons().map((icon) => icon.textContent)).toEqual(["1", "2", "4"]);
    for (const icon of icons()) {
      expect(icon).toHaveAttribute("tabindex", "0");
      expect(icon).toHaveAttribute("role", "button");
      expect(icon.querySelector("span")).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("puts nothing about an unavailable stop on the map", () => {
    const { container } = renderMap(MIXED);
    expect(container.innerHTML).not.toContain(LANDMARK(2));
    expect(container.innerHTML).not.toContain("Gamma Hidden");
    expect(container.innerHTML).not.toContain("Stop 3");
  });

  it("draws no line, route, or other vector geometry", () => {
    const { container } = renderMap(MIXED);
    expect(container.querySelector("svg path, path, polyline, canvas")).toBeNull();
    expect(container.querySelectorAll(".leaflet-overlay-pane *")).toHaveLength(0);
  });

  it("renders nothing for a trip with no stops", () => {
    const { container } = renderMap([]);
    expect(container.querySelector("section")).toBeNull();
    expect(container.querySelector(".leaflet-container")).toBeNull();
  });

  it("explains, without a map, when no stop is available", () => {
    const { container } = renderMap([unavailable(2, 0), unavailable(4, 1)]);
    expect(
      screen.getByText(
        "None of this trip's stops can be shown on the map, because they are no longer available.",
      ),
    ).toBeInTheDocument();
    expect(container.querySelector(".leaflet-container")).toBeNull();
  });

  it("labels the map region and says it is not a route", () => {
    renderMap(MIXED);
    expect(screen.getByRole("region", { name: "Map of the trip's available stops" })).toBeTruthy();
    expect(screen.getByText(/not a route/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Map" })).toBeTruthy();
  });
});

describe("updates from new stops (server-confirmed state)", () => {
  it("renumbers markers when the order changes, keeping each marker's identity", () => {
    const { labels, rerenderWith } = renderMap(MIXED);
    rerenderWith([available(1, 0), available(0, 1), unavailable(2, 2), available(3, 3)]);
    expect([...labels()].sort()).toEqual([
      "Stop 1: Beta Arch, Natural Arch",
      "Stop 2: Alpha Falls, Waterfall",
      "Stop 4: Delta Falls, Waterfall",
    ]);
  });

  it("removes a marker when its stop is removed or becomes unavailable", () => {
    const { labels, rerenderWith } = renderMap(MIXED);
    rerenderWith([available(0, 0), unavailable(2, 1), available(3, 2)]);
    expect(labels()).toEqual(["Stop 1: Alpha Falls, Waterfall", "Stop 3: Delta Falls, Waterfall"]);
    rerenderWith([unavailable(0, 0), unavailable(2, 1), available(3, 2)]);
    expect(labels()).toEqual(["Stop 3: Delta Falls, Waterfall"]);
    rerenderWith([unavailable(0, 0), unavailable(2, 1), unavailable(3, 2)]);
    expect(screen.getByText(/None of this trip's stops can be shown on the map/)).toBeTruthy();
  });
});

describe("viewport", () => {
  it("fits several stops (bounded zoom) and does not refit when only the numbering changes", () => {
    const fit = vi.spyOn(LeafletMap.prototype, "fitBounds");
    const { rerenderWith } = renderMap(MIXED);
    expect(fit).toHaveBeenCalledTimes(1);
    const [bounds, options] = fit.mock.calls[0]!;
    for (const stop of MIXED.filter((s) => s.is_available)) {
      const { latitude, longitude } = (stop as Extract<TripStop, { is_available: true }>).landmark;
      expect(
        (bounds as { contains: (p: [number, number]) => boolean }).contains([latitude, longitude]),
      ).toBe(true);
    }
    expect(options).toMatchObject({ maxZoom: 13 });

    rerenderWith([available(1, 0), available(0, 1), unavailable(2, 2), available(3, 3)]);
    expect(fit).toHaveBeenCalledTimes(1);

    rerenderWith([available(0, 0), available(3, 1)]);
    expect(fit).toHaveBeenCalledTimes(2);
  });

  it("centres a single stop at a bounded zoom", () => {
    const setView = vi.spyOn(LeafletMap.prototype, "setView");
    const fit = vi.spyOn(LeafletMap.prototype, "fitBounds");
    renderMap([available(0, 0, 35.5)]);
    expect(fit).not.toHaveBeenCalled();
    const last = setView.mock.calls.at(-1)!;
    expect(last[1]).toBe(13);
    expect(last[0]).toMatchObject({ lat: 35.5, lng: -84 });
  });

  it("handles stops at the same point with a bounded zoom on that point", () => {
    const setView = vi.spyOn(LeafletMap.prototype, "setView");
    const fit = vi.spyOn(LeafletMap.prototype, "fitBounds");
    const same = available(1, 1, 35.5);
    same.landmark = { ...same.landmark, longitude: -84 } as typeof same.landmark;
    const { icons } = renderMap([available(0, 0, 35.5), same]);
    // One combined marker at that point (Increment 6 correction), not two stacked ones.
    expect(icons()).toHaveLength(1);
    expect(fit).not.toHaveBeenCalled();
    expect(setView.mock.calls.at(-1)![1]).toBe(13);
  });
});

describe("keyboard and popups", () => {
  it("Enter opens a popup with the stop number, name, category, and a profile link; focus moves into it", () => {
    const { icons, popup } = renderMap(MIXED);
    const marker = icons()[1]!;
    marker.focus();
    pressEnter(marker);
    const open = popup()!;
    expect(open).not.toBeNull();
    const group = within(open).getByRole("group", { name: "Stop 2: Beta Arch details" });
    expect(group).toHaveTextContent("Stop 2: Beta Arch");
    expect(group).toHaveTextContent("Natural Arch");
    expect(within(group).getByRole("link", { name: "View profile" })).toHaveAttribute(
      "href",
      `/landmarks/${LANDMARK(1)}`,
    );
    expect(group).toHaveFocus();
    expect(open.textContent).not.toMatch(/35\.1|-84\.1/);
  });

  it("Escape inside the popup closes it and returns focus to the marker", async () => {
    const { icons, popup } = renderMap(MIXED);
    const marker = icons()[0]!;
    marker.focus();
    pressEnter(marker);
    expect(popup()).not.toBeNull();
    await userEvent.keyboard("{Escape}");
    expect(popup()).toBeNull();
    expect(marker).toHaveFocus();
  });

  it("Space toggles the popup", async () => {
    const { icons, popup } = renderMap(MIXED);
    const marker = icons()[2]!;
    marker.focus();
    await userEvent.keyboard(" ");
    expect(popup()).not.toBeNull();
    marker.focus();
    await userEvent.keyboard(" ");
    expect(popup()).toBeNull();
  });

  it("the popup's close button returns focus to its marker", async () => {
    const { icons, popup } = renderMap(MIXED);
    const marker = icons()[0]!;
    marker.focus();
    pressEnter(marker);
    const close = popup()!.querySelector<HTMLElement>(".leaflet-popup-close-button")!;
    close.focus();
    await userEvent.click(close);
    expect(popup()).toBeNull();
    expect(marker).toHaveFocus();
  });
});

describe("focus when a marker disappears", () => {
  it("reports focus loss when the focused marker is removed", () => {
    const { icons, rerenderWith, onFocusLost } = renderMap(MIXED);
    icons()[1]!.focus();
    act(() => rerenderWith([available(0, 0), unavailable(2, 1), available(3, 2)]));
    expect(onFocusLost).toHaveBeenCalledTimes(1);
  });

  it("reports focus loss when the marker with an open, focused popup is removed", () => {
    const { icons, rerenderWith, onFocusLost } = renderMap(MIXED);
    const marker = icons()[1]!;
    marker.focus();
    pressEnter(marker);
    act(() => rerenderWith([available(0, 0), available(3, 1)]));
    expect(onFocusLost).toHaveBeenCalledTimes(1);
  });

  it("does not report (or steal focus) when focus is elsewhere", () => {
    const { icons, rerenderWith, onFocusLost } = renderMap(MIXED);
    expect(icons()).toHaveLength(3);
    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    act(() => rerenderWith([available(0, 0)]));
    expect(onFocusLost).not.toHaveBeenCalled();
    expect(outside).toHaveFocus();
  });
});

// ---------------------------------------------------------------------------
// Stops at exactly the same location (M05-T04 Increment 6 correction)
// ---------------------------------------------------------------------------

/** An available stop for place `key` at `position`, placed at an explicit point. */
function at(key: number, position: number, latitude: number, longitude: number): TripStop {
  return {
    id: STOP(100 + key),
    position,
    is_available: true,
    distance_from_previous_miles: null,
    landmark: {
      id: LANDMARK(100 + key),
      display_name: `Place ${key}`,
      category: key === 1 ? "arch" : "falls",
      latitude,
      longitude,
    },
  };
}

function moved(stop: TripStop, position: number): TripStop {
  return { ...stop, position } as TripStop;
}

describe("stops at exactly the same location share one marker", () => {
  it("groups exact matches only: one combined marker, listed numbers, a complete name; a nearby point stays separate", () => {
    const { icons, labels } = renderMap([
      at(1, 0, 35.5, -84.5),
      at(2, 1, 35.6, -84.6),
      at(3, 2, 35.6, -84.6),
      at(4, 3, 35.6000001, -84.6),
    ]);
    expect(icons()).toHaveLength(3);
    expect(icons().map((i) => i.textContent)).toEqual(["1", "2,3", "4"]);
    // Label in name: every marker's name contains its visible badge text.
    for (const icon of icons()) expect(icon.getAttribute("aria-label")).toContain(icon.textContent);
    expect(labels()).toEqual([
      "Stop 1: Place 1, Natural Arch",
      "Stops 2,3, 2 at the same location: Stop 2: Place 2, Waterfall; Stop 3: Place 3, Waterfall",
      "Stop 4: Place 4, Waterfall",
    ]);
  });

  it("numbers follow trip order with gaps for unavailable stops, and say nothing about them", () => {
    const { icons, labels, container } = renderMap([
      at(3, 0, 35.6, -84.6),
      unavailable(2, 1),
      at(1, 2, 35.6, -84.6),
    ]);
    expect(icons().map((i) => i.textContent)).toEqual(["1,3"]);
    expect(labels()[0]).toBe(
      "Stops 1,3, 2 at the same location: Stop 1: Place 3, Waterfall; Stop 3: Place 1, Natural Arch",
    );
    expect(container.innerHTML).not.toContain(LANDMARK(2));
    expect(container.innerHTML).not.toContain("Gamma Hidden");
  });

  it("badge overflow: two numbers, then '+k' with the exact count; the name always lists every stop", () => {
    const three = [at(1, 0, 35.6, -84.6), at(2, 1, 35.6, -84.6), at(3, 2, 35.6, -84.6)];
    const { icons, labels, rerenderWith } = renderMap(three);
    expect(icons()[0]!.textContent).toBe("1,2 +1");
    expect(labels()[0]!.startsWith("Stops 1,2 +1, 3 at the same location: ")).toBe(true);
    const all = Array.from({ length: 25 }, (_, i) => at(i + 1, i, 35.6, -84.6));
    rerenderWith(all);
    expect(icons()).toHaveLength(1);
    expect(icons()[0]!.textContent).toBe("1,2 +23");
    const name = labels()[0]!;
    for (let n = 1; n <= 25; n += 1) expect(name).toContain(`Stop ${n}: Place ${n},`);
  });

  it("the combined popup lists every stop in trip order, each with its own profile link, without coordinates", () => {
    const { icons, popup } = renderMap([
      at(1, 0, 35.6, -84.6),
      unavailable(2, 1),
      at(3, 2, 35.6, -84.6),
    ]);
    icons()[0]!.focus();
    pressEnter(icons()[0]!);
    const group = within(popup()!).getByRole("group", { name: "Stops 1 and 3 details" });
    expect(group).toHaveFocus();
    const items = within(group).getAllByRole("listitem");
    expect(items.map((li) => li.textContent?.match(/^Stop \d+: Place \d+/)?.[0])).toEqual([
      "Stop 1: Place 1",
      "Stop 3: Place 3",
    ]);
    const links = within(group).getAllByRole("link");
    expect(links.map((l) => [l.getAttribute("aria-label"), l.getAttribute("href")])).toEqual([
      ["View profile: Stop 1, Place 1", `/landmarks/${LANDMARK(101)}`],
      ["View profile: Stop 3, Place 3", `/landmarks/${LANDMARK(103)}`],
    ]);
    for (const link of links) {
      expect(link.getAttribute("aria-label")!.startsWith(link.textContent!)).toBe(true);
    }
    expect(popup()!.textContent).not.toMatch(/35\.6|-84\.6/);
    expect(popup()!.innerHTML).not.toContain(LANDMARK(2));
    expect(group.querySelectorAll("bdi")).toHaveLength(2);
  });

  it("a 25-stop group's popup lists all 25 links (in a scrolling list)", () => {
    const { icons, popup } = renderMap(
      Array.from({ length: 25 }, (_, i) => at(i + 1, i, 35.6, -84.6)),
    );
    icons()[0]!.focus();
    pressEnter(icons()[0]!);
    expect(within(popup()!).getAllByRole("link")).toHaveLength(25);
    expect(popup()!.querySelector("ul")).not.toBeNull();
  });

  it("keeps the same marker (and focus) through renumbering and combined-to-single-to-combined changes, without refitting on reorder", () => {
    const [p1, p2, p3] = [at(1, 0, 35.5, -84.5), at(2, 1, 35.6, -84.6), at(3, 2, 35.6, -84.6)];
    const { icons, rerenderWith, onFocusLost } = renderMap([p1!, p2!, p3!]);
    icons()[1]!.focus();
    const fit = vi.spyOn(LeafletMap.prototype, "fitBounds");
    const setView = vi.spyOn(LeafletMap.prototype, "setView");
    act(() => rerenderWith([moved(p2!, 0), moved(p3!, 1), moved(p1!, 2)]));
    expect(fit).not.toHaveBeenCalled();
    expect(setView).not.toHaveBeenCalled();
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^Stops 1,2, 2 at the same location/,
    );
    act(() => rerenderWith([moved(p2!, 0), moved(p1!, 1)]));
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Stop 1: Place 2, Waterfall");
    act(() => rerenderWith([moved(p2!, 0), moved(p1!, 1), moved(p3!, 2)]));
    expect(document.activeElement?.getAttribute("aria-label")).toMatch(
      /^Stops 1,3, 2 at the same location/,
    );
    expect(onFocusLost).not.toHaveBeenCalled();
  });

  it("availability: a member becoming unavailable leaves the marker; the last one leaving removes it (focus → onFocusLost)", () => {
    const pair = [at(1, 0, 35.6, -84.6), at(2, 1, 35.6, -84.6)];
    const { icons, rerenderWith, onFocusLost } = renderMap(pair);
    icons()[0]!.focus();
    act(() => rerenderWith([pair[0]!, unavailable(2, 1)]));
    expect(icons()).toHaveLength(1);
    expect(icons()[0]!.textContent).toBe("1");
    expect(onFocusLost).not.toHaveBeenCalled();
    act(() => rerenderWith([unavailable(1, 0), unavailable(2, 1)]));
    expect(icons()).toHaveLength(0);
    expect(onFocusLost).toHaveBeenCalledTimes(1);
  });

  it("when the focused popup link's stop leaves the group, focus moves to a surviving link", () => {
    const three = [at(1, 0, 35.6, -84.6), at(2, 1, 35.6, -84.6), at(3, 2, 35.6, -84.6)];
    const { icons, popup, rerenderWith } = renderMap(three);
    icons()[0]!.focus();
    pressEnter(icons()[0]!);
    within(popup()!).getByRole("link", { name: "View profile: Stop 2, Place 2" }).focus();
    act(() => rerenderWith([three[0]!, moved(three[2]!, 1)]));
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "View profile: Stop 2, Place 3",
    );
    act(() => rerenderWith([three[0]!]));
    expect(document.activeElement?.textContent).toBe("View profile");
    expect(within(popup()!).getByRole("group", { name: "Stop 1: Place 1 details" })).toBeTruthy();
  });

  it("does not move focus from an unrelated control when the group changes", () => {
    const three = [at(1, 0, 35.6, -84.6), at(2, 1, 35.6, -84.6), at(3, 2, 35.6, -84.6)];
    const { icons, popup, rerenderWith } = renderMap(three);
    icons()[0]!.focus();
    pressEnter(icons()[0]!);
    within(popup()!).getByRole("link", { name: "View profile: Stop 2, Place 2" }).focus();
    const outside = screen.getByRole("button", { name: "Outside" });
    outside.focus();
    act(() => rerenderWith([three[0]!, moved(three[2]!, 1)]));
    expect(outside).toHaveFocus();
  });

  it("draws no line or route geometry for a combined marker", () => {
    const { container } = renderMap([
      at(1, 0, 35.6, -84.6),
      at(2, 1, 35.6, -84.6),
      at(3, 2, 35.5, -84.5),
    ]);
    expect(container.querySelector("svg path, path, polyline, canvas")).toBeNull();
    expect(container.querySelectorAll(".leaflet-overlay-pane *")).toHaveLength(0);
  });
});
