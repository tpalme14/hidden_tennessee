import { test, expect } from "@playwright/test";

/**
 * M06-T02 Increment 2 — a browser WITHOUT the service-worker API
 * (Specification 6 §3.1, OFF-SW-1). Distinct from Playwright's
 * `serviceWorkers: "block"` (used by the regression project, where the API
 * exists but registration is blocked): here the API itself is removed before
 * any application script runs, so the application's capability check must
 * skip registration and everything else must work normally.
 */

test("without the service-worker API the application skips registration and works normally", async ({
  page,
  context,
}) => {
  await page.addInitScript(() => {
    delete (Navigator.prototype as unknown as Record<string, unknown>).serviceWorker;
  });
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  const workerRequests: string[] = [];
  page.on("request", (req) => {
    const { pathname } = new URL(req.url());
    if (pathname === "/sw.js" || /^\/assets\/workbox-window/.test(pathname)) {
      workerRequests.push(pathname);
    }
  });

  await page.goto("/sign-in");
  await expect(
    page.getByRole("heading", { name: "Tennessee Natural Landmarks Explorer" }),
  ).toBeVisible();
  expect(await page.evaluate(() => "serviceWorker" in navigator)).toBe(false);

  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.getByRole("heading", { name: "Create an account", level: 2 })).toBeVisible();
  await page.goto("/forgot-password");
  await expect(page.getByRole("heading", { name: "Reset your password", level: 2 })).toBeVisible();
  await page.waitForLoadState("networkidle");

  expect(workerRequests).toEqual([]);
  expect(context.serviceWorkers()).toEqual([]);
  expect(pageErrors).toEqual([]);
});
