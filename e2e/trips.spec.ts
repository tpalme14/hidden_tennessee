import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Locator, Page, Route, TestInfo } from "@playwright/test";
import { FIXTURE_REGION_BBOX, type FixtureLandmark } from "./helpers/favoritesFixtures";
import { ORIGIN, TRIP_PASSWORD, expect, test } from "./helpers/tripFixtures";

/**
 * M05-T04 Increment 6 — the trip interfaces in a real browser (Chromium),
 * against the real server on `landmarks_test`, with guarded synthetic
 * fixtures (e2e/helpers/tripFixtures.ts).
 *
 * Two kinds of journey, labelled in each test's title:
 * - [real]: every request reaches the real API; nothing is intercepted except
 *   OpenStreetMap tiles (served a 1×1 PNG, as in every other spec);
 * - [intercepted]: one named request is delayed, failed, or answered by
 *   `page.route` to reproduce a failure path deterministically; every other
 *   request is real.
 *
 * Accessibility: axe (WCAG 2.0–2.2 A/AA tags) in the listed states, and DOM /
 * accessibility-tree checks of names, roles, focus, and live regions. No
 * screen reader is used here.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const RLO = String.fromCodePoint(0x202e);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createTrip(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/v1/trips", {
    headers: { Origin: ORIGIN },
    data: { name },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { trip: { id: string } }).trip.id;
}

async function addStop(request: APIRequestContext, tripId: string, landmark: FixtureLandmark) {
  const response = await request.post(`/api/v1/trips/${tripId}/stops`, {
    headers: { Origin: ORIGIN },
    data: { landmark_id: landmark.id },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { stop: { id: string } }).stop.id;
}

async function serverTrip(request: APIRequestContext, tripId: string) {
  const response = await request.get(`/api/v1/trips/${tripId}`);
  expect(response.status()).toBe(200);
  return (
    (await response.json()) as {
      trip: { version: number; stops: { id: string; landmark: { id: string } }[] };
    }
  ).trip;
}

async function serverTrips(request: APIRequestContext) {
  const response = await request.get("/api/v1/trips?limit=100");
  expect(response.status()).toBe(200);
  return ((await response.json()) as { trips: { id: string; name: string; stop_count: number }[] })
    .trips;
}

const stopsList = (page: Page) => page.getByRole("list", { name: "Stops" });
const stopItems = (page: Page) => stopsList(page).getByRole("listitem");
const stopsHeading = (page: Page) => page.getByRole("heading", { level: 3, name: "Stops" });
const markers = (page: Page) => page.locator(".leaflet-marker-icon");
const status = (page: Page) =>
  page.locator("section[aria-labelledby='trip-heading'] > p[role='status']");

async function openTrip(page: Page, tripId: string) {
  await page.goto(`/trips/${tripId}`);
  await expect(stopsHeading(page)).toBeVisible();
}

async function activeLabel(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "BODY";
    return el.getAttribute("aria-label") ?? el.textContent ?? el.tagName;
  });
}

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => el === document.activeElement);
}

async function tabTo(page: Page, target: Locator, max = 80) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press("Tab");
    if (await isFocused(target)) return;
  }
  throw new Error(`Could not reach the target with Tab within ${max} presses`);
}

/** Holds matching requests until `release()`; `count` is how many arrived. */
async function gate(page: Page, url: string | RegExp, method: string) {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const seen = { count: 0 };
  await page.route(url, async (route: Route) => {
    if (route.request().method() !== method) return route.fallback();
    seen.count += 1;
    await opened;
    await route.fallback();
  });
  return { release, seen };
}

async function scan(page: Page, testInfo: TestInfo, state: string, exclude: string[] = []) {
  let builder = new AxeBuilder({ page }).withTags(WCAG_TAGS);
  for (const selector of exclude) builder = builder.exclude(selector);
  const results = await builder.analyze();
  const summary = {
    state,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? "unknown",
      nodes: v.nodes.length,
      firstTarget: String(v.nodes[0]?.target ?? ""),
    })),
    incomplete: results.incomplete.map((i) => ({ id: i.id, nodes: i.nodes.length })),
    passes: results.passes.length,
  };
  await testInfo.attach(`axe-${state}.json`, {
    contentType: "application/json",
    body: JSON.stringify(
      { violations: results.violations, incomplete: results.incomplete },
      null,
      2,
    ),
  });
  console.log(`[axe] ${state}: ${JSON.stringify(summary)}`);
  expect(summary.violations, `axe violations in "${state}"`).toEqual([]);
}

/** No horizontal page overflow, and every visible control of `scope` inside the viewport. */
async function expectNoOverflow(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - width;
    const offenders: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>(
        "main button, main a, main input, main h2, main h3, main li, main [role=alert], main p",
      ),
    )) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (el.closest(".leaflet-container")) continue; // map panes are clipped by design
      // Partly outside only: wholly off-screen elements are visually hidden on purpose (skip links).
      if ((box.right > width + 1 && box.left < width) || (box.left < -1 && box.right > 0)) {
        offenders.push(
          `${el.tagName}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").slice(0, 40)}`,
        );
      }
    }
    return { overflow, offenders: offenders.slice(0, 5) };
  });
  expect(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect(result.offenders, `${label}: elements outside the viewport`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
});

// ---------------------------------------------------------------------------
// Trip detail (read side)
// ---------------------------------------------------------------------------

test("[real] trip detail: sign-in return, owner view, redaction, numbering, distances, map markers, no route geometry", async ({
  page,
  browser,
  trips,
}, testInfo) => {
  const email = await trips.signUpAndIn(page.request);
  const name = `Weekend ${RLO}sllaF ${"long name ".repeat(6)}`.trim();
  const tripId = await createTrip(page.request, name);
  const [s1, s2] = trips.stops;
  for (const landmark of [s1, trips.hidden, s2, trips.stops[2], trips.retired]) {
    await addStop(page.request, tripId, landmark);
  }
  await trips.makeHiddenSensitive();
  await trips.retire();

  // Signed out (a fresh context): the sign-in link returns to this trip.
  const anonymous = await browser.newContext();
  const anon = await anonymous.newPage();
  await anon.route(/tile\.openstreetmap\.org/, (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
  await anon.goto(`/trips/${tripId}`);
  const signInLink = anon.getByRole("link", { name: "Sign in to see this trip" });
  await expect(signInLink).toHaveAttribute(
    "href",
    `/sign-in?returnTo=${encodeURIComponent(`/trips/${tripId}`)}`,
  );
  await expect(anon.getByText(name)).toHaveCount(0);
  await signInLink.click();
  const form = anon.getByRole("region", { name: "Sign in" });
  await form.getByLabel("Email address").fill(email);
  await form.getByLabel("Password").fill(TRIP_PASSWORD);
  await form.getByRole("button", { name: "Sign in" }).click();
  await expect(anon).toHaveURL(new RegExp(`/trips/${tripId}$`));
  await expect(anon.getByRole("list", { name: "Stops" })).toBeVisible();
  await anonymous.close();

  // Owner view.
  await openTrip(page, tripId);
  const heading = page.getByRole("heading", { level: 2 });
  await expect(heading.locator("bdi")).toHaveText(name);
  expect(await stopsList(page).evaluate((el) => el.tagName)).toBe("OL");
  await expect(stopItems(page)).toHaveCount(5);
  const texts = await stopItems(page).allTextContents();
  expect(texts.map((t) => t.match(/^Stop \d+/)?.[0])).toEqual([
    "Stop 1",
    "Stop 2",
    "Stop 3",
    "Stop 4",
    "Stop 5",
  ]);
  for (const i of [1, 4]) {
    await expect(stopItems(page).nth(i)).toContainText("No longer available");
    await expect(stopItems(page).nth(i).getByRole("link")).toHaveCount(0);
  }
  const html = await page.content();
  expect(html).not.toContain(trips.hidden.displayName);
  expect(html).not.toContain(trips.retired.displayName);
  // Distances: only stop 3 → stop 4 is measured.
  await expect(stopItems(page).nth(2)).toContainText(
    "Distance from the previous stop not measured, because the previous stop is no longer available.",
  );
  await expect(stopItems(page).nth(3)).toContainText(
    /mi \(.*km\) straight-line from the previous stop/,
  );
  await expect(page.getByText(/^Straight-line total of 1 of 4 legs: /)).toBeVisible();
  await expect(
    page.getByText("Straight-line distances, not travel or trail distances."),
  ).toBeVisible();

  // Map: available stops only, numbered with gaps, tiles requested and drawn, no route geometry.
  await expect(markers(page)).toHaveCount(3);
  expect(
    await markers(page).evaluateAll((els) => els.map((e) => e.getAttribute("aria-label"))),
  ).toEqual([
    `Stop 1: ${s1.displayName}, Waterfall`,
    `Stop 3: ${s2.displayName}, Natural Arch`,
    `Stop 4: ${trips.stops[2].displayName}, Waterfall`,
  ]);
  expect(await markers(page).allTextContents()).toEqual(["1", "3", "4"]);
  for (let i = 0; i < 3; i += 1) await expect(markers(page).nth(i)).toBeVisible();
  await expect(page.locator(".leaflet-tile-loaded").first()).toBeVisible();
  const geometry = await page.evaluate(() => {
    const map = document.querySelector(".leaflet-container")!;
    return {
      overlayChildren: map.querySelector(".leaflet-overlay-pane")?.childElementCount ?? 0,
      // Inside the map panes only (the attribution control has its own small SVG flag).
      vectors: map.querySelectorAll(
        ".leaflet-map-pane svg, .leaflet-map-pane canvas, .leaflet-map-pane path, .leaflet-map-pane polyline",
      ).length,
    };
  });
  expect(geometry).toEqual({ overlayChildren: 0, vectors: 0 });
  await expect(page.getByText(/not a route/)).toBeVisible();
  await scan(page, testInfo, "trip-detail-with-unavailable-stops");
});

test("[real + intercepted] trip detail states: generic not-found, error and retry, empty trip, auth loss", async ({
  page,
  browser,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  const emptyTrip = await createTrip(page.request, "Nothing yet");

  // Another user's trip and a missing trip: identical not-found section.
  const other = await browser.newContext();
  await trips.signUpAndIn(other.request);
  const othersTrip = await createTrip(other.request, "Someone else's");
  await other.close();
  await page.goto(`/trips/${othersTrip}`);
  await expect(page.getByText(/This trip couldn't be found/)).toBeVisible();
  const foreign = await page.locator("section[aria-labelledby='trip-heading']").innerHTML();
  expect(foreign).not.toContain("Someone else");
  await page.goto("/trips/00000000-0000-4000-8000-000000000000");
  await expect(page.getByText(/This trip couldn't be found/)).toBeVisible();
  expect(await page.locator("section[aria-labelledby='trip-heading']").innerHTML()).toBe(foreign);
  await scan(page, testInfo, "trip-not-found");

  // [intercepted] A failed load offers Try again.
  let fail = true;
  await page.route(`**/api/v1/trips/${emptyTrip}`, (route) =>
    fail && route.request().method() === "GET"
      ? route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "x" } } })
      : route.fallback(),
  );
  await page.goto(`/trips/${emptyTrip}`);
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(/Couldn't load this trip\. Please try again\./);
  fail = false;
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("This trip has no stops yet.")).toBeVisible();
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
  await scan(page, testInfo, "trip-empty");

  // Auth loss: signing out elsewhere, then a 401, removes all private data.
  await page.request.post("/api/auth/sign-out", { headers: { Origin: ORIGIN }, data: {} });
  await page.reload();
  await expect(page.getByRole("link", { name: "Sign in to see this trip" })).toBeVisible();
  await expect(page.getByText("Nothing yet")).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

test("[real] editing: remove available and unavailable stops, move up/down at the boundaries, persistence, focus and announcements", async ({
  page,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Editing");
  const [a, b, c] = trips.stops;
  for (const landmark of [a, trips.hidden, b, c]) await addStop(page.request, tripId, landmark);
  await trips.makeHiddenSensitive();
  await openTrip(page, tripId);

  // Boundaries.
  await expect(page.getByRole("button", { name: `Move up: ${a.displayName}` })).toBeDisabled();
  await expect(page.getByRole("button", { name: `Move down: ${c.displayName}` })).toBeDisabled();

  // Move down (real), focus stays on the same button, announcement.
  await page.getByRole("button", { name: `Move down: ${a.displayName}` }).click();
  await expect(status(page)).toHaveText(`Moved ${a.displayName} to position 2 of 4.`);
  await expect(page.getByRole("button", { name: `Move down: ${a.displayName}` })).toBeFocused();
  // Move up to the top: focus moves to its Move down button.
  await page.getByRole("button", { name: `Move up: ${b.displayName}` }).click();
  await expect(status(page)).toHaveText(`Moved ${b.displayName} to position 2 of 4.`);
  await page.getByRole("button", { name: `Move up: ${b.displayName}` }).click();
  await expect(status(page)).toHaveText(`Moved ${b.displayName} to position 1 of 4.`);
  await expect(page.getByRole("button", { name: `Move down: ${b.displayName}` })).toBeFocused();

  // Persistence after reload equals the server order.
  const server = await serverTrip(page.request, tripId);
  await page.reload();
  await expect(stopItems(page)).toHaveCount(4);
  expect(server.stops.map((s) => s.landmark.id)).toEqual([b.id, trips.hidden.id, a.id, c.id]);
  await expect(stopItems(page).nth(0)).toContainText(b.displayName);
  await expect(stopItems(page).nth(2)).toContainText(a.displayName);

  // Remove the unavailable stop (named by position): focus → next stop's Remove.
  await page
    .getByRole("button", { name: "Remove stop 2 (no longer available) from the trip" })
    .click();
  await expect(status(page)).toHaveText(
    "Removed stop 2, which was no longer available. The trip has 3 stops.",
  );
  await expect(
    page.getByRole("button", { name: `Remove ${a.displayName} from the trip` }),
  ).toBeFocused();
  // Distances recalculated by the server: all legs measured now.
  await expect(page.getByText(/^Straight-line total: /)).toBeVisible();

  // Remove the last listed stop: focus → previous stop's Remove.
  await page.getByRole("button", { name: `Remove ${c.displayName} from the trip` }).click();
  await expect(status(page)).toHaveText(
    `Removed ${c.displayName} from the trip. The trip has 2 stops.`,
  );
  await expect(
    page.getByRole("button", { name: `Remove ${a.displayName} from the trip` }),
  ).toBeFocused();
  await scan(page, testInfo, "trip-after-edits");

  // Remove the remaining stops: empty state, focus on the Stops heading.
  await page.getByRole("button", { name: `Remove ${b.displayName} from the trip` }).click();
  await expect(status(page)).toHaveText(/The trip has 1 stop\.$/);
  await page.getByRole("button", { name: `Remove ${a.displayName} from the trip` }).click();
  await expect(page.getByText("This trip has no stops yet.")).toBeVisible();
  await expect(stopsHeading(page)).toBeFocused();
  await page.reload();
  await expect(page.getByText("This trip has no stops yet.")).toBeVisible();
  expect((await serverTrip(page.request, tripId)).stops).toEqual([]);
});

test("[real] version conflict across two tabs: re-read, exact message, Stops heading focused, nothing replayed", async ({
  page,
  context,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Two tabs");
  const [a, b, c] = trips.stops;
  for (const landmark of [a, b, c]) await addStop(page.request, tripId, landmark);
  await openTrip(page, tripId);

  const other = await context.newPage();
  await other.route(/tile\.openstreetmap\.org/, (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
  await openTrip(other, tripId);
  await other.getByRole("button", { name: `Move up: ${c.displayName}` }).click();
  await expect(status(other)).toHaveText(`Moved ${c.displayName} to position 2 of 3.`);

  const puts: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "PUT") puts.push(r.url());
  });
  await page.getByRole("button", { name: `Move down: ${a.displayName}` }).click();
  await expect(status(page)).toHaveText(
    "This trip changed since you loaded it. The latest order is shown — try again.",
  );
  await expect(stopItems(page).nth(1)).toContainText(c.displayName);
  await expect(stopsHeading(page)).toBeFocused();
  expect(puts).toHaveLength(1);
  expect((await serverTrip(page.request, tripId)).stops.map((s) => s.landmark.id)).toEqual([
    a.id,
    c.id,
    b.id,
  ]);
  await scan(page, testInfo, "trip-version-conflict-recovered");
});

test("[intercepted] editing failure paths: duplicate clicks, failed re-read with Reload, uncertain outcome without replay, pending state", async ({
  page,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Failures");
  const [a, b, c] = trips.stops;
  for (const landmark of [a, b, c]) await addStop(page.request, tripId, landmark);
  await openTrip(page, tripId);

  // Duplicate clicks while a DELETE is held: one request; pending state announced.
  const held = await gate(page, new RegExp(`/api/v1/trips/${tripId}/stops/`), "DELETE");
  const remove = page.getByRole("button", { name: `Remove ${b.displayName} from the trip` });
  await remove.click();
  await remove.click({ force: true });
  await page.getByRole("button", { name: `Move down: ${a.displayName}` }).click({ force: true });
  await expect(status(page)).toHaveText("Removing stop…");
  await expect(remove).toHaveAttribute("aria-disabled", "true");
  await scan(page, testInfo, "trip-edit-pending");
  held.release();
  await expect(status(page)).toHaveText(/Removed .* The trip has 2 stops\./);
  expect(held.seen.count).toBe(1);
  await page.unroute(new RegExp(`/api/v1/trips/${tripId}/stops/`));

  // The DELETE succeeds but the re-read fails: told it was removed, Reload offered and focused.
  let failReads = 0;
  await page.route(`**/api/v1/trips/${tripId}`, (route) => {
    if (route.request().method() === "GET" && failReads > 0) {
      failReads -= 1;
      return route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "x" } },
      });
    }
    return route.fallback();
  });
  failReads = 1;
  const deletes: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "DELETE") deletes.push(r.url());
  });
  await page.getByRole("button", { name: `Remove ${c.displayName} from the trip` }).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(
    "The stop was removed, but the updated trip couldn't be loaded.",
  );
  await expect(alert.getByRole("button", { name: "Reload trip" })).toBeFocused();
  await expect(stopsList(page)).toHaveCount(0);
  await scan(page, testInfo, "trip-reload-required");
  await alert.getByRole("button", { name: "Reload trip" }).click();
  await expect(stopItems(page)).toHaveCount(1);
  expect(deletes).toHaveLength(1);

  // An uncertain reorder (connection dropped): re-read, never replayed.
  await addStop(page.request, tripId, b);
  await page.reload();
  await expect(stopItems(page)).toHaveCount(2);
  const puts: string[] = [];
  await page.route(`**/api/v1/trips/${tripId}/stops/order`, (route) => {
    puts.push(route.request().url());
    return route.abort("connectionreset");
  });
  await page.getByRole("button", { name: `Move down: ${a.displayName}` }).click();
  await expect(status(page)).toHaveText(/Couldn't confirm whether your change was saved/);
  expect(puts).toHaveLength(1);
  await expect(stopsHeading(page)).toBeFocused();
});

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

test("[real + intercepted] map keyboard: Tab, focus ring, Enter/Space/Escape/close, Shift+Tab, renumbering and removal while focused, viewport kept on reorder", async ({
  page,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Map keyboard");
  const [a, b, c] = trips.stops;
  for (const landmark of [a, b, c]) await addStop(page.request, tripId, landmark);
  await openTrip(page, tripId);
  await expect(markers(page)).toHaveCount(3);

  // Tab reaches a marker; the focus ring is visible.
  const first = markers(page).first();
  await tabTo(page, first);
  const ring = await first.evaluate((el) => {
    const style = getComputedStyle(el);
    return { outline: style.outlineStyle, width: style.outlineWidth, shadow: style.boxShadow };
  });
  expect(ring.outline).toBe("solid");
  expect(ring.width).toBe("3px");
  expect(ring.shadow).not.toBe("none");

  // Enter opens the popup with focus inside; it holds the stop number, name, and a profile link.
  await page.keyboard.press("Enter");
  const popup = page.locator(".leaflet-popup");
  await expect(popup).toBeVisible();
  const group = popup.getByRole("group", { name: `Stop 1: ${a.displayName} details` });
  await expect(group).toBeFocused();
  await expect(group.getByRole("link", { name: "View profile" })).toHaveAttribute(
    "href",
    `/landmarks/${a.id}`,
  );
  await scan(page, testInfo, "trip-map-popup-open");
  // Shift+Tab from the popup content returns to the marker, popup still open.
  await page.keyboard.press("Shift+Tab");
  await expect(first).toBeFocused();
  // Escape (from the marker) closes the popup.
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  // Space opens; the close button returns focus to the marker.
  await page.keyboard.press(" ");
  await expect(popup).toBeVisible();
  await popup.locator(".leaflet-popup-close-button").click();
  await expect(popup).toHaveCount(0);
  await expect(first).toBeFocused();
  // Escape inside the popup returns focus to the marker.
  await page.keyboard.press("Enter");
  await expect(group).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(first).toBeFocused();

  // Viewport kept during a reorder: marker positions do not move, only their numbers.
  const positionsBefore = await markers(page).evaluateAll((els) =>
    els.map((e) => ({
      label: (e.getAttribute("aria-label") ?? "").replace(/^Stop \d+: /, ""),
      box: e.getBoundingClientRect().toJSON() as DOMRect,
    })),
  );

  // Renumbering while a marker has focus: start a move from the list (held), then focus a marker.
  const held = await gate(page, `**/api/v1/trips/${tripId}/stops/order`, "PUT");
  await page.getByRole("button", { name: `Move up: ${c.displayName}` }).click();
  const bMarker = markers(page).filter({ hasText: "2" });
  await bMarker.focus();
  expect(await activeLabel(page)).toBe(`Stop 2: ${b.displayName}, Natural Arch`);
  held.release();
  await expect(status(page)).toHaveText(`Moved ${c.displayName} to position 2 of 3.`);
  await expect(markers(page).filter({ hasText: "3" })).toHaveAttribute(
    "aria-label",
    `Stop 3: ${b.displayName}, Natural Arch`,
  );
  // Focus followed the renumbered marker — never lost to <body>, never moved to the list.
  expect(await activeLabel(page)).toBe(`Stop 3: ${b.displayName}, Natural Arch`);
  await page.unroute(`**/api/v1/trips/${tripId}/stops/order`);

  const positionsAfter = await markers(page).evaluateAll((els) =>
    els.map((e) => ({
      label: (e.getAttribute("aria-label") ?? "").replace(/^Stop \d+: /, ""),
      box: e.getBoundingClientRect().toJSON() as DOMRect,
    })),
  );
  for (const before of positionsBefore) {
    const after = positionsAfter.find((p) => p.label === before.label)!;
    expect(Math.abs(after.box.x - before.box.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after.box.y - before.box.y)).toBeLessThanOrEqual(1);
  }

  // Renumbering while the marker's POPUP has focus.
  const held2 = await gate(page, `**/api/v1/trips/${tripId}/stops/order`, "PUT");
  await page.getByRole("button", { name: `Move down: ${a.displayName}` }).click();
  const bNow = markers(page).filter({ hasText: "3" });
  await bNow.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".leaflet-popup").getByRole("group")).toBeFocused();
  held2.release();
  await expect(status(page)).toHaveText(`Moved ${a.displayName} to position 2 of 3.`);
  const afterPopup = await activeLabel(page);
  expect(afterPopup === "BODY", "focus must not be lost to <body>").toBe(false);
  await page.unroute(`**/api/v1/trips/${tripId}/stops/order`);
  await page.keyboard.press("Escape");

  // A focused marker that disappears (removed in another tab, seen on re-read): focus → Stops heading.
  await page.request.delete(
    `/api/v1/trips/${tripId}/stops/${(await serverTrip(page.request, tripId)).stops.find((s) => s.landmark.id === b.id)!.id}`,
    {
      headers: { Origin: ORIGIN },
    },
  );
  const bMarkerNow = markers(page).filter({ hasText: "3" });
  // The user moves to the map while a list action is still running.
  const held3 = await gate(page, `**/api/v1/trips/${tripId}/stops/order`, "PUT");
  // Order is now [c, a, b]: c is first, so its Move down is the enabled control.
  await page.getByRole("button", { name: `Move down: ${c.displayName}` }).click();
  await bMarkerNow.focus();
  held3.release();
  await expect(status(page)).toHaveText(/This trip/);
  await expect(markers(page)).toHaveCount(2);
  await expect(stopsHeading(page)).toBeFocused();
});

test("[real] map viewport: a single stop is centred", async ({ page, trips }) => {
  await trips.signUpAndIn(page.request);
  const single = await createTrip(page.request, "Single");
  await addStop(page.request, single, trips.stops[0]);
  await openTrip(page, single);
  await expect(markers(page)).toHaveCount(1);
  const centred = await page.evaluate(() => {
    const map = document.querySelector(".leaflet-container")!.getBoundingClientRect();
    const marker = document.querySelector(".leaflet-marker-icon")!.getBoundingClientRect();
    return {
      dx: Math.abs(marker.x + marker.width / 2 - (map.x + map.width / 2)),
      dy: Math.abs(marker.y + marker.height / 2 - (map.y + map.height / 2)),
    };
  });
  expect(centred.dx).toBeLessThanOrEqual(2);
  expect(centred.dy).toBeLessThanOrEqual(2);
});

/** True when a pointer at the element's centre would hit the element itself. */
async function hitByPointer(locator: Locator): Promise<boolean> {
  await locator.scrollIntoViewIfNeeded();
  return locator.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
    return hit !== null && (hit === el || el.contains(hit));
  });
}

/**
 * Marker positions RELATIVE to their map, so "viewport kept" is not confused
 * with page layout moving the whole map (M05-T05 Increment 5 test correction:
 * the "Find nearby" control can change a stop row's wrapping — and so the
 * page height above the map — when a reorder changes its distance text).
 */
async function markerBoxes(page: Page) {
  return markers(page).evaluateAll((els) =>
    els.map((e) => {
      const map = e.closest(".leaflet-container")!.getBoundingClientRect();
      const box = e.getBoundingClientRect();
      return { x: box.x - map.x, y: box.y - map.y };
    }),
  );
}

async function expectNoMapGeometry(page: Page) {
  expect(
    await page.locator(".leaflet-map-pane").locator("path, polyline, polygon, canvas").count(),
  ).toBe(0);
  expect(await page.locator(".leaflet-overlay-pane *").count()).toBe(0);
}

test("[real] coincident stops: one combined marker, pointer and keyboard popups, reorder and removal while focused", async ({
  page,
  trips,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 1600 });
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Same point");
  // stop3 and stop4 share one exact point; stop1 is elsewhere.
  const [s1, , s3, s4] = trips.stops;
  for (const landmark of [s1, s3, s4]) await addStop(page.request, tripId, landmark);
  await openTrip(page, tripId);
  await page.locator(".leaflet-container").scrollIntoViewIfNeeded();

  // One combined marker at the shared point: badge "2,3", a complete accessible name.
  await expect(markers(page)).toHaveCount(2);
  const combined = markers(page).filter({ hasText: "2,3" });
  await expect(combined).toHaveAttribute(
    "aria-label",
    `Stops 2,3, 2 at the same location: Stop 2: ${s3.displayName}, Waterfall; Stop 3: ${s4.displayName}, Waterfall`,
  );
  await expect(combined).toHaveAttribute("tabindex", "0");
  expect(await hitByPointer(combined), "the combined marker is reachable by pointer").toBe(true);
  await expectNoMapGeometry(page);

  // Pointer: a click opens one popup listing both stops in trip order, each with its own link.
  await combined.click();
  const popup = page.locator(".leaflet-popup");
  await expect(popup).toHaveCount(1);
  const group = popup.getByRole("group", { name: "Stops 2 and 3 details" });
  await expect(group).toBeVisible();
  await expect(group.getByRole("listitem")).toHaveCount(2);
  const link3 = group.getByRole("link", { name: `View profile: Stop 2, ${s3.displayName}` });
  const link4 = group.getByRole("link", { name: `View profile: Stop 3, ${s4.displayName}` });
  await expect(link3).toHaveAttribute("href", `/landmarks/${s3.id}`);
  await expect(link4).toHaveAttribute("href", `/landmarks/${s4.id}`);
  for (const link of [link3, link4]) {
    expect(await hitByPointer(link), "each profile link is reachable by pointer").toBe(true);
  }
  expect(await popup.textContent()).not.toMatch(/0\.49|-160\.51/);
  await expectNoMapGeometry(page);
  await scan(page, testInfo, "trip-map-combined-popup");
  await page.locator(".leaflet-popup-close-button").click();
  await expect(popup).toHaveCount(0);

  // Keyboard: Tab reaches the combined marker; Enter opens with focus on the group; Tab reaches both links.
  await tabTo(page, combined);
  await page.keyboard.press("Enter");
  await expect(group).toBeFocused();
  const reached = new Set<string>();
  for (let i = 0; i < 4 && reached.size < 2; i += 1) {
    await page.keyboard.press("Tab");
    const label = await activeLabel(page);
    if (label?.startsWith("View profile: ")) reached.add(label);
  }
  expect([...reached].sort()).toEqual(
    [`View profile: Stop 2, ${s3.displayName}`, `View profile: Stop 3, ${s4.displayName}`].sort(),
  );
  // Escape from a popup link returns focus to the marker.
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(combined).toBeFocused();
  // Space opens; Shift+Tab returns to the marker; the close button returns focus to it.
  await page.keyboard.press(" ");
  await expect(group).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(combined).toBeFocused();
  await page.locator(".leaflet-popup-close-button").click();
  await expect(popup).toHaveCount(0);
  await expect(combined).toBeFocused();

  // Reorder while a popup link has focus: badge, name and popup update; focus and viewport kept.
  const held = await gate(page, `**/api/v1/trips/${tripId}/stops/order`, "PUT");
  await page.getByRole("button", { name: `Move down: ${s1.displayName}` }).click();
  await combined.focus();
  await page.keyboard.press("Enter");
  await expect(group).toBeFocused();
  await link4.focus();
  const before = await markerBoxes(page);
  held.release();
  await expect(status(page)).toHaveText(`Moved ${s1.displayName} to position 2 of 3.`);
  const renumbered = markers(page).filter({ hasText: "1,3" });
  await expect(renumbered).toHaveAttribute(
    "aria-label",
    `Stops 1,3, 2 at the same location: Stop 1: ${s3.displayName}, Waterfall; Stop 3: ${s4.displayName}, Waterfall`,
  );
  await expect(popup.getByRole("group", { name: "Stops 1 and 3 details" })).toBeVisible();
  await expect(
    popup.getByRole("link", { name: `View profile: Stop 1, ${s3.displayName}` }),
  ).toBeVisible();
  expect(await activeLabel(page)).toBe(`View profile: Stop 3, ${s4.displayName}`);
  const after = await markerBoxes(page);
  expect(after).toHaveLength(before.length);
  for (const [i, box] of before.entries()) {
    expect(Math.abs(after[i]!.x - box.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(after[i]!.y - box.y)).toBeLessThanOrEqual(1);
  }
  await page.unroute(`**/api/v1/trips/${tripId}/stops/order`);
  await page.keyboard.press("Escape");
  await expect(renumbered).toBeFocused();

  // Removing a member while the marker has focus: the marker stays (now single), focus kept.
  const held2 = await gate(page, `**/api/v1/trips/${tripId}/stops/*`, "DELETE");
  await page.getByRole("button", { name: `Remove ${s4.displayName} from the trip` }).click();
  await renumbered.focus();
  held2.release();
  await expect(status(page)).toHaveText(
    `Removed ${s4.displayName} from the trip. The trip has 2 stops.`,
  );
  await expect(markers(page)).toHaveCount(2);
  const remaining = markers(page).filter({ hasText: /^1$/ });
  await expect(remaining).toHaveAttribute("aria-label", `Stop 1: ${s3.displayName}, Waterfall`);
  await expect(remaining).toBeFocused();
  await page.unroute(`**/api/v1/trips/${tripId}/stops/*`);
  await expectNoMapGeometry(page);
  await scan(page, testInfo, "trip-map-member-removed");
});

test("[real + intercepted] large coincident group: '+k' badge, complete name, 25 popup links by pointer and keyboard, 320px", async ({
  page,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Large group");
  await addStop(page.request, tripId, trips.stops[2]);
  // [intercepted] GET /trips/:id answers 25 synthetic stops at stop3's exact point
  // (a real trip cannot hold 25 fixture landmarks at one location).
  const uuid = (block: string, n: number) =>
    `${block}-0000-4000-8000-${String(n).padStart(12, "0")}`;
  await page.route(`**/api/v1/trips/${tripId}`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const response = await route.fetch();
    const body = (await response.json()) as {
      trip: { stops: Record<string, unknown>[]; distance_summary: unknown };
    };
    const real = body.trip.stops[0]!;
    body.trip.stops = Array.from({ length: 25 }, (_, i) => ({
      ...real,
      id: uuid("aaaaaaaa", i + 1),
      position: i,
      distance_from_previous_miles: i === 0 ? null : 0,
      landmark: {
        ...(real.landmark as Record<string, unknown>),
        id: uuid("bbbbbbbb", i + 1),
        display_name: `Group stop ${i + 1}`,
      },
    }));
    body.trip.distance_summary = { total_miles: 0, measured_legs: 24, total_legs: 24 };
    await route.fulfill({ response, json: body });
  });

  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await openTrip(page, tripId);
    await expect(stopItems(page)).toHaveCount(25);
    await expect(markers(page)).toHaveCount(1);
    const marker = markers(page).first();
    await expect(marker).toHaveText("1,2 +23");
    const name = (await marker.getAttribute("aria-label"))!;
    expect(name.startsWith("Stops 1,2 +23, 25 at the same location: ")).toBe(true);
    for (let n = 1; n <= 25; n += 1)
      expect(name).toContain(`Stop ${n}: Group stop ${n}, Waterfall`);
    expect(await hitByPointer(marker)).toBe(true);

    // The badge stays inside the map and readable.
    const fits = await marker.evaluate((el) => {
      const map = el.closest(".leaflet-container")!.getBoundingClientRect();
      const badge = el.firstElementChild as HTMLElement;
      const box = el.getBoundingClientRect();
      return {
        inside: box.left >= map.left && box.right <= map.right,
        overflowing: badge.scrollWidth > badge.clientWidth + 1,
        fontSize: getComputedStyle(badge).fontSize,
      };
    });
    expect(fits).toEqual({ inside: true, overflowing: false, fontSize: "12px" });

    // Pointer opens the popup: all 25 links, in a list that scrolls within the map.
    await marker.click();
    const popup = page.locator(".leaflet-popup");
    const group = popup.getByRole("group", { name: /^Stops 1, 2, 3, .* and 25 details$/ });
    await expect(group).toBeVisible();
    const links = group.getByRole("link");
    await expect(links).toHaveCount(25);
    const layout = await popup.evaluate((el) => {
      const map = el.closest(".leaflet-container")!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      const list = el.querySelector("ul")!;
      return {
        insideMap: box.left >= map.left - 1 && box.right <= map.right + 1,
        insideViewport: box.left >= 0 && box.right <= document.documentElement.clientWidth,
        scrolls: list.scrollHeight > list.clientHeight,
      };
    });
    expect(layout).toEqual({ insideMap: true, insideViewport: true, scrolls: true });
    // The last link is reachable by pointer once scrolled into view within the list.
    expect(await hitByPointer(links.last())).toBe(true);
    await scan(page, testInfo, `trip-map-large-group-popup-${width}`);
    await page.screenshot({ path: testInfo.outputPath(`large-group-popup-${width}.png`) });
    await page.locator(".leaflet-popup-close-button").click();

    // Keyboard: Enter opens; Tab reaches every link in order (the list scrolls to each).
    await marker.focus();
    await page.keyboard.press("Enter");
    await expect(group).toBeFocused();
    const seen: string[] = [];
    for (let i = 0; i < 30 && seen.length < 25; i += 1) {
      await page.keyboard.press("Tab");
      const label = await activeLabel(page);
      if (label?.startsWith("View profile: ")) seen.push(label);
    }
    expect(seen).toEqual(
      Array.from({ length: 25 }, (_, i) => `View profile: Stop ${i + 1}, Group stop ${i + 1}`),
    );
    const lastVisible = await links.last().evaluate((el) => {
      const list = el.closest("ul")!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return box.top >= list.top - 1 && box.bottom <= list.bottom + 1;
    });
    expect(lastVisible, "the focused last link is scrolled into view").toBe(true);
    await page.keyboard.press("Escape");
    await expect(marker).toBeFocused();
    if (width === 320) await expectNoOverflow(page, "large group at 320px");
    await expectNoMapGeometry(page);
  }
  await page.unroute(`**/api/v1/trips/${tripId}`);
});

// ---------------------------------------------------------------------------
// Add to trip
// ---------------------------------------------------------------------------

test("[real] add from the profile: sign-in link, no control on protected landmarks, New trip with validation, create-then-add, View trip, duplicate", async ({
  page,
  trips,
}, testInfo) => {
  // Signed out.
  await page.goto(`/landmarks/${trips.public.id}`);
  await expect(
    page.getByRole("link", { name: `Sign in to add to a trip: ${trips.public.displayName}` }),
  ).toHaveAttribute(
    "href",
    `/sign-in?returnTo=${encodeURIComponent(`/landmarks/${trips.public.id}`)}`,
  );

  await trips.signUpAndIn(page.request);
  // Protected landmarks: no add control at all.
  await trips.makeHiddenSensitive();
  await page.goto(`/landmarks/${trips.hidden.id}`);
  await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: /to (a )?trip/ })).toHaveCount(0);
  await trips.retire();
  await page.goto(`/landmarks/${trips.retired.id}`);
  await expect(page.getByRole("heading", { level: 2 })).toBeVisible();
  await expect(page.getByRole("button", { name: /to (a )?trip/ })).toHaveCount(0);

  // Full profile, empty list.
  await page.goto(`/landmarks/${trips.public.id}`);
  const toggle = page.getByRole("button", { name: `Add to trip: ${trips.public.displayName}` });
  await toggle.click();
  const region = page.getByRole("region", { name: `Add ${trips.public.displayName} to a trip` });
  await expect(region).toBeFocused();
  await expect(region.getByText("You don't have any trips yet.")).toBeVisible();
  await scan(page, testInfo, "profile-picker-open-empty");
  await region.getByRole("radio", { name: "New trip" }).check();
  const input = region.getByRole("textbox", { name: "New trip name" });
  const submit = region.getByRole("button", {
    name: `Create trip and add ${trips.public.displayName}`,
  });
  // Client validation.
  await input.fill("   ");
  await submit.click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveAccessibleDescription(
    "name must contain at least one letter, number, punctuation mark, or symbol.",
  );
  await expect(input).toBeFocused();
  await scan(page, testInfo, "new-trip-validation-error");
  // Create, then add.
  await input.fill("Smokies Loop");
  await submit.click();
  const statusRegion = page.locator("p[role='status']").filter({ hasText: /Added/ });
  await expect(statusRegion).toHaveText(
    `Added ${trips.public.displayName} to Smokies Loop — View trip`,
  );
  await scan(page, testInfo, "add-to-trip-success");
  const mine = await serverTrips(page.request);
  expect(mine.map((t) => [t.name, t.stop_count])).toEqual([["Smokies Loop", 1]]);

  // Adding again to the same trip: "Already in this trip."
  await region.getByRole("radio", { name: /Smokies Loop/ }).check();
  await region
    .getByRole("button", { name: `Add to the selected trip: ${trips.public.displayName}` })
    .click();
  await expect(page.getByRole("alert")).toContainText("Already in this trip.");

  // Escape closes and returns focus to the toggle.
  await region.getByRole("radio", { name: /Smokies Loop/ }).focus();
  await page.keyboard.press("Escape");
  await expect(region).toHaveCount(0);
  await expect(toggle).toBeFocused();

  // View trip (no automatic navigation happened), then persistence after reload.
  await expect(page).toHaveURL(new RegExp(`/landmarks/${trips.public.id}$`));
  await page.getByRole("link", { name: "View trip" }).click();
  await expect(page).toHaveURL(new RegExp(`/trips/${mine[0]!.id}$`));
  await expect(stopItems(page)).toHaveCount(1);
  await page.reload();
  await expect(stopItems(page).first()).toContainText(trips.public.displayName);
});

test("[real] add from the geographic results: row picker, existing trip, announcements outside the list beside favorites'", async ({
  page,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "From the map");
  await page.goto(`/?bbox=${FIXTURE_REGION_BBOX}&lat=0.5&lng=-160.5&zoom=11`);
  const results = page.locator("section[aria-labelledby='geo-results-heading']");
  const row = results.getByRole("listitem").filter({ hasText: trips.stops[1].displayName });
  await expect(row).toBeVisible();
  // Both shared announcers exist outside the list; none inside it.
  await expect(page.locator("[aria-live='polite']")).toHaveCount(2);
  expect(await results.locator("[role=status], [role=alert], [aria-live]").count()).toBe(0);

  await row.getByRole("button", { name: `Add to trip: ${trips.stops[1].displayName}` }).click();
  const region = row.getByRole("region", { name: `Add ${trips.stops[1].displayName} to a trip` });
  await region.getByRole("radio", { name: /From the map \(0 stops\)/ }).check();
  // The DISCOVERY map is excluded here only: its markers for the coincident stop-3/stop-4
  // fixtures overlap (axe target-size) — existing discovery behaviour, recorded as a follow-up.
  await scan(page, testInfo, "geo-results-picker-open", [".leaflet-marker-pane"]);
  await region
    .getByRole("button", { name: `Add to the selected trip: ${trips.stops[1].displayName}` })
    .click();
  const tripsRegion = page.locator("[aria-live='polite']").filter({ hasText: "Added" });
  await expect(tripsRegion).toHaveText(
    `Added ${trips.stops[1].displayName} to From the map — View trip`,
  );
  expect(await results.locator("[role=status], [role=alert], [aria-live]").count()).toBe(0);
  expect((await serverTrip(page.request, tripId)).stops.map((s) => s.landmark.id)).toEqual([
    trips.stops[1].id,
  ]);

  // Favorites still announce through their own region.
  await row.getByRole("button", { name: `Favorite ${trips.stops[1].displayName}` }).click();
  await expect(page.locator("[aria-live='polite']").filter({ hasText: "Saved" })).toContainText(
    `Saved ${trips.stops[1].displayName} to favorites.`,
  );
  await expect(tripsRegion).toHaveCount(1);
});

test("[intercepted] add failure paths: server name error, partial failure with verified retry, uncertain create, uncertain add verified, capacity, pagination and vanished selection, 401", async ({
  page,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  const landmark = trips.public;
  const open = async () => {
    await page.goto(`/landmarks/${landmark.id}`);
    await page.getByRole("button", { name: `Add to trip: ${landmark.displayName}` }).click();
    const region = page.getByRole("region", { name: `Add ${landmark.displayName} to a trip` });
    await expect(region.getByRole("group", { name: "Choose a trip" })).toBeVisible();
    return region;
  };
  const posts = { trips: 0, stops: 0 };
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    if (/\/api\/v1\/trips$/.test(r.url())) posts.trips += 1;
    if (/\/api\/v1\/trips\/[^/]+\/stops$/.test(r.url())) posts.stops += 1;
  });

  // 1. The server's name error is shown on the field.
  await page.route("**/api/v1/trips", (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 400,
          json: {
            error: {
              code: "INVALID_REQUEST",
              message: "name contains characters that are not allowed.",
            },
          },
        })
      : route.fallback(),
  );
  let region = await open();
  await region.getByRole("radio", { name: "New trip" }).check();
  await region.getByRole("textbox", { name: "New trip name" }).fill("Server says no");
  await region.getByRole("button", { name: /Create trip and add/ }).click();
  await expect(region.getByText("name contains characters that are not allowed.")).toBeVisible();
  await page.unroute("**/api/v1/trips");

  // 2. Created (real), then the add's connection drops (uncertain): partial message;
  //    "Try adding again" reads the trip first, finds the landmark absent, then adds (real).
  let dropAdd = true;
  await page.route(/\/api\/v1\/trips\/[^/]+\/stops$/, (route) => {
    if (route.request().method() === "POST" && dropAdd) {
      dropAdd = false;
      return route.abort("connectionreset");
    }
    return route.fallback();
  });
  await region.getByRole("textbox", { name: "New trip name" }).fill("Partial");
  await region.getByRole("button", { name: /Create trip and add/ }).click();
  const alert = page.getByRole("alert").filter({ hasText: "was created" });
  await expect(alert).toContainText(
    `The trip Partial was created, but ${landmark.displayName} couldn't be added to it.`,
  );
  await scan(page, testInfo, "add-partial-failure");
  const created = (await serverTrips(page.request)).find((t) => t.name === "Partial")!;
  expect(created.stop_count).toBe(0);
  const reads: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "GET" && r.url().endsWith(`/api/v1/trips/${created.id}`))
      reads.push(r.url());
  });
  await alert.getByRole("button", { name: "Try adding again" }).click();
  await expect(page.locator("p[role='status']").filter({ hasText: "Added" })).toHaveText(
    `Added ${landmark.displayName} to Partial — View trip`,
  );
  expect(reads).toHaveLength(1);
  expect(posts.trips).toBe(2); // the intercepted 400 above + this one create — never another
  expect(posts.stops).toBe(2); // the dropped add + the verified retry
  await page.unroute(/\/api\/v1\/trips\/[^/]+\/stops$/);

  // 3. An add that reached the server but whose answer was lost: the retry reads the trip,
  //    finds the landmark, and sends NO second add.
  const second = trips.stops[0];
  await page.goto(`/landmarks/${second.id}`);
  await page.getByRole("button", { name: `Add to trip: ${second.displayName}` }).click();
  region = page.getByRole("region", { name: `Add ${second.displayName} to a trip` });
  await region.getByRole("radio", { name: /Partial/ }).check();
  await page.route(/\/api\/v1\/trips\/[^/]+\/stops$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fetch(); // reaches the real server…
    return route.abort("connectionreset"); // …but the answer is lost
  });
  const stopsBefore = posts.stops;
  await region
    .getByRole("button", { name: `Add to the selected trip: ${second.displayName}` })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    `We couldn't confirm whether ${second.displayName} was added to Partial.`,
  );
  await region
    .getByRole("button", { name: `Add to the selected trip: ${second.displayName}` })
    .click();
  await expect(page.locator("p[role='status']").filter({ hasText: "Added" })).toHaveText(
    `Added ${second.displayName} to Partial — View trip`,
  );
  expect(posts.stops - stopsBefore).toBe(1);
  await page.unroute(/\/api\/v1\/trips\/[^/]+\/stops$/);

  // 4. An uncertain create: never sent again, and a same-named trip is not taken as ours.
  await page.route("**/api/v1/trips", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fetch();
    return route.abort("connectionreset");
  });
  region = await open();
  await region.getByRole("radio", { name: "New trip" }).check();
  await region.getByRole("textbox", { name: "New trip name" }).fill("Partial");
  const tripsBefore = posts.trips;
  await region.getByRole("button", { name: /Create trip and add/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "We couldn't confirm whether the trip was created.",
  );
  expect(posts.trips - tripsBefore).toBe(1);
  await expect(region.getByRole("radio", { name: "New trip" })).toBeChecked();
  for (const radio of await region.getByRole("radio", { name: /Partial/ }).all()) {
    await expect(radio).not.toBeChecked();
  }
  await page.unroute("**/api/v1/trips");

  // 5. Capacity (the 25-stop answer, intercepted).
  await page.route(/\/api\/v1\/trips\/[^/]+\/stops$/, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 409,
          json: { error: { code: "TRIP_STOP_LIMIT_REACHED", message: "x" } },
        })
      : route.fallback(),
  );
  region = await open();
  await region
    .getByRole("radio", { name: /\(0 stops\)/ })
    .first()
    .check();
  await region
    .getByRole("button", { name: `Add to the selected trip: ${landmark.displayName}` })
    .click();
  await expect(page.getByRole("alert")).toContainText("This trip has 25 stops.");
  await page.unroute(/\/api\/v1\/trips\/[^/]+\/stops$/);

  // 6. Pagination (pages served by interception): Show more, duplicates suppressed,
  //    a vanished selection deselected — never replaced.
  const item = (n: number) => ({
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    name: `Paged ${n}`,
    stop_count: 0,
    updated_at: "2026-11-24T00:00:00.000Z",
    is_shared: false,
  });
  let pageTwoServed = false;
  await page.route(/\/api\/v1\/trips\?/, (route) => {
    const url = new URL(route.request().url());
    const p = Number(url.searchParams.get("page"));
    if (p === 1) {
      const items = pageTwoServed ? [item(2)] : [item(1), item(2)];
      return route.fulfill({
        json: { trips: items, page: 1, limit: 100, has_more: !pageTwoServed },
      });
    }
    pageTwoServed = true;
    return route.fulfill({
      json: { trips: [item(2), item(3)], page: 2, limit: 100, has_more: false },
    });
  });
  region = await open();
  await region.getByRole("button", { name: "Show more trips" }).click();
  await expect(region.getByRole("radio")).toHaveCount(4); // 1, 2, 3, New trip
  await expect(region.getByRole("button", { name: "Show more trips" })).toHaveCount(0);
  await region.getByRole("radio", { name: /Paged 1/ }).check();
  // Re-open: page 1 no longer has "Paged 1".
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: `Add to trip: ${landmark.displayName}` }).click();
  await expect(
    region.getByText("The trip you selected is no longer in your list. Choose a trip."),
  ).toBeVisible();
  for (const radio of await region.getByRole("radio").all()) await expect(radio).not.toBeChecked();
  await page.unroute(/\/api\/v1\/trips\?/);

  // 7. A 401 during an add clears every trip name and selection.
  region = await open();
  await region
    .getByRole("radio", { name: /Partial/ })
    .first()
    .check();
  await page.request.post("/api/auth/sign-out", { headers: { Origin: ORIGIN }, data: {} });
  await region
    .getByRole("button", { name: `Add to the selected trip: ${landmark.displayName}` })
    .click();
  await expect(
    page.getByRole("link", { name: `Sign in to add to a trip: ${landmark.displayName}` }),
  ).toBeVisible();
  await expect(page.getByText(/Partial/)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Responsive layout
// ---------------------------------------------------------------------------

for (const width of [1280, 768, 375, 320]) {
  test(`[real] responsive ${width}px: trip page, profile and results pickers, New trip form, messages`, async ({
    page,
    trips,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await trips.signUpAndIn(page.request);
    const longName = `${"Very long trip name ".repeat(4)}${RLO}end`.slice(0, 100);
    const tripId = await createTrip(page.request, longName);
    for (const landmark of [trips.stops[0], trips.hidden, trips.stops[1]]) {
      await addStop(page.request, tripId, landmark);
    }
    await trips.makeHiddenSensitive();

    await openTrip(page, tripId);
    await expect(markers(page)).toHaveCount(2);
    await expectNoOverflow(page, `${width} trip page`);
    for (const name of ["Move", "Remove"]) {
      const box = await page
        .getByRole("button", { name: new RegExp(`^${name}`) })
        .first()
        .boundingBox();
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    const mapBox = await page.locator(".leaflet-container").boundingBox();
    expect(mapBox!.width).toBeLessThanOrEqual(width);
    expect(mapBox!.height).toBeGreaterThan(100);
    await testInfo.attach(`trip-${width}.png`, {
      body: await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`shot-${Date.now()}.png`),
      }),
      contentType: "image/png",
    });

    await page.goto(`/landmarks/${trips.public.id}`);
    await page.getByRole("button", { name: `Add to trip: ${trips.public.displayName}` }).click();
    const region = page.getByRole("region", { name: `Add ${trips.public.displayName} to a trip` });
    await region.getByRole("radio", { name: "New trip" }).check();
    await region.getByRole("textbox", { name: "New trip name" }).fill(" ");
    await region.getByRole("button", { name: /Create trip and add/ }).click();
    await expect(region.getByRole("textbox", { name: "New trip name" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await expectNoOverflow(page, `${width} profile picker with validation error`);
    await region.getByRole("radio", { name: /Very long trip name/ }).check();
    await region.getByRole("button", { name: /to the selected trip/ }).click();
    await expect(page.locator("p[role='status']").filter({ hasText: "Added" })).toBeVisible();
    await expectNoOverflow(page, `${width} profile success message`);
    await testInfo.attach(`profile-picker-${width}.png`, {
      body: await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`shot-${Date.now()}.png`),
      }),
      contentType: "image/png",
    });

    await page.goto(`/?bbox=${FIXTURE_REGION_BBOX}&lat=0.5&lng=-160.5&zoom=11`);
    const row = page
      .locator("section[aria-labelledby='geo-results-heading']")
      .getByRole("listitem")
      .filter({ hasText: trips.stops[2].displayName });
    await row.getByRole("button", { name: `Add to trip: ${trips.stops[2].displayName}` }).click();
    await expect(row.getByRole("group", { name: "Choose a trip" })).toBeVisible();
    await expectNoOverflow(page, `${width} results picker`);
    await testInfo.attach(`results-picker-${width}.png`, {
      body: await page.screenshot({
        fullPage: true,
        path: testInfo.outputPath(`shot-${Date.now()}.png`),
      }),
      contentType: "image/png",
    });
  });
}
