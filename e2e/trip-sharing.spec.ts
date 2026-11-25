import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Browser, Page, Request, Route, TestInfo } from "@playwright/test";
import type { FixtureLandmark } from "./helpers/favoritesFixtures";
import { ORIGIN, expect, test } from "./helpers/tripFixtures";

/**
 * M05-T06 Increment 6 — owner sharing and the public shared-trip page in a
 * real browser (Chromium) against the real production-mode server on
 * `landmarks_test` with the TEST-ONLY `TRIP_SHARING_ENABLED=true`
 * (playwright.config.ts, decision D11), using the guarded synthetic trip
 * fixtures only.
 *
 * - [real]: every request reaches the real API (OpenStreetMap tiles and the
 *   map attribution page are answered locally so nothing leaves the machine);
 * - [intercepted]: one named request is delayed, aborted after (or instead of)
 *   reaching the server, or rewritten, to reproduce a failure; everything else
 *   is real.
 *
 * Token hygiene: share URLs and tokens are compared as booleans so a failure
 * message never prints one; nothing here logs them.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const RLO = String.fromCodePoint(0x202e);
const ORIGIN_REFERER = `${ORIGIN}/`;
const SHARE_URL_SYNTAX = /^http:\/\/localhost:3000\/shared\/trips\/[A-Za-z0-9_-]{43}$/;
const UNAVAILABLE =
  "This shared trip isn't available. The link may be incorrect, or the owner may have stopped sharing it.";
const WIDTHS = [320, 375, 768, 1280] as const;

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
}

async function shareViaApi(request: APIRequestContext, tripId: string): Promise<string> {
  const response = await request.post(`/api/v1/trips/${tripId}/share`, {
    headers: { Origin: ORIGIN },
    data: {},
  });
  expect(response.status()).toBe(200);
  return ((await response.json()) as { share_url: string }).share_url;
}

const tokenOf = (url: string) => url.split("/").pop()!;
const sharedPath = (url: string) => new URL(url).pathname;
const tripHeading = (page: Page) => page.locator("#trip-heading");
const tripStatus = (page: Page) =>
  page.locator("section[aria-labelledby='trip-heading'] > p[role='status']");
const sharedHeading = (page: Page) => page.locator("#shared-trip-heading");
const sharedStatus = (page: Page) =>
  page.locator("section[aria-labelledby='shared-trip-heading'] > p[role='status']");
// Exact: a trip page's own section is named after the trip, which may contain "sharing".
const sharing = (page: Page) => page.getByRole("region", { name: "Sharing", exact: true });
const linkField = (page: Page) => page.getByLabel("Share link");
const markers = (page: Page) => page.locator(".leaflet-marker-icon");

async function stubExternal(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
  await page.route(/www\.openstreetmap\.org/, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><title>stub</title>",
    }),
  );
}

/** A fresh, independent, signed-out browser context and page. */
async function anonymousPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await stubExternal(page);
  return { context, page };
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

async function tabTo(page: Page, target: ReturnType<Page["getByRole"]>, max = 80) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error(`Could not reach the target with Tab within ${max} presses`);
}

function countRequests(page: Page, method: string, path: RegExp) {
  const seen = { count: 0 };
  page.on("request", (request) => {
    if (request.method() === method && path.test(new URL(request.url()).pathname)) seen.count += 1;
  });
  return seen;
}

async function scan(page: Page, testInfo: TestInfo, state: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = {
    state,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? "unknown",
      nodes: v.nodes.length,
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

async function expectNoOverflow(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - width;
    const offenders: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>(
        "main button, main a, main input, main h2, main h3, main li, main p",
      ),
    )) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (el.closest(".leaflet-container")) continue;
      if ((box.right > width + 1 && box.left < width) || (box.left < -1 && box.right > 0)) {
        offenders.push(
          `${el.tagName}:${(el.getAttribute("aria-label") ?? el.textContent ?? "").slice(0, 30)}`,
        );
      }
    }
    return { overflow, offenders: offenders.slice(0, 5) };
  });
  expect(result.overflow, `${label}: horizontal overflow`).toBeLessThanOrEqual(0);
  expect(result.offenders, `${label}: elements outside the viewport`).toEqual([]);
}

/** The open map popup lies inside the map and the viewport once Leaflet's (animated) auto-pan settles. */
async function expectPopupContained(page: Page, label: string) {
  const popup = page.locator(".leaflet-popup");
  await expect(popup).toBeVisible();
  await expect
    .poll(
      () =>
        popup.evaluate((el) => {
          const map = el.closest(".leaflet-container")!.getBoundingClientRect();
          const box = el.getBoundingClientRect();
          return {
            insideMap: box.left >= map.left - 1 && box.right <= map.right + 1,
            insideViewport: box.left >= 0 && box.right <= document.documentElement.clientWidth,
          };
        }),
      { timeout: 5_000, message: label },
    )
    .toEqual({ insideMap: true, insideViewport: true });
}

test.beforeEach(async ({ page }) => {
  await stubExternal(page);
});

// ---------------------------------------------------------------------------
// The real sharing lifecycle
// ---------------------------------------------------------------------------

test("[real] lifecycle: create (re-read before the link appears), My Trips indicator, real clipboard copy, reload, anonymous view, rotate, revoke, delete", async ({
  page,
  context,
  browser,
  trips,
}, testInfo) => {
  test.setTimeout(120_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Shared waterfalls");
  await addStop(page.request, tripId, trips.stops[0]);
  await page.goto(`/trips/${tripId}`);
  await expect(sharing(page).getByRole("button", { name: "Create share link" })).toBeVisible();
  await expect(sharing(page)).toContainText("anyone who has the link can view");
  await scan(page, testInfo, "sharing-private");

  // Create: hold the mandatory re-read and prove the received link is not usable before it.
  const posts = countRequests(page, "POST", /\/share$/);
  let armed = false;
  let releaseReread!: () => void;
  const rereadHeld = new Promise<void>((r) => (releaseReread = r));
  let rereads = 0;
  await page.route(new RegExp(`/api/v1/trips/${tripId}$`), async (route) => {
    if (!armed || route.request().method() !== "GET") return route.fallback();
    rereads += 1;
    await rereadHeld;
    await route.fallback();
  });
  armed = true;
  const shareResponse = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/share"),
  );
  await sharing(page).getByRole("button", { name: "Create share link" }).click();
  const shareUrl = ((await (await shareResponse).json()) as { share_url: string }).share_url;
  expect(SHARE_URL_SYNTAX.test(shareUrl), "a validated share URL").toBe(true);
  await expect.poll(() => rereads).toBe(1);
  await expect(tripStatus(page)).toHaveText("Updating the trip…");
  await expect(linkField(page)).toHaveCount(0);
  expect(
    (await page.content()).includes(tokenOf(shareUrl)),
    "token not in the page before reconciliation",
  ).toBe(false);
  armed = false;
  releaseReread();
  await expect(linkField(page)).toBeVisible();
  expect((await linkField(page).inputValue()) === shareUrl, "field holds the reconciled URL").toBe(
    true,
  );
  await expect(tripStatus(page)).toHaveText(
    "Share link created. Anyone with the link can view this trip.",
  );
  await expect(sharing(page).getByRole("button", { name: "Copy link" })).toBeFocused();
  expect(posts.count).toBe(1);
  await scan(page, testInfo, "sharing-with-held-link");

  // Not persisted anywhere, not in history state or the page URL.
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
      history: window.history.state,
      url: location.href,
      title: document.title,
    }),
  );
  expect(stored.includes(tokenOf(shareUrl)), "token not in storage, history, URL, or title").toBe(
    false,
  );

  // Real clipboard (Chromium with clipboard permissions).
  await sharing(page).getByRole("button", { name: "Copy link" }).click();
  await expect(tripStatus(page)).toHaveText("Share link copied.");
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  expect(copied === shareUrl, "clipboard holds the reconciled URL").toBe(true);
  expect(
    (await tripStatus(page).textContent())?.includes(tokenOf(shareUrl)),
    "status has no token",
  ).toBe(false);

  // My Trips shows Shared; a reload cannot reconstruct the link.
  await page.goto("/trips");
  await expect(
    page.getByRole("list", { name: "Your trips" }).getByRole("listitem").first(),
  ).toContainText("Shared");
  await page.goto(`/trips/${tripId}`);
  await expect(sharing(page)).toContainText("can't be shown again");
  await expect(linkField(page)).toHaveCount(0);
  expect((await page.content()).includes(tokenOf(shareUrl))).toBe(false);
  await scan(page, testInfo, "sharing-without-held-link");

  // The copied link works in a fresh, signed-out context.
  const anon = await anonymousPage(browser);
  await anon.page.goto(copied);
  await expect(sharedHeading(anon.page)).toHaveText("Shared waterfalls");
  await expect(anon.page.getByText(/Shared trip — view only/)).toBeVisible();

  // Rotate: the old link stops working on a fresh request; the new one works.
  await sharing(page).getByRole("button", { name: "Create new link" }).click();
  await expect(linkField(page)).toBeVisible();
  const rotatedUrl = await linkField(page).inputValue();
  expect(
    SHARE_URL_SYNTAX.test(rotatedUrl) && rotatedUrl !== shareUrl,
    "a new, different link",
  ).toBe(true);
  await expect(tripStatus(page)).toHaveText(
    "New share link created. The previous link no longer works.",
  );
  await anon.page.goto(shareUrl);
  await expect(anon.page.getByText(UNAVAILABLE)).toBeVisible();
  await anon.page.goto(rotatedUrl);
  await expect(sharedHeading(anon.page)).toHaveText("Shared waterfalls");

  // Revoke: the held link is cleared at once; the replacement stops working — checked
  // first, on a fresh anonymous request once the server has answered the DELETE.
  const revoked = page.waitForResponse(
    (r) => r.request().method() === "DELETE" && r.url().endsWith("/share"),
  );
  await sharing(page).getByRole("button", { name: "Turn off sharing" }).click();
  await expect(linkField(page)).toHaveCount(0);
  expect((await revoked).status()).toBe(204);
  await anon.page.goto(rotatedUrl);
  await expect(anon.page.getByText(UNAVAILABLE)).toBeVisible();
  await expect(tripStatus(page)).toHaveText(
    "Sharing turned off. The previous link no longer works.",
  );
  await expect(sharing(page).getByRole("button", { name: "Create share link" })).toBeFocused();

  // Deleting a shared trip also kills its link.
  const finalUrl = await shareViaApi(page.request, tripId);
  await anon.page.goto(finalUrl);
  await expect(sharedHeading(anon.page)).toHaveText("Shared waterfalls");
  expect(
    (
      await page.request.delete(`/api/v1/trips/${tripId}`, { headers: { Origin: ORIGIN } })
    ).status(),
  ).toBe(204);
  await anon.page.goto(finalUrl);
  await expect(anon.page.getByText(UNAVAILABLE)).toBeVisible();
  await anon.context.close();
});

test("[real] keyboard activation (M05-T06 Increment 7): Create share link (Enter), Copy link (Space), Create new link (Enter), Turn off sharing (Space) — pending feedback, re-reads, focus", async ({
  page,
  context,
  trips,
}) => {
  test.setTimeout(90_000);
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Keyboard sharing");
  await page.goto(`/trips/${tripId}`);
  await expect(tripHeading(page)).toHaveText("Keyboard sharing");
  const rereads = countRequests(page, "GET", new RegExp(`^/api/v1/trips/${tripId}$`));
  const posts = countRequests(page, "POST", /\/share$/);
  const deletes = countRequests(page, "DELETE", /\/share$/);

  // Create share link — Tab to it, Enter; the request is held to observe pending feedback.
  const create = sharing(page).getByRole("button", { name: "Create share link" });
  await tabTo(page, create);
  let held = await gate(page, /\/share$/, "POST");
  await page.keyboard.press("Enter");
  await expect(tripStatus(page)).toHaveText("Creating share link…");
  await expect(create).toHaveAttribute("aria-disabled", "true");
  await expect(create).toBeFocused();
  const readsBefore = rereads.count;
  held.release();
  await expect(linkField(page)).toBeVisible();
  await expect(tripStatus(page)).toHaveText(
    "Share link created. Anyone with the link can view this trip.",
  );
  const copy = sharing(page).getByRole("button", { name: "Copy link" });
  await expect(copy).toBeFocused();
  expect(rereads.count).toBe(readsBefore + 1); // the mandatory authoritative re-read
  expect(posts.count).toBe(1);
  const firstUrl = await linkField(page).inputValue();
  expect(SHARE_URL_SYNTAX.test(firstUrl)).toBe(true);
  await page.unroute(/\/share$/);

  // Copy link — Space on the focused button; the real clipboard receives the reconciled URL.
  await page.keyboard.press(" ");
  await expect(tripStatus(page)).toHaveText("Share link copied.");
  expect((await page.evaluate(() => navigator.clipboard.readText())) === firstUrl).toBe(true);
  await expect(copy).toBeFocused();

  // Create new link — Tab to it, Enter; held, then reconciled.
  const rotate = sharing(page).getByRole("button", { name: "Create new link" });
  await tabTo(page, rotate);
  held = await gate(page, /\/share$/, "POST");
  await page.keyboard.press("Enter");
  await expect(tripStatus(page)).toHaveText("Creating share link…");
  await expect(linkField(page)).toHaveCount(0); // the held link is cleared as the change begins
  await expect(rotate).toBeFocused();
  const readsBeforeRotate = rereads.count;
  held.release();
  await expect(linkField(page)).toBeVisible();
  await expect(tripStatus(page)).toHaveText(
    "New share link created. The previous link no longer works.",
  );
  await expect(copy).toBeFocused();
  expect(rereads.count).toBe(readsBeforeRotate + 1);
  expect(posts.count).toBe(2);
  expect((await linkField(page).inputValue()) !== firstUrl).toBe(true);
  await page.unroute(/\/share$/);

  // Turn off sharing — Tab to it, Space; held, then reconciled.
  const turnOff = sharing(page).getByRole("button", { name: "Turn off sharing" });
  await tabTo(page, turnOff);
  held = await gate(page, /\/share$/, "DELETE");
  await page.keyboard.press(" ");
  await expect(tripStatus(page)).toHaveText("Turning off sharing…");
  await expect(linkField(page)).toHaveCount(0);
  await expect(turnOff).toBeFocused();
  const readsBeforeRevoke = rereads.count;
  held.release();
  await expect(tripStatus(page)).toHaveText(
    "Sharing turned off. The previous link no longer works.",
  );
  await expect(sharing(page).getByRole("button", { name: "Create share link" })).toBeFocused();
  expect(rereads.count).toBe(readsBeforeRevoke + 1);
  expect(deletes.count).toBe(1);
});

// ---------------------------------------------------------------------------
// Public presentation and redaction (real API + DOM)
// ---------------------------------------------------------------------------

test("[real] public view and redaction: API response and DOM hide SENSITIVE and retired stops; numbering gaps, grouping, partial distances, keyboard popup, profile link, no owner data", async ({
  page,
  browser,
  trips,
}, testInfo) => {
  test.setTimeout(90_000);
  await trips.signUpAndIn(page.request);
  const name = `Public ${RLO}trip`;
  const tripId = await createTrip(page.request, name);
  const [s1, s2, s3, s4] = trips.stops;
  for (const landmark of [s1, trips.hidden, s2, s3, s4, trips.retired])
    await addStop(page.request, tripId, landmark);
  const url = await shareViaApi(page.request, tripId);
  await trips.makeHiddenSensitive();
  await trips.retire();

  // The real shared API response, without any session.
  const anon = await anonymousPage(browser);
  const apiResponse = await anon.page.request.get(`/api/v1/shared/trips/${tokenOf(url)}`);
  expect(apiResponse.status()).toBe(200);
  const raw = await apiResponse.text();
  const body = JSON.parse(raw) as {
    trip: {
      name: string;
      stops: {
        position: number;
        is_available: boolean;
        distance_from_previous_miles: number | null;
        landmark: Record<string, unknown>;
      }[];
      distance_summary: { measured_legs: number; total_legs: number };
    };
  };
  expect(Object.keys(body.trip).sort()).toEqual(["distance_summary", "name", "stops"]);
  expect(body.trip.stops.map((s) => s.position)).toEqual([0, 1, 2, 3, 4, 5]);
  for (const [index, fixture] of [
    [1, trips.hidden],
    [5, trips.retired],
  ] as const) {
    expect(body.trip.stops[index]!.landmark).toEqual({ id: fixture.id, is_available: false });
    expect(body.trip.stops[index]!.is_available).toBe(false);
  }
  expect(body.trip.stops.map((s) => s.distance_from_previous_miles === null)).toEqual([
    true,
    true,
    true,
    false,
    false,
    true,
  ]);
  expect(body.trip.distance_summary).toMatchObject({ measured_legs: 2, total_legs: 5 });
  for (const secret of [
    trips.hidden.displayName,
    trips.retired.displayName,
    "-160.48",
    "-160.46",
    "0.52",
    "0.54",
    tripId,
  ]) {
    expect(
      raw.includes(secret),
      `the API response hides ${secret.length > 12 ? "a protected name" : secret}`,
    ).toBe(false);
  }

  // The rendered public page.
  await anon.page.goto(url);
  await expect(sharedHeading(anon.page).locator("bdi")).toHaveText(name);
  const items = anon.page.getByRole("list", { name: "Stops" }).getByRole("listitem");
  await expect(items).toHaveCount(6);
  expect((await items.allTextContents()).map((t) => t.match(/^Stop \d+/)?.[0])).toEqual([
    "Stop 1",
    "Stop 2",
    "Stop 3",
    "Stop 4",
    "Stop 5",
    "Stop 6",
  ]);
  for (const index of [1, 5]) {
    await expect(items.nth(index)).toHaveText(`Stop ${index + 1}No longer available`);
    await expect(items.nth(index).getByRole("link")).toHaveCount(0);
  }
  await expect(items.nth(0).getByRole("link", { name: s1.displayName })).toHaveAttribute(
    "href",
    `/landmarks/${s1.id}`,
  );
  const html = await anon.page.content();
  for (const secret of [
    trips.hidden.displayName,
    trips.retired.displayName,
    trips.hidden.id,
    trips.retired.id,
    tripId,
  ]) {
    expect(html.includes(secret), "the page hides protected stops and the trip ID").toBe(false);
  }
  await expect(anon.page.getByText(/Straight-line total of 2 of 5 legs/)).toBeVisible();
  await expect(
    anon.page.getByText("Straight-line distances, not travel or trail distances."),
  ).toBeVisible();
  await expect(markers(anon.page)).toHaveCount(3);
  const labels = await markers(anon.page).evaluateAll((els) =>
    els.map((e) => e.getAttribute("aria-label") ?? ""),
  );
  expect(labels.some((l) => l.startsWith("Stop 1"))).toBe(true);
  expect(labels.some((l) => l.startsWith("Stop 3"))).toBe(true);
  expect(labels.some((l) => l.startsWith("Stops 4,5"))).toBe(true);
  expect(labels.join(" ").includes("Stop 2") || labels.join(" ").includes("Stop 6")).toBe(false);
  expect(await anon.page.locator(".leaflet-overlay-pane path").count()).toBe(0);

  // No owner controls or owner data.
  for (const control of [
    /rename/i,
    /delete/i,
    /remove/i,
    /move (up|down)/i,
    /find nearby/i,
    /add to/i,
    /share link|new link|turn off sharing|copy link/i,
  ]) {
    await expect(anon.page.getByRole("button", { name: control })).toHaveCount(0);
  }
  await expect(anon.page.getByRole("region", { name: "Sharing" })).toHaveCount(0);
  await scan(anon.page, testInfo, "public-shared-trip");

  // Keyboard: a marker popup, then a stop's profile link.
  const firstMarker = markers(anon.page).first();
  await firstMarker.focus();
  await anon.page.keyboard.press("Enter");
  await expect(anon.page.locator(".leaflet-popup").getByRole("group")).toBeFocused();
  await anon.page.keyboard.press("Escape");
  await expect(firstMarker).toBeFocused();
  await items.nth(0).getByRole("link").focus();
  await anon.page.keyboard.press("Enter");
  await expect(anon.page).toHaveURL(new RegExp(`/landmarks/${s1.id}$`));
  await anon.context.close();
});

test("[real] public view: an empty trip and an all-unavailable trip", async ({
  page,
  browser,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  const emptyUrl = await shareViaApi(page.request, await createTrip(page.request, "Nothing yet"));
  const hiddenTrip = await createTrip(page.request, "All hidden");
  await addStop(page.request, hiddenTrip, trips.hidden);
  await addStop(page.request, hiddenTrip, trips.retired);
  const hiddenUrl = await shareViaApi(page.request, hiddenTrip);
  await trips.makeHiddenSensitive();
  await trips.retire();

  const anon = await anonymousPage(browser);
  await anon.page.goto(emptyUrl);
  await expect(sharedHeading(anon.page)).toHaveText("Nothing yet");
  await expect(anon.page.getByText("This trip has no stops.")).toBeVisible();
  await expect(anon.page.getByText(/Find a landmark to add/)).toHaveCount(0);
  await expect(anon.page.getByRole("heading", { name: "Map" })).toHaveCount(0);
  await anon.page.goto(hiddenUrl);
  await expect(anon.page.getByText("No longer available", { exact: true })).toHaveCount(2);
  await expect(markers(anon.page)).toHaveCount(0);
  await expect(
    anon.page.getByText(/None of this trip.s stops can be shown on the map/),
  ).toBeVisible();
  await expect(anon.page.getByText(/No straight-line total/)).toBeVisible();
  await scan(anon.page, testInfo, "public-all-unavailable");
  await anon.context.close();
});

// ---------------------------------------------------------------------------
// Headers, robots, credentials, Referer, token propagation
// ---------------------------------------------------------------------------

test("[real] HTTP headers on the page and the API, robots meta lifecycle, no credentials on the shared read, no session established", async ({
  page,
  playwright,
  trips,
}) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Header trip");
  const url = await shareViaApi(page.request, tripId);

  const plain = await playwright.request.newContext({ baseURL: ORIGIN });
  for (const path of [
    sharedPath(url),
    "/shared/trips/not-a-token",
    `/shared/trips/${"Z".repeat(43)}`,
    `${sharedPath(url)}/?x=/y`,
  ]) {
    const response = await plain.get(path);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/text\/html/);
    expect(response.headers()["x-robots-tag"]).toBe("noindex, nofollow");
    expect(response.headers()["cache-control"]).toBe("no-store");
  }
  for (const path of ["/", "/trips", "/favorites"]) {
    const response = await plain.get(path);
    expect(response.headers()["x-robots-tag"]).toBeUndefined();
    expect(response.headers()["cache-control"]).toBe("public, max-age=0");
  }
  const api = await plain.get(`/api/v1/shared/trips/${tokenOf(url)}`);
  expect(api.status()).toBe(200);
  expect(api.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  expect(api.headers()["cache-control"]).toBe("no-store");
  expect(api.headers()["set-cookie"]).toBeUndefined();
  const missing = await plain.get(`/api/v1/shared/trips/${"Z".repeat(43)}`);
  expect(missing.status()).toBe(404);
  expect(missing.headers()["x-robots-tag"]).toBe("noindex, nofollow");
  await plain.dispose();

  // In the signed-in owner's browser: the shared read carries no cookie and sets none.
  const sharedRequest = page.waitForRequest((r) => r.url().includes("/api/v1/shared/trips/"));
  const sharedResponse = page.waitForResponse((r) => r.url().includes("/api/v1/shared/trips/"));
  await page.goto(url);
  await expect(sharedHeading(page)).toHaveText("Header trip");
  const headers = await (await sharedRequest).allHeaders();
  expect(headers.cookie).toBeUndefined();
  expect((await (await sharedResponse).allHeaders())["set-cookie"]).toBeUndefined();
  expect(await page.locator('head meta[name="robots"]').count()).toBe(1);
  expect(await page.locator('head meta[name="robots"]').getAttribute("content")).toBe(
    "noindex, nofollow",
  );
  // Leave through the app: the route's robots meta goes with it.
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Discover" })
    .click();
  await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);
  await page.goto("/trips");
  await expect(page.locator('head meta[name="robots"]')).toHaveCount(0);
  // The owner is still signed in: the shared read did not disturb the session.
  expect((await (await page.request.get("/api/auth/get-session")).json()) !== null).toBe(true);
});

test("[real] Referer and token propagation: cross-origin tile requests and a cross-origin navigation carry only the origin; same-origin requests too; the token reaches only the shared read", async ({
  page,
  browser,
  trips,
}) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Referer trip");
  await addStop(page.request, tripId, trips.stops[0]);
  const url = await shareViaApi(page.request, tripId);
  const token = tokenOf(url);

  const anon = await anonymousPage(browser);
  const requests: Request[] = [];
  const consoleLines: string[] = [];
  anon.page.on("request", (r) => requests.push(r));
  anon.page.on("console", (m) => consoleLines.push(m.text()));
  await anon.page.goto(url);
  await expect(sharedHeading(anon.page)).toHaveText("Referer trip");
  await expect(markers(anon.page)).toHaveCount(1);
  await expect
    .poll(() => requests.filter((r) => r.url().includes("tile.openstreetmap.org")).length)
    .toBeGreaterThan(0);

  for (const request of requests) {
    const sameOrigin = request.url().startsWith(ORIGIN);
    const isDocument = request.resourceType() === "document";
    if (!isDocument) {
      const referer = await request.headerValue("referer");
      expect(referer, `${sameOrigin ? "same" : "cross"}-origin Referer is only the origin`).toBe(
        ORIGIN_REFERER,
      );
    }
    if (isDocument) continue;
    const carries = request.url().includes(token);
    expect(
      carries ? request.url().includes("/api/v1/shared/trips/") : true,
      "only the shared read carries the token",
    ).toBe(true);
  }
  expect(
    requests.filter((r) => r.url().includes(token) && r.resourceType() !== "document"),
  ).toHaveLength(1);
  expect(requests.some((r) => r.url().includes("/api/v1/trips"))).toBe(false);

  // A real cross-origin NAVIGATION from the shared page (the map attribution link; answered locally).
  const navigation = anon.page.waitForRequest((r) =>
    r.url().startsWith("https://www.openstreetmap.org/"),
  );
  await anon.page.locator(".leaflet-control-attribution a", { hasText: "OpenStreetMap" }).click();
  expect(await (await navigation).headerValue("referer")).toBe(ORIGIN_REFERER);

  // Not in the title, DOM IDs, console, or any link (including sign-in return paths).
  await anon.page.goto(url);
  await expect(sharedHeading(anon.page)).toHaveText("Referer trip");
  const dom = await anon.page.evaluate(() => ({
    title: document.title,
    ids: Array.from(document.querySelectorAll("[id]")).map((e) => e.id),
    hrefs: Array.from(document.querySelectorAll("a[href]")).map(
      (a) => a.getAttribute("href") ?? "",
    ),
  }));
  expect(dom.title.includes(token) || dom.ids.some((id) => id.includes(token))).toBe(false);
  expect(
    dom.hrefs.some((h) => h.includes(token) || decodeURIComponent(h).includes(token)),
    "no link carries the token",
  ).toBe(false);
  await expect(
    anon.page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Sign in" }),
  ).toHaveAttribute("href", "/sign-in");
  expect(consoleLines.some((l) => l.includes(token))).toBe(false);
  await anon.context.close();
});

test("[intercepted] the shared page does not depend on the session check: pending and failing checks", async ({
  page,
  browser,
  trips,
}) => {
  await trips.signUpAndIn(page.request);
  const url = await shareViaApi(page.request, await createTrip(page.request, "No session needed"));
  for (const mode of ["pending", "failing"] as const) {
    const anon = await anonymousPage(browser);
    await anon.page.route("**/api/auth/get-session", (route) =>
      mode === "pending"
        ? new Promise(() => undefined)
        : route.fulfill({ status: 500, json: { error: { code: "X", message: "x" } } }),
    );
    await anon.page.goto(url);
    await expect(sharedHeading(anon.page)).toHaveText("No session needed");
    await anon.context.close();
  }
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

test("[intercepted] sharing disabled: no Sharing section; a 409 TRIP_SHARING_UNAVAILABLE re-reads and hides it", async ({
  page,
  trips,
}) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Disabled sharing");
  let disabled = true;
  await page.route(new RegExp(`/api/v1/trips/${tripId}$`), async (route) => {
    if (route.request().method() !== "GET" || !disabled) return route.fallback();
    const response = await route.fetch();
    const json = (await response.json()) as { trip: Record<string, unknown> };
    json.trip.sharing_enabled = false;
    await route.fulfill({ response, json });
  });
  await page.goto(`/trips/${tripId}`);
  await expect(tripHeading(page)).toHaveText("Disabled sharing");
  await expect(sharing(page)).toHaveCount(0);

  disabled = false;
  await page.reload();
  await expect(sharing(page)).toBeVisible();
  const posts = countRequests(page, "POST", /\/share$/);
  await page.route(/\/share$/, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 409,
          json: { error: { code: "TRIP_SHARING_UNAVAILABLE", message: "x" } },
        })
      : route.fallback(),
  );
  disabled = true;
  await sharing(page).getByRole("button", { name: "Create share link" }).click();
  await expect(tripStatus(page)).toHaveText("Sharing isn't available right now.");
  await expect(sharing(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Stops" })).toBeFocused();
  expect(posts.count).toBe(1);
});

test("[intercepted] public page: generic unavailable for revoked, unknown, and malformed links; 5xx then explicit Try again", async ({
  page,
  browser,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Retry trip");
  const url = await shareViaApi(page.request, tripId);
  const anon = await anonymousPage(browser);
  for (const path of ["/shared/trips/not-a-token", `/shared/trips/${"Q".repeat(43)}`]) {
    await anon.page.goto(path);
    await expect(anon.page.getByText(UNAVAILABLE)).toBeVisible();
    expect(await anon.page.locator('head meta[name="robots"]').getAttribute("content")).toBe(
      "noindex, nofollow",
    );
  }
  await scan(anon.page, testInfo, "public-unavailable");

  let failOnce = true;
  let reads = 0;
  await anon.page.route(/\/api\/v1\/shared\/trips\//, (route) => {
    reads += 1;
    if (failOnce) {
      failOnce = false;
      return route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "x" } },
      });
    }
    return route.fallback();
  });
  await anon.page.goto(url);
  const alert = anon.page.getByRole("alert");
  await expect(alert).toHaveText(/Couldn't load this shared trip. Please try again./);
  await scan(anon.page, testInfo, "public-error");
  expect(reads).toBe(1);
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(sharedHeading(anon.page)).toHaveText("Retry trip");
  await expect(sharedHeading(anon.page)).toBeFocused();
  expect(reads).toBe(2);
  await anon.context.close();
});

test("[intercepted] uncertain create and revoke, a failed re-read, and an unexpected version: nothing replayed, no provisional link shown", async ({
  page,
  trips,
}) => {
  test.setTimeout(90_000);
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Uncertain sharing");
  await page.goto(`/trips/${tripId}`);
  const posts = countRequests(page, "POST", /\/share$/);
  const deletes = countRequests(page, "DELETE", /\/share$/);

  // 1. Uncertain create: the server shared, the answer was lost; sharing is on now.
  await page.route(/\/share$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    await route.fetch();
    await route.abort("failed");
  });
  await sharing(page).getByRole("button", { name: "Create share link" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "a new link may have been created, and an earlier link may no longer work",
  );
  await expect(linkField(page)).toHaveCount(0);
  expect(posts.count).toBe(1);
  await page.unroute(/\/share$/);

  // 2. Uncertain revoke: the server revoked, the answer was lost; sharing is off now.
  await page.route(/\/share$/, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    await route.fetch();
    await route.abort("failed");
  });
  await sharing(page).getByRole("button", { name: "Turn off sharing" }).click();
  await expect(tripStatus(page)).toHaveText(
    "Couldn't confirm the change, but sharing is currently off for this trip.",
  );
  expect(deletes.count).toBe(1);
  await page.unroute(/\/share$/);

  // 3. A real create whose mandatory re-read fails: stale, Reload only reads, no link.
  let failReread = true;
  await page.route(new RegExp(`/api/v1/trips/${tripId}$`), (route) => {
    if (route.request().method() === "GET" && failReread) {
      failReread = false;
      return route.abort("failed");
    }
    return route.fallback();
  });
  await sharing(page).getByRole("button", { name: "Create share link" }).click();
  const stale = page.getByRole("alert");
  await expect(stale).toContainText(
    "A share link was created, but the updated trip couldn't be loaded",
  );
  await stale.getByRole("button", { name: "Reload trip" }).click();
  await expect(sharing(page).getByRole("button", { name: "Create new link" })).toBeVisible();
  await expect(linkField(page)).toHaveCount(0);
  expect(posts.count).toBe(2);
  await page.unroute(new RegExp(`/api/v1/trips/${tripId}$`));

  // 4. A real rotation whose re-read shows an extra version bump: the link is not confirmed.
  let bump = true;
  await page.route(new RegExp(`/api/v1/trips/${tripId}$`), async (route) => {
    if (route.request().method() !== "GET" || !bump) return route.fallback();
    bump = false;
    const response = await route.fetch();
    const json = (await response.json()) as { trip: { version: number } };
    json.trip.version += 1;
    await route.fulfill({ response, json });
  });
  await sharing(page).getByRole("button", { name: "Create new link" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "this trip changed at the same time, so that link couldn't be confirmed",
  );
  await expect(linkField(page)).toHaveCount(0);
  expect(posts.count).toBe(3);
});

test("[intercepted] clipboard failure and late clipboard feedback; signing out clears the held link; the shared lock blocks other changes", async ({
  page,
  trips,
}) => {
  test.setTimeout(90_000);
  const email = await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Clipboard trip");
  await addStop(page.request, tripId, trips.stops[0]);
  await page.goto(`/trips/${tripId}`);
  await sharing(page).getByRole("button", { name: "Create share link" }).click();
  await expect(linkField(page)).toBeVisible();

  // Failure: the browser refuses the clipboard write (controlled override).
  await page.evaluate(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => Promise.reject(new Error("denied")) },
    });
  });
  await sharing(page).getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "The link is selected in the Share link field",
  );
  await expect(linkField(page)).toBeFocused();
  const selection = await linkField(page).evaluate((el: HTMLInputElement) => [
    el.selectionStart,
    el.selectionEnd,
    el.value.length,
  ]);
  expect(selection[0]).toBe(0);
  expect(selection[1]).toBe(selection[2]);

  // Late success after the link was replaced: nothing is reported.
  await page.evaluate(() => {
    const w = window as unknown as { finishCopy?: () => void };
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => new Promise<void>((resolve) => (w.finishCopy = resolve)) },
    });
  });
  await sharing(page).getByRole("button", { name: "Copy link" }).click();
  const held = await gate(page, /\/share$/, "POST");
  await sharing(page).getByRole("button", { name: "Create new link" }).click();
  await expect(linkField(page)).toHaveCount(0);
  // The shared lock while the rotation is pending: rename and remove send nothing.
  const patches = countRequests(page, "PATCH", /\/api\/v1\/trips\/[^/]+$/);
  const removes = countRequests(page, "DELETE", /\/stops\//);
  // Rename is aria-disabled during the pending rotation but still opens its panel (force: a user can).
  await expect(page.getByRole("button", { name: "Rename" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await page.getByRole("button", { name: "Rename" }).click({ force: true });
  await page.getByLabel("Trip name").fill("Locked");
  await page.getByRole("button", { name: "Save name" }).click({ force: true });
  await page.getByRole("button", { name: /^Remove / }).click({ force: true });
  await expect(tripStatus(page)).toHaveText("Creating share link…");
  expect(patches.count).toBe(0);
  expect(removes.count).toBe(0);
  await page.evaluate(() => (window as unknown as { finishCopy: () => void }).finishCopy());
  held.release();
  await expect(linkField(page)).toBeVisible();
  await expect(tripStatus(page)).toHaveText(
    "New share link created. The previous link no longer works.",
  );
  await expect(tripStatus(page)).not.toContainText("copied");
  await page.getByRole("button", { name: "Cancel" }).click();

  // Signing out clears the held link; signing in again does not restore it.
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in to see this trip" })).toBeVisible();
  await expect(linkField(page)).toHaveCount(0);
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", {
        headers: { Origin: ORIGIN },
        data: { email, password: "e2e trips password" },
      })
    ).status(),
  ).toBe(200);
  await page.goto(`/trips/${tripId}`);
  await expect(sharing(page).getByRole("button", { name: "Create new link" })).toBeVisible();
  await expect(linkField(page)).toHaveCount(0);
});

test("[intercepted] a late shared-trip response for the previous token never replaces the current one (in-app navigation)", async ({
  page,
  browser,
  trips,
}) => {
  await trips.signUpAndIn(page.request);
  const urlA = await shareViaApi(page.request, await createTrip(page.request, "Trip A"));
  const urlB = await shareViaApi(page.request, await createTrip(page.request, "Trip B"));
  const anon = await anonymousPage(browser);
  let releaseA!: () => void;
  const heldA = new Promise<void>((r) => (releaseA = r));
  await anon.page.route(new RegExp(`/api/v1/shared/trips/${tokenOf(urlA)}$`), async (route) => {
    await heldA;
    await route.fallback();
  });
  await anon.page.goto(urlA);
  await expect(sharedStatus(anon.page)).toHaveText("Loading shared trip…");
  await anon.page.evaluate((path) => {
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  }, sharedPath(urlB));
  await expect(sharedHeading(anon.page)).toHaveText("Trip B");
  releaseA();
  await anon.page.waitForResponse((r) => r.url().includes(tokenOf(urlA)));
  await expect(sharedHeading(anon.page)).toHaveText("Trip B");
  await expect(anon.page.getByText("Trip A")).toHaveCount(0);
  await anon.context.close();
});

// ---------------------------------------------------------------------------
// Responsive
// ---------------------------------------------------------------------------

for (const width of WIDTHS) {
  test(`[real] responsive ${width}px: owner Sharing panel with a held link, public page with long names, list, and an open map popup`, async ({
    page,
    browser,
    trips,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await trips.signUpAndIn(page.request);
    const longName = `Shared ${RLO}sllaF ${"anotherverylongunbrokenword".repeat(3)}`.slice(0, 100);
    const tripId = await createTrip(page.request, longName);
    for (const landmark of trips.stops) await addStop(page.request, tripId, landmark);
    await page.goto(`/trips/${tripId}`);
    await sharing(page).getByRole("button", { name: "Create share link" }).click();
    await expect(linkField(page)).toBeVisible();
    await expect(sharing(page).getByRole("button", { name: "Copy link" })).toBeVisible();
    await expect(sharing(page).getByRole("button", { name: "Create new link" })).toBeVisible();
    const url = await linkField(page).inputValue();
    await expectNoOverflow(page, `owner sharing ${width}`);

    const anon = await anonymousPage(browser);
    await anon.page.setViewportSize({ width, height: 900 });
    await anon.page.goto(url);
    await expect(sharedHeading(anon.page).locator("bdi")).toHaveText(longName);
    await expectNoOverflow(anon.page, `public page ${width}`);
    await markers(anon.page).first().focus();
    await anon.page.keyboard.press("Enter");
    await expectPopupContained(anon.page, `public popup ${width}`);
    await anon.context.close();

    // The same map on the owner page (the Increment 6 popup-width correction applies to both).
    await markers(page).first().focus();
    await page.keyboard.press("Enter");
    await expectPopupContained(page, `owner popup ${width}`);
  });
}
