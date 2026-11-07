import { test, expect, type Page, type Route } from "@playwright/test";

/**
 * M02-T08 Increment 5a — when a geographic results update removes the map
 * marker (or open popup) that holds keyboard focus, focus must land on the
 * "Landmarks on the map" heading rather than falling to <body>; and focus
 * must NOT be moved when the user is elsewhere.
 *
 * Real production build, real backend, real Chromium. The discovery API
 * responses are intercepted at the browser's network layer and replaced with
 * synthetic PUBLIC fixtures (the real database has no PUBLIC landmarks and is
 * never touched): the first geographic request returns three markers, every
 * later one returns a reduced set after a deliberate delay, which leaves time
 * to move focus onto a marker between the filter commit and the update.
 */

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const CATEGORIES = [
  { slug: "arch", label: "Natural Arch" },
  { slug: "falls", label: "Waterfall" },
  { slug: "peak", label: "Mountain Peak" },
];

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

function collection(items: Item[]) {
  return { items, page: 1, limit: 200, has_more: false, is_truncated: false };
}

/** Delay before the second (and later) geographic response, so a keyboard user can reach a marker first. */
const UPDATE_DELAY_MS = 2500;

async function mockDiscoveryApi(page: Page, firstSet: Item[], laterSet: Item[]) {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
  await page.route("**/api/v1/categories", (route) => route.fulfill({ json: CATEGORIES }));
  let geographicCalls = 0;
  await page.route("**/api/v1/landmarks?**", async (route: Route) => {
    const url = new URL(route.request().url());
    const isGeographic = url.searchParams.has("bbox") || url.searchParams.has("near");
    if (!isGeographic) {
      // The separate name-search list (never coordinates); irrelevant here.
      return route.fulfill({ json: collection([]) });
    }
    geographicCalls += 1;
    if (geographicCalls === 1) return route.fulfill({ json: collection(firstSet) });
    await new Promise((resolve) => setTimeout(resolve, UPDATE_DELAY_MS));
    return route.fulfill({ json: collection(laterSet) });
  });
}

const markers = (page: Page) => page.locator(".leaflet-marker-icon");
const heading = (page: Page) => page.locator("#geo-results-heading");

/** Moves focus backwards from the search box, one Shift+Tab at a time, until the named marker is focused. */
async function shiftTabToMarker(page: Page, name: string) {
  const target = page.locator(`.leaflet-marker-icon[aria-label^="${name}"]`);
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press("Shift+Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Could not reach marker "${name}" with Shift+Tab within 40 presses`);
}

/** Types into the search box (starting the app's 300 ms debounce) so the next geographic refetch happens while focus is elsewhere. */
async function commitFilterThenFocusMarker(page: Page, name: string) {
  const searchBox = page.getByRole("textbox");
  await searchBox.fill("a");
  await shiftTabToMarker(page, name);
}

test.describe("focus when a results update removes the focused marker", () => {
  test("focused marker removed, populated replacement → focus lands on the results heading", async ({
    page,
  }) => {
    await mockDiscoveryApi(page, [ALPHA, BRAVO, CHARLIE], [BRAVO, CHARLIE]);
    await page.goto("/");
    await expect(markers(page)).toHaveCount(3);

    await commitFilterThenFocusMarker(page, "Alpha Falls");
    await expect(page.locator('.leaflet-marker-icon[aria-label^="Alpha Falls"]')).toBeFocused();

    await expect(markers(page)).toHaveCount(2, { timeout: UPDATE_DELAY_MS + 5000 });
    await expect(heading(page)).toBeFocused();
    await expect(page.locator('.leaflet-marker-icon[aria-label^="Alpha Falls"]')).toHaveCount(0);
  });

  test("focused marker removed, EMPTY replacement → focus lands on the results heading next to the empty state", async ({
    page,
  }) => {
    await mockDiscoveryApi(page, [ALPHA, BRAVO], []);
    await page.goto("/");
    await expect(markers(page)).toHaveCount(2);

    await commitFilterThenFocusMarker(page, "Alpha Falls");
    await expect(page.locator('.leaflet-marker-icon[aria-label^="Alpha Falls"]')).toBeFocused();

    await expect(markers(page)).toHaveCount(0, { timeout: UPDATE_DELAY_MS + 5000 });
    await expect(heading(page)).toBeFocused();
    await expect(
      page.getByText(/no publicly viewable landmarks are currently shown/i),
    ).toBeVisible();
  });

  test("focus inside the removed marker's open popup → focus lands on the results heading", async ({
    page,
  }) => {
    await mockDiscoveryApi(page, [ALPHA, BRAVO], [BRAVO]);
    await page.goto("/");
    await expect(markers(page)).toHaveCount(2);

    await commitFilterThenFocusMarker(page, "Alpha Falls");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("group", { name: "Alpha Falls details" })).toBeFocused();

    await expect(markers(page)).toHaveCount(1, { timeout: UPDATE_DELAY_MS + 5000 });
    await expect(heading(page)).toBeFocused();
    await expect(page.locator(".leaflet-popup")).toHaveCount(0);
  });

  test("focus is not moved when the user is on the search box while the update arrives", async ({
    page,
  }) => {
    await mockDiscoveryApi(page, [ALPHA, BRAVO], [BRAVO]);
    await page.goto("/");
    await expect(markers(page)).toHaveCount(2);

    const searchBox = page.getByRole("textbox");
    await searchBox.fill("a");
    await expect(searchBox).toBeFocused();

    await expect(markers(page)).toHaveCount(1, { timeout: UPDATE_DELAY_MS + 5000 });
    await expect(searchBox).toBeFocused();
    await expect(heading(page)).not.toBeFocused();
  });

  test("focus stays on a marker that survives the update", async ({ page }) => {
    await mockDiscoveryApi(page, [ALPHA, BRAVO], [BRAVO]);
    await page.goto("/");
    await expect(markers(page)).toHaveCount(2);

    await commitFilterThenFocusMarker(page, "Bravo Peak");
    const survivor = page.locator('.leaflet-marker-icon[aria-label^="Bravo Peak"]');
    await expect(survivor).toBeFocused();

    await expect(markers(page)).toHaveCount(1, { timeout: UPDATE_DELAY_MS + 5000 });
    await expect(survivor).toBeFocused();
  });
});
