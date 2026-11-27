import { test, expect, type Page } from "@playwright/test";

/**
 * M06-T02 Increment 2 — application-owned registration, installation,
 * control, and the offline application shell (Specification 6 v1.1 OFF-SW-1,
 * OFF-SW-2, AC-27). "chromium-sw" project: service workers allowed, real
 * production build and Express server. Each test has its own browser context,
 * so registrations and caches never leak between tests.
 *
 * Readiness is established deterministically: `navigator.serviceWorker.ready`
 * (an active worker), then a reload, then polling until the page is
 * controlled. No fixed sleeps.
 */

const APP_HEADING = { name: "Tennessee Natural Landmarks Explorer" };
const MISSING_LANDMARK = "/landmarks/00000000-0000-4000-8000-000000000000";

async function installAndControl(page: Page, path = "/sign-in") {
  await page.goto(path);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

test("the application registers one worker, which installs, activates, and controls the page after a reload", async ({
  page,
}) => {
  // The page never loads the plugin's injected registration script; the
  // worker's own script fetch is made by the browser (not visible as a page
  // request) and is verified through the active worker's scriptURL below.
  const injectedRegisterRequests: string[] = [];
  page.on("request", (req) => {
    if (new URL(req.url()).pathname === "/registerSW.js") injectedRegisterRequests.push(req.url());
  });
  // Full document loads only (same-document URL updates by the router are not reloads).
  let documentLoads = 0;
  page.on("domcontentloaded", () => {
    documentLoads += 1;
  });

  await page.goto("/sign-in");
  await expect(page.getByRole("heading", APP_HEADING)).toBeVisible();

  // Registered and activated by the application (after the load event)...
  const registration = await page.evaluate(async () => {
    const ready = await navigator.serviceWorker.ready;
    return {
      scope: ready.scope,
      script: ready.active ? new URL(ready.active.scriptURL).pathname : null,
    };
  });
  expect(registration).toEqual({ scope: "http://localhost:3000/", script: "/sw.js" });
  await expect
    .poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
    .toBe("activated");
  // ...but it does not claim the page that registered it (no clientsClaim).
  expect(await page.evaluate(() => navigator.serviceWorker.controller)).toBeNull();

  // After an explicit reload the page is controlled.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null))
    .toBe("http://localhost:3000/sw.js");

  // Navigating further never creates a second registration.
  await page.goto("/register");
  await page.goto("/sign-in");
  await page.waitForLoadState("networkidle");
  expect(
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length),
  ).toBe(1);

  // Exactly the four document loads made above: nothing reloaded the page by itself.
  expect(documentLoads).toBe(4);
  expect(injectedRegisterRequests).toEqual([]);
});

test("offline, a reload is served the precached shell, its assets load, and in-app navigation works", async ({
  page,
  context,
}) => {
  await installAndControl(page);
  await context.setOffline(true);

  const reloaded = await page.reload();
  expect(reloaded?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", APP_HEADING)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sign in", level: 2 })).toBeVisible();

  // The precached hashed JavaScript ran (the app rendered) and the stylesheet applied.
  const assets = await page.evaluate(() => ({
    script: [...document.scripts].some((s) => /\/assets\/index-[\w-]+\.js$/.test(s.src)),
    stylesheet: [...document.styleSheets].some(
      (s) => /\/assets\/index-[\w-]+\.css$/.test(s.href ?? "") && s.cssRules.length > 0,
    ),
  }));
  expect(assets).toEqual({ script: true, stylesheet: true });

  // Client-side navigation within the running application.
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page).toHaveURL(/\/register$/);
  await expect(page.getByRole("heading", { name: "Create an account", level: 2 })).toBeVisible();

  // A fresh navigation to another application route uses the navigation fallback.
  const navigated = await page.goto("/forgot-password");
  expect(navigated?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("heading", { name: "Reset your password", level: 2 })).toBeVisible();
});

test("offline, a data-dependent route shows its existing network-failure state, not 'unavailable' or an empty result", async ({
  page,
  context,
}) => {
  await installAndControl(page);
  await context.setOffline(true);

  const response = await page.goto(MISSING_LANDMARK);
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  await expect(page.getByText("Landmark unavailable")).toHaveCount(0);
  await expect(page.getByText("This landmark is no longer available in the explorer.")).toHaveCount(
    0,
  );
});
