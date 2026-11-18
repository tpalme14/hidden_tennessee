import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type TestInfo } from "@playwright/test";

/**
 * M03-T03 Increment 3 — registration against the REAL production-mode server
 * and `landmarks_test` (no interception except where a test says so). Each
 * run uses fresh, unique addresses (decision 7) instead of resetting the
 * database; the server runs with auth rate limiting off (decision 6).
 *
 * These tests stop at the `/sign-in` URL and check the session directly; the
 * sign-in page's registration notice and returnTo handling are covered by the
 * registration → sign-in journey in sign-in.spec.ts (Increment 4).
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const PASSWORD = "e2e registration password";

function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Same policy as accessibility.spec.ts: serious/critical violations fail; everything is printed. */
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

async function register(page: Page, email: string) {
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  const request = page.waitForRequest(
    (r) => new URL(r.url()).pathname === "/api/auth/sign-up/email",
  );
  const response = page.waitForResponse(
    (r) => new URL(r.url()).pathname === "/api/auth/sign-up/email",
  );
  await page.getByRole("button", { name: "Create account" }).click();
  const settled = await response;
  // Read now: the body is gone once the page navigates away.
  const body = await settled.json();
  return { request: await request, response: settled, body };
}

async function expectSignedOut(page: Page) {
  const session = await page.request.get("/api/auth/get-session");
  expect(session.status()).toBe(200);
  expect(await session.json()).toBeNull();
  const cookies = await page.context().cookies();
  expect(cookies.filter((c) => c.name.includes("session_token"))).toEqual([]);
}

test.describe("registration (real server)", () => {
  test("a new visitor registers from the header link and lands on sign-in, not signed in", async ({
    page,
  }) => {
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "Account" })
      .getByRole("link", { name: "Register" })
      .click();
    await expect(page).toHaveURL("/register");
    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();

    const email = uniqueEmail("new");
    const { request, response } = await register(page, email);

    // The wrapper's contract: name "" and nothing else besides the credentials.
    expect(request.postDataJSON()).toEqual({ name: "", email, password: PASSWORD });
    expect(response.status()).toBe(200);
    expect(response.headers()["set-cookie"]).toBeUndefined();

    // Registration did not sign the user in: the session is checked directly
    // here. The sign-in page itself (notice, returnTo) is covered by
    // sign-in.spec.ts's registration → sign-in journey.
    await expect(page).toHaveURL("/sign-in");
    await expectSignedOut(page);
  });

  test("registering an existing address looks exactly like registering a new one", async ({
    page,
  }) => {
    const email = uniqueEmail("dup");

    await page.goto("/register");
    const first = await register(page, email);
    await expect(page).toHaveURL("/sign-in");

    await page.goto("/register");
    const second = await register(page, email.toUpperCase());
    await expect(page).toHaveURL("/sign-in");

    expect(second.response.status()).toBe(first.response.status());
    const [a, b] = [first.body, second.body];
    expect(Object.keys(b)).toEqual(Object.keys(a));
    expect(Object.keys(b.user)).toEqual(Object.keys(a.user));
    await expect(page.getByRole("alert")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/already|exists|taken|in use/i);
    await expectSignedOut(page);
  });

  test("keyboard only: validation errors take focus, then the form submits with Enter", async ({
    page,
  }) => {
    await page.goto("/register");
    const email = page.getByLabel("Email address");
    for (let i = 0; i < 10 && !(await email.evaluate((el) => el === document.activeElement)); i++) {
      await page.keyboard.press("Tab");
    }
    await expect(email).toBeFocused();

    // An empty submit from the keyboard: errors appear and focus stays on the first invalid field.
    await page.keyboard.press("Enter");
    await expect(email).toHaveAttribute("aria-invalid", "true");
    await expect(email).toBeFocused();
    await expect(page.getByText("Enter your email address.")).toBeVisible();

    const address = uniqueEmail("kbd");
    await page.keyboard.type(address);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password", { exact: true })).toBeFocused();
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Confirm password")).toBeFocused();
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Tab");
    const submit = page.getByRole("button", { name: "Create account" });
    await expect(submit).toBeFocused();
    const outline = await submit.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline).toBe("solid");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL("/sign-in");
    await expectSignedOut(page);
  });

  test("axe: the empty form, the form with field errors, and a server failure alert", async ({
    page,
  }, testInfo) => {
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Sign in" }).first()).toBeVisible();
    await scan(page, testInfo, "register-empty");

    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
    await scan(page, testInfo, "register-field-errors");

    // Only this state is simulated: a real 503 cannot be produced on demand.
    await page.route("**/api/auth/sign-up/email", (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "x" } },
      }),
    );
    await page.getByLabel("Email address").fill(uniqueEmail("axe"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("alert")).toHaveText(
      "Registration couldn't be completed. Please try again.",
    );
    await scan(page, testInfo, "register-server-error");
  });
});
