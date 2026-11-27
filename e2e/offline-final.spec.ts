import type { APIRequestContext, Page } from "@playwright/test";
import { expectServerView, type FixtureLandmark } from "./helpers/favoritesFixtures";
import { injectStorageFaults, readOfflineState } from "./helpers/offlineState";
import { ORIGIN, expect, test } from "./helpers/tripFixtures";

/**
 * M06-T03 Increment 3g — focused real-browser evidence for acceptance criteria
 * that earlier increments verified only synthetically ("chromium" project).
 * Specification 6 v1.1 AC-14, AC-15, AC-21, AC-25, AC-30, AC-31, and §10.4
 * (another user's shared trip cannot be saved).
 *
 * REAL: production build and server on `landmarks_test`, guarded fixtures and
 * their guarded make-sensitive operation, real trip deletion and sharing
 * through the API, the application's own flows, and real browser storage.
 * INSTRUMENTED, where stated: one page's state-store writes fail (AC-31);
 * map tiles are served a 1×1 PNG.
 */

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const control = (page: Page, name: string) =>
  page.getByRole("group", { name: `Offline copy of ${name}` });
const anyControl = (page: Page) => page.getByRole("group", { name: /^Offline copy of / });

async function noTiles(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
}

async function openSignedIn(page: Page, email: string) {
  await page.goto("/");
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect.poll(async () => (await readOfflineState(page)).marker).not.toBeNull();
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

async function saveCopy(page: Page, path: string, name: string) {
  await page.goto(path);
  const group = control(page, name);
  await group.getByRole("button", { name: "Save for offline" }).click();
  await expect(group.getByRole("status")).toContainText("Saved for offline.");
}

/** READ-ONLY: every record of both offline databases, as stored. */
function dumpOfflineDatabases(page: Page): Promise<Record<string, Record<string, unknown[]>>> {
  return page.evaluate(async () => {
    const out: Record<string, Record<string, unknown[]>> = {};
    const names = (await indexedDB.databases())
      .map((d) => d.name ?? "")
      .filter((n) => n.startsWith("tnle-offline-"));
    for (const name of names) {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open(name);
        request.onupgradeneeded = () => request.transaction?.abort();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(new Error(`open ${name}`));
      });
      out[name] = {};
      for (const store of [...db.objectStoreNames]) {
        out[name][store] = await new Promise<unknown[]>((resolve, reject) => {
          const request = db.transaction(store, "readonly").objectStore(store).getAll();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(new Error(`getAll ${store}`));
        });
      }
      db.close();
    }
    return out;
  });
}

test.beforeEach(async ({ page }) => {
  await noTiles(page);
});

test("(g1) AC-21 [real]: after real saves, offline storage holds no session token, email, share token, version, sharing flag, review, or rating; §10.4: a shared trip offers no save", async ({
  page,
  context,
  trips,
}) => {
  const email = await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Scanned trip", [trips.stops[0], trips.stops[1]]);
  const share = await page.request.post(`/api/v1/trips/${tripId}/share`, {
    headers: { Origin: ORIGIN },
    data: {},
  });
  expect(share.status()).toBe(200);
  const shareUrl = ((await share.json()) as { share_url: string }).share_url;
  const shareToken = shareUrl.split("/").pop()!;
  await openSignedIn(page, email);
  await saveCopy(page, `/landmarks/${trips.public.id}`, trips.public.displayName);
  await saveCopy(page, `/trips/${tripId}`, "Scanned trip");

  const sessionCookies = (await context.cookies()).filter((c) => /session/i.test(c.name));
  expect(sessionCookies.length).toBeGreaterThan(0);
  const dump = JSON.stringify(await dumpOfflineDatabases(page));
  expect(dump).toContain(trips.public.displayName); // the scan reads real records
  expect(dump).toContain("Scanned trip");
  for (const cookie of sessionCookies) {
    for (const part of decodeURIComponent(cookie.value).split(".")) {
      if (part.length >= 16) expect(dump, `session cookie ${cookie.name}`).not.toContain(part);
    }
  }
  expect(dump).not.toContain(email);
  expect(dump).not.toContain(shareToken);
  for (const field of ['"version"', '"is_shared"', '"sharing_enabled"', '"review', '"rating']) {
    expect(dump, field).not.toContain(field);
  }

  // §10.4: the publicly shared view of a trip offers no offline save.
  await page.goto(new URL(shareUrl).pathname);
  await expect(page.locator("#shared-trip-heading")).toHaveText("Scanned trip");
  await expect(page.getByRole("button", { name: "Save for offline" })).toHaveCount(0);
});

test("(g2) AC-14, AC-15 [real server evidence]: a trip refresh propagates a sensitive stop to the landmark copy; a deleted trip becomes a minimal marker", async ({
  page,
  trips,
}) => {
  const email = await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Propagation trip", [
    trips.stops[0],
    trips.hidden,
    trips.stops[1],
  ]);
  await openSignedIn(page, email);
  await saveCopy(page, `/landmarks/${trips.hidden.id}`, trips.hidden.displayName);
  await saveCopy(page, `/trips/${tripId}`, "Propagation trip");

  await trips.makeHiddenSensitive(); // REAL, guarded, landmarks_test
  await expectServerView(page.request, trips.hidden, "minimal");

  // AC-14: refresh the TRIP; the landmark copy becomes a marker too.
  await page.goto(`/offline/trips/${tripId}`);
  await control(page, "Propagation trip")
    .getByRole("button", { name: "Refresh offline copy" })
    .click();
  await expect(anyControl(page).getByRole("status")).toContainText("refreshed");
  const items = page.getByRole("list", { name: "Stops" }).getByRole("listitem");
  await expect(items.nth(1)).toContainText("This stop is no longer available.");
  await page.goto(`/offline/landmarks/${trips.hidden.id}`);
  await expect(page.getByText(/No longer available — recorded/).first()).toBeVisible();
  await expect(page.getByText(/Latitude/)).toHaveCount(0);

  // AC-15: the trip is deleted on the server; a refresh records a minimal marker.
  const deleted = await page.request.delete(`/api/v1/trips/${tripId}`, {
    headers: { Origin: ORIGIN },
  });
  expect(deleted.status()).toBe(204);
  await page.goto(`/offline/trips/${tripId}`);
  await control(page, "Propagation trip")
    .getByRole("button", { name: "Refresh offline copy" })
    .click();
  await expect(anyControl(page).getByRole("alert")).toContainText("no longer available");
  await expect(page.getByText(/No longer available — recorded/).first()).toBeVisible();
  await expect(page.getByRole("list", { name: "Stops" })).toHaveCount(0);

  const dump = await dumpOfflineDatabases(page);
  const tripRecords = dump["tnle-offline-data"]!.trips as Record<string, unknown>[];
  const marker = tripRecords.find((r) => r.trip_id === tripId)!;
  expect(Object.keys(marker).sort()).toEqual(
    [
      "account_id",
      "lifecycle_id",
      "revision",
      "saved_at",
      "schema_version",
      "status",
      "trip_id",
      "unavailable_recorded_at",
    ].sort(),
  );
  // The landmark marker was not changed by the trip-level 404.
  const landmarkRecords = dump["tnle-offline-data"]!.landmarks as Record<string, unknown>[];
  expect(landmarkRecords.find((r) => r.landmark_id === trips.hidden.id)).toMatchObject({
    status: "unavailable",
  });
});

test("(g3) AC-25 [real]: reloads, a reconnect, and focus never refresh a saved copy", async ({
  page,
  context,
  trips,
}) => {
  const email = await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Quiet trip", [trips.stops[0]]);
  await openSignedIn(page, email);
  await saveCopy(page, `/landmarks/${trips.public.id}`, trips.public.displayName);
  await saveCopy(page, `/trips/${tripId}`, "Quiet trip");

  const itemReads: string[] = [];
  page.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (path === `/api/v1/landmarks/${trips.public.id}` || path === `/api/v1/trips/${tripId}`) {
      itemReads.push(path);
    }
  });
  await page.goto("/offline");
  await expect(page.getByRole("link", { name: "Quiet trip" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("link", { name: "Quiet trip" })).toBeVisible();
  await page.goto(`/offline/landmarks/${trips.public.id}`);
  await page.reload();
  await expect(page.getByRole("heading", { name: trips.public.displayName })).toBeVisible();
  await context.setOffline(true);
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  expect(itemReads, "no automatic refresh (AC-25)").toEqual([]);

  // Positive control: the recorder does see a refresh — the explicit, per-item one.
  await page.goto(`/offline/landmarks/${trips.public.id}`);
  await control(page, trips.public.displayName)
    .getByRole("button", { name: "Refresh offline copy" })
    .click();
  await expect(anyControl(page).getByRole("status")).toContainText("refreshed");
  expect(itemReads).toEqual([`/api/v1/landmarks/${trips.public.id}`]);
});

test("(g4) AC-31 [instrumented: state-store writes fail]: after D22 is set, localStorage holds only the fixed lock value and no account data", async ({
  page,
  trips,
}) => {
  await injectStorageFaults(page, ["state-put"]); // INSTRUMENTED
  const email = await trips.signUpAndIn(page.request);
  await openSignedIn(page, email);
  await saveCopy(page, `/landmarks/${trips.public.id}`, trips.public.displayName);
  const marker = (await readOfflineState(page)).marker!;
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect.poll(async () => (await readOfflineState(page)).safetyLock).toBe("true");

  const entries = await page.evaluate(() =>
    Object.keys(localStorage).map((key) => [key, localStorage.getItem(key) ?? ""]),
  );
  const offline = entries.filter(([key]) => key.startsWith("tnle-offline"));
  expect(offline).toEqual([["tnle-offline-safety-lock", "true"]]);
  const all = JSON.stringify(entries);
  for (const secret of [
    marker.account_id,
    marker.lifecycle_id,
    email,
    trips.public.displayName,
    trips.public.id,
  ]) {
    expect(all).not.toContain(secret);
  }
  expect(all).not.toMatch(/\d{4}-\d{2}-\d{2}T/); // no timestamp
  expect(all).not.toMatch(/-?\d{1,3}\.\d{4,}/); // no coordinate
});

test("(g5) AC-30 [real]: no offline view or installation text offers or implies offline map downloads", async ({
  page,
  trips,
}) => {
  const email = await trips.signUpAndIn(page.request);
  const tripId = await createTrip(page.request, "Mapless trip", [trips.stops[0]]);
  await openSignedIn(page, email);
  await saveCopy(page, `/landmarks/${trips.public.id}`, trips.public.displayName);
  await saveCopy(page, `/trips/${tripId}`, "Mapless trip");
  const mapDownload = /download|offline map|map region|save (the )?map|tiles/i;
  for (const path of [
    "/offline",
    `/offline/landmarks/${trips.public.id}`,
    `/offline/trips/${tripId}`,
    `/landmarks/${trips.public.id}`,
    `/trips/${tripId}`,
    "/offline-data",
  ]) {
    await page.goto(path);
    await expect(page.getByRole("main")).toBeVisible();
    await page.waitForLoadState("networkidle");
    const text = await page.locator("body").innerText();
    expect(text, path).not.toMatch(mapDownload);
  }
});
