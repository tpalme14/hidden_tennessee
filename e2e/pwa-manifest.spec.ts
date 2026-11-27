import { test, expect, type APIResponse } from "@playwright/test";

/**
 * M06-T02 Increments 1b and 2 — PWA build (Specification 6 v1.0 §3.1 and
 * v1.1 §12.10; ADR-008). Runs in the regression project ("chromium", service
 * workers BLOCKED) against the real production build and Express server.
 *
 * Verifies the generated web app manifest, the icons, and the generated
 * service-worker files; that the HTML carries no plugin-injected registration
 * (the application registers the worker itself — see e2e/sw/shell-offline);
 * and that the application works normally where service workers cannot be
 * used. Manifest validity and installability PREREQUISITES are checked here;
 * actual browser installation is not, and nothing here claims it.
 *
 * Increment 2 transition: the Increment 1b test "loading and navigating the
 * application registers no service worker" was an implementation-stage
 * invariant (the worker was built but deliberately unregistered). It is
 * replaced by "with service workers blocked, the application loads and
 * navigates normally without a registration"; successful registration is
 * verified with service workers allowed in e2e/sw/shell-offline.spec.ts.
 */

const MANIFEST_PATH = "/manifest.webmanifest";

const APPROVED_MANIFEST = {
  name: "Tennessee Natural Landmarks Explorer",
  short_name: "TN Landmarks",
  description: "Discover lesser-known natural landmarks in Tennessee.",
  id: "/",
  start_url: "/",
  scope: "/",
  display: "standalone",
  lang: "en",
  theme_color: "#ffffff",
  background_color: "#ffffff",
};

const APPROVED_ICONS = [
  { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
  { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
  { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
];

/** Width and height from a PNG's IHDR chunk (bytes 16–23), after checking the signature. */
async function pngSize(response: APIResponse): Promise<{ width: number; height: number }> {
  const body = await response.body();
  expect(body.subarray(0, 8).toString("hex"), "PNG signature").toBe("89504e470d0a1a0a");
  return { width: body.readUInt32BE(16), height: body.readUInt32BE(20) };
}

test.describe("PWA manifest and build foundation", () => {
  test("the application HTML links the manifest, theme colour, and Apple touch icon, with no registration code", async ({
    request,
  }) => {
    const response = await request.get("/");
    expect(response.status()).toBe(200);
    const html = await response.text();
    expect(html).toContain(`<link rel="manifest" href="${MANIFEST_PATH}">`);
    expect(html).toContain('<meta name="theme-color" content="#ffffff" />');
    expect(html).toContain('<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />');
    // Unrelated existing head content is preserved.
    expect(html).toContain('<meta name="referrer" content="strict-origin" />');
    // No injected registration of any kind (inline call, registerSW.js script, or plugin markers).
    expect(html).not.toMatch(/serviceWorker|registerSW|vite-plugin-pwa/);
  });

  test("the manifest is served as a web app manifest with exactly the approved fields and icons", async ({
    request,
  }) => {
    const response = await request.get(MANIFEST_PATH);
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toMatch(/^application\/manifest\+json/);
    const manifest = JSON.parse(await response.text()) as Record<string, unknown>;
    expect(manifest).toEqual({ ...APPROVED_MANIFEST, icons: APPROVED_ICONS });
    const purposes = (manifest.icons as { purpose: string }[]).map((icon) => icon.purpose);
    expect(purposes).toContain("any");
    expect(purposes).toContain("maskable");
  });

  test("every manifest icon and the Apple touch icon exist as PNGs of their declared size", async ({
    request,
  }) => {
    for (const icon of APPROVED_ICONS) {
      const response = await request.get(icon.src);
      expect(response.status(), icon.src).toBe(200);
      expect(response.headers()["content-type"], icon.src).toBe("image/png");
      const [width, height] = icon.sizes.split("x").map(Number);
      expect(await pngSize(response), icon.src).toEqual({ width, height });
    }
    const apple = await request.get("/icons/apple-touch-icon.png");
    expect(apple.status()).toBe(200);
    expect(apple.headers()["content-type"]).toBe("image/png");
    expect(await pngSize(apple)).toEqual({ width: 180, height: 180 });
    const svg = await request.get("/icons/icon.svg");
    expect(svg.status()).toBe(200);
    expect(svg.headers()["content-type"]).toMatch(/^image\/svg\+xml/);
  });

  test("the generated service worker and its Workbox runtime are served as JavaScript, with only the shell precache and navigation fallback", async ({
    request,
  }) => {
    const sw = await request.get("/sw.js");
    expect(sw.status()).toBe(200);
    expect(sw.headers()["content-type"]).toMatch(/javascript/);
    const source = await sw.text();

    // The generated worker loads exactly one Workbox runtime file next to it.
    const runtime = source.match(/"\.\/(workbox-[0-9a-f]+)"/);
    expect(runtime, "Workbox runtime reference in sw.js").not.toBeNull();
    const workbox = await request.get(`/${runtime![1]}.js`);
    expect(workbox.status()).toBe(200);
    expect(workbox.headers()["content-type"]).toMatch(/javascript/);

    // Explicit-update support, and exactly one route besides the precache: the
    // navigation fallback to the precached shell, with its exclusions
    // (Increment 2). No runtime caching route of any kind.
    expect(source).toContain('"SKIP_WAITING"===e.data.type&&self.skipWaiting()');
    expect(source.match(/registerRoute\(/g) ?? []).toHaveLength(1);
    expect(source).toContain(
      'registerRoute(new e.NavigationRoute(e.createHandlerBoundToURL("index.html"),{denylist:[',
    );
    expect(source).not.toMatch(
      /CacheFirst|NetworkFirst|StaleWhileRevalidate|NetworkOnly|runtimeCaching/,
    );

    // Every precache entry belongs to an approved application-shell category.
    const urls = [...source.matchAll(/url:"([^"]+)"/g)].map((m) => m[1]);
    expect(urls.length).toBeGreaterThan(0);
    const allowed = [
      /^index\.html$/,
      /^assets\/index-[\w-]+\.(?:js|css)$/,
      /^assets\/workbox-window\.prod\.es5-[\w-]+\.js$/,
      /^icons\/[\w-]+\.(?:png|svg)$/,
      /^manifest\.webmanifest$/,
    ];
    for (const url of urls) {
      expect(
        allowed.some((pattern) => pattern.test(url)),
        `unexpected precache entry: ${url}`,
      ).toBe(true);
    }
    expect(new Set(urls).size, "no duplicate precache entries").toBe(urls.length);
  });

  test("a missing PWA infrastructure file is still a JSON 404 on the real server (Increment 1a)", async ({
    request,
  }) => {
    const response = await request.get("/workbox-missing.js");
    expect(response.status()).toBe(404);
    expect(response.headers()["content-type"]).toMatch(/application\/json/);
    expect(await response.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Resource not found." },
    });
  });

  test("with service workers blocked, the application loads and navigates normally without a registration", async ({
    page,
  }) => {
    // This project blocks service workers (playwright.config.ts). The
    // application still attempts its own registration; it must fail quietly
    // and never affect ordinary use. (A browser WITHOUT the service-worker API
    // is a different case, covered by e2e/sw/unsupported.spec.ts.)
    expect(test.info().project.use.serviceWorkers).toBe("block");
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    // Map tiles are external and irrelevant here (same approach as the other specs).
    await page.route(/tile\.openstreetmap\.org/, (route) => route.fulfill({ status: 204 }));

    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Tennessee Natural Landmarks Explorer" }),
    ).toBeVisible();
    await page.waitForLoadState("networkidle");
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in", level: 2 })).toBeVisible();
    await page.waitForLoadState("networkidle");

    const state = await page.evaluate(async () => ({
      registrations:
        "serviceWorker" in navigator
          ? (await navigator.serviceWorker.getRegistrations()).map((r) => r.scope)
          : [],
      controlled: "serviceWorker" in navigator && navigator.serviceWorker.controller !== null,
    }));
    expect(state.registrations).toEqual([]);
    expect(state.controlled).toBe(false);
    expect(pageErrors).toEqual([]);
  });
});
