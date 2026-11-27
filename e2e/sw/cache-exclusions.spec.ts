import { test, expect, type Page } from "@playwright/test";

/**
 * M06-T02 Increment 2 — navigation fallback and its exclusions (Specification
 * 6 v1.1 OFF-SW-2, OFF-SW-3, AC-27; ADR-008). "chromium-sw" project, real
 * production build and server.
 *
 * `response.fromServiceWorker()` distinguishes a response the worker produced
 * from its precache (true) from a navigation that passed through to the
 * network (false). Excluded navigations must reach the server online (with the
 * server's own status and headers) and must fail offline — never be answered
 * with the cached shell.
 */

const SYNTHETIC_SHARE_TOKEN = `${"B".repeat(21)}-${"y".repeat(21)}`; // syntactically valid, never issued
const SHARED = `/shared/trips/${SYNTHETIC_SHARE_TOKEN}`;

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

/** Application routes the navigation fallback must serve (pathname + search). */
const APPLICATION_ROUTES = [
  "/register",
  "/sign-in/",
  "/trips",
  "/favorites",
  "/landmarks/00000000-0000-4000-8000-000000000000",
  "/?q=caf%C3%A9&categories=falls", // percent-encoded QUERY values are allowed
];

/** Excluded navigations, with what the server itself answers. */
const EXCLUDED: { path: string; status: number; type: RegExp; shared?: boolean }[] = [
  { path: "/api/v1/categories", status: 200, type: /application\/json/ },
  { path: "/api/v1/categories?x=1", status: 200, type: /application\/json/ },
  { path: "/API/v1/categories", status: 200, type: /application\/json/ },
  { path: "/api", status: 404, type: /application\/json/ },
  { path: "/health", status: 200, type: /application\/json/ },
  { path: "/HEALTH?probe=1", status: 200, type: /application\/json/ },
  { path: SHARED, status: 200, type: /text\/html/, shared: true },
  { path: `${SHARED}/`, status: 200, type: /text\/html/, shared: true },
  { path: `/SHARED/TRIPS/${SYNTHETIC_SHARE_TOKEN}`, status: 200, type: /text\/html/, shared: true },
  { path: `${SHARED}?ref=link`, status: 200, type: /text\/html/, shared: true },
  { path: "/shared?x=1", status: 200, type: /text\/html/ },
  { path: "/%72egister", status: 200, type: /text\/html/ }, // percent-encoded path
  { path: "/sw.js", status: 200, type: /javascript/ }, // file-like
  { path: "/manifest.webmanifest?v=1", status: 200, type: /application\/manifest\+json/ },
  { path: "/assets/missing-x.js", status: 404, type: /application\/json/ }, // Increment 1a 404
  { path: "/workbox-missing.js", status: 404, type: /application\/json/ },
];

test("online: application routes are answered by the worker's shell; excluded navigations reach the server with its own responses", async ({
  page,
}) => {
  await installAndControl(page);

  for (const path of APPLICATION_ROUTES) {
    const response = await page.goto(path);
    expect(response?.fromServiceWorker(), path).toBe(true);
    expect(response?.status(), path).toBe(200);
    await expect(
      page.getByRole("heading", { name: "Tennessee Natural Landmarks Explorer" }),
      path,
    ).toBeVisible();
  }

  for (const { path, status, type, shared } of EXCLUDED) {
    const response = await page.goto(path);
    expect(response?.fromServiceWorker(), path).toBe(false);
    expect(response?.status(), path).toBe(status);
    const headers = response!.headers();
    expect(headers["content-type"], path).toMatch(type);
    if (shared) {
      // The server's shared-trip page protections are preserved.
      expect(headers["cache-control"], path).toBe("no-store");
      expect(headers["x-robots-tag"], path).toBe("noindex, nofollow");
    }
    if (status === 404) {
      expect(await response!.json(), path).toEqual({
        error: { code: "NOT_FOUND", message: "Resource not found." },
      });
    }
  }
});

test("offline: application routes still load from the shell; excluded navigations fail instead of receiving the cached shell", async ({
  page,
  context,
}) => {
  await installAndControl(page);
  await context.setOffline(true);

  for (const path of APPLICATION_ROUTES) {
    const response = await page.goto(path);
    expect(response?.fromServiceWorker(), path).toBe(true);
    await expect(
      page.getByRole("heading", { name: "Tennessee Natural Landmarks Explorer" }),
      path,
    ).toBeVisible();
  }

  for (const { path } of EXCLUDED) {
    await expect(page.goto(path), path).rejects.toThrow(/ERR_INTERNET_DISCONNECTED/);
  }

  // Non-navigation API requests are never answered from a cache either
  // (issued from a fresh, controlled application page in the same context;
  // the failed navigations above left the browser's error page in this one).
  const appPage = await context.newPage();
  const shell = await appPage.goto("/sign-in");
  expect(shell?.fromServiceWorker()).toBe(true);
  const apiResult = await appPage.evaluate(async () => {
    try {
      await fetch("/api/v1/categories");
      return "answered";
    } catch {
      return "network-error";
    }
  });
  expect(apiResult).toBe("network-error");
});
