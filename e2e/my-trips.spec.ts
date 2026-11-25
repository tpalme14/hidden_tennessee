import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Locator, Page, Route, TestInfo } from "@playwright/test";
import { ORIGIN, expect, test } from "./helpers/tripFixtures";

/**
 * M05-T06 Increment 6 — My Trips, creation, rename, and delete in a real
 * browser (Chromium) against the real production-mode server on
 * `landmarks_test`, with the guarded synthetic trip fixtures (accounts are
 * recorded; their trips and stops are deleted before any fixture landmark).
 *
 * Each test title says what kind of evidence it is:
 * - [real]: every request reaches the real API (only OpenStreetMap tiles are
 *   stubbed, as in every spec);
 * - [intercepted]: one named request is delayed, aborted after (or instead of)
 *   reaching the server, or answered by `page.route`, to reproduce a failure
 *   deterministically; every other request is real.
 *
 * Accessibility: axe (WCAG 2.0–2.2 A/AA) in the listed states, plus focus and
 * live-region checks. No screen reader is used.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const RLO = String.fromCodePoint(0x202e);
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

async function apiList(request: APIRequestContext, page = 1) {
  const response = await request.get(`/api/v1/trips?page=${page}&limit=20`);
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    trips: {
      id: string;
      name: string;
      updated_at: string;
      is_shared: boolean;
      stop_count: number;
    }[];
    has_more: boolean;
  };
}

async function apiTrip(request: APIRequestContext, tripId: string) {
  return request.get(`/api/v1/trips/${tripId}`);
}

const myTripsHeading = (page: Page) => page.getByRole("heading", { level: 2, name: "My Trips" });
const myTripsStatus = (page: Page) =>
  page.locator("section[aria-labelledby='my-trips-heading'] > p[role='status']");
const tripStatus = (page: Page) =>
  page.locator("section[aria-labelledby='trip-heading'] > p[role='status']");
const tripRows = (page: Page) =>
  page.getByRole("list", { name: "Your trips" }).getByRole("listitem");
const tripHeading = (page: Page) => page.locator("#trip-heading");
const nameInput = (page: Page) => page.getByLabel("New trip name");
const createButton = (page: Page) => page.getByRole("button", { name: "Create trip" });

/** The router's history state for the current entry (`usr` is React Router's user state). */
async function historyUserState(page: Page): Promise<string> {
  return page.evaluate(() =>
    JSON.stringify((window.history.state as { usr?: unknown } | null)?.usr ?? null),
  );
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

/** Counts requests with this method whose path matches. */
function countRequests(page: Page, method: string, path: RegExp) {
  const seen = { count: 0, bodies: [] as unknown[] };
  page.on("request", (request) => {
    if (request.method() === method && path.test(new URL(request.url()).pathname)) {
      seen.count += 1;
      seen.bodies.push(request.postDataJSON());
    }
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
        "main button, main a, main input, main h2, main h3, main li, main [role=alert], main p",
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

test.beforeEach(async ({ page }) => {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
});

// ---------------------------------------------------------------------------
// My Trips: navigation, empty state, list, pagination
// ---------------------------------------------------------------------------

test("[real] navigation: signed-out return path, nav only when signed in, direct navigation, reload, empty account", async ({
  page,
  browser,
  trips,
}, testInfo) => {
  const anonymous = await browser.newContext();
  const anon = await anonymous.newPage();
  await anon.goto("/trips");
  await expect(anon.getByRole("link", { name: "Sign in to see your trips" })).toHaveAttribute(
    "href",
    "/sign-in?returnTo=%2Ftrips",
  );
  await expect(
    anon.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "My Trips" }),
  ).toHaveCount(0);
  await anonymous.close();

  await trips.signUpAndIn(page.request);
  await page.goto("/");
  const navLink = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "My Trips" });
  await expect(navLink).toHaveAttribute("href", "/trips");
  await navLink.click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(myTripsHeading(page)).toBeVisible();
  await expect(page.getByText(/You don.t have any trips yet/)).toBeVisible();
  await expect(navLink).toHaveAttribute("aria-current", "page");
  await scan(page, testInfo, "my-trips-empty");

  await page.reload();
  await expect(page.getByText(/You don.t have any trips yet/)).toBeVisible();
  await page.goto("/trips");
  await expect(nameInput(page)).toBeVisible();
});

test("[real] list: server order, row content, Shared, 21 trips over two pages, Back/Forward, invalid and past-end pages, never another user's trips", async ({
  page,
  playwright,
  trips,
}, testInfo) => {
  test.setTimeout(90_000);
  await trips.signUpAndIn(page.request);
  const ids: string[] = [];
  for (let i = 1; i <= 21; i += 1)
    ids.push(await createTrip(page.request, `MyTrips ${String(i).padStart(2, "0")}`));
  // One stop on trip 21, then share trip 20 (each change moves the trip to the top).
  expect(
    (
      await page.request.post(`/api/v1/trips/${ids[20]}/stops`, {
        headers: { Origin: ORIGIN },
        data: { landmark_id: trips.stops[0].id },
      })
    ).status(),
  ).toBe(201);
  expect(
    (
      await page.request.post(`/api/v1/trips/${ids[19]}/share`, {
        headers: { Origin: ORIGIN },
        data: {},
      })
    ).status(),
  ).toBe(200);

  // Another user's trip must never appear.
  const other = await playwright.request.newContext({ baseURL: ORIGIN });
  await trips.signUpAndIn(other);
  await createTrip(other, "Someone else's trip");

  const server1 = await apiList(page.request, 1);
  const server2 = await apiList(page.request, 2);
  expect(server1.trips).toHaveLength(20);
  expect(server1.has_more).toBe(true);
  expect(server2.trips.map((t) => t.name)).toEqual(["MyTrips 01"]);
  const times = [...server1.trips, ...server2.trips].map((t) => Date.parse(t.updated_at));
  expect(times).toEqual([...times].sort((a, b) => b - a)); // newest first

  await page.goto("/trips");
  await expect(tripRows(page)).toHaveCount(20);
  const names = await tripRows(page).getByRole("link").allTextContents();
  expect(names).toEqual(server1.trips.map((t) => t.name)); // exactly the server's order
  expect(names.slice(0, 2)).toEqual(["MyTrips 20", "MyTrips 21"]);
  await expect(page.getByText("Someone else's trip")).toHaveCount(0);
  const shared = tripRows(page).filter({ hasText: "MyTrips 20" });
  await expect(shared).toContainText("Shared");
  await expect(shared).toContainText("0 stops");
  const withStop = tripRows(page).filter({ hasText: "MyTrips 21" });
  await expect(withStop).toContainText("1 stop");
  await expect(withStop).not.toContainText("Shared");
  await expect(withStop.getByRole("link")).toHaveAttribute("href", `/trips/${ids[20]}`);
  await expect(withStop.locator("time")).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
  await scan(page, testInfo, "my-trips-populated");

  const pager = page.getByRole("navigation", { name: "Trip list pages" });
  await expect(pager.getByRole("link", { name: "Previous page" })).toHaveCount(0);
  await pager.getByRole("link", { name: "Next page" }).click();
  await expect(page).toHaveURL(/\/trips\?page=2$/);
  await expect(tripRows(page)).toHaveCount(1);
  await expect(myTripsHeading(page)).toBeFocused();
  await expect(pager.getByRole("link", { name: "Next page" })).toHaveCount(0);
  await expect(pager.getByRole("link", { name: "Previous page" })).toHaveAttribute(
    "href",
    "/trips",
  );

  await page.goBack();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(tripRows(page)).toHaveCount(20);
  await page.goForward();
  await expect(page).toHaveURL(/\/trips\?page=2$/);
  await expect(tripRows(page)).toHaveCount(1);

  // Invalid pages become page 1 (replace); a page past the end says so.
  const listRequests = countRequests(page, "GET", /^\/api\/v1\/trips$/);
  await page.goto("/trips?page=0");
  await expect(page).toHaveURL(/\/trips$/);
  await expect(tripRows(page)).toHaveCount(20);
  expect(listRequests.count).toBe(1);
  await page.goto("/trips?page=7");
  await expect(page.getByText("There are no trips on this page.")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Go to the first page of your trips" }),
  ).toHaveAttribute("href", "/trips");
  await expect(page.getByText(/You don.t have any trips yet/)).toHaveCount(0);
  await other.dispose();
});

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

test("[real] create: validation, one request, navigation, announcement and focus once, history cleared, persisted", async ({
  page,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  await page.goto("/trips");
  await expect(nameInput(page)).toBeVisible();

  // Client validation: nothing sent, the error is on the field and it has focus.
  const posts = countRequests(page, "POST", /^\/api\/v1\/trips$/);
  await nameInput(page).fill("   ");
  await createButton(page).click();
  const error = page.getByText(
    "name must contain at least one letter, number, punctuation mark, or symbol.",
  );
  await expect(error).toBeVisible();
  await expect(nameInput(page)).toHaveAttribute("aria-invalid", "true");
  await expect(nameInput(page)).toHaveAttribute(
    "aria-describedby",
    (await error.getAttribute("id"))!,
  );
  await expect(nameInput(page)).toBeFocused();
  await scan(page, testInfo, "my-trips-create-validation");
  expect(posts.count).toBe(0);

  // Duplicate activations while the request is held: exactly one POST.
  const held = await gate(page, /\/api\/v1\/trips$/, "POST");
  const name = `Smoky ${RLO}sllaF`;
  await nameInput(page).fill(`  ${name}  `);
  await createButton(page).click();
  await createButton(page).click({ force: true });
  await expect(createButton(page)).toHaveAttribute("aria-disabled", "true");
  await expect(myTripsStatus(page)).toHaveText("Creating trip…");
  expect(held.seen.count).toBe(1);
  held.release();

  await expect(page).toHaveURL(/\/trips\/[0-9a-f-]{36}$/);
  const tripId = new URL(page.url()).pathname.split("/").pop()!;
  await expect(tripHeading(page).locator("bdi")).toHaveText(name);
  await expect(tripStatus(page)).toHaveText(`Created trip ${name}.`);
  await expect(tripHeading(page)).toBeFocused();
  await expect(page.getByText("This trip has no stops yet.")).toBeVisible();
  expect(await historyUserState(page)).toBe("null");
  expect(posts.count).toBe(1);

  // Never again: reload, Back then Forward.
  await page.reload();
  await expect(tripHeading(page).locator("bdi")).toHaveText(name);
  await expect(tripStatus(page)).not.toContainText("Created trip");
  await page.goBack();
  await expect(myTripsHeading(page)).toBeVisible();
  await page.goForward();
  await expect(tripHeading(page).locator("bdi")).toHaveText(name);
  await expect(tripStatus(page)).not.toContainText("Created trip");

  // Persisted (a fresh request).
  const fresh = await apiTrip(page.request, tripId);
  expect(fresh.status()).toBe(200);
  expect(((await fresh.json()) as { trip: { name: string } }).trip.name).toBe(name);
});

test("[intercepted] uncertain create: the server created the trip but the answer was lost — no replay, page 1 re-read, typed name kept, no name matching", async ({
  page,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  await createTrip(page.request, "Earlier trip");
  await page.goto("/trips");
  await expect(tripRows(page)).toHaveCount(1);

  let posts = 0;
  await page.route(/\/api\/v1\/trips$/, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posts += 1;
    await route.fetch(); // the real server creates the trip…
    await route.abort("failed"); // …but the browser never receives the answer
  });
  await nameInput(page).fill("Lost answer trip");
  await createButton(page).click();

  const alert = page.getByRole("alert");
  await expect(alert).toContainText(
    "We couldn't confirm whether your trip was created — it may have been.",
  );
  await expect(alert).not.toContainText("wasn't created");
  // Page 1 was re-read: the real new trip is listed, but the page did not assume it is "the" new one.
  await expect(tripRows(page)).toHaveCount(2);
  await expect(tripRows(page).first()).toContainText("Lost answer trip");
  await expect(page).toHaveURL(/\/trips$/);
  await expect(nameInput(page)).toHaveValue("Lost answer trip");
  await scan(page, testInfo, "my-trips-create-uncertain");
  expect(posts).toBe(1);
  const server = await apiList(page.request);
  expect(server.trips.filter((t) => t.name === "Lost answer trip")).toHaveLength(1);
});

test("[intercepted] uncertain create whose page-1 check also fails: one alert keeps the uncertainty; Try again re-reads", async ({
  page,
  trips,
}) => {
  await trips.signUpAndIn(page.request);
  await page.goto("/trips");
  await expect(page.getByText(/You don.t have any trips yet/)).toBeVisible();

  await page.route(/\/api\/v1\/trips$/, (route) =>
    route.request().method() === "POST" ? route.abort("failed") : route.fallback(),
  );
  let failNextList = true;
  await page.route(/\/api\/v1\/trips\?/, (route) => {
    if (failNextList && route.request().method() === "GET") {
      failNextList = false;
      return route.abort("failed");
    }
    return route.fallback();
  });
  await nameInput(page).fill("Never arrived");
  await createButton(page).click();
  const alert = page.getByRole("alert");
  await expect(alert).toContainText(
    "it may have been — and your trips couldn't be loaded to check.",
  );
  await expect(alert).not.toContainText("wasn't created");
  await expect(page.getByRole("alert")).toHaveCount(1);
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText(/You don.t have any trips yet/)).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("it may have been");
  await expect(nameInput(page)).toHaveValue("Never arrived");
});

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

test("[real] rename: prefill and focus, Cancel sends nothing, validation, save, heading, list order, persistence", async ({
  page,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  const first = await createTrip(page.request, "Rename me");
  await createTrip(page.request, "Newer trip");
  await page.goto(`/trips/${first}`);
  await expect(tripHeading(page)).toHaveText("Rename me");
  const patches = countRequests(page, "PATCH", /^\/api\/v1\/trips\/[^/]+$/);

  await page.getByRole("button", { name: "Rename" }).click();
  const field = page.getByLabel("Trip name");
  await expect(field).toHaveValue("Rename me");
  await expect(field).toBeFocused();
  await scan(page, testInfo, "trip-rename-form");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Rename" })).toBeFocused();
  expect(patches.count).toBe(0);

  await page.getByRole("button", { name: "Rename" }).click();
  await field.fill("Day\t1");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(page.getByText("name contains characters that are not allowed.")).toBeVisible();
  await expect(field).toHaveAttribute("aria-invalid", "true");
  expect(patches.count).toBe(0);

  await field.fill("Renamed on the trip page");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(tripHeading(page)).toHaveText("Renamed on the trip page");
  await expect(tripStatus(page)).toHaveText("Renamed the trip to Renamed on the trip page.");
  await expect(page.getByRole("button", { name: "Rename" })).toBeFocused();
  expect(patches.count).toBe(1);
  expect(patches.bodies[0]).toEqual({ name: "Renamed on the trip page", version: 0 });

  await page.reload();
  await expect(tripHeading(page)).toHaveText("Renamed on the trip page");
  // Back to My Trips: a fresh list with the renamed trip first (most recently updated).
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "My Trips" })
    .click();
  await expect(tripRows(page).first()).toContainText("Renamed on the trip page");
  await expect(tripRows(page).nth(1)).toContainText("Newer trip");
});

test("[real] two tabs: a stale rename gets TRIP_VERSION_CONFLICT, the trip is re-read, the draft kept, nothing replayed, and an explicit save uses the new version", async ({
  page,
  context,
  trips,
}) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Shared draft");
  const tabB = await context.newPage();
  await tabB.route(/tile\.openstreetmap\.org/, (r) =>
    r.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
  await page.goto(`/trips/${tripId}`);
  await tabB.goto(`/trips/${tripId}`);
  await expect(tripHeading(page)).toHaveText("Shared draft");
  await expect(tripHeading(tabB)).toHaveText("Shared draft");

  const responsesB: number[] = [];
  const patchesB = countRequests(tabB, "PATCH", /^\/api\/v1\/trips\/[^/]+$/);
  tabB.on("response", (r) => {
    if (r.request().method() === "PATCH") responsesB.push(r.status());
  });

  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Trip name").fill("Renamed in tab A");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(tripHeading(page)).toHaveText("Renamed in tab A");

  await tabB.getByRole("button", { name: "Rename" }).click();
  await tabB.getByLabel("Trip name").fill("Renamed in tab B");
  await tabB.getByRole("button", { name: "Save name" }).click();
  // The in-form note (associated with the field) and the status announcement.
  await expect(tabB.getByText(/Review its current name above, then save again\./)).toBeVisible();
  await expect(tripStatus(tabB)).toContainText("Its current name is Renamed in tab A.");
  await expect(tripHeading(tabB)).toHaveText("Renamed in tab A");
  await expect(tabB.getByLabel("Trip name")).toHaveValue("Renamed in tab B");
  expect(responsesB).toEqual([409]);
  expect(patchesB.bodies[0]).toEqual({ name: "Renamed in tab B", version: 0 });

  await tabB.getByRole("button", { name: "Save name" }).click();
  await expect(tripHeading(tabB)).toHaveText("Renamed in tab B");
  expect(patchesB.count).toBe(2);
  expect(patchesB.bodies[1]).toEqual({ name: "Renamed in tab B", version: 1 });
  expect(responsesB).toEqual([409, 200]);
  await tabB.close();
});

test("[intercepted] uncertain rename: the server renamed but the answer was lost — the current name is confirmed without claiming cause, no replay", async ({
  page,
  trips,
}) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Before");
  await page.goto(`/trips/${tripId}`);
  let patches = 0;
  await page.route(/\/api\/v1\/trips\/[^/]+$/, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    patches += 1;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Trip name").fill("After");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(tripStatus(page)).toHaveText(
    "Couldn't confirm the rename, but the trip is now named After.",
  );
  await expect(tripHeading(page)).toHaveText("After");
  expect(patches).toBe(1);
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

test("[real] delete: confirmation sends nothing, Cancel sends nothing, one DELETE, My Trips notice once and focused, gone, direct access unavailable", async ({
  page,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  await createTrip(page.request, "Keep me");
  const tripId = await createTrip(page.request, `Doomed ${RLO}trip`);
  await page.goto(`/trips/${tripId}`);
  const deletes = countRequests(page, "DELETE", /^\/api\/v1\/trips\/[^/]+$/);

  await page.getByRole("button", { name: "Delete trip" }).click();
  const confirmText = page.getByText(/permanently\? This can.t be undone/);
  await expect(confirmText).toBeFocused();
  await expect(confirmText.locator("bdi")).toHaveText(`Doomed ${RLO}trip`);
  await scan(page, testInfo, "trip-delete-confirmation");
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Delete trip" })).toBeFocused();
  expect(deletes.count).toBe(0);

  await page.getByRole("button", { name: "Delete trip" }).click();
  await page.getByRole("button", { name: "Delete trip permanently" }).click();
  await expect(page).toHaveURL(/\/trips$/);
  await expect(myTripsHeading(page)).toBeFocused();
  await expect(myTripsStatus(page)).toHaveText(`Deleted trip Doomed ${RLO}trip.`);
  expect(await historyUserState(page)).toBe("null");
  expect(deletes.count).toBe(1);
  await expect(tripRows(page)).toHaveCount(1);
  await expect(tripRows(page).first()).toContainText("Keep me");

  await page.reload();
  await expect(tripRows(page)).toHaveCount(1);
  await expect(myTripsStatus(page)).not.toContainText("Deleted trip");
  await page.goto(`/trips/${tripId}`);
  await expect(page.getByText(/This trip couldn.t be found/)).toBeVisible();
  await page.goBack();
  await expect(myTripsHeading(page)).toBeVisible();
  await expect(myTripsStatus(page)).not.toContainText("Deleted trip");
  expect((await apiTrip(page.request, tripId)).status()).toBe(404);
});

test("[real] delete 404 (deleted elsewhere first): generic 'no longer available', not 'deleted'", async ({
  page,
  trips,
}) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Gone elsewhere");
  await page.goto(`/trips/${tripId}`);
  await page.getByRole("button", { name: "Delete trip" }).click();
  expect(
    (
      await page.request.delete(`/api/v1/trips/${tripId}`, { headers: { Origin: ORIGIN } })
    ).status(),
  ).toBe(204);
  await page.getByRole("button", { name: "Delete trip permanently" }).click();
  await expect(myTripsStatus(page)).toHaveText("That trip is no longer available.");
  await expect(myTripsStatus(page)).not.toContainText("Deleted");
});

test("[intercepted] uncertain delete: the server deleted but the answer was lost — the re-read finds no trip; qualified notice, no replay", async ({
  page,
  trips,
}) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Lost delete answer");
  await page.goto(`/trips/${tripId}`);
  let deletes = 0;
  await page.route(/\/api\/v1\/trips\/[^/]+$/, async (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    deletes += 1;
    await route.fetch();
    await route.abort("failed");
  });
  await page.getByRole("button", { name: "Delete trip" }).click();
  await page.getByRole("button", { name: "Delete trip permanently" }).click();
  await expect(myTripsStatus(page)).toHaveText(
    "We couldn't confirm the result of your delete request. That trip is no longer available.",
  );
  expect(deletes).toBe(1);
});

test("[intercepted] pending feedback (Increment 3 observation): a panel opened during another change shows why it cannot submit, and sends nothing", async ({
  page,
  trips,
}, testInfo) => {
  await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Busy trip");
  await page.goto(`/trips/${tripId}`);
  const held = await gate(page, /\/api\/v1\/trips\/[^/]+$/, "PATCH");
  const deletes = countRequests(page, "DELETE", /^\/api\/v1\/trips\/[^/]+$/);
  await page.getByRole("button", { name: "Rename" }).click();
  await page.getByLabel("Trip name").fill("Busy trip renamed");
  await page.getByRole("button", { name: "Save name" }).click();
  await expect(tripStatus(page)).toHaveText("Renaming trip…");

  // Delete trip is aria-disabled while the rename is pending but still opens its
  // panel (Playwright needs `force` to activate an aria-disabled control; a user can).
  const deleteTrip = page.getByRole("button", { name: "Delete trip" });
  await expect(deleteTrip).toHaveAttribute("aria-disabled", "true");
  await deleteTrip.click({ force: true });
  const confirm = page.getByRole("button", { name: "Delete trip permanently" });
  await expect(confirm).toHaveAttribute("aria-disabled", "true");
  await expect(tripStatus(page)).toHaveText("Renaming trip…");
  await scan(page, testInfo, "trip-change-pending-with-panel");
  await confirm.click({ force: true });
  expect(deletes.count).toBe(0);
  held.release();
  await expect(tripHeading(page)).toHaveText("Busy trip renamed");
  expect(deletes.count).toBe(0);
});

// ---------------------------------------------------------------------------
// Keyboard and responsive
// ---------------------------------------------------------------------------

test("[real] keyboard: nav, create, pagination, rename save/cancel, delete cancel/confirm", async ({
  page,
  trips,
}) => {
  test.setTimeout(90_000);
  await trips.signUpAndIn(page.request);
  for (let i = 1; i <= 21; i += 1)
    await createTrip(page.request, `Key ${String(i).padStart(2, "0")}`);
  await page.goto("/");
  const navLink = page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "My Trips" });
  await tabTo(page, navLink);
  await page.keyboard.press("Enter");
  await expect(myTripsHeading(page)).toBeVisible();

  await tabTo(page, page.getByRole("link", { name: "Next page" }), 120);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/page=2/);
  await expect(myTripsHeading(page)).toBeFocused();

  await tabTo(page, nameInput(page));
  await page.keyboard.type("Typed by keyboard");
  await page.keyboard.press("Enter");
  await expect(tripHeading(page)).toHaveText("Typed by keyboard");
  await expect(tripHeading(page)).toBeFocused();

  const rename = page.getByRole("button", { name: "Rename" });
  await tabTo(page, rename);
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Trip name")).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: "Cancel" }));
  await page.keyboard.press("Enter");
  await expect(rename).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Keyboard name");
  await page.keyboard.press("Enter");
  await expect(tripHeading(page)).toHaveText("Keyboard name");
  await expect(rename).toBeFocused();

  const del = page.getByRole("button", { name: "Delete trip" });
  await tabTo(page, del);
  await page.keyboard.press("Enter");
  await expect(page.getByText(/permanently\? This can.t be undone/)).toBeFocused();
  await tabTo(page, page.getByRole("button", { name: "Cancel" }));
  await page.keyboard.press("Enter");
  await expect(del).toBeFocused();
  await page.keyboard.press("Enter");
  await tabTo(page, page.getByRole("button", { name: "Delete trip permanently" }));
  await page.keyboard.press("Enter");
  await expect(myTripsHeading(page)).toBeFocused();
  await expect(myTripsStatus(page)).toHaveText("Deleted trip Keyboard name.");
});

for (const width of WIDTHS) {
  test(`[real] responsive ${width}px: My Trips with long and bidirectional names, pager, create form, rename form, delete confirmation`, async ({
    page,
    trips,
  }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 900 });
    await trips.signUpAndIn(page.request);
    const longName = `Weekend ${RLO}sllaF ${"averyveryverylongwordwithoutbreaks".repeat(2)}`.slice(
      0,
      100,
    );
    let tripId = "";
    for (let i = 1; i <= 21; i += 1)
      tripId = await createTrip(page.request, i === 21 ? longName : `Wide ${i}`);
    await page.goto("/trips");
    await expect(tripRows(page)).toHaveCount(20);
    await expect(page.getByRole("link", { name: "Next page" })).toBeVisible();
    await expectNoOverflow(page, `my-trips ${width}`);
    await page.goto(`/trips/${tripId}`);
    await page.getByRole("button", { name: "Rename" }).click();
    await expectNoOverflow(page, `rename form ${width}`);
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.getByRole("button", { name: "Delete trip" }).click();
    await expect(page.getByRole("button", { name: "Delete trip permanently" })).toBeVisible();
    await expectNoOverflow(page, `delete confirmation ${width}`);
  });
}
