import type { Page } from "@playwright/test";
import { readOfflineState } from "../helpers/offlineState";
import { ORIGIN, expect, test } from "../helpers/tripFixtures";

/**
 * M06-T03 Increment 3g — AC-27 / OFF-SW boundaries after snapshot traffic
 * ("chromium-sw"). REAL: production build, service worker, server on
 * `landmarks_test`, guarded fixtures, and the browser's real offline mode.
 * Map tiles are served a 1×1 PNG.
 */

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

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

test("(g6) AC-27 [real]: after saving, refreshing, and reading offline, the service-worker caches hold the shell only — no API, auth, shared, or tile response", async ({
  context,
  trips,
}) => {
  const page = await context.newPage();
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
  const email = await trips.signUpAndIn(page.request);
  const created = await page.request.post("/api/v1/trips", {
    headers: { Origin: ORIGIN },
    data: { name: "Cached?" },
  });
  const tripId = ((await created.json()) as { trip: { id: string } }).trip.id;
  await page.request.post(`/api/v1/trips/${tripId}/stops`, {
    headers: { Origin: ORIGIN },
    data: { landmark_id: trips.stops[0].id },
  });
  await installAndControl(page, "/");
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect.poll(async () => (await readOfflineState(page)).marker).not.toBeNull();

  for (const [path, name] of [
    [`/landmarks/${trips.public.id}`, trips.public.displayName],
    [`/trips/${tripId}`, "Cached?"],
  ] as const) {
    await page.goto(path);
    const group = page.getByRole("group", { name: `Offline copy of ${name}` });
    await group.getByRole("button", { name: "Save for offline" }).click();
    await expect(group.getByRole("status")).toContainText("Saved for offline.");
    await group.getByRole("button", { name: "Refresh offline copy" }).click();
    await expect(group.getByRole("status")).toContainText("refreshed");
  }
  await context.setOffline(true);
  await page.goto("/offline");
  await expect(page.getByRole("link", { name: "Cached?" })).toBeVisible();
  await context.setOffline(false);

  const cached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      for (const request of await (await caches.open(name)).keys()) urls.push(request.url);
    }
    return urls;
  });
  expect(cached.length).toBeGreaterThan(0); // the precached shell exists
  for (const url of cached) {
    const parsed = new URL(url);
    expect(parsed.origin, url).toBe(ORIGIN);
    expect(parsed.pathname, url).not.toMatch(/^\/(api|shared)\//);
    expect(parsed.hostname, url).not.toMatch(/tile/);
  }
});
