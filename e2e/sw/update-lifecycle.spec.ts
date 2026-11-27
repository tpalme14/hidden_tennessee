import AxeBuilder from "@axe-core/playwright";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test, expect, type Page, type TestInfo } from "@playwright/test";
import {
  DEFAULT_DIST_DIR,
  RESET_REQUEST_PATH,
  startUpdateServer,
  type UpdateServer,
} from "../support/update-server";

/**
 * M06-T02 Increment 4c — real service-worker updates in real Chromium
 * ("chromium-sw" project; Specification 6 v1.1 §5 / OFF-SW-1 / AC-27;
 * Specification 7 §5; decisions D9, U1–U13, V1–V10; 4c Option A).
 *
 * Each test runs its own controlled update server (e2e/support/update-server.ts)
 * on an isolated 127.0.0.1 origin, serving version A (the accepted production
 * build) and then version B (A with an HTML marker, an executable JavaScript
 * marker in a renamed bundle, and the matching precache changes). Updates are
 * DISCOVERED with `registration.update()`; they are ACCEPTED only through the
 * application's own Update now / Reload controls — the harness never posts
 * SKIP_WAITING, never sets a marker, and never touches the update-safety
 * store.
 *
 * Evidence:
 * - document loads: main-frame navigation requests (initiation) and
 *   `domcontentloaded` events (completion), per page, recorded by the harness;
 *   same-document route changes produce neither;
 * - worker states: the real ServiceWorkerRegistration (active / waiting) and
 *   the precache contents (which bundle and which index.html revision);
 * - document version: the B HTML meta marker (shell replaced) and the
 *   `data-e2e-build-js` attribute set by EXECUTING the served B bundle
 *   (the changed test bundle ran — not a claim about arbitrary future changes).
 *
 * "No automatic reload" is asserted at deterministic milestones (the other
 * tab's own reload completed, the worker active, the notice shown); it is an
 * observation bounded by those milestones, not a proof that an event could
 * never occur later.
 *
 * Coverage boundary (Option A): no authenticated workflow runs here (the
 * backend accepts mutations only from its own origin and this origin is
 * isolated by design). Protected information comes from the real sign-in
 * form; pending work from the real forgot-password POST, answered and held by
 * the controlled server (never forwarded; no mail). Multi-step holds, trip and
 * review drafts, the held share link, and the unfinished trip add are covered
 * by the integrated unit tests only.
 */

/** The build served as version A (temporarily repointed only by negative controls). */
const DIST_DIR = DEFAULT_DIST_DIR;

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const WAITING_TEXT = "A new version of this app is available.";
const ELSEWHERE_TEXT = "A newer version of this app was activated in another tab.";
const REFUSED_UPDATE =
  "Updating isn't available while changes are still being saved. Try again when they finish.";
const REFUSED_RELOAD =
  "Reloading isn't available while changes are still being saved. Try again when they finish.";
const STALE_TEXT = "What's on this page changed. Review the list and confirm again.";
const SIGN_IN_LABEL = "sign-in details you typed";
const SYNTHETIC_EMAIL = "update-lifecycle.synthetic@example.test";

let server: UpdateServer | undefined;

test.beforeEach(async () => {
  server = await startUpdateServer({ distDir: DIST_DIR });
});

test.afterEach(async () => {
  const current = server;
  server = undefined;
  await current?.close();
});

function srv(): UpdateServer {
  if (!server) throw new Error("update server not started");
  return server;
}

interface Loads {
  started: number;
  completed: number;
}

/** Harness-side document-load accounting for one page (survives reloads). */
function trackLoads(page: Page): Loads {
  const loads: Loads = { started: 0, completed: 0 };
  page.on("request", (request) => {
    if (request.isNavigationRequest() && request.frame() === page.mainFrame()) loads.started += 1;
  });
  page.on("domcontentloaded", () => {
    loads.completed += 1;
  });
  return loads;
}

const snapshot = (loads: Loads): Loads => ({ ...loads });

async function markers(page: Page) {
  return page.evaluate(() => ({
    html: document.querySelector('meta[name="e2e-build"]')?.getAttribute("content") ?? null,
    js: document.documentElement.getAttribute("data-e2e-build-js"),
    bundle:
      [...document.scripts]
        .map((s) => new URL(s.src || location.href).pathname)
        .find((p) => p.startsWith("/assets/index-")) ?? null,
  }));
}

async function workers(page: Page) {
  return page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return {
      active: r?.active?.state ?? null,
      waiting: r?.waiting?.state ?? null,
      installing: r?.installing?.state ?? null,
      controlled: navigator.serviceWorker.controller !== null,
    };
  });
}

/** Paths (with Workbox revision parameters) held in the precache. */
async function precached(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.includes("precache")) continue;
      for (const request of await (await caches.open(name)).keys()) {
        const url = new URL(request.url);
        out.push(url.pathname + url.search);
      }
    }
    return out.sort();
  });
}

function precacheVersion(entries: string[]) {
  const e = srv().evidence;
  const has = (s: string) => entries.some((x) => x.includes(s));
  return {
    jsA: has(e.jsA),
    jsB: has(e.jsB),
    indexA: has(`__WB_REVISION__=${e.indexMd5A}`),
    indexB: has(`__WB_REVISION__=${e.indexMd5B}`),
  };
}

/** First visit: the worker installs and activates; an explicit reload makes the page controlled. */
async function installVersionA(page: Page, route: string, loads: Loads) {
  await page.goto(`${srv().origin}${route}`);
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(async () => (await workers(page)).active).toBe("activated");
  // No clientsClaim: the first page is not taken over, and nothing reloaded it.
  expect((await workers(page)).controlled).toBe(false);
  expect(loads.completed).toBe(1);
  await page.reload();
  await expect.poll(async () => (await workers(page)).controlled).toBe(true);
  expect(loads.completed).toBe(2);
}

async function openControlledPage(page: Page, route: string) {
  await page.goto(`${srv().origin}${route}`);
  await expect.poll(async () => (await workers(page)).controlled).toBe(true);
}

/** Deploys B and lets the real worker discover it via registration.update(). */
async function deployAndDiscover(page: Page) {
  srv().deploy("B");
  await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    await registration?.update();
  });
  // Settles on EITHER outcome, so an activation before acceptance is reported
  // directly (B active: its precache replaced A's bundle) rather than as a timeout.
  let settled = { waiting: null as string | null, bActive: false };
  await expect
    .poll(async () => {
      const state = await workers(page);
      const cache = precacheVersion(await precached(page));
      settled = { waiting: state.waiting, bActive: !cache.jsA && cache.jsB };
      return settled.waiting === "installed" || settled.bActive;
    })
    .toBe(true);
  expect(settled, "B must be waiting, not active, before explicit acceptance").toEqual({
    waiting: "installed",
    bActive: false,
  });
}

const notice = (page: Page) => page.locator("[data-update-notice]");
const liveRegion = (page: Page) => notice(page).locator("[aria-live]");
const confirmation = (page: Page) => page.locator("[data-update-confirmation]");

const countSafely = (locator: ReturnType<Page["locator"]>) => locator.count().catch(() => 0);

/**
 * Milestone for a non-accepting tab: it has reacted to the activation elsewhere
 * (its notice) — or it started a navigation, which the caller then reports.
 */
async function untilActivationObserved(page: Page, loads: Loads, base: Loads) {
  await expect
    .poll(
      async () =>
        loads.started !== base.started ||
        (await countSafely(liveRegion(page).filter({ hasText: ELSEWHERE_TEXT }))) > 0,
    )
    .toBe(true);
}

/**
 * Milestone after Update now / Reload: the notice responded (a refusal or a
 * confirmation) — or a navigation started, which the caller then reports.
 */
async function untilResponded(page: Page, loads: Loads, base: Loads) {
  await expect
    .poll(async () => {
      if (loads.started !== base.started) return true;
      const refused = await countSafely(liveRegion(page).filter({ hasText: "isn't available" }));
      return refused + (await countSafely(confirmation(page))) > 0;
    })
    .toBe(true);
}

async function expectNoAxeViolations(page: Page, testInfo: TestInfo, state: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await testInfo.attach(`axe-${state}.json`, {
    contentType: "application/json",
    body: JSON.stringify({ violations: results.violations }, null, 2),
  });
  expect(
    results.violations.map((v) => ({ id: v.id, nodes: v.nodes.length })),
    `axe violations in ${state}`,
  ).toEqual([]);
}

async function expectNoHorizontalOverflow(page: Page) {
  const widths = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.viewport);
}

test("version B differs from A exactly as constructed, and the server allows only its allowlist", async () => {
  const s = srv();
  const e = s.evidence;
  const get = (p: string, init?: RequestInit) => fetch(`${s.origin}${p}`, init);

  // Version A is the accepted build, unchanged.
  const distIndex = readFileSync(path.join(DIST_DIR, "index.html"));
  const servedIndexA = Buffer.from(await (await get("/index.html")).arrayBuffer());
  expect(servedIndexA.equals(distIndex)).toBe(true);
  expect(createHash("md5").update(servedIndexA).digest("hex")).toBe(e.indexMd5A);
  expect(e.swIndexRevisionA).toBe(e.indexMd5A);
  expect((await get("/sw.js")).headers.get("cache-control")).toBe("no-cache");
  expect((await get("/sw.js")).headers.get("content-type")).toMatch(/^text\/javascript/);

  s.deploy("B");
  const servedIndexB = await (await get("/index.html")).text();
  const servedSwB = await (await get("/sw.js")).text();
  // The B bundle: different URL, different bytes, the marker statement appended.
  expect(e.jsB).not.toBe(e.jsA);
  expect(e.jsBytesDiffer).toBe(true);
  const bundleB = await (await get(e.jsB)).text();
  expect(
    bundleB.endsWith('document.documentElement.setAttribute("data-e2e-build-js","B");\n'),
  ).toBe(true);
  expect((await get(e.jsA)).status).toBe(404); // removed, as after a deployment
  // The shell references the B bundle and carries the B marker.
  expect(servedIndexB).toContain(`src="${e.jsB}"`);
  expect(servedIndexB).not.toContain(e.jsA);
  expect(servedIndexB).toContain('<meta name="e2e-build" content="B" />');
  // The worker precaches the B bundle and the MD5 of the B shell actually served.
  expect(createHash("md5").update(servedIndexB).digest("hex")).toBe(e.indexMd5B);
  expect(servedSwB).toContain(`{url:"index.html",revision:"${e.indexMd5B}"}`);
  expect(servedSwB).toContain(`"${e.jsB.slice(1)}"`);
  expect(servedSwB).not.toContain(e.jsA.slice(1));
  expect(e.indexMd5B).not.toBe(e.indexMd5A);
  // Nothing on disk changed.
  expect(readFileSync(path.join(DIST_DIR, "index.html")).equals(distIndex)).toBe(true);

  // Allowlist: forwarded reads, the locally answered reset, everything else refused.
  expect((await get("/health")).status).toBe(200);
  const reset = await get(RESET_REQUEST_PATH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: SYNTHETIC_EMAIL }),
  });
  expect(reset.status).toBe(200);
  expect(await reset.json()).toEqual({ status: true });
  for (const [method, p] of [
    ["POST", "/api/auth/sign-in/email"],
    ["POST", "/api/trips"],
    ["DELETE", "/api/trips/x"],
    ["PUT", "/sign-in"],
    ["POST", "/"],
  ] as const) {
    const response = await get(p, { method });
    expect(response.status, `${method} ${p}`).toBe(405);
    expect(response.headers.get("content-type")).toMatch(/application\/json/);
  }
  expect((await get("/shared/anything")).status).toBe(404); // never the SPA fallback
  expect((await get("/missing.js")).status).toBe(404);
  expect((await get("/sign-in")).headers.get("content-type")).toMatch(/text\/html/);
  expect(s.log.forwarded).toEqual(["GET /health"]);
  expect(s.log.forwarded.some((f) => f.includes("request-password-reset"))).toBe(false);
  expect(s.log.resetRequests).toBe(1);
  expect(s.log.rejected).toEqual([
    "POST /api/auth/sign-in/email",
    "POST /api/trips",
    "DELETE /api/trips/x",
    "PUT /sign-in",
    "POST /",
  ]);
});

test("discovery, Later, and acceptance in a new page session; the other tab never reloads by itself", async ({
  context,
}, testInfo) => {
  const first = await context.newPage();
  await first.setViewportSize({ width: 320, height: 800 });
  const firstLoads = trackLoads(first);
  await installVersionA(first, "/sign-in", firstLoads);
  expect(await markers(first)).toEqual({ html: null, js: null, bundle: srv().evidence.jsA });

  // Deploying B by itself changes nothing in the page.
  let base = snapshot(firstLoads);
  await deployAndDiscover(first);
  expect(await workers(first)).toMatchObject({ active: "activated", waiting: "installed" });
  const installed = precacheVersion(await precached(first));
  expect(installed).toEqual({ jsA: true, jsB: true, indexA: true, indexB: true }); // B installed, not active
  await expect(liveRegion(first)).toContainText(WAITING_TEXT);
  await expect(first.getByRole("button", { name: "Update now" })).toBeVisible();
  await expect(first.getByRole("button", { name: "Later" })).toBeVisible();
  await expectNoHorizontalOverflow(first);
  await expectNoAxeViolations(first, testInfo, "waiting");
  expect(firstLoads).toEqual(base);
  expect(await markers(first)).toEqual({ html: null, js: null, bundle: srv().evidence.jsA });

  // Later (keyboard): the notice closes, focus goes to the main content, the worker stays waiting.
  await first.getByRole("button", { name: "Later" }).focus();
  await first.keyboard.press("Enter");
  await expect(first.getByRole("button", { name: "Update now" })).toHaveCount(0);
  await expect(first.locator("#main-content")).toBeFocused();
  // A repeated update check for the same postponed worker does not reopen the notice.
  await first.evaluate(async () => {
    await (await navigator.serviceWorker.getRegistration())?.update();
  });
  await expect.poll(async () => (await workers(first)).waiting).toBe("installed");
  await expect(first.getByRole("button", { name: "Update now" })).toHaveCount(0);
  expect(firstLoads).toEqual(base);

  // A new page session (second tab) shows the same waiting worker and accepts it.
  const second = await context.newPage();
  const secondLoads = trackLoads(second);
  await openControlledPage(second, "/sign-in");
  await expect(liveRegion(second)).toContainText(WAITING_TEXT);
  base = snapshot(firstLoads);
  const secondBase = snapshot(secondLoads);
  await second.getByRole("button", { name: "Update now" }).click();

  // The accepting tab: exactly one more document load, into version B.
  await expect.poll(() => secondLoads.completed).toBe(secondBase.completed + 1);
  await expect
    .poll(() => markers(second))
    .toEqual({ html: "B", js: "B", bundle: srv().evidence.jsB });
  await expect.poll(async () => (await workers(second)).waiting).toBeNull();
  expect(await workers(second)).toMatchObject({ active: "activated", controlled: true });
  expect(precacheVersion(await precached(second))).toEqual({
    jsA: false,
    jsB: true,
    indexA: false,
    indexB: true,
  }); // B is the active worker's precache; A's entries were cleaned up on activation
  // The other tab: zero automatic loads (observed up to the milestone where it
  // reacted to the activation), still version A, and notified.
  await untilActivationObserved(first, firstLoads, base);
  expect(firstLoads, "no automatic document load in the non-accepting tab").toEqual(base);
  await expect(liveRegion(first)).toContainText(ELSEWHERE_TEXT);
  expect(secondLoads.started).toBe(secondBase.started + 1);
  expect(secondLoads.completed).toBe(secondBase.completed + 1);
  expect(await markers(first)).toEqual({ html: null, js: null, bundle: srv().evidence.jsA });
  await expectNoAxeViolations(first, testInfo, "activated-elsewhere");
  await expectNoHorizontalOverflow(first);

  // Explicit Reload in the other tab reaches version B (nothing protected there).
  await first.getByRole("button", { name: "Reload" }).click();
  await expect.poll(() => firstLoads.completed).toBe(base.completed + 1);
  await expect
    .poll(() => markers(first))
    .toEqual({ html: "B", js: "B", bundle: srv().evidence.jsB });
});

test("protected sign-in input: confirmation by category, Keep working, stale refresh, and checked Reload in the other tab", async ({
  context,
}, testInfo) => {
  const accepting = await context.newPage();
  const acceptingLoads = trackLoads(accepting);
  await installVersionA(accepting, "/sign-in", acceptingLoads);
  const other = await context.newPage();
  await other.setViewportSize({ width: 320, height: 800 });
  const otherLoads = trackLoads(other);
  await openControlledPage(other, "/sign-in");

  // Real form input in both tabs (synthetic values only).
  const acceptingEmail = accepting.getByLabel("Email address");
  await acceptingEmail.fill(SYNTHETIC_EMAIL);
  const otherEmail = other.getByLabel("Email address");
  await otherEmail.fill(`other.${SYNTHETIC_EMAIL}`);

  await deployAndDiscover(accepting);
  await expect(liveRegion(accepting)).toContainText(WAITING_TEXT);
  await expect(liveRegion(other)).toContainText(WAITING_TEXT);
  const acceptingBase = snapshot(acceptingLoads);
  const otherBase = snapshot(otherLoads);

  // Update now opens the confirmation: categories only, never the typed value.
  await accepting.getByRole("button", { name: "Update now" }).focus();
  await accepting.keyboard.press("Enter");
  await untilResponded(accepting, acceptingLoads, acceptingBase);
  expect(acceptingLoads, "protected input must not be interrupted without confirmation").toEqual(
    acceptingBase,
  );
  await expect(confirmation(accepting)).toContainText(SIGN_IN_LABEL);
  await expect(confirmation(accepting)).toContainText(
    "Anything already saved on the server is not affected.",
  );
  await expect(confirmation(accepting)).not.toContainText(SYNTHETIC_EMAIL);
  await expect(confirmation(accepting).locator("p").first()).toBeFocused();
  await expectNoAxeViolations(accepting, testInfo, "confirmation");

  // Keep working: the draft and the version stay; focus returns to Update now.
  await accepting.getByRole("button", { name: "Keep working" }).click();
  await expect(confirmation(accepting)).toHaveCount(0);
  await expect(accepting.getByRole("button", { name: "Update now" })).toBeFocused();
  await expect(acceptingEmail).toHaveValue(SYNTHETIC_EMAIL);
  expect(await workers(accepting)).toMatchObject({ waiting: "installed" });
  expect(acceptingLoads).toEqual(acceptingBase);

  // Editing the already-protected input while confirming refreshes the confirmation;
  // nothing activates until another explicit action.
  await accepting.getByRole("button", { name: "Update now" }).click();
  await expect(confirmation(accepting)).not.toContainText(STALE_TEXT);
  await acceptingEmail.press("End");
  await acceptingEmail.pressSequentially("x");
  await expect(confirmation(accepting)).toContainText(STALE_TEXT);
  await expect(confirmation(accepting)).toContainText(SIGN_IN_LABEL);
  expect(await workers(accepting)).toMatchObject({ waiting: "installed" });
  expect(acceptingLoads).toEqual(acceptingBase);

  // Fresh explicit confirmation updates (exactly one reload into B).
  await accepting.getByRole("button", { name: "Update anyway" }).click();
  await expect.poll(() => acceptingLoads.completed).toBe(acceptingBase.completed + 1);
  await expect
    .poll(() => markers(accepting))
    .toEqual({ html: "B", js: "B", bundle: srv().evidence.jsB });
  await expect.poll(async () => (await workers(accepting)).waiting).toBeNull();
  expect(acceptingLoads.started).toBe(acceptingBase.started + 1);

  // The other tab keeps its document and draft, and Reload applies the same checks.
  await untilActivationObserved(other, otherLoads, otherBase);
  expect(otherLoads, "no automatic document load in the non-accepting tab").toEqual(otherBase);
  await expect(liveRegion(other)).toContainText(ELSEWHERE_TEXT);
  await expect(otherEmail).toHaveValue(`other.${SYNTHETIC_EMAIL}`);
  expect(await markers(other)).toEqual({ html: null, js: null, bundle: srv().evidence.jsA });
  await other.getByRole("button", { name: "Reload" }).click();
  await expect(confirmation(other)).toContainText("Reloading this page loses information");
  await expect(confirmation(other)).toContainText(SIGN_IN_LABEL);
  await expect(confirmation(other)).not.toContainText(SYNTHETIC_EMAIL);
  await expectNoHorizontalOverflow(other);
  await other.getByRole("button", { name: "Keep working" }).click();
  await expect(other.getByRole("button", { name: "Reload" })).toBeFocused();
  await expect(otherEmail).toHaveValue(`other.${SYNTHETIC_EMAIL}`);
  expect(otherLoads).toEqual(otherBase);
  await other.getByRole("button", { name: "Reload" }).click();
  await other.getByRole("button", { name: "Reload anyway" }).click();
  await expect.poll(() => otherLoads.completed).toBe(otherBase.completed + 1);
  await expect
    .poll(() => markers(other))
    .toEqual({ html: "B", js: "B", bundle: srv().evidence.jsB });
});

test("a pending forgot-password request refuses the update; releasing it activates nothing; a fresh acceptance proceeds", async ({
  page,
}, testInfo) => {
  const loads = trackLoads(page);
  await installVersionA(page, "/forgot-password", loads);
  await deployAndDiscover(page);
  await expect(liveRegion(page)).toContainText(WAITING_TEXT);

  // The real form starts exactly one POST, which the controlled server holds.
  srv().holdResetRequests(true);
  await page.getByLabel("Email address").fill(SYNTHETIC_EMAIL);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await srv().waitForResetRequests(1);
  await expect(page.getByRole("button", { name: "Sending link…" })).toBeVisible();
  expect(srv().log.heldNow).toBe(1);
  const base = snapshot(loads);

  // Update now is refused with a visible, announced explanation; nothing activates.
  await page.getByRole("button", { name: "Update now" }).click();
  await untilResponded(page, loads, base);
  expect(loads, "no document load while the request is pending").toEqual(base);
  await expect(liveRegion(page)).toContainText(REFUSED_UPDATE);
  await expect(page.getByText(REFUSED_UPDATE)).toBeVisible();
  await expect(page.getByRole("button", { name: "Update now" })).toBeFocused();
  // Q3 (Increment 5): the visible refusal describes the refused control.
  await expect(page.getByRole("button", { name: "Update now" })).toHaveAccessibleDescription(
    REFUSED_UPDATE,
  );
  await expect(confirmation(page)).toHaveCount(0);
  expect(await workers(page)).toMatchObject({ active: "activated", waiting: "installed" });
  await expectNoAxeViolations(page, testInfo, "pending-work");
  expect(loads).toEqual(base);

  // Releasing the response completes the form; the update stays waiting.
  srv().releaseResetRequests();
  await expect(page.getByRole("status").filter({ hasText: "If an account exists" })).toBeVisible();
  expect(await workers(page)).toMatchObject({ waiting: "installed" });
  await expect(page.getByRole("button", { name: "Update now" })).toBeVisible();
  // The refusal and its description are gone once the work has ended.
  await expect(page.getByRole("button", { name: "Update now" })).not.toHaveAttribute(
    "aria-describedby",
  );
  await expect(page.getByText(REFUSED_UPDATE)).toHaveCount(0);
  expect(loads).toEqual(base);
  expect(await markers(page)).toEqual({ html: null, js: null, bundle: srv().evidence.jsA });

  // The completed form leaves nothing protected (the address field is gone), so a
  // fresh explicit Update now proceeds without a confirmation.
  await page.getByRole("button", { name: "Update now" }).click();
  await expect.poll(() => loads.completed).toBe(base.completed + 1);
  await expect
    .poll(() => markers(page))
    .toEqual({ html: "B", js: "B", bundle: srv().evidence.jsB });
  expect(srv().log.resetRequests).toBe(1);
  expect(srv().log.forwarded.some((f) => f.includes(RESET_REQUEST_PATH))).toBe(false);
  expect(srv().log.rejected).toEqual([]);
});

test("Q3: Reload after activation elsewhere is refused while a request is pending, described by its explanation, and reloads only when asked after the work ends", async ({
  context,
}) => {
  const accepting = await context.newPage();
  const acceptingLoads = trackLoads(accepting);
  await installVersionA(accepting, "/sign-in", acceptingLoads);
  const other = await context.newPage();
  const otherLoads = trackLoads(other);
  await openControlledPage(other, "/forgot-password");

  await deployAndDiscover(accepting);
  await expect(liveRegion(accepting)).toContainText(WAITING_TEXT);
  const acceptingBase = snapshot(acceptingLoads);
  await accepting.getByRole("button", { name: "Update now" }).click();
  await expect.poll(() => acceptingLoads.completed).toBe(acceptingBase.completed + 1);

  const otherBase = snapshot(otherLoads);
  await untilActivationObserved(other, otherLoads, otherBase);
  expect(otherLoads, "no automatic document load in the non-accepting tab").toEqual(otherBase);

  // A real request is pending in the other tab (held by the controlled server).
  srv().holdResetRequests(true);
  await other.getByLabel("Email address").fill(SYNTHETIC_EMAIL);
  await other.getByRole("button", { name: "Send reset link" }).click();
  await srv().waitForResetRequests(1);

  const reload = other.getByRole("button", { name: "Reload" });
  await reload.click();
  await untilResponded(other, otherLoads, otherBase);
  expect(otherLoads, "no document load while the request is pending").toEqual(otherBase);
  await expect(reload).toHaveAccessibleDescription(REFUSED_RELOAD);
  await expect(reload).toHaveAccessibleName("Reload");
  await expect(reload).toBeFocused();
  await expect(other.locator("[aria-live]")).toHaveCount(1);

  srv().releaseResetRequests();
  await expect(other.getByRole("status").filter({ hasText: "If an account exists" })).toBeVisible();
  await expect(reload).not.toHaveAttribute("aria-describedby");
  await expect(other.getByText(REFUSED_RELOAD)).toHaveCount(0);
  expect(otherLoads).toEqual(otherBase); // no reload by itself

  await reload.click();
  await expect.poll(() => otherLoads.completed).toBe(otherBase.completed + 1);
  await expect
    .poll(() => markers(other))
    .toEqual({ html: "B", js: "B", bundle: srv().evidence.jsB });
});
