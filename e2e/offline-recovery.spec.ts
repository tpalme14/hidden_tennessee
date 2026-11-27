import AxeBuilder from "@axe-core/playwright";
import { test, expect, type APIRequestContext, type Page } from "@playwright/test";
import {
  closeBlockingConnection,
  injectStorageFaults,
  openBlockingConnection,
  readOfflineState,
  seedFailureRecord,
  seedResidualLandmark,
} from "./helpers/offlineState";

/**
 * M06-T03 Increment 3c-2 — real-browser verification of the recovery and
 * explanation interface (Specification 6 OFF-LIFE-9, OFF-OUT-3/5/9,
 * OFF-FAIL-3–6, §12.18; AC-4, AC-6, AC-10, AC-29 (new page), AC-32, AC-34,
 * AC-40, AC-41).
 *
 * REAL: the production build and production-mode server on `landmarks_test`,
 * the application's own flows and recovery operations, Chromium Web Locks,
 * IndexedDB, BroadcastChannel, and localStorage, across pages of one context.
 *
 * INSTRUMENTED, stated in each scenario:
 * - storage faults injected into ONE page by init scripts (`injectStorageFaults`);
 * - a failure record or a saved copy seeded under the application's own lock
 *   (no snapshots are saved before 3d);
 * - a raw test connection that ignores `versionchange`, to block a deletion;
 * - a 503 sign-out response by `page.route`.
 *
 * Synchronization uses bounded polling of observable state; no fixed delays.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "e2e offline-recovery password";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const SAFETY_LOCK_NOTICE = "offline data protection is turned on after a storage problem";
const SITE_DATA = "Removing this site's data in your browser's settings is the only way";
const REMOVED = "Offline copies saved on this device were removed.";
const NOT_REMOVED = "Some offline copies on this device couldn't be removed.";
const CONFIRMED = "You're signed out. The server confirmed the sign-out.";
const PENDING_NOTICE = "the server sign-out isn't confirmed";

const pathOf = (url: string) => new URL(url).pathname;
const accountArea = (page: Page) => page.getByRole("navigation", { name: "Account" }).locator("..");
const recoveryPage = (page: Page) =>
  page.getByRole("region", { name: "Offline data on this device" });
const signInForm = (page: Page) => page.getByRole("region", { name: "Sign in" });

async function createAccount(request: APIRequestContext, label: string): Promise<string> {
  const email = `e2e-recov-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const response = await request.post("/api/auth/sign-up/email", {
    headers: { Origin: ORIGIN },
    data: { name: "", email, password: PASSWORD },
  });
  expect(response.status()).toBe(200);
  return email;
}

async function signIn(page: Page, email: string) {
  await page.goto("/sign-in");
  await signInForm(page).getByLabel("Email address").fill(email);
  await signInForm(page).getByLabel("Password").fill(PASSWORD);
  await signInForm(page).getByRole("button", { name: "Sign in" }).click();
  await expect(accountArea(page)).toContainText(`Signed in as ${email}`);
  await expect.poll(async () => (await readOfflineState(page)).marker).not.toBeNull();
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("link", { name: "Sign in" })).toBeVisible();
}

async function scan(page: Page, state: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(blocking, `serious/critical axe violations in "${state}"`).toEqual([]);
}

test.describe("3c-2 real-browser recovery verification", () => {
  test("(r1) AC-32, AC-41: a sign-out whose intent can't be stored sets D22; it holds across tabs, reloads, Finish signing out, and Delete all", async ({
    context,
  }) => {
    const a = await context.newPage();
    await injectStorageFaults(a, ["state-put"]); // INSTRUMENTED: tab A cannot write the state store
    const email = await createAccount(a.request, "d22");
    await signIn(a, email);
    const b = await context.newPage();
    await b.goto("/");
    await expect(accountArea(b)).toContainText(`Signed in as ${email}`);

    await signOut(a);
    await expect(accountArea(a)).toContainText(SAFETY_LOCK_NOTICE);
    expect((await readOfflineState(a)).safetyLock).toBe("true");
    // The other tab is told (lock-set) and re-inspects: locked out too.
    await expect(accountArea(b)).toContainText(SAFETY_LOCK_NOTICE);
    await expect(b.getByRole("button", { name: "Sign out" })).toHaveCount(0);

    // After reload, sign-in sends no credentials.
    await b.reload();
    await expect(accountArea(b)).toContainText(SAFETY_LOCK_NOTICE);
    const signIns: string[] = [];
    b.on("request", (r) => {
      if (pathOf(r.url()) === "/api/auth/sign-in/email") signIns.push(r.url());
    });
    await b.goto("/sign-in");
    await signInForm(b).getByLabel("Email address").fill(email);
    await signInForm(b).getByLabel("Password").fill(PASSWORD);
    await signInForm(b).getByLabel("Password").press("Enter");
    await expect(signInForm(b).getByRole("button", { name: "Sign in" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(signIns).toEqual([]);

    // A tab whose IndexedDB works ("IndexedDB reopened"): still locked; nothing clears D22.
    const c = await context.newPage();
    await c.goto("/offline-data");
    await expect(recoveryPage(c)).toContainText(SITE_DATA);
    await expect(recoveryPage(c)).toContainText("The app can't turn it off.");
    await scan(c, "offline-data: safety lock");
    await recoveryPage(c).getByRole("button", { name: "Finish signing out" }).click();
    await expect(recoveryPage(c).getByRole("status")).toContainText(/sign-out|nothing left/);
    expect((await readOfflineState(c)).safetyLock).toBe("true");
    await recoveryPage(c)
      .getByRole("button", { name: "Delete all offline data on this device" })
      .click();
    await recoveryPage(c).getByRole("button", { name: "Delete offline data" }).click();
    await expect(recoveryPage(c).getByRole("status")).toContainText(
      "All offline data on this device was deleted.",
    );
    await c.reload();
    expect((await readOfflineState(c)).safetyLock).toBe("true");
    await expect(accountArea(c)).toContainText(SAFETY_LOCK_NOTICE);
  });

  test("(r2) AC-32: when neither the intent nor D22 can be stored, the page says durable protection could not be confirmed", async ({
    page,
  }) => {
    // INSTRUMENTED: the state store and localStorage writes both fail in this page.
    await injectStorageFaults(page, ["state-put", "local-storage-set"]);
    const email = await createAccount(page.request, "memory");
    await signIn(page, email);
    await signOut(page);
    await expect(page.getByRole("alert")).toContainText(
      "protection after this page is closed or reloaded could not be confirmed",
    );
    expect((await readOfflineState(page)).safetyLock).toBeNull(); // truthfully not durable
  });

  test("(r3) AC-4: a deletion blocked by another open connection is reported as waiting, then completes; server data is unchanged", async ({
    context,
  }) => {
    const a = await context.newPage();
    const email = await createAccount(a.request, "blocked");
    await signIn(a, email);
    const created = await a.request.post("/api/v1/trips", {
      headers: { Origin: ORIGIN },
      data: { name: "Recovery check trip" },
    });
    expect(created.status()).toBe(201);
    const tripsBefore = await (await a.request.get("/api/v1/trips?page=1&limit=50")).json();
    await seedResidualLandmark(a, (await readOfflineState(a)).marker!); // INSTRUMENTED saved copy

    const b = await context.newPage();
    await b.goto("/");
    await openBlockingConnection(b); // INSTRUMENTED: ignores versionchange

    await a.goto("/offline-data");
    await recoveryPage(a)
      .getByRole("button", { name: "Delete all offline data on this device" })
      .click();
    await recoveryPage(a).getByRole("button", { name: "Delete offline data" }).click();
    await expect(recoveryPage(a).getByRole("status")).toContainText("Close the app's other tabs");
    await expect(recoveryPage(a).getByText(/was deleted/)).toHaveCount(0);

    await closeBlockingConnection(b);
    await expect(recoveryPage(a).getByRole("status")).toContainText(
      "All offline data on this device was deleted.",
    );
    expect((await readOfflineState(a)).landmarks).toBe(0);
    const tripsAfter = await (await a.request.get("/api/v1/trips?page=1&limit=50")).json();
    expect(tripsAfter).toEqual(tripsBefore);
  });

  test("(r4) AC-40: local failure recovery asks for consent; declining removes nothing; accepting recovers and offline access returns through the session check", async ({
    page,
  }) => {
    const email = await createAccount(page.request, "recover");
    await signIn(page, email);
    const old = (await readOfflineState(page)).marker!;
    await seedResidualLandmark(page, old); // INSTRUMENTED saved copy
    await seedFailureRecord(page); // INSTRUMENTED failure record
    await page.reload();
    await expect(accountArea(page)).toContainText(`Signed in as ${email}`);
    await accountArea(page).getByRole("link", { name: "Offline data on this device" }).click();
    await expect(recoveryPage(page)).toContainText("Offline copies on this device are locked.");

    const recover = recoveryPage(page).getByRole("button", { name: "Recover offline storage" });
    await recover.click();
    const consent = recoveryPage(page).getByRole("group", {
      name: "Remove saved offline copies to recover?",
    });
    await expect(consent).toBeFocused();
    await scan(page, "offline-data: recovery consent");
    await consent.getByRole("button", { name: "Cancel" }).click();
    await expect(recoveryPage(page).getByRole("status")).toContainText("Nothing was removed.");
    let state = await readOfflineState(page);
    expect(state.failure).not.toBeNull();
    expect(state.landmarks).toBe(1);

    await recover.click();
    await consent.getByRole("button", { name: "Remove and recover" }).click();
    await expect(recoveryPage(page).getByRole("status")).toContainText(
      "Offline storage was recovered.",
    );
    state = await readOfflineState(page);
    expect(state.failure).toBeNull();
    expect(state.landmarks).toBe(0);
    await expect
      .poll(async () => (await readOfflineState(page)).marker?.lifecycle_id)
      .not.toBe(old.lifecycle_id);
    await expect(recoveryPage(page)).toContainText(
      "Offline copies are available for your account on this device.",
    );
  });

  test("(r5) AC-10: a confirmed sign-out whose cleanup failed discloses both separately and the recovery is offered and works", async ({
    context,
  }) => {
    const a = await context.newPage();
    await injectStorageFaults(a, ["data-clear"]); // INSTRUMENTED: cleanup cannot clear in tab A
    const email = await createAccount(a.request, "cleanup-fail");
    await signIn(a, email);
    await seedResidualLandmark(a, (await readOfflineState(a)).marker!); // INSTRUMENTED saved copy
    await signOut(a);
    await expect(accountArea(a)).toContainText(CONFIRMED);
    await expect(accountArea(a)).toContainText(NOT_REMOVED);
    expect((await readOfflineState(a)).failure).toMatchObject({ kind: "cleanup" });

    const c = await context.newPage(); // no injected faults
    await c.goto("/offline-data");
    await recoveryPage(c).getByRole("button", { name: "Recover offline storage" }).click();
    await recoveryPage(c).getByRole("button", { name: "Remove and recover" }).click();
    await expect(recoveryPage(c).getByRole("status")).toContainText(
      "Offline storage was recovered.",
    );
    const state = await readOfflineState(c);
    expect(state.failure).toBeNull();
    expect(state.landmarks).toBe(0);
  });

  test("(r6) AC-6: after a reload, a pending sign-out shows its cleanup status beside Finish signing out", async ({
    page,
  }) => {
    const email = await createAccount(page.request, "reload-cleanup");
    await signIn(page, email);
    // INSTRUMENTED: the server sign-out fails (503).
    await page.route("**/api/auth/sign-out", (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "x" } },
      }),
    );
    await signOut(page);
    await page.reload();
    await expect(accountArea(page)).toContainText(PENDING_NOTICE);
    await expect(accountArea(page)).toContainText(REMOVED);
    await expect(page.getByRole("button", { name: "Finish signing out" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Offline data on this device" })).toBeVisible();
  });

  test("(a11y) the recovery page for a visitor with nothing stored: no action needed, no database created", async ({
    page,
  }) => {
    await page.goto("/offline-data");
    await expect(recoveryPage(page)).toContainText("Nothing on this device needs to be recovered.");
    await scan(page, "offline-data: clean");
    expect((await readOfflineState(page)).databases).toEqual([]);
  });
});
