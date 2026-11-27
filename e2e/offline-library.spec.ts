import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Page } from "@playwright/test";
import { expectServerView, type FixtureLandmark } from "./helpers/favoritesFixtures";
import {
  allowDroppingNotices,
  injectStorageFaults,
  readOfflineState,
  seedLandmarkMarkers,
} from "./helpers/offlineState";
import { ORIGIN, expect, test } from "./helpers/tripFixtures";

/**
 * M06-T03 Increment 3e — save controls and the offline library in a real
 * browser ("chromium" project: service workers blocked). Specification 6
 * OFF-UX-1–6, OFF-SNAP-4–8, OFF-STORE-7, §3.3 (E2), §4.2, §9.1.
 *
 * REAL: the production build and production-mode server on `landmarks_test`;
 * guarded synthetic fixtures (e2e/helpers/tripFixtures.ts) — including their
 * guarded retire and make-sensitive operations, which produce REAL server
 * evidence; the application's own save, refresh, and removal flows; Chromium
 * Web Locks, IndexedDB, and BroadcastChannel across pages of one context.
 *
 * INSTRUMENTED, stated in each scenario:
 * - (b8) 200 markers SEEDED under the application's own lock to reach the limit;
 * - (b8) a QuotaExceededError INJECTED into one page's landmark writes;
 * - (b5) incoming cross-tab notices DROPPED in one page;
 * - map tiles served a 1×1 PNG, as in every other spec.
 *
 * Offline cold start, online-only gating, and reconnection are in
 * e2e/sw/offline-library.spec.ts ("chromium-sw", the browser's real offline mode).
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const control = (page: Page, name: string) =>
  page.getByRole("group", { name: `Offline copy of ${name}` });
/** The detail page's control under any name (it is "this landmark" once the copy is gone). */
const anyControl = (page: Page) => page.getByRole("group", { name: /^Offline copy of / });
const library = (page: Page) => page.getByRole("region", { name: "Saved for offline" });
const savedLandmarks = (page: Page) => page.getByRole("region", { name: "Landmarks" });
const savedTrips = (page: Page) => page.getByRole("region", { name: "Trips" });
const navLink = (page: Page) =>
  page.getByRole("navigation").getByRole("link", { name: "Saved for offline" });

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

/** Opens the app signed in (cookie set through `page.request`) and waits for the verified marker. */
async function openSignedIn(page: Page, email: string) {
  await page.goto("/");
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect.poll(async () => (await readOfflineState(page)).marker).not.toBeNull();
}

async function saveLandmark(page: Page, landmark: FixtureLandmark) {
  await page.goto(`/landmarks/${landmark.id}`);
  const group = control(page, landmark.displayName);
  await group.getByRole("button", { name: "Save for offline" }).click();
  await expect(group.getByRole("status")).toContainText("Saved for offline.");
  await expect(group).toContainText(/Last synced about/);
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
  return (await response.json()) as { trip: { version: number; stops: unknown[] } };
}

async function saveTrip(page: Page, tripId: string, name: string) {
  await page.goto(`/trips/${tripId}`);
  const group = control(page, name);
  await group.getByRole("button", { name: "Save for offline" }).click();
  await expect(group.getByRole("status")).toContainText("Saved for offline.");
}

test.beforeEach(async ({ page }) => {
  await noTiles(page);
});

test("(b1, b10) [real] save a landmark and a trip, then view them in the library and the saved-copy views; axe and keyboard", async ({
  page,
  trips,
}) => {
  const email = await trips.signUpAndIn(page.request);
  const [stop1, stop2] = trips.stops;
  const tripId = await createTrip(page.request, "Offline weekend", [stop1, stop2]);
  await openSignedIn(page, email);

  // Keyboard activation of Save on the landmark profile.
  await page.goto(`/landmarks/${trips.public.id}`);
  const group = control(page, trips.public.displayName);
  await expect(group.getByText("Not saved for offline.")).toBeVisible();
  await scan(page, "profile with save control");
  await group.getByRole("button", { name: "Save for offline" }).focus();
  await page.keyboard.press("Enter");
  await expect(group.getByRole("status")).toContainText("Saved for offline.");
  await saveTrip(page, tripId, "Offline weekend");

  // The library, reached from the navigation.
  await navLink(page).click();
  await expect(page).toHaveURL(/\/offline$/);
  await expect(
    savedLandmarks(page).getByRole("link", { name: trips.public.displayName }),
  ).toBeVisible();
  await expect(savedTrips(page).getByRole("link", { name: "Offline weekend" })).toBeVisible();
  await expect(savedTrips(page)).toContainText("2 stops");
  await expect(
    library(page).getByRole("link", { name: "Offline data on this device" }),
  ).toHaveAttribute("href", "/offline-data");
  await scan(page, "library populated");

  // Landmark copy: text coordinates with the disclaimer, freshness, no map.
  await savedLandmarks(page).getByRole("link", { name: trips.public.displayName }).click();
  await expect(page.getByRole("heading", { name: trips.public.displayName })).toBeVisible();
  await expect(page.getByText(/^Latitude -?\d+\.\d+, longitude -?\d+\.\d+$/)).toBeVisible();
  await expect(
    page.getByText("Coordinates and labels shown here do not establish public access", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
  await scan(page, "saved landmark view");

  // Trip copy: stops in order, no map.
  await page.goto(`/offline/trips/${tripId}`);
  const items = page.getByRole("list", { name: "Stops" }).getByRole("listitem");
  await expect(items).toHaveCount(2);
  await expect(items.nth(0)).toContainText(stop1.displayName);
  await expect(items.nth(1)).toContainText(stop2.displayName);
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
  await scan(page, "saved trip view");
});

test("(b3) [real] refresh and remove; removal is local — no server request, server resources unchanged", async ({
  page,
  trips,
}) => {
  const email = await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Keep on server", [trips.stops[0]]);
  const before = await serverTrip(page.request, tripId);
  await openSignedIn(page, email);
  await saveLandmark(page, trips.public);
  await saveTrip(page, tripId, "Keep on server");

  await page.goto(`/offline/landmarks/${trips.public.id}`);
  const group = control(page, trips.public.displayName);
  await group.getByRole("button", { name: "Refresh offline copy" }).click();
  await expect(group.getByRole("status")).toContainText("The offline copy was refreshed.");

  await page.waitForLoadState("networkidle");
  const apiRequests: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname.startsWith("/api/")) apiRequests.push(r.url());
  });
  await group.getByRole("button", { name: "Remove offline copy" }).click();
  await expect(anyControl(page).getByRole("status")).toContainText("removed from this device");
  expect(apiRequests, "E2: removal sends no server request").toEqual([]);
  await page.goto(`/offline/trips/${tripId}`);
  const tripGroup = control(page, "Keep on server");
  await expect(tripGroup.getByRole("button", { name: "Remove offline copy" })).toBeVisible();
  await page.waitForLoadState("networkidle"); // the page's own startup requests are done
  apiRequests.length = 0; // only the removal itself
  await tripGroup.getByRole("button", { name: "Remove offline copy" }).click();
  await expect(anyControl(page).getByRole("status")).toContainText("removed from this device");
  expect(apiRequests, "E2: removal sends no server request").toEqual([]);

  await page.goto("/offline");
  await expect(library(page)).toContainText("No saved copies on this device.");
  // Server resources are unchanged.
  expect(await serverTrip(page.request, tripId)).toEqual(before);
  await expectServerView(page.request, trips.public, "full");
});

test("(b4) [real server evidence] a retired landmark and a sensitive one become markers; the sensitive one propagates into a saved trip", async ({
  page,
  trips,
}) => {
  const email = await trips.signUpAndIn(page.request);
  const [stop1, stop2] = trips.stops;
  const tripId = await createTrip(page.request, "Through the hidden one", [
    stop1,
    trips.hidden,
    stop2,
  ]);
  await openSignedIn(page, email);
  await saveLandmark(page, trips.retired);
  await saveLandmark(page, trips.hidden);
  await saveTrip(page, tripId, "Through the hidden one");

  // REAL: guarded fixture operations on landmarks_test; the server now says so.
  await trips.retire();
  await trips.makeHiddenSensitive();
  await expectServerView(page.request, trips.retired, "not_found");
  await expectServerView(page.request, trips.hidden, "minimal");

  await page.goto(`/offline/landmarks/${trips.retired.id}`);
  await control(page, trips.retired.displayName)
    .getByRole("button", { name: "Refresh offline copy" })
    .click();
  await expect(anyControl(page).getByRole("alert")).toContainText(
    "This landmark is no longer available. The saved copy now shows only that it's unavailable.",
  );
  await expect(page.getByText(/No longer available — recorded/).first()).toBeVisible();
  await expect(page.getByText(/Latitude/)).toHaveCount(0);

  await page.goto(`/offline/landmarks/${trips.hidden.id}`);
  await control(page, trips.hidden.displayName)
    .getByRole("button", { name: "Refresh offline copy" })
    .click();
  await expect(page.getByText(/No longer available — recorded/).first()).toBeVisible();

  // Propagated into the saved trip (OFF-SNAP-4): placeholder, no summary, notice.
  await page.goto(`/offline/trips/${tripId}`);
  const items = page.getByRole("list", { name: "Stops" }).getByRole("listitem");
  await expect(items.nth(1)).toContainText("This stop is no longer available.");
  await expect(items.nth(1)).not.toContainText(trips.hidden.displayName);
  await expect(
    page.getByText("The distance summary is unavailable until you refresh this trip."),
  ).toBeVisible();
  await expect(page.getByText(/Part of this trip was updated on this device/)).toBeVisible();
  await scan(page, "invalidated trip view");
});

test("(b5) [instrumented: notices dropped] a copy removed in another tab is withdrawn by revalidation, not only by the notice", async ({
  context,
  trips,
}) => {
  const a = await context.newPage();
  await noTiles(a);
  await allowDroppingNotices(a);
  const email = await trips.signUpAndIn(a.request);
  await openSignedIn(a, email);
  await saveLandmark(a, trips.public);
  await a.goto("/offline");
  await expect(
    savedLandmarks(a).getByRole("link", { name: trips.public.displayName }),
  ).toBeVisible();
  await a.evaluate(() => {
    (window as { __tnleDropNotices?: boolean }).__tnleDropNotices = true;
  });

  const b = await context.newPage();
  await noTiles(b);
  await b.goto(`/offline/landmarks/${trips.public.id}`);
  const group = control(b, trips.public.displayName);
  await group.getByRole("button", { name: "Remove offline copy" }).click();
  await expect(anyControl(b).getByRole("status")).toContainText("removed from this device");

  // A never received the notice; returning to A revalidates and withdraws it.
  await a.bringToFront();
  await a.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(savedLandmarks(a).getByRole("link", { name: trips.public.displayName })).toHaveCount(
    0,
  );
});

test("(b6) [real] signing out in another tab ends the lifecycle and withdraws rendered copies at once", async ({
  context,
  trips,
}) => {
  const a = await context.newPage();
  await noTiles(a);
  const email = await trips.signUpAndIn(a.request);
  await openSignedIn(a, email);
  await saveLandmark(a, trips.public);
  await a.goto(`/offline/landmarks/${trips.public.id}`);
  await expect(a.getByRole("heading", { name: trips.public.displayName })).toBeVisible();

  const b = await context.newPage();
  await b.goto("/");
  await b.getByRole("button", { name: "Sign out" }).click();
  await expect(b.getByRole("link", { name: "Sign in" })).toBeVisible();

  await expect(a.getByRole("heading", { name: trips.public.displayName })).toHaveCount(0);
  await expect(a.getByText(/Latitude/)).toHaveCount(0);
  await expect.poll(async () => (await readOfflineState(a)).landmarks).toBe(0);
  await expect(navLink(a)).toHaveCount(0);
});

test("(b7) [real] another account signing in on this device never sees the first account's copies", async ({
  page,
  trips,
}) => {
  const first = await trips.signUpAndIn(page.request);
  await openSignedIn(page, first);
  await saveLandmark(page, trips.public);
  const firstMarker = (await readOfflineState(page)).marker;

  // The server session switches without this app's sign-out (marker mismatch path).
  const second = await trips.signUpAndIn(page.request);
  await page.goto("/offline");
  await expect(page.getByText(`Signed in as ${second}`)).toBeVisible();
  await expect(library(page)).toContainText("No saved copies on this device.");
  await expect(page.getByText(trips.public.displayName)).toHaveCount(0);
  const marker = (await readOfflineState(page)).marker;
  expect(marker?.account_id).not.toBe(firstMarker?.account_id);
});

test("(b7b) [real] a server-confirmed absent session never grants offline reads", async ({
  page,
  trips,
}) => {
  const email = await trips.signUpAndIn(page.request);
  await openSignedIn(page, email);
  await saveLandmark(page, trips.public);

  const signOut = await page.request.post("/api/auth/sign-out", {
    headers: { Origin: ORIGIN },
    data: {},
  });
  expect(signOut.status()).toBe(200);
  await page.goto("/offline");
  await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
  await expect(library(page)).toContainText("Sign in on this device to see what you've saved");
  await expect(page.getByText(trips.public.displayName)).toHaveCount(0);
  await expect(navLink(page)).toHaveCount(0);
});

test("(b8) [instrumented: seeded limit; injected quota] the limit and a full quota are reported, nothing partial is kept", async ({
  context,
  trips,
}) => {
  const page = await context.newPage();
  await noTiles(page);
  const email = await trips.signUpAndIn(page.request);
  await openSignedIn(page, email);

  // Quota first (the limit check runs before any write).
  const quota = await context.newPage();
  await noTiles(quota);
  await injectStorageFaults(quota, ["landmark-put-quota"]); // INSTRUMENTED: this page only
  await quota.goto(`/landmarks/${trips.hidden.id}`);
  const quotaGroup = control(quota, trips.hidden.displayName);
  await quotaGroup.getByRole("button", { name: "Save for offline" }).click();
  await expect(quotaGroup.getByRole("alert")).toContainText(/storage for this site is full/);
  expect((await readOfflineState(quota)).landmarks).toBe(0);
  await scan(quota, "quota alert");

  const marker = (await readOfflineState(page)).marker;
  if (marker === null) throw new Error("no marker");
  await seedLandmarkMarkers(page, marker, 200); // INSTRUMENTED
  await page.goto(`/landmarks/${trips.public.id}`);
  const group = control(page, trips.public.displayName);
  await group.getByRole("button", { name: "Save for offline" }).click();
  await expect(group.getByRole("alert")).toContainText(/limit of 200 saved landmarks/);
  expect((await readOfflineState(page)).landmarks).toBe(200);
});
