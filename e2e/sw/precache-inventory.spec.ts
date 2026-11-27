import { test, expect, type Page } from "@playwright/test";

/**
 * M06-T02 Increment 2 — the complete application-shell precache and the
 * actual Cache Storage contents (Specification 6 v1.1 OFF-SW-1, OFF-SW-3,
 * AC-27). "chromium-sw" project, real production build and server.
 *
 * Representative API, authentication, health, shared-trip, and static
 * requests are made through the controlled page BEFORE Cache Storage is
 * inspected, so any accidental runtime caching would be detected. The
 * generated worker scripts (sw.js and the Workbox runtime) are not shell
 * entries and must not be precached.
 */

const SYNTHETIC_SHARE_TOKEN = `${"A".repeat(21)}_${"z".repeat(21)}`; // syntactically valid, never issued
const MISSING_LANDMARK_ID = "00000000-0000-4000-8000-000000000000";

const APPROVED_SHELL_ENTRY = [
  /^\/index\.html$/,
  /^\/assets\/index-[\w-]+\.(?:js|css)$/,
  /^\/assets\/workbox-window\.prod\.es5-[\w-]+\.js$/,
  /^\/icons\/(?:icon\.svg|icon-192\.png|icon-512\.png|icon-maskable-512\.png|apple-touch-icon\.png)$/,
  /^\/manifest\.webmanifest$/,
];

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

test("Cache Storage holds exactly the generated shell precache, even after API, auth, health, and shared-trip requests", async ({
  page,
  request,
}) => {
  await installAndControl(page);

  // Representative requests through the controlled page (fetches, not navigations).
  const statuses = await page.evaluate(
    async ({ token, landmark }) => {
      const paths = [
        "/api/v1/categories",
        "/api/v1/landmarks?limit=1",
        `/api/v1/landmarks/${landmark}`,
        "/api/auth/get-session",
        "/health",
        `/api/v1/shared/trips/${token}`,
        "/manifest.webmanifest",
        "/sw.js",
      ];
      const result: Record<string, number> = {};
      for (const path of paths)
        result[path] = (await fetch(path, { credentials: "same-origin" })).status;
      return result;
    },
    { token: SYNTHETIC_SHARE_TOKEN, landmark: MISSING_LANDMARK_ID },
  );
  expect(statuses["/api/v1/categories"]).toBe(200);
  expect(statuses["/health"]).toBe(200);
  expect(statuses[`/api/v1/shared/trips/${SYNTHETIC_SHARE_TOKEN}`]).toBe(404);
  expect(statuses[`/api/v1/landmarks/${MISSING_LANDMARK_ID}`]).toBe(404);

  // The generated precache manifest, read from the served worker.
  const workerSource = await (await request.get("/sw.js")).text();
  const generated = [...workerSource.matchAll(/url:"([^"]+)"/g)].map((m) => `/${m[1]}`).sort();
  expect(new Set(generated).size).toBe(generated.length);

  const storage = await page.evaluate(async () => {
    const names = await caches.keys();
    const entries: Record<string, string[]> = {};
    for (const name of names) {
      const cache = await caches.open(name);
      entries[name] = (await cache.keys()).map((r) => r.url);
    }
    return entries;
  });

  // Exactly one cache: the versioned precache. No runtime cache exists.
  const names = Object.keys(storage);
  expect(names).toEqual(["hidden-tennessee-precache-v2-http://localhost:3000/"]);

  const stored = storage[names[0]!]!.map((url) => {
    const parsed = new URL(url);
    expect(parsed.origin, url).toBe("http://localhost:3000");
    const params = [...parsed.searchParams.keys()];
    expect(
      params.every((p) => p === "__WB_REVISION__"),
      url,
    ).toBe(true);
    return parsed.pathname;
  });
  // The actual Cache Storage contents equal the generated precache manifest...
  expect([...stored].sort()).toEqual(generated);
  // ...every entry belongs to an approved application-shell category...
  for (const path of stored) {
    expect(
      APPROVED_SHELL_ENTRY.some((pattern) => pattern.test(path)),
      `unapproved entry ${path}`,
    ).toBe(true);
  }
  // ...the required shell files are present (the current hashed bundles from index.html)...
  const html = await (await request.get("/")).text();
  const required = [
    "/index.html",
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-maskable-512.png",
    "/icons/apple-touch-icon.png",
    "/icons/icon.svg",
    html.match(/src="(\/assets\/index-[\w-]+\.js)"/)![1]!,
    html.match(/href="(\/assets\/index-[\w-]+\.css)"/)![1]!,
  ];
  for (const path of required) expect(stored, path).toContain(path);
  expect(stored.some((p) => /^\/assets\/workbox-window\.prod\.es5-[\w-]+\.js$/.test(p))).toBe(true);
  // ...and nothing that is not part of the shell was stored.
  for (const path of stored) {
    expect(path).not.toMatch(/^\/(?:api|health|shared)(?:\/|$)/i);
    expect(path).not.toMatch(/^\/(?:sw\.js|workbox-[\w-]+\.js)$/);
    expect(path).not.toMatch(/\.map$/);
  }
});
