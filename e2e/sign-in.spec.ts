import AxeBuilder from "@axe-core/playwright";
import { test, expect, type APIRequestContext, type Page, type TestInfo } from "@playwright/test";

/**
 * M03-T03 Increment 4 — sign-in and the session journeys against the REAL
 * production-mode server and `landmarks_test`. Interception is used only
 * where a test says so (to make a session check or a sign-out fail on
 * demand). Every run uses fresh, unique addresses (decision 7); the server
 * runs with auth rate limiting off (decision 6).
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "e2e sign-in password";
const LANDMARK_PATH = "/landmarks/11111111-1111-4111-8111-111111111111";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const REGISTERED_NOTICE = "Registration received. Sign in with your email address and password.";
/** The home route on this origin; the discovery page then adds its own map state to the query. */
const HOME = /^http:\/\/localhost:3000\/(\?.*)?$/;

function uniqueEmail(label: string): string {
  return `e2e-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/** Creates an account through the real API (registration itself is covered in registration.spec.ts). */
async function createAccount(request: APIRequestContext, label: string): Promise<string> {
  const email = uniqueEmail(label);
  const response = await request.post("/api/auth/sign-up/email", {
    headers: { Origin: ORIGIN },
    data: { name: "", email, password: PASSWORD },
  });
  expect(response.status()).toBe(200);
  return email;
}

const accountNav = (page: Page) => page.getByRole("navigation", { name: "Account" });
const signInForm = (page: Page) => page.getByRole("region", { name: "Sign in" });

async function signInThroughUi(page: Page, email: string, password = PASSWORD) {
  await signInForm(page).getByLabel("Email address").fill(email);
  await signInForm(page).getByLabel("Password").fill(password);
  await signInForm(page).getByRole("button", { name: "Sign in" }).click();
}

async function expectSignedInAs(page: Page, email: string) {
  await expect(accountNav(page)).toContainText(`Signed in as ${email}`);
  await expect(accountNav(page).getByRole("button", { name: "Sign out" })).toBeVisible();
}

async function expectSignedOutUi(page: Page) {
  await expect(accountNav(page).getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
}

async function serverSession(page: Page) {
  const response = await page.request.get("/api/auth/get-session");
  expect(response.status()).toBe(200);
  return response.json();
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

test.describe("registration → sign-in (cross-increment)", () => {
  test("returnTo survives registration; the notice shows on the usable sign-in page; registration does not sign in; sign-in lands on the destination", async ({
    page,
  }) => {
    const returnTo = encodeURIComponent(LANDMARK_PATH);
    await page.goto(`/sign-in?returnTo=${returnTo}`);
    await signInForm(page).getByRole("link", { name: "Create an account" }).click();
    await expect(page).toHaveURL(`/register?returnTo=${returnTo}`);
    // The URL changes before React Router's transition renders the new page;
    // wait for the registration form so the fills cannot land in the old one.
    const registerForm = page.getByRole("region", { name: "Create an account" });
    await expect(registerForm).toBeVisible();

    const email = uniqueEmail("journey");
    await registerForm.getByLabel("Email address").fill(email);
    await registerForm.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await registerForm.getByLabel("Confirm password").fill(PASSWORD);
    await registerForm.getByRole("button", { name: "Create account" }).click();

    // The usable sign-in page, inside the application shell, with the notice.
    await expect(page).toHaveURL(`/sign-in?returnTo=${returnTo}`);
    await expect(page.getByRole("banner")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(signInForm(page).getByRole("status")).toHaveText(REGISTERED_NOTICE);
    // Registration did not authenticate the visitor.
    await expectSignedOutUi(page);
    expect(await serverSession(page)).toBeNull();

    await signInThroughUi(page, email);
    await expect(page).toHaveURL(LANDMARK_PATH);
    await expectSignedInAs(page, email);
    const session = await serverSession(page);
    expect(session.user.email).toBe(email);

    // The session lives only in the HttpOnly cookie, never in browser storage.
    const cookie = (await page.context().cookies()).find((c) => c.name.includes("session_token"));
    expect(cookie?.httpOnly).toBe(true);
    expect(cookie?.sameSite).toBe("Lax");
    expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
  });
});

test.describe("sign-in (real server)", () => {
  test("a wrong password and an unknown address get the identical generic message", async ({
    page,
  }) => {
    const email = await createAccount(page.request, "generic");
    await page.goto("/sign-in");

    await signInThroughUi(page, email, "not the password");
    const alert = signInForm(page).getByRole("alert");
    await expect(alert).toHaveText("The email address or password is incorrect.");
    await expect(signInForm(page).getByLabel("Password")).toHaveValue("");
    await expect(signInForm(page).getByLabel("Password")).toBeFocused();
    const afterWrongPassword = await signInForm(page).innerHTML();

    await page.goto("/sign-in");
    await signInThroughUi(page, email, "not the password");
    await expect(alert).toBeVisible();
    await page.goto("/sign-in");
    await signInThroughUi(page, uniqueEmail("nobody"), "not the password");
    await expect(alert).toHaveText("The email address or password is incorrect.");
    // Identical apart from the typed address.
    const afterUnknown = (await signInForm(page).innerHTML()).replace(/value="[^"]*"/g, "");
    expect(afterUnknown).toBe(afterWrongPassword.replace(/value="[^"]*"/g, ""));
    expect(await serverSession(page)).toBeNull();
  });

  test("an unsafe returnTo falls back to /", async ({ page }) => {
    const email = await createAccount(page.request, "unsafe");
    await page.goto(`/sign-in?returnTo=${encodeURIComponent("https://evil.example/")}`);
    await signInThroughUi(page, email);
    await expect(page).toHaveURL(HOME);
    await expectSignedInAs(page, email);

    await page.goto(`/sign-in?returnTo=${encodeURIComponent("//evil.example")}`);
    await expect(page).toHaveURL(HOME); // already signed in: sent on, safely
  });

  test("an already signed-in visitor is sent on to the safe destination", async ({ page }) => {
    const email = await createAccount(page.request, "already");
    await page.goto("/sign-in");
    await signInThroughUi(page, email);
    await expect(page).toHaveURL(HOME);

    await page.goto(`/sign-in?returnTo=${encodeURIComponent(LANDMARK_PATH)}`);
    await expect(page).toHaveURL(LANDMARK_PATH);
    await page.goto("/register");
    await expect(page).toHaveURL(HOME);
  });
});

test.describe("session journeys (real server)", () => {
  test("reload restores the session; confirmed sign-out ends it and survives a reload", async ({
    page,
  }) => {
    const email = await createAccount(page.request, "reload");
    await page.goto("/sign-in");
    await signInThroughUi(page, email);
    await expectSignedInAs(page, email);

    await page.reload();
    await expectSignedInAs(page, email);

    await accountNav(page).getByRole("button", { name: "Sign out" }).click();
    await expect(accountNav(page).getByRole("link", { name: "Sign in" })).toBeFocused();
    expect(await serverSession(page)).toBeNull();
    await page.reload();
    await expectSignedOutUi(page);
  });

  test("a cleared cookie shows as signed out on the next load", async ({ page }) => {
    const email = await createAccount(page.request, "cleared");
    await page.goto("/sign-in");
    await signInThroughUi(page, email);
    await expectSignedInAs(page, email);

    await page.context().clearCookies();
    await page.reload();
    await expectSignedOutUi(page);
  });

  test("a session revoked from another browser context shows as signed out on the next check", async ({
    page,
    browser,
  }) => {
    const email = await createAccount(page.request, "revoked");
    await page.goto("/sign-in");
    await signInThroughUi(page, email);
    await expectSignedInAs(page, email);

    // Another context holding the same session signs it out on the server.
    const other = await browser.newContext({ baseURL: ORIGIN });
    await other.addCookies(await page.context().cookies());
    const revoke = await other.request.post("/api/auth/sign-out", {
      headers: { Origin: ORIGIN },
      data: {},
    });
    expect(await revoke.json()).toEqual({ success: true });
    await other.close();

    await page.reload();
    await expectSignedOutUi(page);
    expect(await serverSession(page)).toBeNull();
  });

  test("a failed session check shows the notice, never redirects the sign-in page, and Retry recovers", async ({
    page,
  }) => {
    const email = await createAccount(page.request, "unavailable");
    await page.goto("/sign-in");
    await signInThroughUi(page, email);
    await expectSignedInAs(page, email);

    // Only the check fails (simulated); the session itself is still valid.
    await page.route("**/api/auth/get-session", (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "x" } },
      }),
    );
    await page.goto(`/sign-in?returnTo=${encodeURIComponent(LANDMARK_PATH)}`);
    await expect(
      page.getByRole("status").filter({ hasText: "Couldn't check whether you're signed in." }),
    ).toBeVisible();
    await expect(page).toHaveURL(`/sign-in?returnTo=${encodeURIComponent(LANDMARK_PATH)}`);
    await expect(signInForm(page).getByLabel("Email address")).toBeVisible();

    await page.unroute("**/api/auth/get-session");
    await page.getByRole("button", { name: "Retry" }).click();
    // Recovered: the real check now finds the session, so the page sends the visitor on.
    await expect(page).toHaveURL(LANDMARK_PATH);
    await expectSignedInAs(page, email);
  });

  test("a failed sign-out keeps the user signed in with an alert; retrying signs out", async ({
    page,
  }) => {
    const email = await createAccount(page.request, "signout-fail");
    await page.goto("/sign-in");
    await signInThroughUi(page, email);
    await expectSignedInAs(page, email);

    await page.route("**/api/auth/sign-out", (route) =>
      route.fulfill({
        status: 503,
        json: { error: { code: "SERVICE_UNAVAILABLE", message: "x" } },
      }),
    );
    await accountNav(page).getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("alert")).toContainText(
      "Sign-out didn't complete. You're still signed in.",
    );
    await expectSignedInAs(page, email);
    expect((await serverSession(page)).user.email).toBe(email);

    await page.unroute("**/api/auth/sign-out");
    await page.getByRole("button", { name: "Try signing out again" }).click();
    await expectSignedOutUi(page);
    expect(await serverSession(page)).toBeNull();
  });
});

test.describe("sign-in accessibility", () => {
  test("keyboard only: validation, then sign-in with Enter", async ({ page }) => {
    const email = await createAccount(page.request, "kbd");
    await page.goto("/sign-in");
    const emailField = signInForm(page).getByLabel("Email address");
    for (
      let i = 0;
      i < 10 && !(await emailField.evaluate((el) => el === document.activeElement));
      i++
    ) {
      await page.keyboard.press("Tab");
    }
    await expect(emailField).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(emailField).toHaveAttribute("aria-invalid", "true");
    await expect(emailField).toBeFocused();

    await page.keyboard.type(email);
    await page.keyboard.press("Tab");
    await expect(signInForm(page).getByLabel("Password")).toBeFocused();
    await page.keyboard.type(PASSWORD);
    await page.keyboard.press("Tab");
    const submit = signInForm(page).getByRole("button", { name: "Sign in" });
    await expect(submit).toBeFocused();
    expect(await submit.evaluate((el) => getComputedStyle(el).outlineStyle)).toBe("solid");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(HOME);
    await expectSignedInAs(page, email);
  });

  test("axe: empty form, registration notice, field errors, credential failure, signed-in shell", async ({
    page,
  }, testInfo) => {
    const email = await createAccount(page.request, "axe");
    await page.goto("/sign-in");
    await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
    await expect(accountNav(page).getByRole("link", { name: "Sign in" })).toBeVisible();
    await scan(page, testInfo, "sign-in-empty");

    await page.goto("/register");
    await page.getByLabel("Email address").fill(uniqueEmail("axe-reg"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByLabel("Confirm password").fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(signInForm(page).getByRole("status")).toHaveText(REGISTERED_NOTICE);
    await scan(page, testInfo, "sign-in-registered-notice");

    await signInForm(page).getByRole("button", { name: "Sign in" }).click();
    await expect(signInForm(page).getByLabel("Email address")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    await scan(page, testInfo, "sign-in-field-errors");

    await signInThroughUi(page, email, "not the password");
    await expect(signInForm(page).getByRole("alert")).toBeVisible();
    await scan(page, testInfo, "sign-in-credential-error");

    await signInThroughUi(page, email);
    await expectSignedInAs(page, email);
    await expect(page.getByRole("heading", { name: "Discover Landmarks" })).toBeVisible();
    await scan(page, testInfo, "signed-in-shell");
  });
});
