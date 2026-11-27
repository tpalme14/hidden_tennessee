import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type Request, type TestInfo } from "@playwright/test";

/**
 * M03-T03 Increment 5 — password-reset pages and reset-token security in real
 * Chromium against the real production-mode server and `landmarks_test`.
 *
 * Real server: the reset-request 503 (the e2e server runs with
 * MAIL_TRANSPORT=disabled), rejection of an invalid token by the real
 * completion endpoint, and the library's own GET callback redirect.
 * Simulated, as approved: a SUCCESSFUL completion and a neutral 200 request
 * response — no real token can be obtained without mail delivery. Tile
 * responses are stubbed so no request leaves the machine. In every case the
 * request URLs and headers asserted are the ones the browser itself built.
 *
 * Acknowledged and not testable here: the initial document request carries
 * the token, so it can reach server or proxy access logs before any script
 * runs (deployment consideration).
 */

const ORIGIN = "http://localhost:3000";
const ORIGIN_REFERER = `${ORIGIN}/`;
const TOKEN = "E2eResetTokenQwErTyUiOp1";
const NEW_PASSWORD = "e2e new password value";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const UNAVAILABLE = "Password reset is temporarily unavailable. Please try again later.";
const INVALID_LINK =
  "This password reset link is invalid or has expired. Each link works once and expires after 30 minutes. Request a new link to try again.";

/**
 * Records, from inside the page, the URL visible at the moment of every fetch
 * call and of React's first render into #root — to prove the token was gone
 * before either happened.
 */
async function instrument(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __hrefAtFetch: string[];
      __hrefAtFirstRender: string | null;
    };
    w.__hrefAtFetch = [];
    w.__hrefAtFirstRender = null;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (...args: Parameters<typeof fetch>) => {
      w.__hrefAtFetch.push(location.href);
      return originalFetch(...args);
    };
    new MutationObserver((_records, observer) => {
      const root = document.getElementById("root");
      if (root && root.childNodes.length > 0) {
        w.__hrefAtFirstRender = location.href;
        observer.disconnect();
      }
    }).observe(document, { childList: true, subtree: true });
  });
}

/** Every request the page makes, with the headers the browser built for it. */
function recordRequests(page: Page): Request[] {
  const requests: Request[] = [];
  page.on("request", (request) => requests.push(request));
  return requests;
}

function recordConsole(page: Page): string[] {
  const messages: string[] = [];
  page.on("console", (message) => messages.push(message.text()));
  page.on("pageerror", (error) => messages.push(String(error)));
  return messages;
}

async function expectNoTokenLeaks(page: Page, requests: Request[], consoleMessages: string[]) {
  const withTokenInUrl = requests.filter((r) => r.url().includes(TOKEN));
  // Only the initial document request may carry it (acknowledged above).
  expect(withTokenInUrl.map((r) => r.resourceType())).toEqual(["document"]);
  for (const request of requests) {
    expect((await request.headerValue("referer")) ?? "").not.toContain(TOKEN);
  }
  expect(page.url()).not.toContain(TOKEN);
  const storage = await page.evaluate(() => ({
    local: JSON.stringify({ ...localStorage }),
    session: JSON.stringify({ ...sessionStorage }),
    cookie: document.cookie,
    history: JSON.stringify(history.state),
    href: location.href,
  }));
  expect(JSON.stringify(storage)).not.toContain(TOKEN);
  expect((await page.context().cookies()).map((c) => c.value).join(" ")).not.toContain(TOKEN);
  expect(consoleMessages.join("\n")).not.toContain(TOKEN);
}

async function scan(page: Page, testInfo: TestInfo, state: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await testInfo.attach(`axe-${state}.json`, {
    contentType: "application/json",
    body: JSON.stringify(
      { violations: results.violations, incomplete: results.incomplete },
      null,
      2,
    ),
  });
  const summary = results.violations.map((v) => ({
    id: v.id,
    impact: v.impact,
    nodes: v.nodes.length,
  }));
  console.log(`[axe] ${state}: ${JSON.stringify(summary)}`);
  const blocking = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(blocking, `serious/critical axe violations in "${state}"`).toEqual([]);
}

async function fillNewPassword(page: Page) {
  await page.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Confirm new password").fill(NEW_PASSWORD);
}

test.describe("reset-token security", () => {
  test("the token is captured and stripped before React renders or any application request, and never leaks afterwards", async ({
    page,
  }) => {
    await instrument(page);
    const requests = recordRequests(page);
    const consoleMessages = recordConsole(page);
    await page.route(/tile\.openstreetmap\.org/, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
    );

    await page.goto(`/reset-password?token=${TOKEN}&keep=1#frag`);
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();

    // The address bar no longer has the token; other parameters and the fragment survive.
    expect(page.url()).toBe(`${ORIGIN}/reset-password?keep=1#frag`);
    const timing = await page.evaluate(() => {
      const w = window as unknown as {
        __hrefAtFetch: string[];
        __hrefAtFirstRender: string | null;
      };
      return { fetches: w.__hrefAtFetch, firstRender: w.__hrefAtFirstRender };
    });
    expect(timing.firstRender).toBe(`${ORIGIN}/reset-password?keep=1#frag`);
    // M06-T03 3c-1b correction: since 3c-1a the startup session check is sent
    // after the asynchronous offline security pre-checks, so wait for it
    // deterministically. The fetch log accumulates from the first script, so
    // re-reading it after the wait excludes no earlier request.
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { __hrefAtFetch: string[] }).__hrefAtFetch.length,
        ),
      )
      .toBeGreaterThan(0); // the session check
    timing.fetches = await page.evaluate(
      () => (window as unknown as { __hrefAtFetch: string[] }).__hrefAtFetch,
    );
    for (const href of timing.fetches) expect(href).not.toContain(TOKEN);

    // Leaving for the map in the same document: tiles still get only the origin.
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Discover" })
      .click();
    await expect
      .poll(() => requests.filter((r) => /tile\.openstreetmap\.org/.test(r.url())).length)
      .toBeGreaterThan(0);
    for (const tile of requests.filter((r) => /tile\.openstreetmap\.org/.test(r.url()))) {
      expect(await tile.headerValue("referer")).toBe(ORIGIN_REFERER);
    }

    await expectNoTokenLeaks(page, requests, consoleMessages);
  });

  test("submission sends the token only in the POST body, with the CSRF Origin, then lands on sign-in (completion simulated)", async ({
    page,
  }) => {
    const requests = recordRequests(page);
    const consoleMessages = recordConsole(page);
    let completion: Request | null = null;
    await page.route("**/api/auth/reset-password", (route) => {
      completion = route.request();
      return route.fulfill({ status: 200, json: { status: true } });
    });

    await page.goto(`/reset-password?token=${TOKEN}`);
    await fillNewPassword(page);
    const sessionRecheck = page.waitForRequest(
      (r) => new URL(r.url()).pathname === "/api/auth/get-session",
    );
    await page.getByRole("button", { name: "Reset password" }).click();

    await expect(page).toHaveURL("/sign-in");
    await expect(page.getByRole("status")).toHaveText(
      "Your password has been reset. Sign in with your new password.",
    );
    await sessionRecheck;

    expect(completion).not.toBeNull();
    const request = completion as unknown as Request;
    expect(request.method()).toBe("POST");
    expect(request.url()).toBe(`${ORIGIN}/api/auth/reset-password`);
    expect(request.postDataJSON()).toEqual({ token: TOKEN, newPassword: NEW_PASSWORD });
    expect(await request.headerValue("origin")).toBe(ORIGIN);
    expect(await request.headerValue("referer")).toBe(ORIGIN_REFERER);
    expect(await request.headerValue("content-type")).toContain("application/json");

    await expectNoTokenLeaks(page, requests, consoleMessages);
  });

  test("the real server rejects an unknown token; the page shows the invalid-link alert with focus", async ({
    page,
  }) => {
    const requests = recordRequests(page);
    const consoleMessages = recordConsole(page);
    await page.goto(`/reset-password?token=${TOKEN}`);
    await fillNewPassword(page);
    const response = page.waitForResponse(
      (r) => new URL(r.url()).pathname === "/api/auth/reset-password",
    );
    await page.getByRole("button", { name: "Reset password" }).click();

    const real = await response;
    expect(real.status()).toBe(400); // the token check, not a 403 from CSRF
    expect(await real.request().headerValue("origin")).toBe(ORIGIN);
    const alert = page.getByRole("alert");
    await expect(alert).toHaveText(INVALID_LINK);
    await expect(alert).toBeFocused();
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Request a new reset link" })).toHaveAttribute(
      "href",
      "/forgot-password",
    );

    // Console errors are expected only for the failed request itself, never with the token.
    await expectNoTokenLeaks(page, requests, consoleMessages);
  });

  test("the library's own callback redirect for a bad token lands on the invalid-link message", async ({
    page,
  }) => {
    await page.goto(
      `/api/auth/reset-password/not-a-real-token?callbackURL=${encodeURIComponent(`${ORIGIN}/reset-password`)}`,
    );
    await expect(page).toHaveURL(`${ORIGIN}/reset-password?error=INVALID_TOKEN`);
    await expect(page.getByRole("alert")).toHaveText(INVALID_LINK);
  });

  test("without a token the page explains the link is incomplete", async ({ page }) => {
    await page.goto("/reset-password");
    await expect(
      page.getByText(
        "This password reset link is incomplete. Request a new link to reset your password.",
      ),
    ).toBeVisible();
    await expect(page.getByLabel("New password", { exact: true })).toHaveCount(0);
  });

  test("leaving the reset page forgets the token: browser Back and Forward cannot bring the form back (Increment 6)", async ({
    page,
  }) => {
    let completions = 0;
    await page.route("**/api/auth/reset-password", (route) => {
      completions++;
      return route.fulfill({ status: 200, json: { status: true } });
    });
    await page.route(/tile\.openstreetmap\.org/, (route) =>
      route.fulfill({ status: 200, contentType: "image/png", body: PNG }),
    );

    await page.goto(`/reset-password?token=${TOKEN}`);
    const newPassword = page.getByLabel("New password", { exact: true });
    await expect(newPassword).toBeVisible();
    // Staying on the page keeps the form usable.
    await newPassword.fill("partially typed");
    await expect(newPassword).toBeVisible();

    // Leave within the same document, then use the browser's own Back button.
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Discover" })
      .click();
    await expect(page.getByRole("heading", { name: "Discover Landmarks" })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(`${ORIGIN}/reset-password`);
    await expect(
      page.getByText(
        "This password reset link is incomplete. Request a new link to reset your password.",
      ),
    ).toBeVisible();
    await expect(newPassword).toHaveCount(0);

    // Forward and Back again: still nothing to restore it from.
    await page.goForward();
    await page.goBack();
    await expect(newPassword).toHaveCount(0);
    expect(page.url()).not.toContain(TOKEN);
    expect(completions).toBe(0);
  });
});

test.describe("forgot password", () => {
  test("the sign-in page links to it, and the real server's unavailable answer is identical for any address", async ({
    page,
  }) => {
    // An account that exists, to compare with one that doesn't.
    const email = `e2e-reset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
    expect(
      (
        await page.request.post("/api/auth/sign-up/email", {
          headers: { Origin: ORIGIN },
          data: { name: "", email, password: "e2e reset password" },
        })
      ).status(),
    ).toBe(200);

    await page.goto("/sign-in");
    await page
      .getByRole("region", { name: "Sign in" })
      .getByRole("link", { name: "Forgot password?" })
      .click();
    await expect(page).toHaveURL("/forgot-password");

    const outcomes: string[] = [];
    for (const address of [email, `nobody-${Date.now()}@example.com`]) {
      await page.goto("/forgot-password");
      await page.getByLabel("Email address").fill(address);
      const response = page.waitForResponse(
        (r) => new URL(r.url()).pathname === "/api/auth/request-password-reset",
      );
      await page.getByRole("button", { name: "Send reset link" }).click();
      const real = await response;
      expect(real.status()).toBe(503);
      expect(real.request().postDataJSON()).toEqual({ email: address });
      await expect(page.getByRole("alert")).toHaveText(UNAVAILABLE);
      await expect(page.getByRole("status")).toHaveCount(0);
      outcomes.push(
        (await page.getByRole("region", { name: "Reset your password" }).innerHTML()).replace(
          /value="[^"]*"/g,
          "",
        ),
      );
    }
    expect(outcomes[1]).toBe(outcomes[0]);
  });

  test("a successful request shows the neutral confirmation with focus (response simulated)", async ({
    page,
  }) => {
    await page.route("**/api/auth/request-password-reset", (route) =>
      route.fulfill({ status: 200, json: { status: true, message: "ignored" } }),
    );
    await page.goto("/forgot-password");
    await page.getByLabel("Email address").fill("someone@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    const status = page.getByRole("status");
    await expect(status).toHaveText(
      "If an account exists for that email address, a link to reset its password is on its way. The link works once and expires after 30 minutes.",
    );
    await expect(status).toBeFocused();
    await expect(page.getByText("ignored")).toHaveCount(0);
  });
});

test.describe("password-reset accessibility", () => {
  test("keyboard only: request a link, then choose a new password", async ({ page }) => {
    await page.route("**/api/auth/request-password-reset", (route) =>
      route.fulfill({ status: 200, json: { status: true } }),
    );
    await page.goto("/forgot-password");
    const email = page.getByLabel("Email address");
    for (let i = 0; i < 10 && !(await email.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(email).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toBeFocused();
    await page.keyboard.type("someone@example.com");
    await page.keyboard.press("Enter");
    await expect(page.getByRole("status")).toBeFocused();

    await page.route("**/api/auth/reset-password", (route) =>
      route.fulfill({ status: 200, json: { status: true } }),
    );
    await page.goto(`/reset-password?token=${TOKEN}`);
    const newPassword = page.getByLabel("New password", { exact: true });
    for (
      let i = 0;
      i < 10 && !(await newPassword.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(newPassword).toBeFocused();
    await page.keyboard.type(NEW_PASSWORD);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Confirm new password")).toBeFocused();
    await page.keyboard.type(NEW_PASSWORD);
    await page.keyboard.press("Tab");
    const submit = page.getByRole("button", { name: "Reset password" });
    await expect(submit).toBeFocused();
    expect(await submit.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/sign-in");
  });

  test("axe: forgot-password and reset-password states", async ({ page }, testInfo) => {
    await page.goto("/forgot-password");
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    await scan(page, testInfo, "forgot-empty");

    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
    await scan(page, testInfo, "forgot-field-error");

    await page.getByLabel("Email address").fill("someone@example.com");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("alert")).toHaveText(UNAVAILABLE); // real 503
    await scan(page, testInfo, "forgot-unavailable");

    await page.route("**/api/auth/request-password-reset", (route) =>
      route.fulfill({ status: 200, json: { status: true } }),
    );
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByRole("status")).toBeVisible();
    await scan(page, testInfo, "forgot-confirmation");

    await page.goto(`/reset-password?token=${TOKEN}`);
    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();
    await scan(page, testInfo, "reset-form");

    await page.getByRole("button", { name: "Reset password" }).click();
    await expect(page.getByLabel("New password", { exact: true })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await scan(page, testInfo, "reset-field-errors");

    await fillNewPassword(page);
    await page.getByRole("button", { name: "Reset password" }).click(); // real 400 for this token
    await expect(page.getByRole("alert")).toHaveText(INVALID_LINK);
    await scan(page, testInfo, "reset-invalid-link");

    await page.goto("/sign-in");
    await scan(page, testInfo, "sign-in-with-forgot-link");
  });
});
