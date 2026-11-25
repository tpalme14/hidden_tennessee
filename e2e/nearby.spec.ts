import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Locator, Page, Request, Route, TestInfo } from "@playwright/test";
import type { FixtureLandmark } from "./helpers/favoritesFixtures";
import { ORIGIN, expect, test } from "./helpers/tripFixtures";

/**
 * M05-T05 Increment 5 — nearby landmarks for a trip stop, in a real browser
 * (Chromium) against the real server on `landmarks_test`, with the guarded
 * synthetic fixtures of `e2e/helpers/tripFixtures.ts` (all PUBLIC at first;
 * `hidden` can be made SENSITIVE and `retired` retired, both guarded).
 *
 * Kinds of journey, labelled in each title:
 * - [real]: every request reaches the real API and PostGIS; only map tiles are
 *   stubbed (a 1×1 PNG, as in every spec);
 * - [delayed]: a real request is held by `gate()` to observe an in-flight state;
 * - [intercepted]: one named request is failed or answered by `page.route`.
 *
 * Other tests (other workers) create fixture landmarks in the same region at
 * the same time, so a real proximity response may contain their landmarks too.
 * Assertions therefore take their expectations from the captured response
 * JSON (order, grouping, distances) — never from the frontend code under test
 * — and check this test's own fixtures by ID.
 *
 * Accessibility: axe (WCAG 2.0–2.2 A/AA) in the listed states, with NO
 * exclusions; DOM and accessibility-tree checks of names, focus, and live
 * regions. No screen reader is used.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const RLO = String.fromCodePoint(0x202e);
const KM_PER_MILE = 1.609344;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface NearbyItem {
  id: string;
  display_name: string;
  category: string;
  latitude: number;
  longitude: number;
  distance_miles: number;
}
interface NearbyBody {
  items: NearbyItem[];
  page: number;
  limit: number;
  has_more: boolean;
  is_truncated: boolean;
}

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

interface ServerTrip {
  version: number;
  stops: { id: string; position: number; is_available: boolean; landmark: { id: string } }[];
  distance_summary: { total_miles: number | null; measured_legs: number; total_legs: number };
}

async function serverTrip(request: APIRequestContext, tripId: string): Promise<ServerTrip> {
  const response = await request.get(`/api/v1/trips/${tripId}`);
  expect(response.status()).toBe(200);
  return ((await response.json()) as { trip: ServerTrip }).trip;
}

const isNearbyUrl = (url: string) => url.includes("/api/v1/landmarks?") && url.includes("near=");
const isTripGet = (tripId: string) => (r: Request) =>
  r.method() === "GET" && new URL(r.url()).pathname === `/api/v1/trips/${tripId}`;
const isAddPost = (tripId: string) => (r: Request) =>
  r.method() === "POST" && new URL(r.url()).pathname === `/api/v1/trips/${tripId}/stops`;

/** Records every request matching `match` (the page's own requests only). */
function recorder(page: Page, match: (r: Request) => boolean) {
  const seen: Request[] = [];
  page.on("request", (r) => {
    if (match(r)) seen.push(r);
  });
  return seen;
}

/** Holds matching requests until `release()`. */
async function gate(page: Page, url: string | RegExp | ((u: URL) => boolean), method: string) {
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

async function openTrip(page: Page, tripId: string) {
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByRole("heading", { level: 3, name: "Stops" })).toBeVisible();
}

const findNearby = (page: Page, n: number, name: string) =>
  page.getByRole("button", { name: `Find nearby: Stop ${n}, ${name}` });
const panel = (page: Page) => page.locator("#trip-nearby-panel");
const panelHeading = (page: Page) => page.getByRole("heading", { level: 3, name: /^Near Stop/ });
const resultsList = (page: Page) => page.getByRole("list", { name: /^Landmarks near Stop/ });
const resultRows = (page: Page) => resultsList(page).getByRole("listitem");
const radiusSelect = (page: Page) => page.getByRole("combobox", { name: "Radius" });
const panelStatus = (page: Page) => panel(page).locator("p[role='status']");
const pageStatus = (page: Page) =>
  page.locator("section[aria-labelledby='trip-heading'] > p[role='status']");
const nearbyMap = (page: Page) =>
  page.getByRole("region", { name: "Map of the search origin and nearby landmarks" });
const tripMap = (page: Page) =>
  page.getByRole("region", { name: "Map of the trip's available stops" });
const nearbyMarkers = (page: Page) => nearbyMap(page).locator(".leaflet-marker-icon");
const addButton = (page: Page, name: string) =>
  resultsList(page).getByRole("button", { name: `Add to this trip: ${name}` });
const rowFor = (page: Page, name: string) =>
  resultRows(page).filter({ has: page.getByRole("link", { name, exact: true }) });

async function activeLabel(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return "BODY";
    return el.getAttribute("aria-label") ?? el.textContent ?? el.tagName;
  });
}

async function scan(page: Page, testInfo: TestInfo, state: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
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

async function expectNoOverflow(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const overflow = document.documentElement.scrollWidth - width;
    const offenders: string[] = [];
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>(
        "main button, main a, main select, main h2, main h3, main li, main p",
      ),
    )) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      if (el.closest(".leaflet-container")) continue;
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

/** Great-circle distance in miles (spherical; an independent sanity check of PostGIS). */
function haversineMiles(a: [number, number], b: [number, number]): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b[0] - a[0]);
  const dLng = rad(b[1] - a[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * 3958.7613 * Math.asin(Math.sqrt(h));
}

/** The expected visible distance text for a server distance (the approved wording). */
function distanceText(miles: number): string {
  if (miles < 0.05) return "Less than 0.1 mi (less than 0.2 km), straight-line";
  return `About ${miles.toFixed(1)} mi (${(miles * KM_PER_MILE).toFixed(1)} km), straight-line`;
}

/** Distinct exact coordinate pairs: the origin's plus each result's (the expected marker count). */
function expectedMarkerKeys(origin: [number, number], items: readonly NearbyItem[]): Set<string> {
  const keys = new Set<string>([`${origin[0]},${origin[1]}`]);
  for (const item of items) keys.add(`${item.latitude},${item.longitude}`);
  return keys;
}

/**
 * Waits until Leaflet's animated fit, zoom, or popup auto-pan has finished: the
 * nearby markers' and popup's positions are unchanged across consecutive polls.
 * (Measuring or clicking mid-animation reads transient positions.)
 */
async function settleMap(page: Page) {
  let previous = "";
  for (let i = 0; i < 40; i += 1) {
    const now = await page.evaluate(() => {
      const map = document.querySelector(
        '[aria-label="Map of the search origin and nearby landmarks"] .leaflet-container',
      );
      if (!map) return "none";
      return Array.from(map.querySelectorAll(".leaflet-marker-icon, .leaflet-popup"))
        .map((e) => {
          const b = e.getBoundingClientRect();
          return `${Math.round(b.x)},${Math.round(b.y)}`;
        })
        .join(";");
    });
    if (now === previous) return;
    previous = now;
    await page.waitForTimeout(150);
  }
  throw new Error("the nearby map did not settle");
}

/** The first nearby marker's position RELATIVE to the nearby map (page layout may shift around it). */
async function originOffset(page: Page) {
  await settleMap(page);
  const map = (await nearbyMap(page).boundingBox())!;
  const marker = (await nearbyMarkers(page).first().boundingBox())!;
  return { x: Math.round(marker.x - map.x), y: Math.round(marker.y - map.y) };
}

/** The open nearby popup lies entirely inside the nearby map (Increment 5 correction). */
async function expectPopupInsideMap(page: Page, label: string) {
  await settleMap(page);
  const fits = await nearbyMap(page)
    .locator(".leaflet-popup")
    .evaluate((el) => {
      const map = el.closest(".leaflet-container")!.getBoundingClientRect();
      const b = el.getBoundingClientRect();
      return {
        horizontal: b.left >= map.left - 1 && b.right <= map.right + 1,
        vertical: b.top >= map.top - 1 && b.bottom <= map.bottom + 1,
      };
    });
  expect(fits, `${label}: popup inside the nearby map`).toEqual({
    horizontal: true,
    vertical: true,
  });
  // The close button takes a real pointer click (nothing covers it).
  await nearbyMap(page).locator(".leaflet-popup-close-button").click({ trial: true });
}

async function noRouteGeometry(page: Page, map: Locator) {
  expect(
    await map
      .locator(".leaflet-map-pane")
      .locator("path, polyline, polygon, circle, canvas")
      .count(),
  ).toBe(0);
  expect(await map.locator(".leaflet-overlay-pane *").count()).toBe(0);
  expect(await page.getByText(/turn |directions|driving|walking time/i).count()).toBe(0);
}

/** Builds a synthetic first page from `items` (for [intercepted] states). */
function body(
  items: NearbyItem[],
  flags: Partial<Pick<NearbyBody, "has_more" | "is_truncated">> = {},
): NearbyBody {
  return { items, page: 1, limit: 200, has_more: false, is_truncated: false, ...flags };
}

function synthetic(n: number, name: string, lat: number, lng: number, miles: number): NearbyItem {
  return {
    id: `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`,
    display_name: name,
    category: "falls",
    latitude: lat,
    longitude: lng,
    distance_miles: miles,
  };
}

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
});

/**
 * A signed-in owner with a trip of `[stop3, stop1, stop2]` (stop 1 of the trip is
 * stop3, whose point stop4 shares). Returns the trip ID and handy fixtures.
 */
async function ownerWithTrip(
  page: Page,
  trips: Parameters<Parameters<typeof test>[2]>[0]["trips"],
  name = "Nearby trip",
) {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, name);
  const [s1, s2, s3, s4] = trips.stops;
  for (const landmark of [s3, s1, s2]) await addStop(page.request, tripId, landmark);
  return { tripId, s1, s2, s3, s4 };
}

// ---------------------------------------------------------------------------
// Real proximity search
// ---------------------------------------------------------------------------

test("[real] search: explicit activation only, exact origin and radius, server order, origin left out by ID, coincident result kept, distances, membership, protected and retired excluded", async ({
  page,
  trips,
}, testInfo) => {
  const { tripId, s1, s2, s3, s4 } = await ownerWithTrip(page, trips);
  // An unavailable stop offers no Find nearby: add `retired`, then retire it (guarded).
  await addStop(page.request, tripId, trips.retired);
  await trips.retire();
  // Protected landmark: SENSITIVE before the search.
  await trips.makeHiddenSensitive();
  const nearbyRequests = recorder(page, (r) => isNearbyUrl(r.url()));

  await openTrip(page, tripId);
  await page.waitForLoadState("networkidle");
  expect(nearbyRequests, "opening a trip starts no nearby search").toHaveLength(0);
  expect(await page.getByRole("button", { name: /^Find nearby/ }).count()).toBe(3);
  await expect(
    page
      .getByRole("listitem")
      .filter({ hasText: "No longer available" })
      .getByRole("button", { name: /Find nearby/ }),
  ).toHaveCount(0);

  const responsePromise = page.waitForResponse((r) => isNearbyUrl(r.url()));
  await findNearby(page, 1, s3.displayName).click();
  const response = await responsePromise;
  const url = new URL(response.url());
  expect(Object.fromEntries(url.searchParams)).toEqual({
    near: "0.49,-160.51",
    radius: "25",
    page: "1",
    limit: "200",
  });
  expect(response.status()).toBe(200);
  const json = (await response.json()) as NearbyBody;
  await expect(resultsList(page)).toBeVisible();
  await expect(radiusSelect(page)).toHaveValue("25");
  expect(await radiusSelect(page).locator("option").allTextContents()).toEqual([
    "5 mi (8.0 km)",
    "10 mi (16.1 km)",
    "25 mi (40.2 km)",
    "50 mi (80.5 km)",
    "100 mi (160.9 km)",
  ]);

  // The server's own response: ordered by distance, all within 25 miles, PUBLIC fixtures only.
  const distances = json.items.map((i) => i.distance_miles);
  for (let i = 1; i < distances.length; i += 1)
    expect(distances[i]).toBeGreaterThanOrEqual(distances[i - 1]!);
  for (const d of distances) expect(d).toBeLessThanOrEqual(25);
  const ids = json.items.map((i) => i.id);
  expect(ids).toContain(s3.id); // the origin itself is in the response…
  expect(ids).not.toContain(trips.hidden.id); // SENSITIVE: never returned
  expect(ids).not.toContain(trips.retired.id); // retired: never returned
  // Independent sanity check of the server distances for this test's fixtures (spherical vs spheroid).
  const at: Record<string, [number, number]> = {
    [s1.id]: [0.45, -160.55],
    [s2.id]: [0.47, -160.53],
    [s4.id]: [0.49, -160.51],
    [trips.public.id]: [0.5, -160.5],
  };
  for (const item of json.items.filter((i) => i.id in at)) {
    const expected = haversineMiles([0.49, -160.51], at[item.id]!);
    expect(Math.abs(item.distance_miles - expected)).toBeLessThanOrEqual(0.005 * expected + 0.01);
  }

  // …but the list leaves it out (by ID) and otherwise keeps the server order exactly.
  const shownNames = await resultsList(page).getByRole("link").allTextContents();
  expect(shownNames).toEqual(json.items.filter((i) => i.id !== s3.id).map((i) => i.display_name));
  expect(shownNames).not.toContain(s3.displayName);
  // stop4 shares the origin's exact point: kept, at distance 0.
  const s4Row = rowFor(page, s4.displayName);
  await expect(s4Row).toContainText(
    distanceText(json.items.find((i) => i.id === s4.id)!.distance_miles),
  );
  await expect(s4Row).toContainText("Less than 0.1 mi (less than 0.2 km), straight-line");
  // Distances shown are the server's, in miles and kilometres, labelled straight-line.
  for (const item of json.items.filter((i) => i.id !== s3.id).slice(0, 10)) {
    await expect(rowFor(page, item.display_name).first()).toContainText(
      distanceText(item.distance_miles),
    );
  }
  // Members: stop1 and stop2 of this trip (stops 2 and 3); no Add on them.
  await expect(rowFor(page, s1.displayName)).toContainText("In this trip (Stop 2)");
  await expect(rowFor(page, s2.displayName)).toContainText("In this trip (Stop 3)");
  await expect(rowFor(page, s1.displayName).getByRole("button")).toHaveCount(0);
  await expect(addButton(page, s4.displayName)).toBeVisible();
  // Protected and retired: nowhere in the panel, the map, popups, or links.
  const panelHtml = await panel(page).innerHTML();
  for (const hidden of [trips.hidden, trips.retired]) {
    expect(panelHtml).not.toContain(hidden.id);
    expect(panelHtml).not.toContain(hidden.displayName);
  }
  // Profile links point at the result's own profile.
  await expect(rowFor(page, s4.displayName).getByRole("link")).toHaveAttribute(
    "href",
    `/landmarks/${s4.id}`,
  );
  await scan(page, testInfo, "nearby-results");

  // A radius change requests that radius and nothing else.
  const second = page.waitForResponse((r) => isNearbyUrl(r.url()));
  await radiusSelect(page).selectOption("5");
  const radius5 = await second;
  expect(new URL(radius5.url()).searchParams.get("radius")).toBe("5");
  expect(new URL(radius5.url()).searchParams.get("near")).toBe("0.49,-160.51");
  for (const item of ((await radius5.json()) as NearbyBody).items)
    expect(item.distance_miles).toBeLessThanOrEqual(5);
  expect(nearbyRequests).toHaveLength(2);
});

test("[real + delayed] switching, closing, reopening, and the session-local radius", async ({
  page,
  trips,
}) => {
  const { tripId, s1, s3 } = await ownerWithTrip(page, trips);
  const nearbyRequests = recorder(page, (r) => isNearbyUrl(r.url()));
  await openTrip(page, tripId);
  await findNearby(page, 1, s3.displayName).click();
  await expect(resultsList(page)).toBeVisible();
  await radiusSelect(page).selectOption("10");
  await expect(panelStatus(page)).toHaveText(/within 10 mi/);

  // Close: focus back to the stop's Find nearby; reopen: a fresh request at the kept radius.
  await panel(page).getByRole("button", { name: "Close nearby landmarks" }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(findNearby(page, 1, s3.displayName)).toBeFocused();
  await findNearby(page, 1, s3.displayName).click();
  await expect(resultsList(page)).toBeVisible();
  expect(nearbyRequests).toHaveLength(3);
  expect(new URL(nearbyRequests[2]!.url()).searchParams.get("radius")).toBe("10");
  await expect(radiusSelect(page)).toHaveValue("10");

  // Switching stops replaces the search at once ([delayed] to observe the loading state).
  const held = await gate(page, (u) => isNearbyUrl(u.toString()), "GET");
  await findNearby(page, 2, s1.displayName).click();
  await expect(panelHeading(page)).toHaveText(`Near Stop 2: ${s1.displayName}`);
  await expect(panelHeading(page)).toBeFocused();
  await expect(resultsList(page)).toHaveCount(0);
  await expect(nearbyMap(page)).toHaveCount(0);
  await expect(panelStatus(page)).toHaveText("Finding landmarks within 10 mi (16.1 km) of Stop 2…");
  expect(new URL(nearbyRequests.at(-1)!.url()).searchParams.get("near")).toBe("0.45,-160.55");
  held.release();
  await expect(resultsList(page)).toBeVisible();
  await expect(page.locator("#trip-nearby-panel")).toHaveCount(1);
});

// ---------------------------------------------------------------------------
// Search states and completeness ([intercepted] responses for the hard cases)
// ---------------------------------------------------------------------------

test("[delayed + intercepted] states: loading, empty, retained during an update and after its failure, initial failure and retry, completeness, malformed, late responses", async ({
  page,
  trips,
}, testInfo) => {
  const { tripId, s3, s4 } = await ownerWithTrip(page, trips);
  await openTrip(page, tripId);
  const origin = { id: s3.id, lat: 0.49, lng: -160.51 };
  const listed = [
    synthetic(1, "Synthetic One", 0.5, -160.5, 0.98),
    synthetic(2, "Synthetic Two", 0.52, -160.52, 2.19),
  ];
  let next: (route: Route) => Promise<void> = (route) => route.fallback();
  let hold: Promise<void> | null = null;
  await page.route(
    (u) => isNearbyUrl(u.toString()),
    async (route) => {
      if (hold) await hold;
      await next(route);
    },
  );
  const answer = (b: NearbyBody) => async (route: Route) => route.fulfill({ status: 200, json: b });
  const fail = (status: number) => async (route: Route) =>
    route.fulfill({ status, json: { error: { code: "INTERNAL_ERROR", message: "x" } } });

  // Initial loading: status line, no list, no map.
  let releaseHold!: () => void;
  hold = new Promise((r) => (releaseHold = r));
  next = answer(
    body([
      { ...synthetic(0, s3.displayName, origin.lat, origin.lng, 0), id: origin.id },
      ...listed,
    ]),
  );
  await findNearby(page, 1, s3.displayName).click();
  await expect(panelStatus(page)).toHaveText("Finding landmarks within 25 mi (40.2 km) of Stop 1…");
  await expect(resultsList(page)).toHaveCount(0);
  await expect(nearbyMap(page)).toHaveCount(0);
  await scan(page, testInfo, "nearby-loading");
  hold = null;
  releaseHold();
  await expect(resultRows(page)).toHaveCount(2);
  await expect(nearbyMarkers(page)).toHaveCount(3);

  // Radius update: earlier results kept with THEIR radius; requested radius shown separately; no Add.
  hold = new Promise((r) => (releaseHold = r));
  next = fail(500);
  await radiusSelect(page).selectOption("50");
  await expect(radiusSelect(page)).toHaveValue("50");
  await expect(panel(page)).toContainText(
    "Showing the earlier 2 landmarks found within 25 mi (40.2 km) while the search within 50 mi (80.5 km) loads.",
  );
  await expect(panel(page)).toContainText(
    "The map still shows the earlier 2 landmarks found within 25 mi (40.2 km), not results for 50 mi (80.5 km).",
  );
  await expect(resultsList(page).getByRole("button")).toHaveCount(0);
  await expect(nearbyMarkers(page)).toHaveCount(3);
  await scan(page, testInfo, "nearby-retained-updating");
  hold = null;
  releaseHold();
  // …and after it fails: kept, labelled, alert with Try again.
  await expect(panel(page).getByRole("alert")).toContainText("Nearby landmarks couldn't be loaded");
  await expect(panel(page)).toContainText(
    "The search within 50 mi (80.5 km) failed. Still showing the earlier 2 landmarks found within 25 mi (40.2 km).",
  );
  await expect(resultsList(page).getByRole("button")).toHaveCount(0);
  await scan(page, testInfo, "nearby-retained-failed");

  // Retry with completeness flags and one malformed item.
  next = answer(
    body([...listed, { ...synthetic(3, "Broken", 91, -160.5, 1) }], {
      has_more: true,
      is_truncated: true,
    }),
  );
  await panel(page).getByRole("button", { name: "Try again" }).click();
  await expect(resultRows(page)).toHaveCount(2);
  await expect(panel(page)).toContainText(
    /^.*More landmarks are within 50 mi \(80\.5 km\) than are listed here\./,
  );
  await expect(panel(page)).toContainText("1 result could not be displayed.");
  await expect(panel(page)).toContainText(
    "Not every landmark within 50 mi (80.5 km) is on the map.",
  );
  await expect(panel(page)).not.toContainText("Broken");

  // Genuine empty (only the origin): origin-only map with its caption.
  next = answer(
    body([{ ...synthetic(0, s3.displayName, origin.lat, origin.lng, 0), id: origin.id }]),
  );
  await radiusSelect(page).selectOption("5");
  await expect(panelStatus(page)).toHaveText(
    "No other publicly viewable landmarks were found within 5 mi (8.0 km) of this stop. Try a larger radius.",
  );
  await expect(nearbyMarkers(page)).toHaveCount(1);
  await expect(panel(page)).toContainText("The map shows the search origin only");
  await scan(page, testInfo, "nearby-empty");

  // Entirely malformed: no false "no landmarks" claim, no map.
  next = answer(body([synthetic(4, "Bad", 0.5, 200, 1)]));
  await radiusSelect(page).selectOption("10");
  await expect(panelStatus(page)).toHaveText(
    "No results within 10 mi (16.1 km) can be displayed: the results returned could not be shown.",
  );
  await expect(nearbyMap(page)).toHaveCount(0);

  // Incomplete with nothing usable: no false empty claim.
  next = answer(
    body([{ ...synthetic(0, "x", origin.lat, origin.lng, 0), id: origin.id }], { has_more: true }),
  );
  await radiusSelect(page).selectOption("25");
  await expect(panelStatus(page)).toHaveText(
    "No other landmarks could be listed, although the search reports more matches within 25 mi (40.2 km).",
  );
  await expect(nearbyMap(page)).toHaveCount(0);

  // Initial failure without retained results (another stop): alert, no list, no map; retry.
  next = fail(503);
  await findNearby(page, 2, trips.stops[0].displayName).click();
  await expect(panel(page).getByRole("alert")).toBeVisible();
  await expect(resultsList(page)).toHaveCount(0);
  await expect(nearbyMap(page)).toHaveCount(0);
  await scan(page, testInfo, "nearby-failed");
  next = (route) => route.fallback(); // real again
  await panel(page).getByRole("button", { name: "Try again" }).click();
  await expect(resultsList(page)).toBeVisible();

  // Late responses: a held search that finishes after Close never reopens the panel.
  hold = new Promise((r) => (releaseHold = r));
  await radiusSelect(page).selectOption("50");
  await panel(page).getByRole("button", { name: "Close nearby landmarks" }).click();
  hold = null;
  releaseHold();
  await page.waitForTimeout(300);
  await expect(panel(page)).toHaveCount(0);
  void s4;
});

// ---------------------------------------------------------------------------
// Real additions
// ---------------------------------------------------------------------------

test("[real + delayed] add by pointer and keyboard: exact IDs, 201 then the trip re-read, no optimistic stop, persistence, maps, membership, remove and reorder", async ({
  page,
  trips,
}, testInfo) => {
  const { tripId, s3, s4 } = await ownerWithTrip(page, trips);
  const pub = trips.public;
  const nearbyRequests = recorder(page, (r) => isNearbyUrl(r.url()));
  const posts = recorder(page, isAddPost(tripId));
  const tripGets = recorder(page, isTripGet(tripId));
  await openTrip(page, tripId);
  const before = await serverTrip(page.request, tripId);
  await findNearby(page, 1, s3.displayName).click();
  await expect(addButton(page, s4.displayName)).toBeVisible();
  await expect(tripMap(page).locator(".leaflet-marker-icon")).toHaveCount(3);
  const originBox = await originOffset(page);

  // Pointer add, with the POST held: nothing changes before the server confirms.
  const heldPost = await gate(page, `**/api/v1/trips/${tripId}/stops`, "POST");
  await addButton(page, s4.displayName).click();
  await expect(pageStatus(page)).toHaveText("Adding stop…");
  await expect(page.getByRole("list", { name: "Stops" }).getByRole("listitem")).toHaveCount(3);
  await expect(addButton(page, s4.displayName)).toHaveAttribute("aria-disabled", "true");
  await scan(page, testInfo, "nearby-add-pending");
  expect(posts).toHaveLength(1);
  expect(posts[0]!.postDataJSON()).toEqual({ landmark_id: s4.id });
  const getsBefore = tripGets.length;
  const createdPromise = page.waitForResponse((r) => isAddPost(tripId)(r.request()));
  heldPost.release();
  const created = await createdPromise;
  expect(created.status()).toBe(201);
  await expect(pageStatus(page)).toHaveText(
    `Added ${s4.displayName} to the trip as stop 4. The trip has 4 stops.`,
  );
  expect(tripGets.length).toBe(getsBefore + 1); // the authoritative re-read
  await page.unroute(`**/api/v1/trips/${tripId}/stops`);
  await expect(rowFor(page, s4.displayName)).toContainText("In this trip (Stop 4)");
  await expect(rowFor(page, s4.displayName).getByRole("link")).toBeFocused();
  await expect(page.getByRole("list", { name: "Stops" }).getByRole("listitem")).toHaveCount(4);
  const marker4 = nearbyMarkers(page).first(); // stop4 shares the origin's point: the origin group
  await expect(marker4).toHaveAttribute(
    "aria-label",
    new RegExp(`${s4.displayName}.*in this trip \\(Stop 4\\)`),
  );
  expect(await originOffset(page)).toEqual(originBox); // nearby viewport kept (the page grew above it)
  const after = await serverTrip(page.request, tripId);
  expect(after.version).toBeGreaterThan(before.version);
  expect(after.stops.map((s) => s.landmark.id).at(-1)).toBe(s4.id);
  expect(after.stops.at(-1)!.position).toBe(3);
  await expect(page.getByText(/^Straight-line total/)).toBeVisible();
  await scan(page, testInfo, "nearby-add-success");

  // Keyboard add of another landmark.
  await addButton(page, pub.displayName).focus();
  await page.keyboard.press("Enter");
  await expect(pageStatus(page)).toHaveText(
    `Added ${pub.displayName} to the trip as stop 5. The trip has 5 stops.`,
  );
  await expect(rowFor(page, pub.displayName).getByRole("link")).toBeFocused();
  expect(posts).toHaveLength(2);
  expect(nearbyRequests).toHaveLength(1); // membership changes never refetch

  // Persistence across a reload.
  await page.reload();
  await expect(page.getByRole("list", { name: "Stops" }).getByRole("listitem")).toHaveCount(5);
  await expect(tripMap(page).locator(".leaflet-marker-icon")).toHaveCount(4);
  await findNearby(page, 1, s3.displayName).click();
  await expect(rowFor(page, pub.displayName)).toContainText("In this trip (Stop 5)");

  // Remove the added stop: its Add control returns, without a new nearby request.
  const requestsNow = nearbyRequests.length;
  await page.getByRole("button", { name: `Remove ${pub.displayName} from the trip` }).click();
  await expect(addButton(page, pub.displayName)).toBeVisible();
  // Reorder: the origin moves to stop 2; membership numbers and the origin marker follow.
  await page.getByRole("button", { name: `Move down: ${s3.displayName}` }).click();
  await expect(panelHeading(page)).toHaveText(`Near Stop 2: ${s3.displayName}`);
  await expect(nearbyMarkers(page).first()).toHaveAttribute("aria-label", /^Stop 2 \+/);
  await expect(rowFor(page, s4.displayName)).toContainText("In this trip (Stop 4)");
  expect(nearbyRequests.length).toBe(requestsNow);
});

test("[real] conflicts and refusals: a concurrent duplicate (409), a landmark protected after the search (404, safe), a deleted trip (generic not found)", async ({
  page,
  trips,
}) => {
  const { tripId, s3, s4 } = await ownerWithTrip(page, trips);
  await openTrip(page, tripId);
  await findNearby(page, 1, s3.displayName).click();
  await expect(addButton(page, s4.displayName)).toBeVisible();

  // 409: the same landmark added elsewhere first.
  await addStop(page.request, tripId, s4);
  const dup = page.waitForResponse((r) => isAddPost(tripId)(r.request()));
  await addButton(page, s4.displayName).click();
  const dupResponse = await dup;
  expect(dupResponse.status()).toBe(409);
  expect(((await dupResponse.json()) as { error: { code: string } }).error.code).toBe(
    "TRIP_STOP_ALREADY_EXISTS",
  );
  await expect(pageStatus(page)).toHaveText(
    `${s4.displayName} is already in this trip. The latest trip is shown.`,
  );
  await expect(rowFor(page, s4.displayName)).toContainText("In this trip (Stop 4)");

  // 404: protected between the search and the add — generic, no metadata.
  await expect(addButton(page, trips.hidden.displayName)).toBeVisible();
  await trips.makeHiddenSensitive();
  const gone = page.waitForResponse((r) => isAddPost(tripId)(r.request()));
  await addButton(page, trips.hidden.displayName).click();
  const goneResponse = await gone;
  expect(goneResponse.status()).toBe(404);
  const goneText = await goneResponse.text();
  expect(goneText).not.toContain(trips.hidden.displayName);
  expect(goneText).not.toMatch(/SENSITIVE|sensitiv|latitude|0\.52/);
  await expect(pageStatus(page)).toHaveText(
    `${trips.hidden.displayName} can't be added to this trip. The latest trip is shown.`,
  );
  await expect(pageStatus(page)).not.toHaveText(/sensitive|protected|classif/i);
  await expect(addButton(page, trips.hidden.displayName)).toBeFocused();
  // A new search no longer returns it.
  const again = page.waitForResponse((r) => isNearbyUrl(r.url()));
  await radiusSelect(page).selectOption("10");
  const ids = ((await (await again).json()) as NearbyBody).items.map((i) => i.id);
  expect(ids).not.toContain(trips.hidden.id);
  await expect(rowFor(page, trips.hidden.displayName)).toHaveCount(0);

  // Deleted trip: the add's 404 and the re-read's 404 → the generic not-found page.
  const del = await page.request.delete(`/api/v1/trips/${tripId}`, { headers: { Origin: ORIGIN } });
  expect(del.status()).toBe(204);
  await addButton(page, trips.public.displayName).click();
  await expect(page.getByText(/This trip couldn't be found/)).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
});

test("[intercepted] capacity 409, 429 with Retry-After, and a definitive 400: messages, focus, no re-read for refusals, no replay", async ({
  page,
  trips,
}, testInfo) => {
  const { tripId, s3, s4 } = await ownerWithTrip(page, trips);
  const posts = recorder(page, isAddPost(tripId));
  const tripGets = recorder(page, isTripGet(tripId));
  await openTrip(page, tripId);
  await findNearby(page, 1, s3.displayName).click();
  await expect(addButton(page, s4.displayName)).toBeVisible();
  let reply: (route: Route) => Promise<void>;
  await page.route(`**/api/v1/trips/${tripId}/stops`, (route) =>
    route.request().method() === "POST" ? reply(route) : route.fallback(),
  );

  reply = (route) =>
    route.fulfill({
      status: 429,
      headers: { "Retry-After": "12" },
      json: { error: { code: "RATE_LIMITED", message: "slow" } },
    });
  let gets = tripGets.length;
  await addButton(page, s4.displayName).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Couldn't change the trip. Too many requests. Please try again in 12 seconds.",
  );
  await expect(addButton(page, s4.displayName)).toBeFocused();
  expect(tripGets.length).toBe(gets);
  await scan(page, testInfo, "nearby-add-error");

  reply = (route) =>
    route.fulfill({ status: 400, json: { error: { code: "INVALID_REQUEST", message: "bad" } } });
  gets = tripGets.length;
  await addButton(page, s4.displayName).click();
  await expect(page.getByRole("alert")).toHaveText("Couldn't change the trip. Please try again.");
  expect(tripGets.length).toBe(gets);

  // Capacity: the real trip is re-read after the (intercepted) 409.
  reply = (route) =>
    route.fulfill({
      status: 409,
      json: { error: { code: "TRIP_STOP_LIMIT_REACHED", message: "full" } },
    });
  gets = tripGets.length;
  await addButton(page, s4.displayName).click();
  await expect(pageStatus(page)).toHaveText(
    "This trip already has 25 stops, the most a trip can hold. The latest trip is shown.",
  );
  expect(tripGets.length).toBe(gets + 1);
  expect(posts).toHaveLength(3); // one per click; nothing replayed
});

test("[real] 401: signing out elsewhere, then Add, clears the trip and the nearby panel and re-checks the session", async ({
  page,
  trips,
}) => {
  const { tripId, s3, s4 } = await ownerWithTrip(page, trips);
  await openTrip(page, tripId);
  await findNearby(page, 1, s3.displayName).click();
  await expect(nearbyMarkers(page).first()).toBeVisible();
  await page.request.post("/api/auth/sign-out", { headers: { Origin: ORIGIN }, data: {} });
  const unauth = page.waitForResponse((r) => isAddPost(tripId)(r.request()));
  await addButton(page, s4.displayName).click();
  expect((await unauth).status()).toBe(401);
  await expect(page.getByRole("link", { name: "Sign in to see this trip" })).toBeVisible();
  await expect(panel(page)).toHaveCount(0);
  await expect(nearbyMap(page)).toHaveCount(0);
  await expect(page.getByText(s3.displayName)).toHaveCount(0);
  // Signed-out users cannot reach the owner trip interface.
  await page.reload();
  await expect(page.getByRole("link", { name: "Sign in to see this trip" })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Find nearby/ })).toHaveCount(0);
});

test("[real + intercepted] uncertain outcomes: a lost response after a REAL commit, an aborted request, and failed reconciliation with Reload", async ({
  page,
  trips,
}, testInfo) => {
  const { tripId, s3, s4 } = await ownerWithTrip(page, trips);
  const pub = trips.public;
  const posts = recorder(page, isAddPost(tripId));
  await openTrip(page, tripId);
  await findNearby(page, 1, s3.displayName).click();
  await expect(addButton(page, s4.displayName)).toBeVisible();

  // Lost response after a real commit: the server adds it; the browser sees a network failure.
  let committedStatus = 0;
  await page.route(`**/api/v1/trips/${tripId}/stops`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const real = await route.fetch();
    committedStatus = real.status();
    await route.abort("failed");
  });
  await addButton(page, s4.displayName).click();
  await expect(pageStatus(page)).toHaveText(
    `Couldn't confirm the change, but ${s4.displayName} is in the trip. The latest trip is shown.`,
  );
  expect(committedStatus).toBe(201);
  await expect(addButton(page, s4.displayName)).toHaveCount(0);
  expect(posts).toHaveLength(1);
  expect(
    (await serverTrip(page.request, tripId)).stops.filter((s) => s.landmark.id === s4.id),
  ).toHaveLength(1);
  await page.unroute(`**/api/v1/trips/${tripId}/stops`);

  // Aborted before reaching the server: absent; only an explicit click retries.
  await page.route(`**/api/v1/trips/${tripId}/stops`, (route) =>
    route.request().method() === "POST" ? route.abort("failed") : route.fallback(),
  );
  await addButton(page, pub.displayName).click();
  await expect(pageStatus(page)).toHaveText(
    `Couldn't confirm whether ${pub.displayName} was added. It isn't in the trip — you can try again.`,
  );
  await expect(addButton(page, pub.displayName)).toBeFocused();
  expect(posts).toHaveLength(2);
  await page.waitForTimeout(300);
  expect(posts).toHaveLength(2); // never replayed automatically
  await page.unroute(`**/api/v1/trips/${tripId}/stops`);

  // 201, then the re-read fails: stale with Reload; Reload shows it without re-sending.
  let failGet = true;
  await page.route(`**/api/v1/trips/${tripId}`, (route) =>
    failGet && route.request().method() === "GET"
      ? route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "x" } } })
      : route.fallback(),
  );
  await addButton(page, pub.displayName).click();
  const alert = page.getByRole("alert");
  await expect(alert).toHaveText(
    /^The stop was added, but the updated trip couldn't be loaded\. Reload the trip before making more changes\./,
  );
  await expect(alert.getByRole("button", { name: "Reload trip" })).toBeFocused();
  await expect(panel(page)).toHaveCount(0);
  await scan(page, testInfo, "nearby-add-reload-required");
  failGet = false;
  const postsBeforeReload = posts.length;
  await alert.getByRole("button", { name: "Reload trip" }).click();
  await expect(page.getByRole("list", { name: "Stops" }).getByRole("listitem")).toHaveCount(5);
  expect(posts.length).toBe(postsBeforeReload);
});

test("[delayed] one change at a time: repeated and different Add clicks, Remove and Move while an add is pending", async ({
  page,
  trips,
}) => {
  const { tripId, s3, s4, s2 } = await ownerWithTrip(page, trips);
  const posts = recorder(page, isAddPost(tripId));
  const others = recorder(
    page,
    (r) =>
      (r.method() === "DELETE" || r.method() === "PUT") &&
      r.url().includes(`/api/v1/trips/${tripId}/`),
  );
  await openTrip(page, tripId);
  await findNearby(page, 1, s3.displayName).click();
  await expect(addButton(page, s4.displayName)).toBeVisible();
  const held = await gate(page, `**/api/v1/trips/${tripId}/stops`, "POST");
  await addButton(page, s4.displayName).click();
  await addButton(page, s4.displayName).click({ force: true });
  await addButton(page, trips.public.displayName).click({ force: true });
  await page
    .getByRole("button", { name: `Remove ${s2.displayName} from the trip` })
    .click({ force: true });
  await page.getByRole("button", { name: `Move down: ${s3.displayName}` }).click({ force: true });
  // A burst in one task, before React re-renders.
  await page.evaluate(() => {
    for (const b of Array.from(document.querySelectorAll<HTMLButtonElement>("[data-nearby-add]")))
      b.click();
  });
  expect(posts).toHaveLength(1);
  expect(others).toHaveLength(0);
  held.release();
  await expect(rowFor(page, s4.displayName)).toContainText("In this trip (Stop 4)");
  expect(posts).toHaveLength(1);
  expect(others).toHaveLength(0);
});

test("[real + delayed] lifecycle: close or switch during an add, origin removed, origin unavailable, origin coordinates changed [intercepted], session loss with a late search", async ({
  page,
  trips,
}) => {
  const { tripId, s1, s2, s3, s4 } = await ownerWithTrip(page, trips);
  const posts = recorder(page, isAddPost(tripId));
  await openTrip(page, tripId);

  // Close during a pending add: not cancelled, announced, focus stays on Find nearby.
  await findNearby(page, 1, s3.displayName).click();
  let held = await gate(page, `**/api/v1/trips/${tripId}/stops`, "POST");
  await addButton(page, s4.displayName).click();
  await panel(page).getByRole("button", { name: "Close nearby landmarks" }).click();
  await expect(findNearby(page, 1, s3.displayName)).toBeFocused();
  held.release();
  await expect(pageStatus(page)).toHaveText(
    `Added ${s4.displayName} to the trip as stop 4. The trip has 4 stops.`,
  );
  await expect(panel(page)).toHaveCount(0);
  await expect(findNearby(page, 1, s3.displayName)).toBeFocused();
  expect(posts).toHaveLength(1);
  await page.unroute(`**/api/v1/trips/${tripId}/stops`);

  // Switch during a pending add: the new search stays, with focus.
  await findNearby(page, 1, s3.displayName).click();
  held = await gate(page, `**/api/v1/trips/${tripId}/stops`, "POST");
  await addButton(page, trips.public.displayName).click();
  await findNearby(page, 3, s2.displayName).click();
  await expect(panelHeading(page)).toBeFocused();
  held.release();
  await expect(pageStatus(page)).toHaveText(/^Added /);
  await expect(panelHeading(page)).toHaveText(`Near Stop 3: ${s2.displayName}`);
  await expect(panelHeading(page)).toBeFocused();
  await page.unroute(`**/api/v1/trips/${tripId}/stops`);

  // Origin removed: the panel closes with a notice.
  await page.getByRole("button", { name: `Remove ${s2.displayName} from the trip` }).click();
  await expect(panel(page)).toHaveCount(0);
  await expect(pageStatus(page)).toHaveText(
    /The nearby search was closed because its stop was removed from the trip\.$/,
  );

  // Origin coordinates changed in the authoritative trip [intercepted re-read]: closed, focus back to Find nearby.
  await findNearby(page, 2, s1.displayName).click();
  await expect(resultsList(page)).toBeVisible();
  await resultRows(page).first().getByRole("link").focus();
  await page.route(`**/api/v1/trips/${tripId}`, async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const real = await route.fetch();
    const json = (await real.json()) as {
      trip: { stops: { landmark: { id: string; latitude?: number } }[] };
    };
    for (const s of json.trip.stops) if (s.landmark.id === s1.id) s.landmark.latitude = 0.4501;
    await route.fulfill({ response: real, json });
  });
  // Trigger a re-read without moving focus (a removal clicked by script).
  await page.evaluate((name) => {
    const button = document.querySelector<HTMLButtonElement>(
      `button[aria-label="Remove ${name} from the trip"]`,
    );
    button?.click();
  }, trips.public.displayName);
  await expect(pageStatus(page)).toHaveText(
    /The nearby search was closed because its stop's location changed\.$/,
  );
  await expect(findNearby(page, 2, s1.displayName)).toBeFocused();
  await page.unroute(`**/api/v1/trips/${tripId}`);

  // Session loss with a late search response: the panel never comes back.
  await page.reload();
  await findNearby(page, 1, s3.displayName).click();
  await expect(resultsList(page)).toBeVisible();
  const heldSearch = await gate(page, (u) => isNearbyUrl(u.toString()), "GET");
  await radiusSelect(page).selectOption("100");
  await page.request.post("/api/auth/sign-out", { headers: { Origin: ORIGIN }, data: {} });
  // A trip change now gets a real 401, and the session is re-checked.
  await page.getByRole("button", { name: `Remove ${s4.displayName} from the trip` }).click();
  await expect(page.getByRole("link", { name: "Sign in to see this trip" })).toBeVisible();
  heldSearch.release();
  await page.waitForTimeout(300);
  await expect(panel(page)).toHaveCount(0);
  await expect(nearbyMap(page)).toHaveCount(0);
});

test("[real] origin made unavailable: the panel closes with a notice; focus inside the panel falls back to Stops", async ({
  page,
  trips,
}) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Origin turns protected");
  for (const landmark of [trips.hidden, trips.stops[0], trips.stops[1]])
    await addStop(page.request, tripId, landmark);
  await openTrip(page, tripId);
  await findNearby(page, 1, trips.hidden.displayName).click();
  await expect(resultsList(page)).toBeVisible();
  await resultRows(page).first().getByRole("link").focus();
  await trips.makeHiddenSensitive();
  // A re-read is needed for the page to learn it: a removal clicked by script (focus stays in the panel).
  await page.evaluate((name) => {
    document
      .querySelector<HTMLButtonElement>(`button[aria-label="Remove ${name} from the trip"]`)
      ?.click();
  }, trips.stops[1].displayName);
  await expect(pageStatus(page)).toHaveText(
    /The nearby search was closed because its stop is no longer available\.$/,
  );
  await expect(panel(page)).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 3, name: "Stops" })).toBeFocused();
  await expect(page.getByRole("button", { name: /^Find nearby: Stop 1/ })).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// Supplementary map, keyboard, nested Escape
// ---------------------------------------------------------------------------

test("[real] nearby map: exact groups from the response, origin identity, both maps independent, pointer and keyboard popups, nested Escape, no geometry, panning requests nothing", async ({
  page,
  trips,
}, testInfo) => {
  const { tripId, s3, s4 } = await ownerWithTrip(page, trips);
  const nearbyRequests = recorder(page, (r) => isNearbyUrl(r.url()));
  await page.setViewportSize({ width: 1280, height: 1800 });
  await openTrip(page, tripId);
  const responsePromise = page.waitForResponse((r) => isNearbyUrl(r.url()));
  await findNearby(page, 1, s3.displayName).click();
  const json = (await (await responsePromise).json()) as NearbyBody;
  const shown = json.items.filter((i) => i.id !== s3.id);
  await expect(nearbyMarkers(page)).toHaveCount(expectedMarkerKeys([0.49, -160.51], shown).size);
  await expect(tripMap(page).locator(".leaflet-marker-icon")).toHaveCount(3);

  // The origin marker: square "Stop 1 +k" (stop4 and any others at its exact point), identity first.
  const atOrigin = shown.filter((i) => i.latitude === 0.49 && i.longitude === -160.51);
  expect(atOrigin.map((i) => i.id)).toContain(s4.id);
  const origin = nearbyMarkers(page).first();
  await expect(origin).toHaveText(`Stop 1 +${atOrigin.length}`);
  await expect(origin).toHaveAttribute(
    "aria-label",
    new RegExp(
      `^Stop 1 \\+${atOrigin.length}, search origin and ${atOrigin.length} nearby landmarks? at the same location: ${s3.displayName}, search origin; `,
    ),
  );
  expect(await origin.locator("span").getAttribute("class")).toMatch(/originBadge/);
  // Every marker's name starts with its visible text.
  for (const marker of await nearbyMarkers(page).all()) {
    const text = (await marker.textContent()) ?? "";
    expect((await marker.getAttribute("aria-label"))!.startsWith(text)).toBe(true);
  }
  // Nearby but distinct points stay separate markers at distinct positions.
  const boxes = await nearbyMarkers(page).evaluateAll((els) =>
    els.map((e) => {
      const b = e.getBoundingClientRect();
      return `${Math.round(b.x + b.width / 2)},${Math.round(b.y + b.height / 2)}`;
    }),
  );
  expect(new Set(boxes).size).toBe(boxes.length);

  // Pointer: the origin group's popup lists the origin and each result with its own link.
  await settleMap(page);
  await origin.click();
  const popup = nearbyMap(page).locator(".leaflet-popup");
  await expect(popup).toBeVisible();
  await expect(
    popup.getByRole("group", { name: "Search origin and nearby landmarks at this location" }),
  ).toBeFocused();
  await expect(
    popup.getByRole("link", { name: `View profile: Stop 1, ${s3.displayName}` }),
  ).toHaveAttribute("href", `/landmarks/${s3.id}`);
  await expect(
    popup.getByRole("link", { name: `View profile: ${s4.displayName}` }),
  ).toHaveAttribute("href", `/landmarks/${s4.id}`);
  await expect(popup.getByRole("link")).toHaveCount(1 + atOrigin.length);
  await expectPopupInsideMap(page, "origin group popup at 1280px");
  await scan(page, testInfo, "nearby-coincident-popup");
  // Escape in the popup closes only the popup (focus back to the marker), then the panel.
  await popup.getByRole("link").first().focus();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(origin).toBeFocused();
  await expect(panel(page)).toHaveCount(1);
  // Space opens; Shift+Tab from the popup start returns to the marker; Enter; close button.
  await page.keyboard.press(" ");
  await expect(popup).toBeVisible();
  await page.keyboard.press("Shift+Tab");
  await expect(origin).toBeFocused();
  await expect(popup).toBeVisible();
  await popup.locator(".leaflet-popup-close-button").click();
  await expect(popup).toHaveCount(0);
  await expect(origin).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(popup).toBeVisible();
  await scan(page, testInfo, "nearby-popup-open");
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(panel(page)).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(findNearby(page, 1, s3.displayName)).toBeFocused();

  // Reopen; no route geometry; panning and zooming request nothing; the trip map is unaffected.
  await findNearby(page, 1, s3.displayName).click();
  await expect(nearbyMarkers(page).first()).toBeVisible();
  await noRouteGeometry(page, nearbyMap(page));
  await noRouteGeometry(page, tripMap(page));
  const count = nearbyRequests.length;
  await nearbyMap(page).locator(".leaflet-control-zoom-in").click();
  await nearbyMap(page).locator(".leaflet-control-zoom-out").click();
  await settleMap(page);
  const box = (await nearbyMap(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2 + 40, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  expect(nearbyRequests.length).toBe(count);
  await expect(tripMap(page).locator(".leaflet-marker-icon")).toHaveCount(3);

  // A pending radius update and its failure keep the viewport and markers.
  // [delayed + intercepted] One route holds the update, then answers it with a 500.
  const originBox = await originOffset(page);
  let releaseUpdate!: () => void;
  const updateHeld = new Promise<void>((resolve) => (releaseUpdate = resolve));
  await page.route(
    (u) => isNearbyUrl(u.toString()),
    async (route) => {
      await updateHeld;
      await route.fulfill({
        status: 500,
        json: { error: { code: "INTERNAL_ERROR", message: "x" } },
      });
    },
  );
  await radiusSelect(page).selectOption("50");
  await expect(panel(page)).toContainText("while the search within 50 mi");
  expect(await originOffset(page)).toEqual(originBox);
  releaseUpdate();
  await expect(panel(page).getByRole("alert")).toBeVisible();
  expect(await originOffset(page)).toEqual(originBox);
});

test("[real] keyboard-only workflow: Tab to Find nearby, panel heading, radius, links, Add, map controls; the focus listener is cleaned up", async ({
  page,
  trips,
}) => {
  const { tripId, s3, s4 } = await ownerWithTrip(page, trips);
  await openTrip(page, tripId);
  const cdp = await page.context().newCDPSession(page);
  const focusinListeners = async () => {
    const { result } = await cdp.send("Runtime.evaluate", { expression: "document" });
    const { listeners } = await cdp.send("DOMDebugger.getEventListeners", {
      objectId: result.objectId!,
    });
    return listeners.filter((l) => l.type === "focusin").length;
  };
  // The page's document focusin listener lives as long as the trip page.
  const onTripPage = await focusinListeners();

  const button = findNearby(page, 1, s3.displayName);
  for (
    let i = 0;
    i < 60 && !(await button.evaluate((el) => el === document.activeElement));
    i += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(button).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panelHeading(page)).toBeFocused();
  await expect(resultsList(page)).toBeVisible();
  await page.keyboard.press("Tab");
  expect(await activeLabel(page)).toBe("Close nearby landmarks");
  await page.keyboard.press("Tab");
  await expect(radiusSelect(page)).toBeFocused();
  // Keyboard radius change (ArrowDown selects the next option without opening the native list).
  const changed = page.waitForResponse((r) => isNearbyUrl(r.url()));
  await page.keyboard.press("ArrowDown");
  expect(new URL((await changed).url()).searchParams.get("radius")).toBe("50");
  await expect(radiusSelect(page)).toBeFocused();
  // Escape on the (closed) native select reaches the panel and closes it — documented behaviour;
  // Escape while the native list is OPEN is a manual check (see the record).
  await page.keyboard.press("Escape");
  await expect(panel(page)).toHaveCount(0);
  await expect(button).toBeFocused();

  // Reopen, Tab to the first link and an Add control; Enter adds.
  await page.keyboard.press("Enter");
  await expect(resultsList(page)).toBeVisible();
  const add = addButton(page, s4.displayName);
  for (let i = 0; i < 80 && !(await add.evaluate((el) => el === document.activeElement)); i += 1) {
    await page.keyboard.press("Tab");
  }
  await expect(add).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(rowFor(page, s4.displayName).getByRole("link")).toBeFocused();
  // Onward to the map's zoom control and a marker.
  const zoomIn = nearbyMap(page).locator(".leaflet-control-zoom-in");
  // The results list also shows OTHER parallel tests' PUBLIC fixtures in the shared
  // fixture region (two tab stops per row: link and Add), so the Tab budget follows the
  // rows actually listed instead of a fixed 120 (M05-T06 Increment 6 correction).
  const tabBudget = (await resultRows(page).count()) * 2 + 60;
  for (
    let i = 0;
    i < tabBudget && !(await zoomIn.evaluate((el) => el === document.activeElement));
    i += 1
  ) {
    await page.keyboard.press("Tab");
  }
  await expect(zoomIn).toBeFocused();

  // Repeated open/close and navigation leave no extra document focusin listeners.
  const open = await focusinListeners();
  for (let i = 0; i < 3; i += 1) {
    await page.keyboard.press("Escape").catch(() => undefined);
    await button.click();
    await panel(page).getByRole("button", { name: "Close nearby landmarks" }).click();
  }
  expect(open).toBe(onTripPage);
  expect(await focusinListeners()).toBe(onTripPage);
  // Leaving the trip page (client-side navigation) removes the page's document focusin
  // listeners; coming back adds exactly the same number again (no accumulation). Since
  // M05-T06 Increment 4 the page owns TWO: the nearby panel's focus tracking (M05-T05)
  // and the Sharing section's (Increment 4) — both cleaned up on unmount.
  await page.evaluate(() => {
    window.history.pushState({}, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  await page.waitForURL((u) => !u.pathname.startsWith("/trips/"));
  await expect(page.getByRole("heading", { level: 3, name: "Stops" })).toHaveCount(0);
  expect(await focusinListeners()).toBe(onTripPage - 2);
  await page.goBack();
  await expect(page.getByRole("heading", { level: 3, name: "Stops" })).toBeVisible();
  expect(await focusinListeners()).toBe(onTripPage);
});

// ---------------------------------------------------------------------------
// Responsive layout and maximum results ([intercepted] synthetic results)
// ---------------------------------------------------------------------------

for (const width of [320, 375, 768, 1280]) {
  test(`[intercepted] responsive ${width}px: panel, long and bidirectional names, Add controls, membership, full-trip notice, both maps, grouped badge, popup`, async ({
    page,
    trips,
  }, testInfo) => {
    const { tripId, s3 } = await ownerWithTrip(page, trips);
    await page.setViewportSize({ width, height: 900 });
    const long = `Extraordinarily Long Landmark Name Without Many Natural Break Opportunities ${"Waterfall".repeat(4)}`;
    const items = [
      synthetic(1, long, 0.5, -160.5, 0.98),
      synthetic(2, `${RLO}Reversed bidirectional name`, 0.5, -160.5, 0.98),
      { ...synthetic(3, trips.stops[0].displayName, 0.45, -160.55, 2.76), id: trips.stops[0].id },
      synthetic(4, "Group A", 0.52, -160.52, 2.19),
      synthetic(5, "Group B", 0.52, -160.52, 2.19),
    ];
    await page.route(
      (u) => isNearbyUrl(u.toString()),
      (route) => route.fulfill({ status: 200, json: body(items) }),
    );
    await openTrip(page, tripId);
    await findNearby(page, 1, s3.displayName).click();
    await expect(resultRows(page)).toHaveCount(5);
    await expect(rowFor(page, trips.stops[0].displayName)).toContainText("In this trip (Stop 2)");
    await expect(nearbyMarkers(page)).toHaveCount(4);
    await expect(nearbyMarkers(page).nth(1)).toHaveText("2");
    await expectNoOverflow(page, `nearby ${width}`);
    await settleMap(page);
    await nearbyMarkers(page).nth(1).click();
    const popup = nearbyMap(page).locator(".leaflet-popup");
    await expect(popup.getByRole("link")).toHaveCount(2);
    await expectPopupInsideMap(page, `group popup at ${width}px`);
    await page.screenshot({ path: testInfo.outputPath(`nearby-${width}.png`), fullPage: true });

    // A full trip (25 stops) [intercepted trip read]: the notice wraps and no Add control shows.
    await page.route(`**/api/v1/trips/${tripId}`, async (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      const real = await route.fetch();
      const json = (await real.json()) as {
        trip: { stops: Record<string, unknown>[]; distance_summary: unknown };
      };
      const first = json.trip.stops[0]!;
      json.trip.stops = Array.from({ length: 25 }, (_, i) =>
        i === 0
          ? { ...first, distance_from_previous_miles: null }
          : {
              ...first,
              id: `44444444-4444-4444-8444-${String(i).padStart(12, "0")}`,
              position: i,
              distance_from_previous_miles: null,
              landmark: {
                ...(first.landmark as object),
                id: `55555555-5555-4555-8555-${String(i).padStart(12, "0")}`,
              },
            },
      );
      json.trip.distance_summary = { total_miles: null, measured_legs: 0, total_legs: 24 };
      await route.fulfill({ response: real, json });
    });
    await page.reload();
    await findNearby(page, 1, s3.displayName).click();
    await expect(panel(page)).toContainText("This trip is full: it has 25 stops");
    await expect(resultsList(page).getByRole("button")).toHaveCount(0);
    await expectNoOverflow(page, `nearby full ${width}`);
    if (width === 320) await scan(page, testInfo, "nearby-full-trip-320");
  });
}

test("[intercepted] maximum results: 200 distinct points plus the origin, 200 at one point, and an origin group — list, popups, timings", async ({
  page,
  trips,
}, testInfo) => {
  const { tripId, s3 } = await ownerWithTrip(page, trips);
  await page.setViewportSize({ width: 1280, height: 1400 });
  let items: NearbyItem[] = [];
  await page.route(
    (u) => isNearbyUrl(u.toString()),
    (route) => route.fulfill({ status: 200, json: body(items) }),
  );
  await openTrip(page, tripId);
  const timings: Record<string, number> = {};
  const timed = async (label: string, action: () => Promise<void>) => {
    const t0 = Date.now();
    await action();
    timings[label] = Date.now() - t0;
  };

  // 200 distinct points.
  items = Array.from({ length: 200 }, (_, i) =>
    synthetic(
      i + 1,
      `Distinct ${i + 1}`,
      0.3 + Math.floor(i / 20) * 0.02,
      -160.7 + (i % 20) * 0.02,
      1 + i / 10,
    ),
  );
  await timed("open → 201 markers rendered", async () => {
    await findNearby(page, 1, s3.displayName).click();
    await expect(nearbyMarkers(page)).toHaveCount(201, { timeout: 15000 });
  });
  await expect(resultRows(page)).toHaveCount(200);
  const box = (await nearbyMap(page).boundingBox())!;
  await timed("drag pan with 201 markers", async () => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 10 });
    await page.mouse.up();
  });
  await timed("zoom in and out with 201 markers", async () => {
    await nearbyMap(page).locator(".leaflet-control-zoom-in").click();
    await nearbyMap(page).locator(".leaflet-control-zoom-out").click();
  });
  // The last result is reachable in the primary list.
  const lastLink = resultsList(page).getByRole("link", { name: "Distinct 200", exact: true });
  await lastLink.focus();
  await expect(lastLink).toBeFocused();

  // 200 results at one point (not the origin's): one round "200" marker; the popup lists all 200.
  items = Array.from({ length: 200 }, (_, i) =>
    synthetic(i + 1, `Stacked ${i + 1}`, 0.6, -160.4, 8.5),
  );
  await radiusSelect(page).selectOption("50");
  await expect(nearbyMarkers(page)).toHaveCount(2);
  const stack = nearbyMarkers(page).nth(1);
  await expect(stack).toHaveText("200");
  await timed("open 200-link popup", async () => {
    await settleMap(page);
    await stack.click();
    await expect(nearbyMap(page).locator(".leaflet-popup").getByRole("link")).toHaveCount(200);
  });
  await expectPopupInsideMap(page, "200-link popup");
  const popupLast = nearbyMap(page)
    .locator(".leaflet-popup")
    .getByRole("link", { name: "View profile: Stacked 200" });
  await popupLast.focus();
  await expect(popupLast).toBeFocused();
  const visible = await popupLast.evaluate((el) => {
    const list = el.closest(".leaflet-popup-content")!.getBoundingClientRect();
    const b = el.getBoundingClientRect();
    return b.top >= list.top - 1 && b.bottom <= list.bottom + 1;
  });
  expect(visible, "the focused last popup link is scrolled into view").toBe(true);
  await popupLast.click({ trial: true }); // reachable by pointer (actionable, not covered)
  await page.keyboard.press("Escape");

  // Origin group: the origin plus 3 results at its exact point.
  items = [0, 1, 2].map((i) => synthetic(300 + i, `At origin ${i}`, 0.49, -160.51, 0));
  await radiusSelect(page).selectOption("10");
  await expect(nearbyMarkers(page)).toHaveCount(1);
  await expect(nearbyMarkers(page).first()).toHaveText("Stop 1 +3");
  await settleMap(page);
  await nearbyMarkers(page).first().click();
  await expect(nearbyMap(page).locator(".leaflet-popup").getByRole("link")).toHaveCount(4);

  console.log(
    `[perf] Chromium bundled with @playwright/test, headless, local Windows machine; wall-clock ms around each Playwright action (includes Playwright overhead): ${JSON.stringify(timings)}`,
  );
  await testInfo.attach("nearby-timings.json", {
    contentType: "application/json",
    body: JSON.stringify(timings, null, 2),
  });
});
