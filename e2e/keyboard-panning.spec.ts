import { test, expect, type Page } from "@playwright/test";

/**
 * M02-T08 Increment 4 — keyboard panning regression coverage (spec §3.2:
 * "Users can pan and zoom using supported pointer and keyboard interactions").
 *
 * Runs against the real production build served by the real backend (the
 * project's existing Playwright webServer), in real Chromium with trusted
 * keyboard input. Needs no landmark data: it exercises Leaflet's own keyboard
 * handler on the map container plus the app's URL viewport tracking.
 *
 * Two independent movement signals are asserted, so a pass means Leaflet
 * actually moved the map AND the app observed the move end-to-end:
 *  1. Leaflet's own DOM: the `.leaflet-map-pane` transform, which Leaflet
 *     shifts by the pan offset (negative x for a pan east, negative y for a
 *     pan south).
 *  2. The app's URL: `MapViewportTracker` writes the new centre (`lat`/`lng`)
 *     on Leaflet's `moveend`, so a changed URL proves the move completed and
 *     was reported — no fixed delays, just polling for the settled state.
 */

// A valid 1×1 transparent PNG, served for every tile request so the test never
// reaches the public tile server and never triggers the app's tile-error state.
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

async function blockTileRequests(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
}

function urlCenter(page: Page): { lat: number; lng: number } | null {
  const params = new URL(page.url()).searchParams;
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  return params.has("lat") && params.has("lng") && Number.isFinite(lat) && Number.isFinite(lng)
    ? { lat, lng }
    : null;
}

/** Leaflet's current map-pane translation, read from its own inline transform. */
async function mapPaneOffset(page: Page): Promise<{ x: number; y: number }> {
  return page.locator(".leaflet-map-pane").evaluate((pane) => {
    const match = /translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/.exec(pane.style.transform);
    return match ? { x: Number(match[1]), y: Number(match[2]) } : { x: 0, y: 0 };
  });
}

/**
 * Focuses the map the way a keyboard user does: by tabbing forward from the
 * top of the document until the Leaflet container is the active element.
 * Bounded, but not tied to a hardcoded number of Tab presses, so adding or
 * removing a skip link or control before the map doesn't break this test.
 */
async function tabToMap(page: Page): Promise<void> {
  const map = page.locator(".leaflet-container");
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    if (await map.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error("Could not reach the map container with Tab within 25 presses");
}

test.describe("keyboard panning of the discovery map", () => {
  test.beforeEach(async ({ page }) => {
    await blockTileRequests(page);
    await page.goto("/");
    // The app writes the initial viewport into the URL once Leaflet is ready.
    await expect.poll(() => urlCenter(page)).not.toBeNull();
  });

  test("ArrowRight and ArrowDown pan the map east and south once the map has keyboard focus", async ({
    page,
  }) => {
    const map = page.locator(".leaflet-container");

    await tabToMap(page);
    await expect(map).toBeFocused();

    const startCenter = urlCenter(page)!;
    const startPane = await mapPaneOffset(page);

    await page.keyboard.press("ArrowRight");
    // Pan east: longitude increases; Leaflet shifts the pane left (negative x).
    await expect.poll(() => urlCenter(page)!.lng).toBeGreaterThan(startCenter.lng);
    await expect.poll(async () => (await mapPaneOffset(page)).x).toBeLessThan(startPane.x);
    expect(urlCenter(page)!.lat).toBeCloseTo(startCenter.lat, 2);

    const afterRight = urlCenter(page)!;
    const paneAfterRight = await mapPaneOffset(page);

    await page.keyboard.press("ArrowDown");
    // Pan south: latitude decreases; Leaflet shifts the pane up (negative y).
    await expect.poll(() => urlCenter(page)!.lat).toBeLessThan(afterRight.lat);
    await expect.poll(async () => (await mapPaneOffset(page)).y).toBeLessThan(paneAfterRight.y);
    expect(urlCenter(page)!.lng).toBeCloseTo(afterRight.lng, 2);

    // The map is still the focused element after panning — no focus loss.
    await expect(map).toBeFocused();
  });

  test("arrow keys do not pan the map while focus is on a neutral control outside it", async ({
    page,
  }) => {
    const neutral = page.getByRole("button", { name: "Find near map center" });
    await neutral.focus();
    await expect(neutral).toBeFocused();

    const startCenter = urlCenter(page)!;
    const startPane = await mapPaneOffset(page);

    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");
    // A negative check needs a bounded settle window: Leaflet's keyboard pan
    // animates for 0.25s and the app writes the URL on moveend, so anything
    // that was going to move has done so well within this window.
    await page.waitForTimeout(750);

    expect(urlCenter(page)).toEqual(startCenter);
    expect(await mapPaneOffset(page)).toEqual(startPane);
    await expect(page.locator(".leaflet-container")).not.toBeFocused();
  });
});

/**
 * M06-T02 Increment 5a — navigating away from Discover while the map is still
 * animating keeps the destination. Before the correction, a Leaflet
 * `zoomend`/`moveend` delivered after the navigation (or the text debounce)
 * could make Discover replace the new route with `/?…` (observed 3/80 in
 * instrumented runs). Every history operation is recorded; after the push to
 * the destination, no `replaceState` back to `/` may follow.
 *
 * The final wait is an OBSERVATION boundary (longer than Leaflet's 250 ms zoom
 * animation timer), not a synchronization: the destination is already
 * asserted before it. A passing run is evidence, not proof, for an
 * intermittent race; the deterministic guarantees are in
 * `MapViewportTracker.test.tsx` and `useDiscoveryUrlState.test.tsx`.
 */
test("navigating away from Discover during a zoom animation keeps the destination (10 bounded attempts)", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await blockTileRequests(page);
  await page.addInitScript(() => {
    const w = window as unknown as { __historyOps: string[] };
    w.__historyOps = [];
    const push = history.pushState.bind(history);
    const replace = history.replaceState.bind(history);
    history.pushState = (...args: Parameters<History["pushState"]>) => {
      w.__historyOps.push(`push ${new URL(String(args[2]), location.href).pathname}`);
      return push(...args);
    };
    history.replaceState = (...args: Parameters<History["replaceState"]>) => {
      w.__historyOps.push(`replace ${new URL(String(args[2]), location.href).pathname}`);
      return replace(...args);
    };
  });
  const signIn = page.getByRole("link", { name: "Sign in" });

  for (let attempt = 1; attempt <= 10; attempt++) {
    await page.goto("/");
    await expect(page.locator(".leaflet-container")).toBeVisible();
    await expect(signIn).toBeVisible();
    // The map's initial view has been reported to the URL (MapViewportTracker's whenReady).
    await expect.poll(() => urlCenter(page)).not.toBeNull();
    await page.evaluate(() => {
      (window as unknown as { __historyOps: string[] }).__historyOps.length = 0;
    });

    await page.getByRole("button", { name: "Zoom in" }).click(); // starts Leaflet's zoom animation
    await signIn.click(); // navigates away at once
    await expect(page.getByRole("heading", { name: "Sign in", level: 2 })).toBeVisible();
    await page.waitForTimeout(500); // observation boundary (see the comment above)

    const ops = await page.evaluate(
      () => (window as unknown as { __historyOps: string[] }).__historyOps,
    );
    const afterPush = ops.slice(ops.indexOf("push /sign-in") + 1);
    expect(ops, `attempt ${attempt}: the navigation was a push to /sign-in`).toContain(
      "push /sign-in",
    );
    expect(
      afterPush.filter((op) => op === "replace /"),
      `attempt ${attempt}: no Discover URL write after leaving (history: ${ops.join(", ")})`,
    ).toEqual([]);
    expect(new URL(page.url()).pathname, `attempt ${attempt}: destination kept`).toBe("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in", level: 2 })).toBeVisible();
  }
});
