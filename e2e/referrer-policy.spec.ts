import { test, expect, type Request } from "@playwright/test";

/**
 * M03-T03 decision 5 / refinement 1, amended 2026-11-18 — the global
 * `strict-origin` referrer policy, observed in real Chromium against the real
 * production-mode server:
 *
 * - tile requests to tile.openstreetmap.org carry a Referer, and it is ONLY
 *   the application origin (OSM's tile usage policy requires a Referer;
 *   the reset-token design requires that no path or query ever leaks);
 * - same-origin API requests also carry only the origin;
 * - the real sign-out still sends the exact `Origin` the backend's CSRF check
 *   requires, and succeeds.
 *
 * Tile responses are stubbed so no request leaves the machine; the headers
 * asserted are the ones the browser itself built for those requests.
 */

const ORIGIN = "http://localhost:3000";
const ORIGIN_REFERER = `${ORIGIN}/`;
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

test("tile and API requests send only the application origin as the Referer", async ({ page }) => {
  const tileRequests: Request[] = [];
  await page.route(/tile\.openstreetmap\.org/, (route) => {
    tileRequests.push(route.request());
    return route.fulfill({ status: 200, contentType: "image/png", body: PNG });
  });
  const apiRequest = page.waitForRequest((r) => new URL(r.url()).pathname.startsWith("/api/v1/"));

  // A path and a query string that must never appear in any Referer.
  await page.goto("/?q=Falls&secret=do-not-leak");
  await expect.poll(() => tileRequests.length).toBeGreaterThan(0);

  for (const request of tileRequests) {
    expect(await request.headerValue("referer")).toBe(ORIGIN_REFERER);
  }
  expect(await (await apiRequest).headerValue("referer")).toBe(ORIGIN_REFERER);
  expect(
    await page.evaluate(
      () => document.querySelector('meta[name="referrer"]')?.getAttribute("content") ?? null,
    ),
  ).toBe("strict-origin");
});

test("the real sign-out sends the exact Origin, an origin-only Referer, and succeeds", async ({
  page,
}) => {
  const email = `e2e-referrer-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const password = "e2e referrer password";
  const headers = { Origin: ORIGIN };
  expect(
    (
      await page.request.post("/api/auth/sign-up/email", {
        headers,
        data: { name: "", email, password },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await page.request.post("/api/auth/sign-in/email", { headers, data: { email, password } })
    ).status(),
  ).toBe(200);

  await page.goto("/?q=Falls");
  const signOutButton = page.getByRole("button", { name: "Sign out" });
  await expect(signOutButton).toBeVisible();

  const signOut = page.waitForRequest((r) => new URL(r.url()).pathname === "/api/auth/sign-out");
  const signOutResponse = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/auth/sign-out",
  );
  await signOutButton.click();

  const request = await signOut;
  expect(await request.headerValue("origin")).toBe(ORIGIN);
  expect(await request.headerValue("referer")).toBe(ORIGIN_REFERER);
  const response = await signOutResponse;
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ success: true });

  await expect(
    page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Sign in" }),
  ).toBeFocused();
  const session = await page.request.get("/api/auth/get-session");
  expect(await session.json()).toBeNull();
});
