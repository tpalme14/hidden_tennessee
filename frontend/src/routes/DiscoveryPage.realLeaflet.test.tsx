import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { getCategories } from "../api/categories";
import { getLandmarkGeoMarkers, searchLandmarks } from "../api/landmarks";
import type { LandmarkCollectionResponse } from "../api/types";
import { GEO_RESULTS_HEADING_ID } from "./GeographicResultsList";

/**
 * M02-T08 Increment 5a — the whole discovery page with REAL react-leaflet /
 * Leaflet, real URL-state, filter, geographic, and marker hooks, and the real
 * `GeographicResultsList`; only the network boundary is mocked. Proves the
 * end-to-end behaviour the increment is for: a genuine debounced filter
 * commit triggers a genuine marker refetch, and when the resulting result set
 * no longer contains the marker (or open popup) holding keyboard focus,
 * focus lands on the geographic-results heading instead of <body>.
 *
 * The map is given an explicit viewport via the URL so Leaflet uses
 * `center`/`zoom` rather than a bounds fit (jsdom has no layout, so a
 * bounds fit in a zero-size container is not meaningful).
 */
vi.mock("../api/landmarks", () => ({ getLandmarkGeoMarkers: vi.fn(), searchLandmarks: vi.fn() }));
vi.mock("../api/categories", () => ({ getCategories: vi.fn() }));

const { DiscoveryPage } = await import("./DiscoveryPage");

const alpha = {
  id: "a",
  display_name: "Alpha Falls",
  category: "falls",
  latitude: 35.6,
  longitude: -85.6,
};
const bravo = {
  id: "b",
  display_name: "Bravo Peak",
  category: "peak",
  latitude: 35.9,
  longitude: -84.9,
};

function response(items: LandmarkCollectionResponse["items"]): LandmarkCollectionResponse {
  return { items, page: 1, limit: 200, has_more: false, is_truncated: false };
}

function fireEnter(element: HTMLElement) {
  // Leaflet opens a marker popup from a keypress with keyCode 13 (see the
  // marker test files for why user-event's Enter cannot be used here).
  element.dispatchEvent(
    new KeyboardEvent("keypress", {
      key: "Enter",
      keyCode: 13,
      bubbles: true,
    } as KeyboardEventInit),
  );
}

function renderPage() {
  const utils = render(
    <MemoryRouter initialEntries={["/?lat=35.75&lng=-85.95&zoom=7"]}>
      <DiscoveryPage />
    </MemoryRouter>,
  );
  const icons = () =>
    Array.from(utils.container.querySelectorAll<HTMLElement>(".leaflet-marker-icon"));
  const iconNamed = (name: string) =>
    icons().find((el) => el.getAttribute("aria-label")?.startsWith(name))!;
  const heading = () => document.getElementById(GEO_RESULTS_HEADING_ID)!;
  return { ...utils, icons, iconNamed, heading };
}

function mockNetwork(
  first: LandmarkCollectionResponse["items"],
  second: LandmarkCollectionResponse["items"],
) {
  vi.mocked(getCategories).mockResolvedValue([]);
  vi.mocked(searchLandmarks).mockResolvedValue(response([]));
  vi.mocked(getLandmarkGeoMarkers).mockReset();
  vi.mocked(getLandmarkGeoMarkers)
    .mockResolvedValueOnce(response(first))
    .mockResolvedValueOnce(response(second));
}

describe("DiscoveryPage — focus moves to the geographic-results heading when a focused marker disappears (real Leaflet, 5a)", () => {
  it("focused marker removed by a populated replacement set → heading focused", async () => {
    mockNetwork([alpha, bravo], [bravo]);
    const user = userEvent.setup();
    const { icons, iconNamed, heading } = renderPage();
    await waitFor(() => expect(icons()).toHaveLength(2));

    // A real filter commit: typing starts the 300 ms debounce; focus then
    // moves to a marker before it fires (as a keyboard user tabbing on would).
    await user.type(screen.getByRole("textbox"), "x");
    iconNamed("Alpha Falls").focus();
    expect(document.activeElement).toBe(iconNamed("Alpha Falls"));

    await waitFor(() => expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(icons()).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(heading()));
    expect(iconNamed("Bravo Peak")).toBeDefined();
  });

  it("focused marker removed by an EMPTY replacement set → heading focused and the empty state shown", async () => {
    mockNetwork([alpha], []);
    const user = userEvent.setup();
    const { icons, iconNamed, heading } = renderPage();
    await waitFor(() => expect(icons()).toHaveLength(1));

    await user.type(screen.getByRole("textbox"), "x");
    iconNamed("Alpha Falls").focus();

    await waitFor(() => expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(icons()).toHaveLength(0));
    await waitFor(() => expect(document.activeElement).toBe(heading()));
    const section = heading().closest("section")!;
    expect(
      within(section).getByText(/no publicly viewable landmarks are currently shown/i),
    ).toBeInTheDocument();
  });

  it("focus inside the removed marker's open popup → heading focused", async () => {
    mockNetwork([alpha, bravo], [bravo]);
    const user = userEvent.setup();
    const { container, icons, iconNamed, heading } = renderPage();
    await waitFor(() => expect(icons()).toHaveLength(2));

    await user.type(screen.getByRole("textbox"), "x");
    const icon = iconNamed("Alpha Falls");
    icon.focus();
    fireEnter(icon);
    const popup = container.querySelector(".leaflet-popup") as HTMLElement;
    const group = await within(popup).findByRole("group", { name: "Alpha Falls details" });
    await waitFor(() => expect(document.activeElement).toBe(group));

    await waitFor(() => expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(icons()).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toBe(heading()));
    expect(container.querySelector(".leaflet-popup")).toBeNull();
  });

  it("does not steal focus from the search box when the user kept typing there", async () => {
    mockNetwork([alpha, bravo], [bravo]);
    const user = userEvent.setup();
    const { icons } = renderPage();
    await waitFor(() => expect(icons()).toHaveLength(2));

    const textbox = screen.getByRole("textbox");
    await user.type(textbox, "x");
    expect(document.activeElement).toBe(textbox);

    await waitFor(() => expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(icons()).toHaveLength(1));
    expect(document.activeElement).toBe(textbox);
  });

  it("does not move focus when the focused marker survives the update", async () => {
    mockNetwork([alpha, bravo], [bravo]);
    const user = userEvent.setup();
    const { icons, iconNamed } = renderPage();
    await waitFor(() => expect(icons()).toHaveLength(2));

    await user.type(screen.getByRole("textbox"), "x");
    const survivor = iconNamed("Bravo Peak");
    survivor.focus();

    await waitFor(() => expect(getLandmarkGeoMarkers).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(icons()).toHaveLength(1));
    expect(document.activeElement).toBe(survivor);
    expect(survivor.isConnected).toBe(true);
  });
});
