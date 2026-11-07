import { test, expect } from "@playwright/test";

// One trivial smoke test proving the pipeline (build, serve, browser) works
// end to end. There is no real product journey to test yet — this is
// honestly scoped to what M00-T05's foundation actually contains.
test("the application shell loads", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Tennessee Natural Landmarks Explorer" }),
  ).toBeVisible();
});
