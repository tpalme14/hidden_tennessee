import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { expectServerView, type FixtureLandmark } from "../helpers/favoritesFixtures";
import { readOfflineState } from "../helpers/offlineState";
import { ORIGIN, expect, test } from "../helpers/tripFixtures";

/**
 * M06-T03 Increment 3e — offline-read, online-only actions, offline removal,
 * and reconnection with the browser's REAL offline mode ("chromium-sw":
 * service workers allowed; the precached shell serves the cold start).
 * Specification 6 §3.3 (E2), §4.2, §9.1, OFF-UX-5, OFF-UX-6.
 *
 * REAL: production build and server on `landmarks_test`, guarded fixtures,
 * `context.setOffline`, the service worker, and the application's own flows.
 * Nothing is intercepted except map tiles (a 1×1 PNG).
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const ONLINE_ONLY_REASON = "Unavailable while the server can't be reached.";
const OFFLINE_READ = "This doesn't sign you in.";

const control = (page: Page, name: string) =>
  page.getByRole("group", { name: `Offline copy of ${name}` });
const savedLandmarks = (page: Page) => page.getByRole("region", { name: "Landmarks" });
const savedTrips = (page: Page) => page.getByRole("region", { name: "Trips" });
const anyControl = (page: Page) => page.getByRole("group", { name: /^Offline copy of / });
const nav = (page: Page) => page.getByRole("navigation").first();

async function noTiles(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
}

async function scan(page: Page, state: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(blocking, `serious/critical axe violations in "${state}"`).toEqual([]);
}

async function installAndControl(page: Page, path: string) {
  await page.goto(path);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

async function createTrip(request: APIRequestContext, name: string, stops: FixtureLandmark[]) {
  const created = await request.post("/api/v1/trips", {
    headers: { Origin: ORIGIN },
    data: { name },
  });
  expect(created.status()).toBe(201);
  const tripId = ((await created.json()) as { trip: { id: string } }).trip.id;
  for (const landmark of stops) {
    const added = await request.post(`/api/v1/trips/${tripId}/stops`, {
      headers: { Origin: ORIGIN },
      data: { landmark_id: landmark.id },
    });
    expect(added.status()).toBe(201);
  }
  return tripId;
}

async function serverTrip(request: APIRequestContext, tripId: string) {
  const response = await request.get(`/api/v1/trips/${tripId}`);
  expect(response.status()).toBe(200);
  return (await response.json()) as unknown;
}

async function saveCopy(page: Page, path: string, name: string) {
  await page.goto(path);
  const group = control(page, name);
  await group.getByRole("button", { name: "Save for offline" }).click();
  await expect(group.getByRole("status")).toContainText("Saved for offline.");
}

test("(b9) [real offline] Save is online-only: disabled with its reason, and nothing is sent or queued", async ({
  page,
  context,
  trips,
}) => {
  await noTiles(page);
  const email = await trips.signUpAndIn(page.request);
  await installAndControl(page, `/landmarks/${trips.public.id}`);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  const group = control(page, trips.public.displayName);
  await expect(group.getByRole("button", { name: "Save for offline" })).toBeVisible();

  await context.setOffline(true);
  await page.getByRole("button", { name: /check(ing)? connection/i }).click();
  const save = group.getByRole("button", { name: "Save for offline" });
  await expect(save).toHaveAttribute("aria-disabled", "true");
  await expect(save).toHaveAccessibleDescription(ONLINE_ONLY_REASON);

  const apiRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) apiRequests.push(r.url());
  });
  // force: Playwright refuses aria-disabled targets; a user's click still reaches the button.
  await save.click({ force: true });
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  expect(apiRequests, "nothing sent or queued for later").toEqual([]);
  expect((await readOfflineState(page)).landmarks).toBe(0);
});

test("(b2) [real offline cold start] offline-read shows saved copies, never signs in, removes locally, and reconnection needs a coordinated check", async ({
  context,
  trips,
}) => {
  const online = await context.newPage();
  await noTiles(online);
  const email = await trips.signUpAndIn(online.request);
  const [stop1, stop2] = trips.stops;
  const tripId = await createTrip(online.request, "Offline trail day", [stop1, stop2]);
  const tripBefore = await serverTrip(online.request, tripId);
  await installAndControl(online, "/");
  await expect(online.getByText(`Signed in as ${email}`)).toBeVisible();
  await saveCopy(online, `/landmarks/${trips.public.id}`, trips.public.displayName);
  await saveCopy(online, `/trips/${tripId}`, "Offline trail day");
  await online.close();

  // A GENUINE cold start: a new page, no running app, the browser offline.
  await context.setOffline(true);
  const page = await context.newPage();
  await noTiles(page);
  const sessionChecks: string[] = [];
  const apiRequests: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path.startsWith("/api/")) apiRequests.push(path);
    if (path === "/api/auth/get-session") sessionChecks.push(path);
  });
  const response = await page.goto("/offline");
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page.getByText(OFFLINE_READ)).toBeVisible();
  await expect(
    savedLandmarks(page).getByRole("link", { name: trips.public.displayName }),
  ).toBeVisible();
  await expect(savedTrips(page).getByRole("link", { name: "Offline trail day" })).toBeVisible();
  await scan(page, "offline-read library");

  // Never signed-in functionality.
  await expect(page.getByText(/Signed in as/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(nav(page).getByRole("link", { name: "Favorites" })).toHaveCount(0);
  await expect(nav(page).getByRole("link", { name: "My trips" })).toHaveCount(0);
  await expect(nav(page).getByRole("link", { name: "Saved for offline" })).toBeVisible();

  // The trip copy reads; Save and Refresh are disabled, with no request.
  await savedTrips(page).getByRole("link", { name: "Offline trail day" }).click();
  await expect(page.getByRole("list", { name: "Stops" }).getByRole("listitem")).toHaveCount(2);
  const tripGroup = control(page, "Offline trail day");
  const refresh = tripGroup.getByRole("button", { name: "Refresh offline copy" });
  await expect(refresh).toHaveAttribute("aria-disabled", "true");
  await expect(
    tripGroup.getByText(
      "Saving and refreshing need you to be signed in with a connection to the server.",
    ),
  ).toBeVisible();
  await page.waitForLoadState("networkidle");
  apiRequests.length = 0;
  await refresh.click({ force: true });
  expect(apiRequests).toEqual([]);

  // E2: removal offline is local and sends nothing.
  await page.goto(`/offline/landmarks/${trips.public.id}`);
  const group = control(page, trips.public.displayName);
  await expect(group.getByRole("button", { name: "Remove offline copy" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // the page's own startup check is done
  apiRequests.length = 0;
  await group.getByRole("button", { name: "Remove offline copy" }).click();
  await expect(anyControl(page).getByRole("status")).toContainText("removed from this device");
  expect(apiRequests, "offline removal sends no request").toEqual([]);

  // Reconnection alone does not promote: still read-only, no session.
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  await page.goto(`/offline/trips/${tripId}`);
  // That navigation's own startup check is the coordinated check: promotion
  // happens only after a REAL session request succeeds.
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  expect(sessionChecks.length).toBeGreaterThan(0);
  await expect(
    control(page, "Offline trail day").getByRole("button", { name: "Refresh offline copy" }),
  ).not.toHaveAttribute("aria-disabled", "true");

  // The removed copy does not reappear; the server was never changed.
  await page.goto("/offline");
  await expect(savedTrips(page).getByRole("link", { name: "Offline trail day" })).toBeVisible();
  await expect(page.getByText(trips.public.displayName)).toHaveCount(0);
  expect(await serverTrip(page.request, tripId)).toEqual(tripBefore);
  await expectServerView(page.request, trips.public, "full");
});

test("(b2b) [real offline] an open page that loses its connection is NOT promoted when the connection returns", async ({
  context,
  trips,
}) => {
  const online = await context.newPage();
  await noTiles(online);
  const email = await trips.signUpAndIn(online.request);
  await installAndControl(online, "/");
  await expect(online.getByText(`Signed in as ${email}`)).toBeVisible();
  await saveCopy(online, `/landmarks/${trips.public.id}`, trips.public.displayName);
  await online.close();

  await context.setOffline(true);
  const page = await context.newPage();
  await noTiles(page);
  await page.goto(`/offline/landmarks/${trips.public.id}`);
  await expect(page.getByText(OFFLINE_READ)).toBeVisible();
  await expect(page.getByRole("heading", { name: trips.public.displayName })).toBeVisible();
  const group = control(page, trips.public.displayName);
  await expect(group.getByRole("button", { name: "Refresh offline copy" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );

  const sessionChecks: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/auth/get-session") sessionChecks.push(r.url());
  });
  await context.setOffline(false);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(true);
  // Without a coordinated session check the page stays read-only.
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(group.getByRole("button", { name: "Refresh offline copy" })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await expect(page.getByText(/Signed in as/)).toHaveCount(0);
  expect(sessionChecks).toEqual([]);
});
