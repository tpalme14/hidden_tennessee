import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type TestInfo } from "@playwright/test";

/**
 * M06-T02 Increment 4d — the installation affordance in the real production
 * application ("chromium-sw" project; Specification 6 v1.1 §3.1; decisions
 * D3, U12, U13).
 *
 * SYNTHETIC: the `beforeinstallprompt` and `appinstalled` events are
 * dispatched by this harness, with a controlled `prompt()` (counted) and a
 * controlled `userChoice` (resolved by the test). Automation cannot show the
 * browser's native install prompt, so these tests do NOT verify native
 * installation eligibility, native prompt presentation, or operating-system
 * installation.
 * REAL: the application's own listener, retention, `preventDefault`,
 * Install app button, explicit invocation, duplicate protection, consumption,
 * outcome messages, guidance, focus, layout, and that nothing reloads or
 * activates a worker. The harness's counters live in the page under
 * `__e2eInstall` (test-only; the application never reads them).
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const GUIDANCE = "Some browsers let you install this app from their menu";
const OFFLINE_NOTE = "Installing doesn't download landmarks, trips, maps, or your account";
const DISMISSED = "Installation was dismissed. Nothing was installed.";
const ACCEPTED = "Your browser accepted the installation request.";
const INSTALLED = "Your browser reports that this app was installed.";

function trackLoads(page: Page) {
  const loads = { completed: 0 };
  page.on("domcontentloaded", () => {
    loads.completed += 1;
  });
  return loads;
}

async function openApp(page: Page) {
  await page.goto("/sign-in");
  await expect(page.getByRole("heading", { name: "Sign in", level: 2 })).toBeVisible();
  // The worker is installed and fully activated before any baseline is taken
  // (`ready` already resolves while the first worker is still "activating").
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null,
      ),
    )
    .toBe("activated");
}

/** Dispatches a synthetic prompt event; returns whether the application prevented its default. */
async function dispatchPromptEvent(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const w = window as unknown as {
      __e2eInstall: { prompts: number; resolve: ((outcome: string) => void) | null };
    };
    w.__e2eInstall = { prompts: 0, resolve: null };
    const event = new Event("beforeinstallprompt", { cancelable: true });
    const userChoice = new Promise<{ outcome: string; platform: string }>((resolve) => {
      w.__e2eInstall.resolve = (outcome) => resolve({ outcome, platform: "web" });
    });
    Object.defineProperty(event, "prompt", {
      value: () => {
        w.__e2eInstall.prompts += 1;
        return Promise.resolve();
      },
    });
    Object.defineProperty(event, "userChoice", { value: userChoice });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

const promptCount = (page: Page) =>
  page.evaluate(
    () => (window as unknown as { __e2eInstall?: { prompts: number } }).__e2eInstall?.prompts ?? 0,
  );

async function resolveChoice(page: Page, outcome: "accepted" | "dismissed") {
  await page.evaluate((o) => {
    (
      window as unknown as { __e2eInstall: { resolve: (outcome: string) => void } }
    ).__e2eInstall.resolve(o);
  }, outcome);
}

async function workerStates(page: Page) {
  return page.evaluate(async () => {
    const r = await navigator.serviceWorker.getRegistration();
    return { active: r?.active?.state ?? null, waiting: r?.waiting?.state ?? null };
  });
}

const installButton = (page: Page) => page.getByRole("button", { name: "Install app" });
const installRegion = (page: Page) => page.locator("[data-install-affordance] [aria-live]");

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

test("without a browser prompt: collapsed generic guidance only, keyboard operable, at 320 px", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await openApp(page);
  await expect(installButton(page)).toHaveCount(0);
  const summary = page.locator("[data-install-affordance] summary");
  await expect(summary).toHaveText("Install this app");
  await expect(page.getByText(GUIDANCE)).toBeHidden();
  await summary.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText(GUIDANCE)).toBeVisible();
  await expect(page.getByText(OFFLINE_NOTE)).toBeVisible();
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page, testInfo, "install-guidance");
  // Existing shell structure is intact.
  await expect(page.getByRole("link", { name: "Skip to content" })).toHaveAttribute(
    "href",
    "#main-content",
  );
  await expect(page.locator("main#main-content")).toHaveCount(1);
});

test("a prompt event offers Install app without prompting; one explicit click prompts once; dismissal consumes it", async ({
  page,
}, testInfo) => {
  const loads = trackLoads(page);
  await openApp(page);
  const workersBefore = await workerStates(page);
  const loadsBefore = loads.completed;

  await page.getByLabel("Email address").focus();
  expect(await dispatchPromptEvent(page)).toBe(true); // retained by the application
  await expect(installButton(page)).toBeVisible();
  await expect(page.getByLabel("Email address")).toBeFocused(); // no focus theft
  expect(await promptCount(page)).toBe(0); // never automatic
  await page.setViewportSize({ width: 320, height: 800 });
  await expectNoHorizontalOverflow(page);
  await expectNoAxeViolations(page, testInfo, "install-available");

  await installButton(page).click();
  expect(await promptCount(page)).toBe(1);
  await expect(installButton(page)).toHaveAttribute("aria-disabled", "true");
  // Repeated activation while pending, by real keyboard input on the still-focused button
  // (Playwright's click() refuses aria-disabled elements, so it cannot be used here).
  await expect(installButton(page)).toBeFocused();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Space");
  expect(await promptCount(page)).toBe(1);

  await resolveChoice(page, "dismissed");
  await expect(installRegion(page)).toHaveText(DISMISSED);
  await expect(installButton(page)).toHaveCount(0); // consumed
  await expect(installRegion(page)).toBeFocused(); // not lost to the body
  await expect(page.locator("[data-install-affordance] summary")).toHaveText("Install this app");
  expect(await promptCount(page)).toBe(1);
  expect(loads.completed).toBe(loadsBefore); // nothing reloaded
  expect(await workerStates(page)).toEqual(workersBefore); // nothing activated
});

test("keyboard activation and acceptance; appinstalled ends promotion; nothing reloads or activates", async ({
  page,
}) => {
  const loads = trackLoads(page);
  await openApp(page);
  const workersBefore = await workerStates(page);
  const loadsBefore = loads.completed;

  await dispatchPromptEvent(page);
  await installButton(page).focus();
  await page.keyboard.press("Enter");
  expect(await promptCount(page)).toBe(1);
  await resolveChoice(page, "accepted");
  await expect(installRegion(page)).toContainText(ACCEPTED);
  await expect(installButton(page)).toHaveCount(0);

  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(installRegion(page)).toHaveText(INSTALLED);
  await expect(page.locator("[data-install-affordance] summary")).toHaveCount(0);
  await expect(installButton(page)).toHaveCount(0);
  expect(await promptCount(page)).toBe(1);
  expect(loads.completed).toBe(loadsBefore);
  expect(await workerStates(page)).toEqual(workersBefore);
});

test("a later prompt event makes Install app available again (and it prompts only its own event)", async ({
  page,
}) => {
  await openApp(page);
  await dispatchPromptEvent(page);
  await installButton(page).click();
  await resolveChoice(page, "dismissed");
  await expect(installButton(page)).toHaveCount(0);
  await dispatchPromptEvent(page); // a fresh harness counter for the new event
  await expect(installButton(page)).toBeVisible();
  await installButton(page).click();
  expect(await promptCount(page)).toBe(1);
});

test("appinstalled while Install app is offered removes the promotion without prompting", async ({
  page,
}) => {
  await openApp(page);
  await dispatchPromptEvent(page);
  await expect(installButton(page)).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  await expect(installButton(page)).toHaveCount(0);
  await expect(page.locator("[data-install-affordance] summary")).toHaveCount(0);
  await expect(installRegion(page)).toHaveText(INSTALLED);
  expect(await promptCount(page)).toBe(0);
});
