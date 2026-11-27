import {
  test,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { lockQuery, readOfflineState, seedResidualLandmark } from "./helpers/offlineState";

/**
 * M06-T03 Increment 3c-1b — real-browser cross-tab verification of the
 * authentication integration (Specification 6 OFF-OUT-1–11, OFF-LIFE-2–8,
 * OFF-CONC-4; AC-2, AC-6, AC-7, AC-9, AC-11, AC-36; decisions U2, U4, U5, U7).
 *
 * REAL in every scenario: the production build and the production-mode server
 * on `landmarks_test`, the application's own sign-in, session-check, and
 * sign-out flows, Chromium's Web Locks, IndexedDB, BroadcastChannel, and the
 * session cookie shared by two pages of one browser context ("two tabs").
 *
 * INSTRUMENTED conditions, each stated where used:
 * - a sign-out request held (then passed through unchanged) or answered with a
 *   503 by `page.route`, to create an in-flight or failed server sign-out;
 * - an account switch or session revocation performed with direct requests to
 *   the real authentication API (as another tab or device would);
 * - one seeded offline record, because the application saves no snapshots yet (3d);
 * - Web Locks removed by an init script, for the compatibility scenario.
 *
 * Inspection is read-only (`helpers/offlineState.ts`). Synchronization uses
 * bounded polling of observable state (Web Locks queries, IndexedDB,
 * rendered text, request events); there are no fixed delays.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "e2e account-security password";
const SIGNED_OUT_CONFIRMED = "You're signed out. The server confirmed the sign-out.";
const NOT_CONFIRMED = "You're signed out on this device, but the server sign-out isn't confirmed.";
const PENDING_NOTICE = "the server sign-out isn't confirmed";
const NO_LOCKS_NOTICE = "can't coordinate sign-in safely between tabs";

const pathOf = (url: string) => new URL(url).pathname;
const accountNav = (page: Page) => page.getByRole("navigation", { name: "Account" });
const signInForm = (page: Page) => page.getByRole("region", { name: "Sign in" });

function uniqueEmail(label: string): string {
  return `e2e-acsec-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function createAccount(request: APIRequestContext, label: string): Promise<string> {
  const email = uniqueEmail(label);
  const response = await request.post("/api/auth/sign-up/email", {
    headers: { Origin: ORIGIN },
    data: { name: "", email, password: PASSWORD },
  });
  expect(response.status()).toBe(200);
  return email;
}

async function signInThroughUi(page: Page, email: string) {
  await page.goto("/sign-in");
  await signInForm(page).getByLabel("Email address").fill(email);
  await signInForm(page).getByLabel("Password").fill(PASSWORD);
  await signInForm(page).getByRole("button", { name: "Sign in" }).click();
}

async function expectSignedInAs(page: Page, email: string) {
  await expect(accountNav(page)).toContainText(`Signed in as ${email}`);
}

async function expectSignedOut(page: Page) {
  await expect(accountNav(page).getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
}

/** The server's view of this context's session cookie (a real request). */
async function serverSession(request: APIRequestContext) {
  const response = await request.get("/api/auth/get-session");
  expect(response.status()).toBe(200);
  return (await response.json()) as { user: { id: string; email: string } } | null;
}

/** Records authentication requests a page actually sends. */
function recordAuthRequests(page: Page, sink: string[]) {
  page.on("request", (request) => {
    const path = pathOf(request.url());
    if (path.startsWith("/api/auth/")) sink.push(`${request.method()} ${path}`);
  });
}

async function signedInPair(context: BrowserContext, label: string) {
  const a = await context.newPage();
  const email = await createAccount(a.request, label);
  await signInThroughUi(a, email);
  await expectSignedInAs(a, email);
  const b = await context.newPage();
  await b.goto("/");
  await expectSignedInAs(b, email);
  return { a, b, email };
}

test.describe("3c-1b real-browser cross-tab verification", () => {
  test("(a) AC-9: a second tab's sign-in is not sent until the first tab's sign-out operation completes; no security lock is held across the request", async ({
    context,
  }) => {
    const a = await context.newPage();
    const email = await createAccount(a.request, "ac9");
    await signInThroughUi(a, email);
    await expectSignedInAs(a, email);

    // INSTRUMENTED: A's real sign-out request is held, then passed through unchanged.
    const order: string[] = [];
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let reached!: () => void;
    const held = new Promise<void>((resolve) => (reached = resolve));
    await a.route("**/api/auth/sign-out", async (route) => {
      reached();
      await released;
      await route.continue();
    });
    a.on("requestfinished", (request) => {
      if (pathOf(request.url()) === "/api/auth/sign-out") order.push("sign-out finished");
    });

    await accountNav(a).getByRole("button", { name: "Sign out" }).click();
    await held;
    // Real Web Locks: A holds tnle-auth during its server request, and never
    // the security lock across it (DR-2).
    expect((await lockQuery(a)).held).toEqual(["tnle-auth"]);

    const b = await context.newPage();
    const bSignIns: string[] = [];
    b.on("request", (request) => {
      if (pathOf(request.url()) === "/api/auth/sign-in/email") {
        bSignIns.push(request.url());
        order.push("sign-in sent");
      }
    });
    await b.goto("/sign-in");
    await signInForm(b).getByLabel("Email address").fill(email);
    await signInForm(b).getByLabel("Password").fill(PASSWORD);
    await signInForm(b).getByRole("button", { name: "Sign in" }).click();
    // Deterministic point: B's startup check and its sign-in are both queued
    // behind A's real tnle-auth hold.
    await expect
      .poll(async () => (await lockQuery(b)).pending.filter((n) => n === "tnle-auth").length)
      .toBeGreaterThanOrEqual(2);
    expect(bSignIns, "no sign-in request while the sign-out request is in flight").toEqual([]);

    release();
    await expect(a.getByRole("status").filter({ hasText: SIGNED_OUT_CONFIRMED })).toBeVisible();
    await expectSignedInAs(b, email);
    expect(order).toEqual(["sign-out finished", "sign-in sent"]);
    // The delayed sign-out result did not alter the newer session or lifecycle.
    expect((await serverSession(b.request))?.user.email).toBe(email);
    const state = await readOfflineState(b);
    expect(state.marker?.account_id).toBe((await serverSession(b.request))?.user.id);
    expect(state.intent).toBeNull();
  });

  test("(b) AC-6, AC-7, OFF-OUT-4: a failed sign-out in one tab withdraws the other tab, survives a reload, and Finish signing out there confirms it", async ({
    context,
  }) => {
    const { a, b, email } = await signedInPair(context, "pending");
    const bAuth: string[] = [];
    recordAuthRequests(b, bAuth);

    // INSTRUMENTED: the server sign-out from A fails (503).
    let aSignOuts = 0;
    await a.route("**/api/auth/sign-out", (route) => {
      aSignOuts += 1;
      return route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "x" } },
      });
    });
    await accountNav(a).getByRole("button", { name: "Sign out" }).click();
    await expect(a.getByRole("alert")).toContainText(NOT_CONFIRMED);
    await expectSignedOut(a);

    // B: withdrawn by the real notice and the authoritative re-check; the still-
    // valid cookie does not restore it (OFF-OUT-4).
    await expectSignedOut(b);
    await expect(accountNav(b).locator("..")).toContainText(PENDING_NOTICE);
    const pending = await readOfflineState(b);
    expect(pending.intent?.pending).toBe(true);
    expect(pending.marker).toBeNull();
    expect((await serverSession(b.request))?.user.email).toBe(email);

    await b.reload();
    await expectSignedOut(b);
    const finish = b.getByRole("button", { name: "Finish signing out" });
    await expect(finish).toBeVisible();
    expect(bAuth.filter((r) => r.endsWith("/sign-out"))).toEqual([]); // nothing automatic
    expect(aSignOuts).toBe(1);
    // Unresolved: A still warns that the server sign-out isn't confirmed.
    await expect(a.getByRole("alert").filter({ hasText: NOT_CONFIRMED })).toBeVisible();

    await finish.click();
    await expect(b.getByRole("status").filter({ hasText: SIGNED_OUT_CONFIRMED })).toBeVisible();
    expect(bAuth.filter((r) => r.endsWith("/sign-out"))).toEqual(["POST /api/auth/sign-out"]);
    expect((await readOfflineState(b)).intent).toBeNull();
    expect(await serverSession(b.request)).toBeNull();
    // A re-inspects after B's notice: the pending restriction is gone there too,
    // and A's obsolete "not confirmed" warning is cleared (D-1) without A
    // claiming a confirmation of its own; A stays signed out.
    await expect(a.getByRole("button", { name: "Finish signing out" })).toHaveCount(0);
    await expect(a.getByText(NOT_CONFIRMED)).toHaveCount(0);
    await expect(a.getByText(SIGNED_OUT_CONFIRMED)).toHaveCount(0);
    await expectSignedOut(a);
  });

  test("(c) AC-2: reloads and other tabs keep the same lifecycle; only verified_at changes", async ({
    context,
  }) => {
    const a = await context.newPage();
    const email = await createAccount(a.request, "continuity");
    await signInThroughUi(a, email);
    await expectSignedInAs(a, email);
    await expect.poll(async () => (await readOfflineState(a)).marker).not.toBeNull();
    const first = (await readOfflineState(a)).marker!;

    await a.reload();
    await expectSignedInAs(a, email);
    await expect
      .poll(async () => (await readOfflineState(a)).marker?.verified_at)
      .not.toBe(first.verified_at);
    expect((await readOfflineState(a)).marker?.lifecycle_id).toBe(first.lifecycle_id);

    const b = await context.newPage();
    const second = (await readOfflineState(a)).marker!;
    await b.goto("/");
    await expectSignedInAs(b, email);
    await expect
      .poll(async () => (await readOfflineState(b)).marker?.verified_at)
      .not.toBe(second.verified_at);
    const third = (await readOfflineState(b)).marker!;
    expect(third.lifecycle_id).toBe(first.lifecycle_id);
    expect(third.account_id).toBe(first.account_id);
  });

  test("(d) OFF-LIFE-8: an account switch invalidates and cleans the old account's lifecycle before the new account's lifecycle exists", async ({
    context,
  }) => {
    const { a, b, email: first } = await signedInPair(context, "switch-a");
    const old = (await readOfflineState(a)).marker!;
    // INSTRUMENTED: one record of the current lifecycle (no snapshots exist before 3d).
    await seedResidualLandmark(a, old);
    expect((await readOfflineState(a)).landmarks).toBe(1);
    await b.close();

    // INSTRUMENTED: the shared cookie switches to another account through the
    // real authentication API (as another tab or device would).
    const second = await createAccount(a.request, "switch-b");
    const switched = await a.request.post("/api/auth/sign-in/email", {
      headers: { Origin: ORIGIN },
      data: { email: second, password: PASSWORD },
    });
    expect(switched.status()).toBe(200);
    const secondId = (await serverSession(a.request))!.user.id;

    const c = await context.newPage();
    await c.goto("/");
    await expectSignedInAs(c, second);
    await expect.poll(async () => (await readOfflineState(c)).marker?.account_id).toBe(secondId);
    const after = await readOfflineState(c);
    expect(after.marker?.lifecycle_id).not.toBe(old.lifecycle_id);
    expect(after.landmarks).toBe(0); // the old lifecycle's record was cleaned
    // A was told (lifecycle-ended), re-checked, and now shows the new account.
    await expectSignedInAs(a, second);
    expect(first).not.toBe(second);
  });

  test("(e) AC-11, OFF-OUT-8: a confirmed absence of the session invalidates and cleans the lifecycle without any sign-out request", async ({
    context,
    browser,
  }) => {
    const a = await context.newPage();
    const aAuth: string[] = [];
    recordAuthRequests(a, aAuth);
    const email = await createAccount(a.request, "absent");
    await signInThroughUi(a, email);
    await expectSignedInAs(a, email);
    const marker = (await readOfflineState(a)).marker!;
    await seedResidualLandmark(a, marker); // INSTRUMENTED (see above)

    // INSTRUMENTED: the session is revoked on the server from another context.
    const other = await browser.newContext({ baseURL: ORIGIN });
    await other.addCookies(await context.cookies());
    const revoke = await other.request.post("/api/auth/sign-out", {
      headers: { Origin: ORIGIN },
      data: {},
    });
    expect(await revoke.json()).toEqual({ success: true });
    await other.close();

    await a.reload();
    await expectSignedOut(a);
    await expect.poll(async () => (await readOfflineState(a)).marker).toBeNull();
    const after = await readOfflineState(a);
    expect(after.landmarks).toBe(0);
    expect(after.intent).toBeNull();
    expect(after.safetyLock).toBeNull();
    expect(aAuth.filter((r) => r.endsWith("/sign-out"))).toEqual([]);
  });

  test("(f) AC-36, U2: without Web Locks nothing is restored, requested, or stored, and public browsing works", async ({
    browser,
  }) => {
    const context = await browser.newContext({ baseURL: ORIGIN, serviceWorkers: "block" });
    try {
      // A still-valid session cookie exists before the visit (U2).
      const email = await createAccount(context.request, "nolocks");
      const signedIn = await context.request.post("/api/auth/sign-in/email", {
        headers: { Origin: ORIGIN },
        data: { email, password: PASSWORD },
      });
      expect(signedIn.status()).toBe(200);
      // INSTRUMENTED: Web Locks absent in this browser context.
      await context.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, "locks", {
          configurable: true,
          get: () => undefined,
        });
      });

      const page = await context.newPage();
      const auth: string[] = [];
      recordAuthRequests(page, auth);
      const landmarks = page.waitForResponse(
        (response) => pathOf(response.url()) === "/api/v1/landmarks",
      );
      await page.goto("/");
      expect(await page.evaluate(() => navigator.locks)).toBeUndefined();
      await expect(page.getByText(NO_LOCKS_NOTICE)).toBeVisible();
      await expect(page.getByText(`Signed in as ${email}`)).toHaveCount(0);
      expect((await landmarks).status()).toBe(200); // public browsing
      await expect(
        page.getByRole("heading", { name: "Tennessee Natural Landmarks Explorer" }),
      ).toBeVisible();

      await page.goto("/sign-in");
      // Shown both in the header and on the sign-in page itself.
      await expect(accountNav(page).locator("..").getByText(NO_LOCKS_NOTICE)).toBeVisible();
      await expect(signInForm(page).getByText(NO_LOCKS_NOTICE)).toBeVisible();
      await signInForm(page).getByLabel("Email address").fill(email);
      await signInForm(page).getByLabel("Password").fill(PASSWORD);
      const submit = signInForm(page).getByRole("button", { name: "Sign in" });
      await expect(submit).toHaveAttribute("aria-disabled", "true");
      // Playwright treats aria-disabled as not actionable, so activate it the
      // ways a user still can: Enter on the focused control, and a pointer click.
      await submit.focus();
      await page.keyboard.press("Enter");
      await submit.click({ force: true });
      await expect(signInForm(page).getByLabel("Password")).toHaveValue(PASSWORD);
      await expect(submit).toHaveText("Sign in"); // never entered the pending state

      expect(auth).toEqual([]); // no session check, sign-in, or sign-out request
      const state = await readOfflineState(page);
      expect(state.databases).toEqual([]);
      expect(state.safetyLock).toBeNull();
      // The server session stays active (U2: it remains until it expires).
      expect((await serverSession(context.request))?.user.email).toBe(email);
    } finally {
      await context.close();
    }
  });

  test("(g) DR-1 retention: an anonymous visit creates no offline database", async ({ page }) => {
    const check = page.waitForResponse(
      (response) => pathOf(response.url()) === "/api/auth/get-session",
    );
    await page.goto("/");
    expect(await (await check).json()).toBeNull();
    await expectSignedOut(page);
    await page.goto("/sign-in");
    await expectSignedOut(page);
    expect((await readOfflineState(page)).databases).toEqual([]);
  });
});
