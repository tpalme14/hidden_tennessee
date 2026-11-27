import type { Page, Route } from "@playwright/test";
import { readOfflineState } from "./helpers/offlineState";
import { expect, test } from "./helpers/tripFixtures";

/**
 * M06-T05 — milestone verification: interrupted snapshot saves and refreshes
 * and their recovery ("chromium" project). M06-T05 scope: "interrupted
 * downloads" means interrupted snapshot saves and refreshes (map-region
 * downloads are deferred with FR-14). Specification 6 AC-18, AC-24 (no false
 * success), OFF-UX-5 (nothing queued or retried), AC-26.
 *
 * REAL: production build and server on `landmarks_test`, guarded fixtures, the
 * application's own flows and storage. INSTRUMENTED: the one landmark read the
 * save or refresh makes is aborted by `page.route` (a dropped connection),
 * after the profile itself has loaded; map tiles are served a 1×1 PNG.
 */

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const INTERRUPTED = "Couldn't reach the server. Your saved copy hasn't changed.";

async function noTiles(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
}

test("(m1) [instrumented: dropped connection] an interrupted save and an interrupted refresh claim nothing, change nothing, retry nothing, and recover only by explicit action", async ({
  page,
  trips,
}) => {
  await noTiles(page);
  const email = await trips.signUpAndIn(page.request);
  await page.goto(`/landmarks/${trips.public.id}`);
  await expect(page.getByText(`Signed in as ${email}`)).toBeVisible();
  await expect.poll(async () => (await readOfflineState(page)).marker).not.toBeNull();
  const group = page.getByRole("group", { name: `Offline copy of ${trips.public.displayName}` });
  const save = group.getByRole("button", { name: "Save for offline" });
  await expect(save).toBeVisible();

  const itemPath = `/api/v1/landmarks/${trips.public.id}`;
  const aborted: string[] = [];
  const dropConnection = (route: Route) => {
    aborted.push(new URL(route.request().url()).pathname);
    return route.abort("internetdisconnected");
  };
  const reads: string[] = [];
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === itemPath) reads.push(itemPath);
  });

  // 1. Interrupted save: no false success, nothing stored, nothing queued.
  await page.route(`**${itemPath}`, dropConnection);
  await save.click();
  await expect(group.getByRole("alert")).toHaveText(INTERRUPTED);
  expect(aborted).toEqual([itemPath]); // the interruption really happened
  await expect(group.getByText("Not saved for offline.")).toBeVisible();
  expect((await readOfflineState(page)).landmarks).toBe(0);
  // The failed request is evidence the server can't be reached: Save is now refused with a reason.
  await expect(save).toHaveAttribute("aria-disabled", "true");

  // 2. Recovery is explicit: the connection returns, the user checks it, then saves.
  await page.unroute(`**${itemPath}`, dropConnection);
  const readsBeforeRecovery = reads.length;
  await page.getByRole("button", { name: /check(ing)? connection/i }).click();
  await expect(save).not.toHaveAttribute("aria-disabled", "true");
  expect(reads.length, "nothing was retried automatically").toBe(readsBeforeRecovery);
  await save.click();
  await expect(group.getByRole("status")).toContainText("Saved for offline.");
  expect((await readOfflineState(page)).landmarks).toBe(1);

  // 3. Interrupted refresh: the saved copy is unchanged and still shown.
  await page.goto(`/offline/landmarks/${trips.public.id}`);
  const copy = page.getByRole("group", { name: `Offline copy of ${trips.public.displayName}` });
  const synced = await page
    .getByText(/Last synced about/)
    .first()
    .innerText();
  await page.route(`**${itemPath}`, dropConnection);
  await copy.getByRole("button", { name: "Refresh offline copy" }).click();
  await expect(copy.getByRole("alert")).toHaveText(INTERRUPTED);
  expect(aborted).toEqual([itemPath, itemPath]);
  await expect(page.getByRole("heading", { name: trips.public.displayName })).toBeVisible();
  await expect(page.getByText(/Latitude/)).toBeVisible();
  expect(
    await page
      .getByText(/Last synced about/)
      .first()
      .innerText(),
  ).toBe(synced);
  expect((await readOfflineState(page)).landmarks).toBe(1);

  // 4. Recovery: explicit check, then an explicit refresh succeeds.
  await page.unroute(`**${itemPath}`, dropConnection);
  await page.getByRole("button", { name: /check(ing)? connection/i }).click();
  await copy.getByRole("button", { name: "Refresh offline copy" }).click();
  await expect(copy.getByRole("status")).toContainText("The offline copy was refreshed.");
});
