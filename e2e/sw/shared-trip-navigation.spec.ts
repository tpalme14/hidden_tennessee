import type { APIRequestContext, Page } from "@playwright/test";
import { ORIGIN, expect, test } from "../helpers/tripFixtures";

/**
 * M06-T02 Increment 2 — shared-trip page navigation with the service worker
 * active (Specification 6 v1.1 OFF-SW-2; Specification 5 v1.1 §7.2). Uses a
 * real shared trip built from the guarded synthetic trip fixtures
 * (`landmarks_test` only); the share token is never printed, attached, or
 * asserted as text.
 *
 * Every variant must bypass the worker's navigation fallback
 * (`fromServiceWorker() === false`) and reach the server. The canonical page
 * and its case, trailing-slash, query, and encoded variants must display the
 * trip with the server's `Cache-Control: no-store` and
 * `X-Robots-Tag: noindex, nofollow`.
 *
 * History: Increment 2 confirmed that when a letter of "shared" or "trips" was
 * percent-encoded (for example `/%73hared/trips/…`), the page displayed the
 * trip but the server sent neither header, because it matched only the raw
 * path. Increment 2a corrected the server (raw and decoded path); those two
 * forms are now asserted as protected variants below.
 */

const TRIP_NAME = "Service worker shared trip";

async function createSharedTripToken(request: APIRequestContext, stopId: string): Promise<string> {
  const created = await request.post("/api/v1/trips", {
    headers: { Origin: ORIGIN },
    data: { name: TRIP_NAME },
  });
  expect(created.status()).toBe(201);
  const tripId = ((await created.json()) as { trip: { id: string } }).trip.id;
  const stop = await request.post(`/api/v1/trips/${tripId}/stops`, {
    headers: { Origin: ORIGIN },
    data: { landmark_id: stopId },
  });
  expect(stop.status()).toBe(201);
  const shared = await request.post(`/api/v1/trips/${tripId}/share`, {
    headers: { Origin: ORIGIN },
    data: {},
  });
  expect(shared.status()).toBe(200);
  return new URL(((await shared.json()) as { share_url: string }).share_url).pathname
    .split("/")
    .pop()!;
}

async function installAndControl(page: Page) {
  await page.goto("/sign-in");
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

test("shared-trip navigations bypass the worker; protected variants display the trip with no-store and noindex", async ({
  page,
  trips,
}) => {
  await trips.signUpAndIn(page.request);
  const token = await createSharedTripToken(page.request, trips.stops[0].id);
  // View anonymously, as a share recipient would.
  await page.context().clearCookies();
  await installAndControl(page);

  const heading = page.locator("#shared-trip-heading");
  const protectedVariants: [string, string][] = [
    ["canonical", `/shared/trips/${token}`],
    ["upper-case path", `/SHARED/TRIPS/${token}`],
    ["trailing slash", `/shared/trips/${token}/`],
    ["query string", `/shared/trips/${token}?ref=link`],
    [
      "percent-encoded first token character",
      `/shared/trips/%${token.charCodeAt(0).toString(16)}${token.slice(1)}`,
    ],
    // The two forms found unprotected in Increment 2 and corrected in Increment 2a.
    ["percent-encoded 's' in shared", `/%73hared/trips/${token}`],
    ["percent-encoded 't' in trips", `/shared/%74rips/${token}`],
  ];
  for (const [label, path] of protectedVariants) {
    // The page's own read of the shared-trip API, recorded without the token.
    const apiResponse = page.waitForResponse((r) =>
      new URL(r.url()).pathname.startsWith("/api/v1/shared/trips/"),
    );
    const response = await page.goto(path);
    expect(response?.fromServiceWorker(), label).toBe(false);
    expect(response?.status(), label).toBe(200);
    // Soft, so a missing header is reported together with whether the trip
    // was still displayed (the test fails either way).
    expect.soft(response!.headers()["cache-control"], `${label}: cache-control`).toBe("no-store");
    expect
      .soft(response!.headers()["x-robots-tag"], `${label}: x-robots-tag`)
      .toBe("noindex, nofollow");
    // React Router recognised the route and the synthetic trip is displayed.
    await expect(heading, label).toHaveText(TRIP_NAME);
    // The shared-trip API behavior is unchanged (canonical request, its own headers).
    const api = await apiResponse;
    expect(api.status(), label).toBe(200);
    expect(api.headers()["cache-control"], label).toBe("no-store");
    expect(api.headers()["x-robots-tag"], label).toBe("noindex, nofollow");
    expect(new URL(api.url()).pathname === `/api/v1/shared/trips/${token}`, label).toBe(true);
  }

  // Offline, a shared-trip link is never answered with the cached shell.
  await page.context().setOffline(true);
  await expect(page.goto(`/shared/trips/${token}`)).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
});
