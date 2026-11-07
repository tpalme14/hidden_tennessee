import { test, expect, type Page } from "@playwright/test";

/**
 * M02-T08 Increment 5d — the complete discovery KEYBOARD workflow on the
 * production build, in real Chromium with trusted keyboard input: skip links,
 * map focus and arrow panning, marker focus with a visible focus indicator,
 * Enter/Space activation, popup navigation and dismissal, and reaching the
 * non-map results lists. (Shift+Tab at the popup boundary and focus
 * restoration after a results update have their own dedicated specs.)
 *
 * Synthetic PUBLIC fixtures via route mocking; tiles stubbed; the database and
 * classifications are never touched. Every navigation step uses bounded Tab
 * loops keyed on the destination, never hardcoded press counts.
 */

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const ALPHA = {
  id: "11111111-1111-4111-8111-111111111111",
  display_name: "Alpha Falls",
  category: "falls",
  latitude: 35.6,
  longitude: -85.6,
};
const BRAVO = {
  id: "22222222-2222-4222-8222-222222222222",
  display_name: "Bravo Peak",
  category: "peak",
  latitude: 35.9,
  longitude: -84.9,
};
const CHARLIE = {
  id: "33333333-3333-4333-8333-333333333333",
  display_name: "Charlie Arch",
  category: "arch",
  latitude: 36.2,
  longitude: -86.3,
};
type Item = typeof ALPHA;

async function mockApi(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
  await page.route("**/api/v1/categories", (route) =>
    route.fulfill({ json: [{ slug: "falls", label: "Waterfall" }] }),
  );
  await page.route("**/api/v1/landmarks?**", (route) => {
    const url = new URL(route.request().url());
    const isGeographic = url.searchParams.has("bbox") || url.searchParams.has("near");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const all = [ALPHA, BRAVO, CHARLIE];
    const matching = q ? all.filter((i) => i.display_name.toLowerCase().includes(q)) : all;
    const items: Partial<Item>[] = isGeographic
      ? matching
      : matching.map(({ id, display_name, category }) => ({ id, display_name, category }));
    return route.fulfill({
      json: { items, page: 1, limit: 200, has_more: false, is_truncated: false },
    });
  });
}

/** Presses `key` until `predicate` is true for the active element (bounded), returning the press count. */
async function pressUntil(
  page: Page,
  key: string,
  predicate: (el: Element) => boolean,
  max = 40,
): Promise<number> {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press(key);
    if (await page.evaluate(predicate, undefined as never)) return i;
  }
  throw new Error(`Active element never matched after ${max} × ${key}`);
}

// Predicates run in the page, so they must be self-contained.
const isMapContainer = () =>
  document.activeElement?.classList.contains("leaflet-container") === true;
const isMarker = () => document.activeElement?.classList.contains("leaflet-marker-icon") === true;
const isSearchBox = () =>
  document.activeElement?.tagName === "INPUT" &&
  (document.activeElement as HTMLInputElement).type === "text";
// A result link is a link whose NEAREST section is the one labelled by that list's heading —
// the page's skip links live in the outer discovery section, which merely contains the lists.
const isGeoResultLink = () =>
  document.activeElement?.tagName === "A" &&
  document.activeElement.closest("section")?.getAttribute("aria-labelledby") ===
    "geo-results-heading";
const isSearchResultLink = () =>
  document.activeElement?.tagName === "A" &&
  document.activeElement.closest("section")?.getAttribute("aria-labelledby") === "search-heading";

function urlCenter(page: Page) {
  const p = new URL(page.url()).searchParams;
  return { lat: Number(p.get("lat")), lng: Number(p.get("lng")) };
}

async function loaded(page: Page) {
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(3);
  await expect.poll(() => new URL(page.url()).searchParams.has("lat")).toBe(true);
}

test.describe("complete keyboard workflow on the discovery page", () => {
  test("skip links: each moves focus to its results heading, bypassing the map and markers", async ({
    page,
  }) => {
    await loaded(page);
    await pressUntil(
      page,
      "Tab",
      () => document.activeElement?.textContent === "Skip to landmarks on the map",
      10,
    );
    await page.keyboard.press("Enter");
    await expect(page.locator("#geo-results-heading")).toBeFocused();
    // The next Tab goes INTO the geographic list, not back to markers.
    await page.keyboard.press("Tab");
    await expect(page.locator("#geo-results-heading")).not.toBeFocused();
    expect(await page.evaluate(isMarker)).toBe(false);

    await page.goto("/");
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(3);
    await pressUntil(
      page,
      "Tab",
      () => document.activeElement?.textContent === "Skip to name search results",
      10,
    );
    await page.keyboard.press("Enter");
    await expect(page.locator("#search-heading")).toBeFocused();
  });

  test("map: reachable by Tab, pans with the arrow keys while the container is focused", async ({
    page,
  }) => {
    await loaded(page);
    await pressUntil(page, "Tab", isMapContainer, 15);

    // The focused container carries the visible keyboard instruction as its accessible
    // description; the instruction itself is plain text that was NOT a Tab stop on the way here.
    const description = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement;
      const target = document.getElementById(el.getAttribute("aria-describedby") ?? "");
      return {
        text: target?.textContent?.replace(/\s+/g, " ").trim(),
        tag: target?.tagName,
        tabindex: target?.getAttribute("tabindex"),
      };
    });
    expect(description).toEqual({
      text: "Keyboard controls: Use arrow keys to pan the focused map. Press Tab to move between markers, Enter or Space to open a marker, and Escape to close its popup.",
      tag: "P",
      tabindex: null,
    });
    await expect(
      page.getByRole("region", { name: "Map of Tennessee natural landmarks" }),
    ).toBeVisible();

    const before = urlCenter(page);
    await page.keyboard.press("ArrowLeft");
    await expect.poll(() => urlCenter(page).lng).toBeLessThan(before.lng);
    await page.keyboard.press("ArrowUp");
    await expect.poll(() => urlCenter(page).lat).toBeGreaterThan(before.lat);
    expect(await page.evaluate(isMapContainer)).toBe(true);
  });

  test("markers: Tab reaches each marker in order, with a visible keyboard focus indicator and an accessible name", async ({
    page,
  }) => {
    await loaded(page);
    await pressUntil(page, "Tab", isMarker, 15);
    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      const info = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        const cs = getComputedStyle(el);
        return {
          label: el.getAttribute("aria-label"),
          role: el.getAttribute("role"),
          focusVisible: el.matches(":focus-visible"),
          outlineStyle: cs.outlineStyle,
          outlineWidth: cs.outlineWidth,
          boxShadow: cs.boxShadow,
        };
      });
      seen.push(info.label ?? "");
      expect(info.role).toBe("button");
      expect(info.focusVisible).toBe(true);
      expect(info.outlineStyle).not.toBe("none");
      expect(parseFloat(info.outlineWidth)).toBeGreaterThanOrEqual(3);
      expect(info.boxShadow).not.toBe("none");
      if (i < 2) await page.keyboard.press("Tab");
    }
    expect(seen).toEqual([
      "Alpha Falls, Waterfall",
      "Bravo Peak, Mountain Peak",
      "Charlie Arch, Natural Arch",
    ]);
  });

  test("popups: Enter and Space open, content → link → close button by Tab, Escape dismisses and restores focus", async ({
    page,
  }) => {
    await loaded(page);
    await pressUntil(page, "Tab", isMarker, 15);
    const alpha = page.locator('.leaflet-marker-icon[aria-label^="Alpha Falls"]');
    await expect(alpha).toBeFocused();

    // Enter opens; focus lands in the content group.
    await page.keyboard.press("Enter");
    const group = page.getByRole("group", { name: "Alpha Falls details" });
    await expect(group).toBeFocused();
    await expect(group).toContainText("Waterfall");

    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "View profile" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Close popup" })).toBeFocused();

    // Escape from the close button closes and returns focus to the marker.
    await page.keyboard.press("Escape");
    await expect(page.locator(".leaflet-popup")).toHaveCount(0);
    await expect(alpha).toBeFocused();

    // Space opens too (and does not scroll the page); Escape on the marker closes.
    const scrollBefore = await page.evaluate(() => window.scrollY);
    await page.keyboard.press("Space");
    await expect(group).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
    await page.keyboard.press("Escape");
    await expect(page.locator(".leaflet-popup")).toHaveCount(0);
    await expect(alpha).toBeFocused();

    // The close button itself works by keyboard and restores focus to the marker.
    await page.keyboard.press("Enter");
    await expect(group).toBeFocused();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Enter");
    await expect(page.locator(".leaflet-popup")).toHaveCount(0);
    await expect(alpha).toBeFocused();
  });

  test("non-map results: both lists are reachable and operable by keyboard alone", async ({
    page,
  }) => {
    await loaded(page);
    // Geographic results list: the same markers, as links.
    await pressUntil(page, "Tab", isGeoResultLink, 40);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Alpha Falls");

    // Name search: type a filter, then reach its results.
    await pressUntil(page, "Tab", isSearchBox, 40);
    await page.keyboard.type("Falls");
    // The search is debounced (300 ms) and fetched; wait for its result to render before tabbing on.
    const searchSection = page.locator('section[aria-labelledby="search-heading"]');
    await expect(searchSection.getByRole("link", { name: "Alpha Falls" })).toBeVisible();
    await pressUntil(page, "Tab", isSearchResultLink, 40);
    expect(await page.evaluate(() => document.activeElement?.textContent)).toBe("Alpha Falls");

    // Activating a result link by keyboard opens the profile; Back returns to discovery.
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/landmarks\//);
  });
});
