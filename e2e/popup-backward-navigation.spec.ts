import { test, expect, type Page } from "@playwright/test";

/**
 * M02-T08 Increment 5c — backward keyboard navigation out of a marker popup
 * returns to the marker that opened it (real production build, real backend,
 * real Chromium, trusted keyboard input). Leaflet renders popups in a pane
 * after all markers, so without the interception Shift+Tab from the popup
 * lands on the LAST marker in the result set, not the one the user came from.
 *
 * The MIDDLE marker (Bravo) is used so that "previous" (Alpha) and "next"
 * (Charlie) markers both exist and the natural order from the marker is
 * observable. Synthetic PUBLIC fixtures via route mocking; tiles stubbed; the
 * database and classifications are never touched.
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

async function mockApi(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
  await page.route("**/api/v1/categories", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/v1/landmarks?**", (route) => {
    const url = new URL(route.request().url());
    const isGeographic = url.searchParams.has("bbox") || url.searchParams.has("near");
    return route.fulfill({
      json: {
        items: isGeographic ? [ALPHA, BRAVO, CHARLIE] : [],
        page: 1,
        limit: 200,
        has_more: false,
        is_truncated: false,
      },
    });
  });
}

const marker = (page: Page, name: string) =>
  page.locator(`.leaflet-marker-icon[aria-label^="${name}"]`);
const popup = (page: Page) => page.locator(".leaflet-popup");

/** Opens Bravo's popup the way a keyboard user does, leaving focus on its content group. */
async function openBravoPopup(page: Page) {
  await mockApi(page);
  await page.goto("/");
  await expect(page.locator(".leaflet-marker-icon")).toHaveCount(3);
  const bravo = marker(page, "Bravo Peak");
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    if (await bravo.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(bravo).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("group", { name: "Bravo Peak details" })).toBeFocused();
  await expect(popup(page)).toHaveCount(1);
}

test.describe("Shift+Tab out of a marker popup returns to the originating marker", () => {
  test("from the content group: Shift+Tab → originating marker (popup stays open); then natural backward, forward, and Escape", async ({
    page,
  }) => {
    await openBravoPopup(page);
    const bravo = marker(page, "Bravo Peak");

    await page.keyboard.press("Shift+Tab");
    await expect(bravo).toBeFocused();
    await expect(popup(page)).toHaveCount(1);

    // Natural order from the marker: previous marker backward, next marker forward.
    await page.keyboard.press("Shift+Tab");
    await expect(marker(page, "Alpha Falls")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(bravo).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(marker(page, "Charlie Arch")).toBeFocused();
    await expect(popup(page)).toHaveCount(1);

    // Back on the marker, Escape dismisses the popup and focus stays put.
    await page.keyboard.press("Shift+Tab");
    await expect(bravo).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(popup(page)).toHaveCount(0);
    await expect(bravo).toBeFocused();
  });

  test("from the profile link: Shift+Tab → originating marker (popup stays open)", async ({
    page,
  }) => {
    await openBravoPopup(page);
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "View profile" })).toBeFocused();

    await page.keyboard.press("Shift+Tab");

    await expect(marker(page, "Bravo Peak")).toBeFocused();
    await expect(popup(page)).toHaveCount(1);
  });

  test("from the close button: Shift+Tab still reaches the profile link; forward Tab leaves the popup normally", async ({
    page,
  }) => {
    await openBravoPopup(page);
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    const closeButton = page.getByRole("button", { name: "Close popup" });
    await expect(closeButton).toBeFocused();

    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("link", { name: "View profile" })).toBeFocused();

    await page.keyboard.press("Tab");
    await expect(closeButton).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeFocused(); // out of the popup, into Leaflet's controls
    await expect(popup(page)).toHaveCount(1);
  });
});
