import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
  type Request,
  type Route,
} from "@playwright/test";
import {
  currentRunTag,
  FIXTURE_REGION_BBOX,
  test as fixtureTest,
  type FixtureLandmark,
} from "../helpers/favoritesFixtures";
import { test as tripTest } from "../helpers/tripFixtures";

/**
 * M06-T02 Increment 3a — connectivity feedback in the real production build
 * (Specification 6 v1.1 OFF-NET-1 to OFF-NET-3, OFF-UX-6, OFF-UX-7, AC-26).
 * "chromium-sw" project.
 *
 * Request interception: tests that use `page.route` run on a page the service
 * worker does NOT control (the first load is never controlled — no
 * clientsClaim), so interception is reliable; every route records its hits
 * and the test asserts the intended request really went through it. The
 * offline-shell test installs and controls the worker and uses the
 * browser's real offline mode instead.
 */

const MISSING_LANDMARK = "/landmarks/00000000-0000-4000-8000-000000000000";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const banner = (page: Page) => page.locator("[data-connectivity-banner]");
const liveText = (page: Page) => banner(page).locator("[aria-live='polite']");
const checkButton = (page: Page) => page.getByRole("button", { name: /check(ing)? connection/i });

const TEXT = {
  hintOffline: "Your device reports that it is offline.",
  offlineUnreachable: "You appear to be offline.",
  onlineUnreachable:
    "The app can't reach the server right now, although your device reports a network connection.",
  unhealthy: "The server responded but isn't working normally.",
  recovered: "Connected to the server.",
};

async function noMapTiles(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 204 }));
}

/** Aborts discovery's API reads as a refused connection, counting what was actually intercepted. */
async function refuseDiscoveryApi(page: Page) {
  const hits: string[] = [];
  const handler = (route: Route) => {
    hits.push(new URL(route.request().url()).pathname);
    return route.abort("connectionrefused");
  };
  await page.route(/\/api\/v1\/(?:landmarks|categories)(?:\?|$)/, handler);
  return hits;
}

async function goDiscover(page: Page) {
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "Discover" })
    .click();
}

test("online: no banner; real HTTP errors (404, 503) are not presented as a lost connection", async ({
  page,
}) => {
  await noMapTiles(page);
  await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");
  await expect(banner(page)).toHaveText("");
  // No extra live region exists while there is nothing to say.
  await expect(banner(page).locator("[aria-live]")).toHaveCount(0);
  await expect(checkButton(page)).toHaveCount(0);

  // A real 404 from the server: the feature's own outcome, no banner.
  await page.goto(MISSING_LANDMARK);
  await expect(page.getByText("Landmark unavailable")).toBeVisible();
  await expect(banner(page)).toHaveText("");

  // A 503 from the server (intercepted on this uncontrolled page): the
  // feature reports its error; the banner does not claim a disconnection.
  const hits: string[] = [];
  await page.route(/\/api\/v1\/landmarks\/[^/?]+$/, (route) => {
    hits.push(route.request().url());
    return route.fulfill({
      status: 503,
      json: { error: { code: "SERVICE_UNAVAILABLE", message: "Service unavailable." } },
    });
  });
  await page.goto(MISSING_LANDMARK);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  expect(hits.length).toBeGreaterThan(0);
  await expect(banner(page)).toHaveText("");
  await expect(checkButton(page)).toHaveCount(0);
});

test("browser offline hint, then a genuine request failure, then back online without a claimed recovery", async ({
  page,
  context,
}) => {
  await noMapTiles(page);
  await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");

  // Hint only: nothing has failed yet.
  await context.setOffline(true);
  await expect(liveText(page)).toContainText(TEXT.hintOffline);
  await expect(checkButton(page)).toBeVisible();

  // A real request failure while offline (discovery's own API reads).
  const failed: string[] = [];
  page.on("requestfailed", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/v1/")) failed.push(r.url());
  });
  await goDiscover(page);
  await expect(liveText(page)).toContainText(TEXT.offlineUnreachable);
  expect(failed.length).toBeGreaterThan(0);
  // The feature keeps its own error and retry.
  await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();

  // Back online: reachability is unknown again — no banner, and no claim of recovery.
  await context.setOffline(false);
  await expect(banner(page)).toHaveText("");
  await expect(checkButton(page)).toHaveCount(0);
  await expect(banner(page)).not.toContainText(/connected|restored/i);
});

test("server unreachable while the browser reports online; one explicit check, with a pending state, recovers", async ({
  page,
}) => {
  await noMapTiles(page);
  await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");
  const refused = await refuseDiscoveryApi(page);
  await goDiscover(page);
  await expect(liveText(page)).toHaveText(TEXT.onlineUnreachable);
  expect(refused.length).toBeGreaterThan(0);
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);

  // Hold the health check so the pending state and duplicate protection are observable.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  const healthHits: string[] = [];
  await page.route(/\/health$/, async (route) => {
    healthHits.push(route.request().url());
    await held;
    await route.continue();
  });

  // Keyboard activation; repeated activation while pending sends nothing more.
  await checkButton(page).focus();
  await page.keyboard.press("Enter");
  await expect(checkButton(page)).toHaveText("Checking connection…");
  await expect(checkButton(page)).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  release();

  await expect(liveText(page)).toHaveText(TEXT.recovered);
  await expect(checkButton(page)).toHaveCount(0);
  expect(healthHits).toHaveLength(1);
});

test("an explicit check that finds an unhealthy server (503) is reported as such, not as recovery", async ({
  page,
}) => {
  await noMapTiles(page);
  await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");
  await refuseDiscoveryApi(page);
  await goDiscover(page);
  await expect(liveText(page)).toHaveText(TEXT.onlineUnreachable);

  const healthHits: string[] = [];
  await page.route(/\/health$/, (route) => {
    healthHits.push(route.request().url());
    return route.fulfill({ status: 503, json: { status: "unavailable" } });
  });
  await checkButton(page).click();
  await expect(liveText(page)).toContainText(TEXT.unhealthy);
  await expect(banner(page)).not.toContainText(TEXT.recovered);
  expect(healthHits).toHaveLength(1);
});

test("offline shell: the worker serves the app, the banner reports the failed session check, and a data page keeps its own error", async ({
  page,
  context,
}) => {
  await page.goto("/sign-in");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  await context.setOffline(true);
  const reloaded = await page.reload();
  expect(reloaded?.fromServiceWorker()).toBe(true);
  await expect(
    page.getByRole("heading", { name: "Tennessee Natural Landmarks Explorer" }),
  ).toBeVisible();
  await expect(liveText(page)).toContainText(TEXT.offlineUnreachable);

  await page.goto(MISSING_LANDMARK);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(liveText(page)).toContainText(TEXT.offlineUnreachable);
  await expect(page.getByText("Landmark unavailable")).toHaveCount(0);
});

test("the banner fits a narrow viewport, keeps the skip link first, and passes the automated accessibility checks", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await noMapTiles(page);
  await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");
  await refuseDiscoveryApi(page);
  await goDiscover(page);
  await expect(liveText(page)).toHaveText(TEXT.onlineUnreachable);
  await expect(checkButton(page)).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  // The skip link is still the first focusable element, and the banner's
  // button comes after the header and before the main content.
  const order = await page.evaluate(() => {
    const focusable = [
      ...document.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea"),
    ].filter((el) => !el.hasAttribute("disabled") && el.tabIndex >= 0);
    const index = (el: Element | null) => (el ? focusable.indexOf(el as HTMLElement) : -1);
    const bannerButton = document.querySelector("[data-connectivity-banner] button");
    const firstInMain = document.querySelector("main")!.querySelector("a[href], button, input");
    const lastInHeader = [...document.querySelectorAll("header a[href], header button")].pop()!;
    return {
      first: focusable[0]?.getAttribute("href") ?? null,
      afterHeader: index(bannerButton) > index(lastInHeader),
      beforeMain: index(bannerButton) < index(firstInMain),
    };
  });
  expect(order).toEqual({ first: "#main-content", afterHeader: true, beforeMain: true });

  const results = await new AxeBuilder({ page })
    .include("[data-connectivity-banner]")
    .withTags(WCAG_TAGS)
    .analyze();
  await testInfo.attach("axe-connectivity-banner", {
    body: JSON.stringify(results.violations, null, 2),
    contentType: "application/json",
  });
  // Automated evidence only; not a claim of full WCAG conformance.
  expect(results.violations).toEqual([]);
});

// ---------------------------------------------------------------------------
// M06-T02 Increment 3b-i — favorites and reviews as online-only actions
// (OFF-UX-5), with real synthetic fixtures (guarded `landmarks_test`; the
// fixture teardown removes their favorites and reviews). Unreachability is
// established by REAL request evidence: a favorite save whose request is
// refused as a connection failure, on a page the service worker does not
// control. Recovery uses the banner's "Check connection" (a real /health).
// ---------------------------------------------------------------------------

const ORIGIN = "http://localhost:3000";
const PASSWORD = "e2e connectivity password";
const REASON = "Unavailable while the server can't be reached.";

async function signUpAndIn(request: APIRequestContext) {
  const email = `e2e-conn-${currentRunTag()}-${randomUUID().slice(0, 8)}@example.com`;
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers: { Origin: ORIGIN },
    data: { name: "", email, password: PASSWORD },
  });
  expect(signUp.status()).toBe(200);
  const signIn = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email, password: PASSWORD },
  });
  expect(signIn.status()).toBe(200);
}

/**
 * A page round trip (one animation frame): any request an earlier user action
 * started has been reported to the test by the time this resolves.
 */
async function settle(page: Page) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
}

/** Counts the page's own mutation requests matching `method` and `path`. */
function countRequests(page: Page, method: string, path: RegExp) {
  const seen: Request[] = [];
  page.on("request", (r) => {
    if (r.method() === method && path.test(new URL(r.url()).pathname)) seen.push(r);
  });
  return seen;
}

async function openProfile(page: Page, landmark: FixtureLandmark) {
  await noMapTiles(page);
  await page.goto(`/landmarks/${landmark.id}`);
  await expect(page.getByRole("heading", { level: 2, name: landmark.displayName })).toBeVisible();
  await expect(page.getByText(/Loading reviews|Checking for your review/)).toHaveCount(0);
}

const favoriteToggle = (page: Page, landmark: FixtureLandmark) =>
  page.getByRole("button", { name: `Favorite ${landmark.displayName}` });

/** One favorite save, refused as a connection failure: real evidence that the server is unreachable. */
async function becomeUnreachableThroughFavorite(page: Page, landmark: FixtureLandmark) {
  const refused: string[] = [];
  const pattern = /\/api\/v1\/favorites\/[^/?]+$/;
  await page.route(pattern, (route) => {
    refused.push(route.request().method());
    return route.abort("connectionrefused");
  });
  await expect(favoriteToggle(page, landmark)).toHaveAttribute("aria-pressed", "false");
  await favoriteToggle(page, landmark).click();
  await expect(liveText(page)).toHaveText(TEXT.onlineUnreachable);
  expect(refused).toEqual(["PUT"]);
  await page.unroute(pattern);
}

async function recoverThroughCheck(page: Page) {
  await checkButton(page).click();
  await expect(liveText(page)).toHaveText(TEXT.recovered);
}

fixtureTest(
  "favorites: unavailable with a reason while unreachable, nothing sent, state kept; saved explicitly after recovery",
  async ({ page, favoriteFixtures: { public: landmark } }) => {
    await signUpAndIn(page.request);
    await openProfile(page, landmark);
    const puts = countRequests(page, "PUT", /^\/api\/v1\/favorites\/[^/]+$/);

    await becomeUnreachableThroughFavorite(page, landmark);
    const toggle = favoriteToggle(page, landmark);
    await expect(toggle).toHaveAttribute("aria-disabled", "true");
    await expect(toggle).toHaveAccessibleDescription(REASON);
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    // `force`: Playwright would otherwise wait for an aria-disabled control to
    // become enabled; a real mouse click is still dispatched.
    await toggle.click({ force: true });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    expect(puts).toHaveLength(1); // only the refused attempt that established unreachability
    await expect(toggle).toHaveAttribute("aria-pressed", "false");

    await recoverThroughCheck(page);
    await expect(toggle).not.toHaveAttribute("aria-disabled");
    expect(puts).toHaveLength(1); // nothing was sent automatically
    const saved = page.waitForResponse(
      (r) => r.request().method() === "PUT" && /\/api\/v1\/favorites\//.test(r.url()),
    );
    await toggle.click();
    expect((await saved).status()).toBe(201);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(puts).toHaveLength(2);
  },
);

fixtureTest(
  "reviews: the draft survives unreachability, submission (including the keyboard) is refused, and only an explicit submit posts it",
  async ({ page, favoriteFixtures: { public: landmark } }) => {
    await signUpAndIn(page.request);
    await openProfile(page, landmark);
    const posts = countRequests(page, "POST", /^\/api\/v1\/reviews$/);
    const form = page.getByRole("form", { name: "Write a review" });
    const text = form.getByRole("textbox", { name: "Review (optional)" });
    const post = form.getByRole("button", { name: "Post review" });

    await form.getByRole("radio", { name: "4 stars" }).check();
    await text.fill("Cool spray at the base.");
    await becomeUnreachableThroughFavorite(page, landmark);

    // Editing still works; the draft is intact.
    await text.press("End");
    await text.pressSequentially(" Slippery rocks.");
    await expect(text).toHaveValue("Cool spray at the base. Slippery rocks.");
    await expect(form.getByRole("radio", { name: "4 stars" })).toBeChecked();

    await expect(post).toHaveAttribute("aria-disabled", "true");
    await expect(post).toHaveAccessibleDescription(REASON);
    // Each kind of attempt is checked on its own, right after it is made.
    await post.click({ force: true });
    await settle(page);
    expect(posts, "mouse click").toHaveLength(0);
    await post.focus();
    await page.keyboard.press("Enter");
    await settle(page);
    expect(posts, "Enter").toHaveLength(0);
    await page.keyboard.press("Space");
    await settle(page);
    expect(posts, "Space").toHaveLength(0);
    await form.evaluate((f: HTMLFormElement) => f.requestSubmit());
    await settle(page);
    expect(posts, "direct form submission").toHaveLength(0);
    await expect(form.getByRole("alert")).toHaveCount(0); // refused, not "invalid"

    await recoverThroughCheck(page);
    await expect(post).not.toHaveAttribute("aria-disabled");
    expect(posts).toHaveLength(0); // no automatic submission
    await expect(text).toHaveValue("Cool spray at the base. Slippery rocks.");
    await expect(form.getByRole("radio", { name: "4 stars" })).toBeChecked();

    const created = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/reviews",
    );
    await post.click();
    expect((await created).status()).toBe(201);
    await expect(page.getByText("Your review was posted.")).toBeAttached();
    expect(posts).toHaveLength(1);
  },
);

fixtureTest(
  "reviews: deletion confirmation opens and cancels by keyboard while unreachable, refuses to confirm, and deletes only when asked after recovery",
  async ({ page, favoriteFixtures: { public: landmark } }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 720 });
    await signUpAndIn(page.request);
    const created = await page.request.post("/api/v1/reviews", {
      headers: { Origin: ORIGIN },
      data: { landmark_id: landmark.id, rating: 5 },
    });
    expect(created.status()).toBe(201);
    await openProfile(page, landmark);
    const deletes = countRequests(page, "DELETE", /^\/api\/v1\/reviews\/[^/]+$/);
    await becomeUnreachableThroughFavorite(page, landmark);

    const del = page.getByRole("button", { name: "Delete your review" });
    await del.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByText("Delete your review? This can't be undone.")).toBeFocused();
    const confirm = page.getByRole("button", { name: "Delete review" });
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await expect(confirm).toHaveAccessibleDescription(REASON);
    await confirm.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await confirm.click({ force: true });
    expect(deletes).toHaveLength(0);

    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
    const results = await new AxeBuilder({ page })
      .include("section[aria-labelledby]")
      .include("[data-connectivity-banner]")
      .withTags(WCAG_TAGS)
      .analyze();
    await testInfo.attach("axe-online-only-review-controls", {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
    expect(results.violations).toEqual([]); // automated evidence only

    await page.getByRole("button", { name: "Cancel" }).press("Enter");
    await expect(del).toBeFocused();
    expect(deletes).toHaveLength(0);

    await recoverThroughCheck(page);
    expect(deletes).toHaveLength(0);
    await del.click();
    const removed = page.waitForResponse(
      (r) => r.request().method() === "DELETE" && /\/api\/v1\/reviews\//.test(r.url()),
    );
    await page.getByRole("button", { name: "Delete review" }).click();
    expect((await removed).ok()).toBe(true);
    expect(deletes).toHaveLength(1);
  },
);

// ---------------------------------------------------------------------------
// M06-T02 Increment 3b-ii — trip mutations as online-only actions (OFF-UX-5).
// Guarded synthetic trip fixtures (e2e/helpers/tripFixtures.ts): accounts are
// recorded and their trips deleted at teardown. Two ways of producing real
// evidence that the server is unreachable:
// - browser ONLINE: one read is refused at the network level by `page.route`
//   on a page the worker does not control (hits asserted), then unrouted;
// - browser OFFLINE (`context.setOffline`): "Check connection" sends a real
//   /health that fails; going back online is the recovery (unreachable →
//   unknown). Used where a read would disturb the state under test.
// Share links are compared only as booleans; nothing here prints one.
// ---------------------------------------------------------------------------

async function createTripApi(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post("/api/v1/trips", {
    headers: { Origin: ORIGIN },
    data: { name },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { trip: { id: string } }).trip.id;
}

async function addStopApi(request: APIRequestContext, tripId: string, landmark: FixtureLandmark) {
  const response = await request.post(`/api/v1/trips/${tripId}/stops`, {
    headers: { Origin: ORIGIN },
    data: { landmark_id: landmark.id },
  });
  expect(response.status()).toBe(201);
}

const stopNames = (page: Page) =>
  page
    .getByRole("list", { name: "Stops" })
    .getByRole("listitem")
    .evaluateAll((items) => items.map((li) => li.querySelector("bdi")?.textContent ?? ""));

const isNearbyRead = (url: URL) =>
  url.pathname === "/api/v1/landmarks" && url.searchParams.has("near");

/** Browser online: a "Find nearby" read refused at the network level. */
async function becomeUnreachableThroughNearby(page: Page, findNearby: string) {
  const refused: string[] = [];
  await page.route(isNearbyRead, (route) => {
    refused.push(route.request().method());
    return route.abort("connectionrefused");
  });
  await page.getByRole("button", { name: findNearby }).click();
  await expect(liveText(page)).toHaveText(TEXT.onlineUnreachable);
  expect(refused).toEqual(["GET"]);
  await page.unroute(isNearbyRead);
}

/** Browser offline: the explicit check fails for real. */
async function becomeUnreachableWhileOffline(page: Page) {
  await page.context().setOffline(true);
  await expect(liveText(page)).toContainText(TEXT.hintOffline);
  await checkButton(page).click();
  await expect(liveText(page)).toContainText(TEXT.offlineUnreachable);
}

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

const tripStatus = (page: Page) =>
  page.locator("section[aria-labelledby='trip-heading'] > p[role='status']");

tripTest(
  "trips: creating a trip from the picker is refused while unreachable (click, Enter, direct submission), the name and selection survive, and only an explicit submit creates it",
  async ({ page, trips }) => {
    await trips.signUpAndIn(page.request);
    await openProfile(page, trips.public);
    const tripPosts = countRequests(page, "POST", /^\/api\/v1\/trips$/);
    const stopPosts = countRequests(page, "POST", /^\/api\/v1\/trips\/[^/]+\/stops$/);

    await page.getByRole("button", { name: `Add to trip: ${trips.public.displayName}` }).click();
    const picker = page.getByRole("region", { name: `Add ${trips.public.displayName} to a trip` });
    await picker.getByRole("radio", { name: "New trip" }).check();
    const nameInput = picker.getByRole("textbox", { name: "New trip name" });
    await nameInput.fill("Connectivity loop");
    await becomeUnreachableThroughFavorite(page, trips.public);

    const create = picker.getByRole("button", {
      name: `Create trip and add ${trips.public.displayName}`,
    });
    await expect(create).toHaveAttribute("aria-disabled", "true");
    await expect(create).toHaveAccessibleDescription(REASON);
    // `force`: an intentional press of the aria-disabled button (see above).
    await create.click({ force: true });
    await settle(page);
    expect(tripPosts, "mouse click").toHaveLength(0);
    await nameInput.press("Enter");
    await settle(page);
    expect(tripPosts, "Enter in the field").toHaveLength(0);
    await nameInput.evaluate((input: HTMLInputElement) => input.form!.requestSubmit());
    await settle(page);
    expect(tripPosts, "direct form submission").toHaveLength(0);
    await expect(nameInput).toHaveValue("Connectivity loop");
    await expect(picker.getByRole("radio", { name: "New trip" })).toBeChecked();

    await recoverThroughCheck(page);
    await expect(create).not.toHaveAttribute("aria-disabled");
    await settle(page);
    expect(tripPosts).toHaveLength(0); // nothing was sent automatically
    expect(stopPosts).toHaveLength(0);
    await expect(nameInput).toHaveValue("Connectivity loop");

    const created = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/trips",
    );
    await create.click();
    expect((await created).status()).toBe(201);
    await expect(page.getByRole("status").filter({ hasText: "Connectivity loop" })).toBeAttached();
    expect(tripPosts).toHaveLength(1);
    expect(stopPosts).toHaveLength(1);
  },
);

tripTest(
  "trips: renaming is refused while unreachable, the typed name survives, recovery saves nothing, and an explicit save renames",
  async ({ page, trips }) => {
    await trips.signUpAndIn(page.request);
    const tripId = await createTripApi(page.request, "Before connectivity");
    await addStopApi(page.request, tripId, trips.stops[0]);
    await noMapTiles(page);
    await page.goto(`/trips/${tripId}`);
    await expect(page.locator("#trip-heading")).toHaveText("Before connectivity");
    const patches = countRequests(page, "PATCH", new RegExp(`^/api/v1/trips/${tripId}$`));

    await page.getByRole("button", { name: "Rename", exact: true }).click();
    const input = page.getByRole("textbox", { name: "Trip name" });
    await input.fill("After connectivity");
    await becomeUnreachableThroughNearby(
      page,
      `Find nearby: Stop 1, ${trips.stops[0].displayName}`,
    );

    const save = page.getByRole("button", { name: "Save name" });
    await expect(save).toHaveAttribute("aria-disabled", "true");
    await expect(save).toHaveAccessibleDescription(REASON);
    await save.click({ force: true }); // intentional press of an aria-disabled control
    await settle(page);
    expect(patches, "mouse click").toHaveLength(0);
    await input.press("Enter");
    await settle(page);
    expect(patches, "Enter in the field").toHaveLength(0);
    await input.evaluate((el: HTMLInputElement) => el.form!.requestSubmit());
    await settle(page);
    expect(patches, "direct form submission").toHaveLength(0);
    await expect(input).toHaveValue("After connectivity");
    await expect(page.locator("#trip-heading")).toHaveText("Before connectivity");

    await recoverThroughCheck(page);
    await expect(save).not.toHaveAttribute("aria-disabled");
    await settle(page);
    expect(patches).toHaveLength(0);
    await expect(input).toHaveValue("After connectivity");

    const renamed = page.waitForResponse(
      (r) =>
        r.request().method() === "PATCH" && new URL(r.url()).pathname === `/api/v1/trips/${tripId}`,
    );
    await save.click();
    expect((await renamed).ok()).toBe(true);
    await expect(page.locator("#trip-heading")).toHaveText("After connectivity");
    expect(patches).toHaveLength(1);
  },
);

tripTest(
  "trips: at 320 px, reorder, remove, nearby Add, and the delete confirmation are refused while unreachable; nothing changes; one explicit move after recovery",
  async ({ page, trips }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await trips.signUpAndIn(page.request);
    const [s1, s2, s3, s4] = trips.stops;
    const tripId = await createTripApi(page.request, "Stops under test");
    for (const s of [s1, s2, s3]) await addStopApi(page.request, tripId, s);
    await noMapTiles(page);
    await page.goto(`/trips/${tripId}`);
    await expect(page.getByRole("list", { name: "Stops" }).getByRole("listitem")).toHaveCount(3);
    const order = [s1.displayName, s2.displayName, s3.displayName];
    expect(await stopNames(page)).toEqual(order);

    // A successful nearby search first, so "Add to this trip" is offered for stop 4.
    await page.getByRole("button", { name: `Find nearby: Stop 1, ${s1.displayName}` }).click();
    const nearbyAdd = page.getByRole("button", { name: `Add to this trip: ${s4.displayName}` });
    await expect(nearbyAdd).toBeVisible();

    const reorders = countRequests(
      page,
      "PUT",
      new RegExp(`^/api/v1/trips/${tripId}/stops/order$`),
    );
    const removals = countRequests(page, "DELETE", new RegExp(`^/api/v1/trips/${tripId}/stops/`));
    const additions = countRequests(page, "POST", new RegExp(`^/api/v1/trips/${tripId}/stops$`));
    const deletions = countRequests(page, "DELETE", new RegExp(`^/api/v1/trips/${tripId}$`));
    const mutations = () => reorders.length + removals.length + additions.length + deletions.length;

    await becomeUnreachableWhileOffline(page);

    const moveDown = page.getByRole("button", { name: `Move down: ${s1.displayName}` });
    const moveUp = page.getByRole("button", { name: `Move up: ${s2.displayName}` });
    const remove = page.getByRole("button", { name: `Remove ${s2.displayName} from the trip` });
    for (const [label, control] of [
      ["Move down", moveDown],
      ["Move up", moveUp],
      ["Remove", remove],
      ["nearby Add", nearbyAdd],
    ] as const) {
      await expect(control, label).toHaveAttribute("aria-disabled", "true");
      await expect(control, label).toHaveAccessibleDescription(REASON);
      await control.click({ force: true }); // intentional press of an aria-disabled control
      await settle(page);
      expect(mutations(), `${label}: mouse`).toBe(0);
      await control.focus();
      await page.keyboard.press("Enter");
      await settle(page);
      expect(mutations(), `${label}: Enter`).toBe(0);
      await expect(control).toBeFocused();
    }
    // The existing boundary rules are unchanged.
    await expect(page.getByRole("button", { name: `Move up: ${s1.displayName}` })).toBeDisabled();
    await expect(page.getByRole("button", { name: `Move down: ${s3.displayName}` })).toBeDisabled();
    expect(await stopNames(page)).toEqual(order);
    await expect(nearbyAdd).toBeVisible();

    // The delete confirmation opens and cancels by keyboard; confirming is refused.
    const deleteTrip = page.getByRole("button", { name: "Delete trip", exact: true });
    await deleteTrip.focus();
    await page.keyboard.press("Enter");
    const confirm = page.getByRole("button", { name: "Delete trip permanently" });
    await expect(confirm).toHaveAttribute("aria-disabled", "true");
    await expect(confirm).toHaveAccessibleDescription(REASON);
    await confirm.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await confirm.click({ force: true }); // intentional press of an aria-disabled control
    await settle(page);
    expect(mutations(), "delete confirmation").toBe(0);

    await noHorizontalOverflow(page);
    const results = await new AxeBuilder({ page })
      .include("section[aria-labelledby='trip-heading']")
      .include("[data-connectivity-banner]")
      .exclude(".leaflet-container")
      .withTags(WCAG_TAGS)
      .analyze();
    await testInfo.attach("axe-online-only-trip-controls", {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
    expect(results.violations).toEqual([]); // automated evidence only

    await page.getByRole("button", { name: "Cancel" }).press("Enter");
    await expect(page.getByRole("button", { name: "Delete trip permanently" })).toHaveCount(0);

    // Recovery: back online (unreachable → unknown). Nothing is sent by itself.
    await page.context().setOffline(false);
    await expect(moveDown).not.toHaveAttribute("aria-disabled");
    await expect(nearbyAdd).not.toHaveAttribute("aria-disabled");
    await settle(page);
    expect(mutations()).toBe(0);
    expect(await stopNames(page)).toEqual(order);

    const moved = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" && r.url().endsWith(`/api/v1/trips/${tripId}/stops/order`),
    );
    await moveDown.click();
    expect((await moved).ok()).toBe(true);
    await expect
      .poll(() => stopNames(page))
      .toEqual([s2.displayName, s1.displayName, s3.displayName]);
    expect(reorders).toHaveLength(1);
    expect(removals.length + additions.length + deletions.length).toBe(0);
  },
);

tripTest(
  "trips: at 320 px, replacing and turning off a share link are refused while unreachable; the held link stays and can be copied; one explicit change after recovery",
  async ({ page, context, trips }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: ORIGIN });
    await trips.signUpAndIn(page.request);
    const tripId = await createTripApi(page.request, "Shared under test");
    await addStopApi(page.request, tripId, trips.stops[0]);
    await noMapTiles(page);
    await page.goto(`/trips/${tripId}`);
    const sharing = page.getByRole("region", { name: "Sharing", exact: true });
    const field = sharing.getByLabel("Share link");

    await sharing.getByRole("button", { name: "Create share link" }).click();
    await expect(field).toBeVisible();
    const held = await field.inputValue(); // compared only as booleans below

    const shares = countRequests(page, "POST", new RegExp(`^/api/v1/trips/${tripId}/share$`));
    const unshares = countRequests(page, "DELETE", new RegExp(`^/api/v1/trips/${tripId}/share$`));
    await becomeUnreachableThroughNearby(
      page,
      `Find nearby: Stop 1, ${trips.stops[0].displayName}`,
    );

    for (const name of ["Create new link", "Turn off sharing"]) {
      const control = sharing.getByRole("button", { name });
      await expect(control, name).toHaveAttribute("aria-disabled", "true");
      await expect(control, name).toHaveAccessibleDescription(REASON);
      await control.click({ force: true }); // intentional press of an aria-disabled control
      await control.focus();
      await page.keyboard.press("Enter");
      await page.keyboard.press("Space");
      await settle(page);
      expect(shares.length + unshares.length, name).toBe(0);
    }
    expect((await field.inputValue()) === held, "the held link is unchanged").toBe(true);

    // Copying the held link is local and stays available.
    const copy = sharing.getByRole("button", { name: "Copy link" });
    await expect(copy).not.toHaveAttribute("aria-disabled");
    await copy.click();
    await expect(tripStatus(page)).toHaveText("Share link copied.");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied === held, "clipboard holds the held link").toBe(true);
    await noHorizontalOverflow(page);

    await recoverThroughCheck(page);
    await settle(page);
    expect(shares.length + unshares.length).toBe(0); // nothing was sent automatically
    expect((await field.inputValue()) === held, "the held link survives recovery").toBe(true);

    const revoked = page.waitForResponse(
      (r) => r.request().method() === "DELETE" && r.url().endsWith(`/api/v1/trips/${tripId}/share`),
    );
    await sharing.getByRole("button", { name: "Turn off sharing" }).click();
    expect((await revoked).ok()).toBe(true);
    await expect(sharing.getByRole("button", { name: "Create share link" })).toBeVisible();
    expect(unshares).toHaveLength(1);
    expect(shares).toHaveLength(0);
  },
);

// M06-T02 Increment 3b-ii-a — the shared announcer's list-variant "Try adding again".
tripTest(
  "trips: at 320 px, the results list's 'Try adding again' after a partial create-then-add is unavailable with a reason while unreachable, retries nothing, and verifies then adds once after recovery",
  async ({ page, trips }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await trips.signUpAndIn(page.request);
    const target = trips.stops[1];
    await noMapTiles(page);
    await page.goto(`/?bbox=${FIXTURE_REGION_BBOX}&lat=0.5&lng=-160.5&zoom=11`);
    const results = page.locator("section[aria-labelledby='geo-results-heading']");
    const row = results.getByRole("listitem").filter({ hasText: target.displayName });
    await expect(row).toBeVisible();

    const creates = countRequests(page, "POST", /^\/api\/v1\/trips$/);
    const adds = countRequests(page, "POST", /^\/api\/v1\/trips\/[^/]+\/stops$/);
    const verifies = countRequests(page, "GET", /^\/api\/v1\/trips\/[0-9a-f-]{36}$/);

    // The supported way to reach "Try adding again": New trip → the trip is
    // created (real), then the add's connection drops BEFORE it reaches the
    // server (interception hit asserted), so the trip exists with no stop.
    const dropped: string[] = [];
    const addPattern = /\/api\/v1\/trips\/[^/]+\/stops$/;
    await page.route(addPattern, (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      dropped.push(route.request().method());
      return route.abort("connectionreset");
    });
    await row.getByRole("button", { name: `Add to trip: ${target.displayName}` }).click();
    const picker = row.getByRole("region", { name: `Add ${target.displayName} to a trip` });
    await picker.getByRole("radio", { name: "New trip" }).check();
    await picker.getByRole("textbox", { name: "New trip name" }).fill("Retry target");
    const created = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/trips",
    );
    await picker.getByRole("button", { name: `Create trip and add ${target.displayName}` }).click();
    const tripId = ((await (await created).json()) as { trip: { id: string } }).trip.id;
    const alert = page.getByRole("alert").filter({ hasText: "was created" });
    const message = `The trip Retry target was created, but ${target.displayName} couldn't be added to it.`;
    await expect(alert).toContainText(message);
    expect(dropped).toEqual(["POST"]);
    await page.unroute(addPattern);
    // The announcer is outside the results list.
    expect(await results.locator("[role=alert]").count()).toBe(0);
    const before = () => creates.length + adds.length + verifies.length;
    expect(creates).toHaveLength(1);
    expect(adds).toHaveLength(1); // the dropped add
    expect(verifies).toHaveLength(0);

    // Genuine unreachability, independent of the add.
    await becomeUnreachableThroughFavorite(page, target);
    const retry = alert.getByRole("button", { name: "Try adding again" });
    await expect(retry).toHaveAttribute("aria-disabled", "true");
    await expect(retry).toHaveAccessibleName("Try adding again");
    await expect(retry).toHaveAccessibleDescription(REASON);
    const reasonId = await retry.getAttribute("aria-describedby");
    await expect(page.locator(`[id="${reasonId}"]`)).toBeVisible();
    await expect(alert.getByText(REASON)).toHaveCount(0); // the reason is outside the alert

    await retry.click({ force: true }); // intentional press of an aria-disabled control
    await settle(page);
    expect(before(), "mouse").toBe(2); // nothing new: one create + the dropped add
    await retry.focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Space");
    await settle(page);
    expect(before(), "keyboard").toBe(2);
    await expect(retry).toBeFocused();
    await expect(alert).toContainText(message); // the uncertain-outcome state is intact

    await noHorizontalOverflow(page);
    const scan = await new AxeBuilder({ page })
      .include("[role=alert]")
      .include("[data-connectivity-banner]")
      .withTags(WCAG_TAGS)
      .analyze();
    await testInfo.attach("axe-online-only-announcer-retry", {
      body: JSON.stringify(scan.violations, null, 2),
      contentType: "application/json",
    });
    expect(scan.violations).toEqual([]); // automated evidence only

    await recoverThroughCheck(page);
    await expect(retry).not.toHaveAttribute("aria-disabled");
    await settle(page);
    expect(before()).toBe(2); // nothing retried automatically
    await expect(alert).toContainText(message);

    // The existing contract: read the trip first, find the landmark absent, then add once —
    // to THAT trip, never creating another.
    await retry.click();
    await expect(page.locator("[aria-live='polite']").filter({ hasText: "Added" })).toContainText(
      `Added ${target.displayName} to Retry target`,
    );
    expect(verifies.map((r) => new URL(r.url()).pathname)).toEqual([`/api/v1/trips/${tripId}`]);
    expect(adds).toHaveLength(2); // the dropped add + the verified retry
    expect(creates).toHaveLength(1);
    const server = await page.request.get(`/api/v1/trips/${tripId}`);
    const stops = ((await server.json()) as { trip: { stops: { landmark: { id: string } }[] } })
      .trip.stops;
    expect(stops.map((s) => s.landmark.id)).toEqual([target.id]); // no duplicate
  },
);

// ---------------------------------------------------------------------------
// M06-T02 Increment 3b-ii-a (D2) — computed cursor: `not-allowed` for a
// connectivity refusal, `progress` only while an operation is genuinely
// pending (`data-pending`), the ordinary `pointer` otherwise. Pending
// operations are held by a gate (a deferred route) and released explicitly.
// ---------------------------------------------------------------------------

const cursorOf = (locator: ReturnType<Page["getByRole"]>) =>
  locator.evaluate((el) => getComputedStyle(el).cursor);

/** Holds `method` requests matching `pattern` until `release()`; counts them. */
async function holdRequests(page: Page, pattern: RegExp | ((url: URL) => boolean), method: string) {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held: string[] = [];
  await page.route(pattern, async (route) => {
    if (route.request().method() !== method) return route.fallback();
    held.push(method);
    await opened;
    await route.fallback();
  });
  return { release, held };
}

tripTest(
  "trips (D2): stop controls and trip-management buttons show not-allowed when only unreachable, progress while a move is pending — also while unreachable and after recovery — and pointer once it finishes",
  async ({ page, trips }) => {
    await page.setViewportSize({ width: 320, height: 900 });
    await trips.signUpAndIn(page.request);
    const [s1, s2] = trips.stops;
    const tripId = await createTripApi(page.request, "Cursor under test");
    await addStopApi(page.request, tripId, s1);
    await addStopApi(page.request, tripId, s2);
    await noMapTiles(page);
    await page.goto(`/trips/${tripId}`);
    const moveDown = page.getByRole("button", { name: `Move down: ${s1.displayName}` });
    const firstUp = page.getByRole("button", { name: `Move up: ${s1.displayName}` });
    const share = page
      .getByRole("region", { name: "Sharing", exact: true })
      .getByRole("button", { name: "Create share link" });
    const deleteTrip = page.getByRole("button", { name: "Delete trip", exact: true });
    const findNearby = `Find nearby: Stop 1, ${s1.displayName}`;
    const reorders = countRequests(
      page,
      "PUT",
      new RegExp(`^/api/v1/trips/${tripId}/stops/order$`),
    );

    // 1. Available.
    expect(await cursorOf(moveDown), "available: TripStops").toBe("pointer");
    expect(await cursorOf(share), "available: TripManage").toBe("pointer");
    expect(await cursorOf(deleteTrip), "available: page toolbar").toBe("pointer");
    expect(await cursorOf(firstUp), "native disabled boundary").toBe("not-allowed");

    // 2. Unreachable, nothing pending.
    await becomeUnreachableThroughNearby(page, findNearby);
    await expect(moveDown).toHaveAttribute("aria-disabled", "true");
    await expect(moveDown).not.toHaveAttribute("data-pending");
    expect(await cursorOf(moveDown), "unreachable: TripStops").toBe("not-allowed");
    expect(await cursorOf(share), "unreachable: TripManage").toBe("not-allowed");
    expect(await cursorOf(deleteTrip), "toolbar is not online-only").toBe("pointer");
    await recoverThroughCheck(page);
    expect(await cursorOf(moveDown), "recovered").toBe("pointer");

    // 3. A genuinely pending move (held).
    const gate = await holdRequests(
      page,
      new RegExp(`/api/v1/trips/${tripId}/stops/order$`),
      "PUT",
    );
    await moveDown.click();
    await expect.poll(() => gate.held.length).toBe(1);
    await expect(moveDown).toHaveAttribute("data-pending", "true");
    expect(await cursorOf(moveDown), "pending: TripStops").toBe("progress");
    expect(await cursorOf(share), "pending: TripManage (shared lock)").toBe("progress");
    expect(await cursorOf(deleteTrip), "pending: page toolbar").toBe("progress");
    expect(await cursorOf(firstUp), "pending: native-disabled boundary keeps progress").toBe(
      "progress",
    );

    // 4. Pending while unreachable.
    await becomeUnreachableThroughNearby(page, findNearby);
    expect(await cursorOf(moveDown), "pending + unreachable: TripStops").toBe("progress");
    expect(await cursorOf(share), "pending + unreachable: TripManage").toBe("progress");

    // 5. Recovered while still pending.
    await recoverThroughCheck(page);
    expect(await cursorOf(moveDown), "pending after recovery: TripStops").toBe("progress");
    expect(await cursorOf(share), "pending after recovery: TripManage").toBe("progress");
    expect(reorders).toHaveLength(1); // the lock held; nothing else was sent

    // 6. Finished, connectivity restored.
    const moved = page.waitForResponse(
      (r) =>
        r.request().method() === "PUT" && r.url().endsWith(`/api/v1/trips/${tripId}/stops/order`),
    );
    gate.release();
    expect((await moved).ok()).toBe(true);
    const movedDown = page.getByRole("button", { name: `Move down: ${s2.displayName}` });
    await expect(movedDown).not.toHaveAttribute("data-pending");
    await expect(movedDown).not.toHaveAttribute("aria-disabled");
    expect(await cursorOf(movedDown), "finished: TripStops").toBe("pointer");
    expect(await cursorOf(share), "finished: TripManage").toBe("pointer");
    expect(reorders).toHaveLength(1);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  },
);

tripTest(
  "trips (D2): the picker's add shows not-allowed when only unreachable and progress only while its request is pending",
  async ({ page, trips }) => {
    await trips.signUpAndIn(page.request);
    await createTripApi(page.request, "Cursor picker");

    // AddToTrip.module.css — the picker's "Add to the selected trip".
    await openProfile(page, trips.public);
    await page.getByRole("button", { name: `Add to trip: ${trips.public.displayName}` }).click();
    const picker = page.getByRole("region", { name: `Add ${trips.public.displayName} to a trip` });
    await picker.getByRole("radio", { name: /Cursor picker/ }).check();
    const add = picker.getByRole("button", {
      name: `Add to the selected trip: ${trips.public.displayName}`,
    });
    expect(await cursorOf(add), "available: AddToTrip").toBe("pointer");
    await becomeUnreachableThroughFavorite(page, trips.public);
    expect(await cursorOf(add), "unreachable: AddToTrip").toBe("not-allowed");
    await recoverThroughCheck(page);
    expect(await cursorOf(add), "recovered: AddToTrip").toBe("pointer");
    const addGate = await holdRequests(page, /\/api\/v1\/trips\/[^/]+\/stops$/, "POST");
    await add.click();
    await expect.poll(() => addGate.held.length).toBe(1);
    await expect(add).toHaveAttribute("data-pending", "true");
    expect(await cursorOf(add), "pending: AddToTrip").toBe("progress");
    const added = page.waitForResponse(
      (r) => r.request().method() === "POST" && /\/api\/v1\/trips\/[^/]+\/stops$/.test(r.url()),
    );
    addGate.release();
    expect((await added).status()).toBe(201);
    await expect(add).not.toHaveAttribute("data-pending");
    expect(await cursorOf(add), "finished: AddToTrip").toBe("pointer");
    await page.unrouteAll({ behavior: "ignoreErrors" });
  },
);

tripTest(
  "trips (D2): My Trips' Create trip shows not-allowed when only unreachable and progress only while the creation is pending",
  async ({ page, trips }) => {
    await trips.signUpAndIn(page.request);
    // CreateTripForm.module.css — the FIRST load of this test, so the worker does
    // not control the page and interception is reliable (hits asserted).
    // Both of the page's initial reads (its trip list and the favorites the shell
    // loads) are refused, so no later successful response marks the server reachable.
    const listReads: string[] = [];
    const isListRead = (url: URL) => url.pathname === "/api/v1/trips";
    const isInitialRead = (url: URL) =>
      url.pathname === "/api/v1/trips" || url.pathname === "/api/v1/favorites";
    await page.route(isInitialRead, (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      listReads.push(new URL(route.request().url()).pathname);
      return route.abort("connectionrefused");
    });
    await page.goto("/trips");
    await expect(liveText(page)).toHaveText(TEXT.onlineUnreachable);
    expect([...new Set(listReads)].sort()).toEqual(["/api/v1/favorites", "/api/v1/trips"]);
    await page.unroute(isInitialRead);
    const createTrip = page.getByRole("button", { name: "Create trip" });
    await expect(createTrip).toHaveAttribute("aria-disabled", "true");
    await expect(createTrip).not.toHaveAttribute("data-pending");
    expect(await cursorOf(createTrip), "unreachable: CreateTripForm").toBe("not-allowed");
    await recoverThroughCheck(page);
    expect(await cursorOf(createTrip), "recovered: CreateTripForm").toBe("pointer");
    await page.getByRole("textbox", { name: "New trip name" }).fill("Cursor created");
    const creates = countRequests(page, "POST", /^\/api\/v1\/trips$/);
    const createGate = await holdRequests(page, isListRead, "POST");
    await createTrip.click();
    await expect.poll(() => createGate.held.length).toBe(1);
    await expect(createTrip).toHaveAttribute("data-pending", "true");
    expect(await cursorOf(createTrip), "pending: CreateTripForm").toBe("progress");
    const created = page.waitForResponse(
      (r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/api/v1/trips",
    );
    createGate.release();
    expect((await created).status()).toBe(201);
    expect(creates).toHaveLength(1);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  },
);

// ---------------------------------------------------------------------------
// M06-T02 Increment 3b-iii — authentication submissions as online-only actions
// (OFF-UX-5). An authentication page makes no API request before submitting
// except the shell's session check, so real evidence of unreachability comes
// from refusing that check at the network level on the FIRST load (not
// worker-controlled; hits asserted). Synthetic data only; accounts use this
// spec's e2e-conn-<run>-… addresses and are kept, as elsewhere. Passwords and
// tokens are never printed.
// ---------------------------------------------------------------------------

const AUTH_PASSWORD = "e2e connectivity auth password";
const isSessionCheck = (url: URL) => url.pathname === "/api/auth/get-session";

/** Loads `path` with the session check refused; returns the refused hits. */
async function loadUnreachable(page: Page, path: string) {
  const refused: string[] = [];
  await page.route(isSessionCheck, (route) => {
    refused.push(route.request().method());
    return route.abort("connectionrefused");
  });
  await page.goto(path);
  await expect(liveText(page)).toHaveText(TEXT.onlineUnreachable);
  expect(refused.length).toBeGreaterThanOrEqual(1);
  await page.unroute(isSessionCheck);
  return refused;
}

/** Every refused activation path, each checked on its own right after it is made. */
async function attemptAll(
  page: Page,
  submit: ReturnType<Page["getByRole"]>,
  field: ReturnType<Page["getByLabel"]>,
  sent: Request[],
) {
  await submit.click({ force: true }); // intentional press of an aria-disabled control
  await settle(page);
  expect(sent, "mouse click").toHaveLength(0);
  await field.press("Enter");
  await settle(page);
  expect(sent, "Enter in a field").toHaveLength(0);
  await submit.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  await settle(page);
  expect(sent, "Enter and Space on the button").toHaveLength(0);
  await submit.evaluate((button: HTMLButtonElement) => button.form!.requestSubmit());
  await settle(page);
  expect(sent, "direct form submission").toHaveLength(0);
  await expect(submit).toBeFocused();
}

test("auth: sign-in sends no credentials while unreachable, keeps the values, sends nothing on recovery, and signs in when asked", async ({
  page,
  request,
}) => {
  // The account is created through a separate request context, so this page stays signed out.
  const email = `e2e-conn-${currentRunTag()}-${randomUUID().slice(0, 8)}@example.com`;
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers: { Origin: ORIGIN },
    data: { name: "", email, password: AUTH_PASSWORD },
  });
  expect(signUp.status()).toBe(200);

  await loadUnreachable(page, "/sign-in");
  const signIns = countRequests(page, "POST", /^\/api\/auth\/sign-in\/email$/);
  const region = page.getByRole("region", { name: "Sign in" });
  const emailField = region.getByLabel("Email address");
  const passwordField = region.getByLabel("Password");
  await emailField.fill(email);
  await passwordField.fill(AUTH_PASSWORD);

  const submit = region.getByRole("button", { name: "Sign in" });
  await expect(submit).toHaveAttribute("aria-disabled", "true");
  await expect(submit).toHaveAccessibleDescription(REASON);
  await expect(submit).not.toHaveAttribute("data-pending");
  await attemptAll(page, submit, passwordField, signIns);
  await expect(emailField).toHaveValue(email);
  expect((await passwordField.inputValue()) === AUTH_PASSWORD, "password kept").toBe(true);
  await expect(region.getByRole("alert")).toHaveCount(0);

  await recoverThroughCheck(page);
  await expect(submit).not.toHaveAttribute("aria-disabled", "true");
  await settle(page);
  expect(signIns).toHaveLength(0); // nothing submitted automatically

  const signedIn = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/auth/sign-in/email"),
  );
  await submit.click();
  expect((await signedIn).status()).toBe(200);
  await expect.poll(() => new URL(page.url()).pathname).toBe("/");
  expect(signIns).toHaveLength(1);
});

test("auth: registration sends nothing while unreachable, keeps the values, registers nothing on recovery, and registers when asked", async ({
  page,
}) => {
  await loadUnreachable(page, "/register");
  const signUps = countRequests(page, "POST", /^\/api\/auth\/sign-up\/email$/);
  const region = page.getByRole("region", { name: "Create an account" });
  const email = `e2e-conn-${currentRunTag()}-${randomUUID().slice(0, 8)}@example.com`;
  await region.getByLabel("Email address").fill(email);
  await region.getByLabel("Password", { exact: true }).fill(AUTH_PASSWORD);
  const confirm = region.getByLabel("Confirm password");
  await confirm.fill(AUTH_PASSWORD);

  const submit = region.getByRole("button", { name: "Create account" });
  await expect(submit).toHaveAttribute("aria-disabled", "true");
  await expect(submit).toHaveAccessibleDescription(REASON);
  await attemptAll(page, submit, confirm, signUps);
  await expect(region.getByLabel("Email address")).toHaveValue(email);

  await recoverThroughCheck(page);
  await settle(page);
  expect(signUps).toHaveLength(0);

  const registered = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/auth/sign-up/email"),
  );
  await submit.click();
  expect((await registered).status()).toBe(200);
  await expect(page.getByRole("region", { name: "Sign in" }).getByRole("status")).toHaveText(
    "Registration received. Sign in with your email address and password.",
  );
  expect(signUps).toHaveLength(1);
});

test("auth: at 320 px, the reset-link request is refused while unreachable; cursor not-allowed / progress while pending — also while unreachable and after recovery; the real RESET_UNAVAILABLE outcome after an explicit request", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await loadUnreachable(page, "/forgot-password");
  const requests = countRequests(page, "POST", /^\/api\/auth\/request-password-reset$/);
  const region = page.getByRole("region", { name: "Reset your password" });
  const emailField = region.getByLabel("Email address");
  await emailField.fill("someone@example.com");
  const submit = region.getByRole("button", { name: /Send(ing)? (reset )?link/ });

  await expect(submit).toHaveAttribute("aria-disabled", "true");
  await expect(submit).toHaveAccessibleDescription(REASON);
  expect(await cursorOf(submit), "unreachable, not pending").toBe("not-allowed");
  await attemptAll(page, submit, emailField, requests);
  await expect(emailField).toHaveValue("someone@example.com");

  await noHorizontalOverflow(page);
  const scan = await new AxeBuilder({ page })
    .include("section[aria-labelledby='forgot-password-heading']")
    .include("[data-connectivity-banner]")
    .withTags(WCAG_TAGS)
    .analyze();
  await testInfo.attach("axe-online-only-forgot-password", {
    body: JSON.stringify(scan.violations, null, 2),
    contentType: "application/json",
  });
  expect(scan.violations).toEqual([]); // automated evidence only

  await recoverThroughCheck(page);
  expect(await cursorOf(submit), "available").toBe("pointer");
  expect(requests).toHaveLength(0);

  // A genuinely pending request (held), then loss and recovery while it is held.
  const gate = await holdRequests(
    page,
    (url) => url.pathname === "/api/auth/request-password-reset",
    "POST",
  );
  await submit.click();
  await expect.poll(() => gate.held.length).toBe(1);
  await expect(submit).toHaveAttribute("data-pending", "true");
  expect(await cursorOf(submit), "pending").toBe("progress");
  await becomeUnreachableWhileOffline(page);
  expect(await cursorOf(submit), "pending + unreachable").toBe("progress");
  await page.context().setOffline(false); // recovery (unreachable → unknown)
  await expect(liveText(page)).not.toContainText(TEXT.offlineUnreachable);
  expect(await cursorOf(submit), "pending after recovery").toBe("progress");
  expect(requests).toHaveLength(1); // the lock held

  const answered = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/auth/request-password-reset",
  );
  gate.release();
  expect((await answered).status()).toBe(503); // e2e runs with mail delivery disabled
  await expect(region.getByRole("alert")).toHaveText(
    "Password reset is temporarily unavailable. Please try again later.",
  );
  await expect(submit).not.toHaveAttribute("data-pending");
  expect(await cursorOf(submit), "finished (a server problem is not unavailability)").toBe(
    "pointer",
  );
  expect(requests).toHaveLength(1);
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("auth: choosing a new password is refused while unreachable; the passwords and token restrictions are kept; an explicit submit gets the real invalid-token outcome", async ({
  page,
}) => {
  const token = "E2eConnectivitySyntheticToken1";
  const resets = countRequests(page, "POST", /^\/api\/auth\/reset-password$/);
  await loadUnreachable(page, `/reset-password?token=${token}`);
  expect(page.url().includes(token), "token stripped from the URL").toBe(false);
  const region = page.getByRole("region", { name: "Choose a new password" });
  const newPassword = region.getByLabel("New password", { exact: true });
  const confirm = region.getByLabel("Confirm new password");
  await newPassword.fill(AUTH_PASSWORD);
  await confirm.fill(AUTH_PASSWORD);

  const submit = region.getByRole("button", { name: "Reset password" });
  await expect(submit).toHaveAttribute("aria-disabled", "true");
  await expect(submit).toHaveAccessibleDescription(REASON);
  await attemptAll(page, submit, confirm, resets);
  expect((await newPassword.inputValue()) === AUTH_PASSWORD, "password kept").toBe(true);

  await recoverThroughCheck(page);
  await settle(page);
  expect(resets).toHaveLength(0);

  const answered = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/auth/reset-password",
  );
  await submit.click();
  expect((await answered).status()).toBe(400); // the real token check
  await expect(page.getByRole("alert")).toHaveText(
    "This password reset link is invalid or has expired. Each link works once and expires after 30 minutes. Request a new link to try again.",
  );
  expect(resets).toHaveLength(1);
});

fixtureTest(
  "favorites (Increment 5): not-allowed when only unreachable, progress while a save is pending — also while unreachable and after recovery — and pointer once it finishes",
  async ({ page, favoriteFixtures: { public: landmark } }) => {
    await signUpAndIn(page.request);
    await openProfile(page, landmark);
    const toggle = favoriteToggle(page, landmark);
    const puts = countRequests(page, "PUT", /^\/api\/v1\/favorites\/[^/]+$/);

    // 1. Available.
    await expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(await cursorOf(toggle), "available").toBe("pointer");

    // 2. Unreachable, nothing pending.
    await becomeUnreachableThroughFavorite(page, landmark);
    await expect(toggle).toHaveAttribute("aria-disabled", "true");
    await expect(toggle).not.toHaveAttribute("data-pending");
    expect(await cursorOf(toggle), "unreachable, nothing pending").toBe("not-allowed");
    await recoverThroughCheck(page);
    expect(await cursorOf(toggle), "recovered").toBe("pointer");

    // 3. A genuinely pending save (held).
    const gate = await holdRequests(page, /\/api\/v1\/favorites\/[^/?]+$/, "PUT");
    await toggle.click();
    await expect.poll(() => gate.held.length).toBe(1);
    await expect(toggle).toHaveAttribute("data-pending", "true");
    expect(await cursorOf(toggle), "pending").toBe("progress");

    // 4. Pending while unreachable (the browser's real offline mode and an explicit check).
    await becomeUnreachableWhileOffline(page);
    await expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(await cursorOf(toggle), "pending + unreachable").toBe("progress");

    // 5. Recovered while still pending: the browser's online event ends the
    // unreachable state (reachability returns to unknown — no check needed).
    await page.context().setOffline(false);
    await expect(checkButton(page)).toHaveCount(0);
    expect(await cursorOf(toggle), "pending after recovery").toBe("progress");
    expect(puts).toHaveLength(2); // the refused attempt and the held save; nothing else

    // 6. Finished.
    const saved = page.waitForResponse(
      (r) => r.request().method() === "PUT" && /\/api\/v1\/favorites\//.test(r.url()),
    );
    gate.release();
    expect((await saved).status()).toBe(201);
    await expect(toggle).toHaveAttribute("aria-pressed", "true");
    await expect(toggle).not.toHaveAttribute("data-pending");
    expect(await cursorOf(toggle), "finished").toBe("pointer");
    expect(puts).toHaveLength(2);
    await page.unrouteAll({ behavior: "ignoreErrors" });
  },
);
