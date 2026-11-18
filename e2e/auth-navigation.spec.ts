import { test, expect } from "@playwright/test";

/**
 * M03-T03 Increment 2 — the shell's account navigation for a signed-out
 * visitor, against the REAL production-mode server: the browser's own
 * `GET /api/auth/get-session` (no interception) answers 200 with `null`, and
 * the header must show Sign in and Register — not the "couldn't check"
 * notice, which would mean the check failed rather than confirmed no session.
 */
test("a signed-out visitor sees Sign in and Register from a real session check", async ({
  page,
}) => {
  const sessionCheck = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/auth/get-session",
  );
  await page.goto("/");

  const response = await sessionCheck;
  expect(response.status()).toBe(200);
  expect(await response.json()).toBeNull();

  const account = page.getByRole("navigation", { name: "Account" });
  await expect(account.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/sign-in");
  await expect(account.getByRole("link", { name: "Register" })).toHaveAttribute(
    "href",
    "/register",
  );
  await expect(page.getByRole("button", { name: "Sign out" })).toHaveCount(0);
  await expect(page.getByText("Couldn't check whether you're signed in.")).toHaveCount(0);
  // Existing discovery navigation is untouched.
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Discover" }),
  ).toBeVisible();
  // No session data is kept in browser storage.
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
});
