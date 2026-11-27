import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Locator, Page, TestInfo } from "@playwright/test";
import { currentRunTag, expect, test, type FixtureLandmark } from "./helpers/favoritesFixtures";
import { UNICODE_REVIEW_CASES } from "../frontend/src/reviews/testdata/unicodeReviewCorpus";

/**
 * M04-T03 Increment 5 — real reviews journeys against the production-mode
 * server and `landmarks_test` (spec v1.1 §§3–8; §9 #1, #2, #5–#8, #10, #13,
 * #14).
 *
 * Every test gets synthetic PUBLIC fixtures from `favoriteFixtures` (guarded
 * inserts; server identity checked before the test body; guaranteed teardown,
 * which now also deletes the reviews on THIS test's fixtures) and its OWN new
 * accounts. Reviews are only ever written through the real API or UI.
 *
 * Interception is used only where a test says so: map tiles (no external
 * requests), one 429 on POST, one aborted PATCH, and one failing list GET.
 * The 401, 404, and 409 paths use REAL server responses.
 *
 * axe policy (as in favorites.spec.ts): serious/critical violations fail;
 * every finding and needs-review item is printed and attached.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "e2e reviews password";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function stubTiles(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
}

const newEmail = () => `e2e-rev-${currentRunTag()}-${randomUUID().slice(0, 8)}@example.com`;

/** Registers and signs in through `request` (a page's own jar, or a standalone context). */
async function signUpAndIn(request: APIRequestContext): Promise<string> {
  const email = newEmail();
  const headers = { Origin: ORIGIN };
  const signUp = await request.post("/api/auth/sign-up/email", {
    headers,
    data: { name: "", email, password: PASSWORD },
  });
  expect(signUp.status()).toBe(200);
  await signIn(request, email);
  return email;
}

async function signIn(request: APIRequestContext, email: string) {
  const response = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email, password: PASSWORD },
  });
  expect(response.status()).toBe(200);
}

/** Writes a review through the real API; returns its ID. */
async function postReview(
  request: APIRequestContext,
  landmark: FixtureLandmark,
  rating: number,
  body?: string,
): Promise<string> {
  const response = await request.post("/api/v1/reviews", {
    headers: { Origin: ORIGIN },
    data: { landmark_id: landmark.id, rating, ...(body !== undefined ? { body } : {}) },
  });
  expect(response.status()).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

/** The server's public view of a landmark's reviews. */
async function serverReviews(request: APIRequestContext, landmark: FixtureLandmark) {
  const response = await request.get(`/api/v1/landmarks/${landmark.id}/reviews?limit=100`);
  expect(response.status()).toBe(200);
  return (await response.json()) as {
    reviews: { id: string; rating: number; body: string | null }[];
    aggregate: { average_rating: number | null; rating_count: number };
  };
}

const reviewsRegion = (page: Page) => page.getByRole("region", { name: "Reviews" });
const reviewItems = (page: Page) => reviewsRegion(page).getByRole("list").getByRole("listitem");
const textArea = (page: Page) => page.getByRole("textbox", { name: "Review (optional)" });

async function openProfile(page: Page, landmark: FixtureLandmark) {
  await page.goto(`/landmarks/${landmark.id}`);
  await expect(page.getByRole("heading", { level: 2, name: landmark.displayName })).toBeVisible();
  await expect(
    reviewsRegion(page).getByText(/Loading reviews|Checking for your review/),
  ).toHaveCount(0);
}

async function isFocused(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => el === document.activeElement);
}

/** Tabs forward until `target` has focus (bounded). */
async function tabTo(page: Page, target: Locator, max = 60) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press("Tab");
    if (await isFocused(target)) return;
  }
  throw new Error(`Could not reach the target with Tab within ${max} presses`);
}

async function scan(page: Page, testInfo: TestInfo, state: string) {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  const summary = {
    state,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? "unknown",
      nodes: v.nodes.length,
      firstTarget: String(v.nodes[0]?.target ?? ""),
    })),
    incomplete: results.incomplete.map((i) => ({
      id: i.id,
      impact: i.impact ?? "unknown",
      nodes: i.nodes.length,
      firstTarget: String(i.nodes[0]?.target ?? ""),
    })),
    passes: results.passes.length,
  };
  await testInfo.attach(`axe-${state}.json`, {
    contentType: "application/json",
    body: JSON.stringify(
      { violations: results.violations, incomplete: results.incomplete },
      null,
      2,
    ),
  });
  console.log(`[axe] ${state}: ${JSON.stringify(summary)}`);
  const blocking = summary.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(blocking, `serious/critical axe violations in "${state}"`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await stubTiles(page);
});

// ---------------------------------------------------------------------------
// Anonymous
// ---------------------------------------------------------------------------

test("anonymous: empty and populated public reviews, a sign-in prompt, no ownership controls", async ({
  page,
  request,
  favoriteFixtures: fixtures,
}, testInfo) => {
  // Empty: "No reviews yet", never a zero-star rating.
  await openProfile(page, fixtures.hidden);
  await expect(reviewsRegion(page).getByText("No reviews yet")).toBeVisible();
  await expect(reviewsRegion(page).getByText(/0\.0|out of 5/)).toHaveCount(0);
  await scan(page, testInfo, "reviews-empty-anonymous");

  // Populated by another (API) user.
  await signUpAndIn(request);
  await postReview(request, fixtures.public, 5, "Clear trail to the overlook.");
  await openProfile(page, fixtures.public);
  const region = reviewsRegion(page);
  await expect(region.getByText("5.0 out of 5 · 1 review")).toBeVisible();
  await expect(reviewItems(page)).toHaveCount(1);
  await expect(reviewItems(page).first()).toContainText("Community Member");
  await expect(reviewItems(page).first()).toContainText("Clear trail to the overlook.");
  await expect(
    region.getByText(
      "Reviews are personal opinions. They do not establish public access, legal entry, maintained trails, or safety.",
    ),
  ).toBeVisible();
  const signInLink = region.getByRole("link", { name: "Sign in to write a review" });
  await expect(signInLink).toHaveAttribute(
    "href",
    `/sign-in?returnTo=${encodeURIComponent(`/landmarks/${fixtures.public.id}`)}`,
  );
  await expect(region.getByRole("button", { name: /edit|delete/i })).toHaveCount(0);
  await expect(page.getByText(/@example\.com/)).toHaveCount(0);
  await scan(page, testInfo, "reviews-populated-anonymous");
});

// ---------------------------------------------------------------------------
// The complete lifecycle
// ---------------------------------------------------------------------------

test("lifecycle: create, identify, edit, cancel, clear text, open/cancel delete, delete — with aggregates", async ({
  page,
  favoriteFixtures: { public: landmark },
}, testInfo) => {
  await signUpAndIn(page.request);
  await openProfile(page, landmark);
  const region = reviewsRegion(page);
  await expect(region.getByRole("form", { name: "Write a review" })).toBeVisible();
  await scan(page, testInfo, "reviews-create-form");

  // Validation: no rating → a focused summary whose link moves focus to the field.
  await textArea(page).fill("Mossy steps, bring good shoes.");
  await region.getByRole("button", { name: "Post review" }).click();
  const summary = region.getByRole("alert");
  await expect(summary).toContainText("There's a problem with your review:");
  await expect(summary).toBeFocused();
  await scan(page, testInfo, "reviews-validation-error");
  await summary.getByRole("link", { name: "Choose a rating from 1 to 5 stars." }).click();
  await expect(page.getByRole("radio", { name: "1 star" })).toBeFocused();

  // Create.
  await page.getByRole("radio", { name: "4 stars" }).check();
  await region.getByRole("button", { name: "Post review" }).click();
  await expect(
    region.getByRole("status").filter({ hasText: "Your review was posted." }),
  ).toBeVisible();
  const ownHeading = region.getByRole("heading", { level: 4, name: "Your review", exact: true });
  await expect(ownHeading).toBeFocused();
  await expect(region.getByText("4.0 out of 5 · 1 review")).toBeVisible();
  await expect(reviewItems(page).first()).toContainText("Your review");
  await expect(reviewItems(page).first()).not.toContainText("Community Member");
  await expect(reviewItems(page).getByRole("button")).toHaveCount(0);
  expect((await serverReviews(page.request, landmark)).aggregate).toEqual({
    average_rating: 4,
    rating_count: 1,
  });
  await scan(page, testInfo, "reviews-own-review");

  // Edit, then Cancel: nothing changes; focus returns to Edit.
  const editButton = region.getByRole("button", { name: "Edit your review" });
  await editButton.click();
  await expect(region.getByRole("heading", { name: "Edit your review" })).toBeFocused();
  await expect(page.getByRole("radio", { name: "4 stars" })).toBeChecked();
  await expect(textArea(page)).toHaveValue("Mossy steps, bring good shoes.");
  await scan(page, testInfo, "reviews-edit-form");
  await textArea(page).fill("Not saved");
  await region.getByRole("button", { name: "Cancel" }).click();
  await expect(editButton).toBeFocused();
  expect((await serverReviews(page.request, landmark)).reviews[0]!.body).toBe(
    "Mossy steps, bring good shoes.",
  );

  // Edit rating and text.
  await editButton.click();
  await page.getByRole("radio", { name: "2 stars" }).check();
  await textArea(page).fill("Slippery after rain.");
  const patch = page.waitForRequest((r) => r.method() === "PATCH");
  await region.getByRole("button", { name: "Save changes" }).click();
  expect((await patch).postDataJSON()).toEqual({ rating: 2, body: "Slippery after rain." });
  await expect(
    region.getByRole("status").filter({ hasText: "Your review was updated." }),
  ).toBeVisible();
  await expect(ownHeading).toBeFocused();
  await expect(region.getByText("2.0 out of 5 · 1 review")).toBeVisible();
  await expect(reviewItems(page).first()).toContainText("Slippery after rain.");
  await expect(reviewItems(page).first()).toContainText("Edited");

  // Clear the text: PATCH sends body: null and nothing else.
  await editButton.click();
  await textArea(page).fill("");
  const clearPatch = page.waitForRequest((r) => r.method() === "PATCH");
  await region.getByRole("button", { name: "Save changes" }).click();
  expect((await clearPatch).postDataJSON()).toEqual({ body: null });
  await expect(reviewItems(page).first()).not.toContainText("Slippery after rain.");
  expect((await serverReviews(page.request, landmark)).reviews[0]!.body).toBeNull();

  // Open and cancel the delete confirmation.
  const deleteButton = region.getByRole("button", { name: "Delete your review" });
  await deleteButton.click();
  const confirm = region.getByRole("group", { name: "Delete your review? This can't be undone." });
  await expect(confirm).toBeVisible();
  await expect(confirm.getByText("Delete your review? This can't be undone.")).toBeFocused();
  await scan(page, testInfo, "reviews-delete-confirmation");
  await confirm.getByRole("button", { name: "Cancel" }).click();
  await expect(deleteButton).toBeFocused();
  expect((await serverReviews(page.request, landmark)).aggregate.rating_count).toBe(1);

  // Confirm deletion.
  await deleteButton.click();
  await region.getByRole("button", { name: "Delete review" }).click();
  await expect(
    region.getByRole("status").filter({ hasText: "Your review was deleted." }),
  ).toBeVisible();
  await expect(region.getByRole("heading", { level: 3, name: "Reviews" })).toBeFocused();
  await expect(region.getByText("No reviews yet")).toBeVisible();
  await expect(region.getByRole("form", { name: "Write a review" })).toBeVisible();
  expect((await serverReviews(page.request, landmark)).aggregate).toEqual({
    average_rating: null,
    rating_count: 0,
  });
});

test("a second account sees the review as Community Member and cannot edit or delete it", async ({
  page,
  playwright,
  favoriteFixtures: { public: landmark },
}) => {
  const author = await playwright.request.newContext({ baseURL: ORIGIN });
  try {
    await signUpAndIn(author);
    const reviewId = await postReview(author, landmark, 3, "Author's words");

    await signUpAndIn(page.request);
    await openProfile(page, landmark);
    const region = reviewsRegion(page);
    await expect(reviewItems(page).first()).toContainText("Community Member");
    await expect(reviewItems(page).first()).not.toContainText("Your review");
    await expect(region.getByRole("button", { name: /edit|delete/i })).toHaveCount(0);
    await expect(region.getByRole("form", { name: "Write a review" })).toBeVisible();

    // Direct API attempts with the second account's session: the same 404 as a missing review.
    const patch = await page.request.patch(`/api/v1/reviews/${reviewId}`, {
      headers: { Origin: ORIGIN },
      data: { rating: 1 },
    });
    const del = await page.request.delete(`/api/v1/reviews/${reviewId}`, {
      headers: { Origin: ORIGIN },
    });
    for (const response of [patch, del]) {
      expect(response.status()).toBe(404);
      expect(await response.json()).toEqual({
        error: { code: "NOT_FOUND", message: "Resource not found." },
      });
    }
    const after = await serverReviews(page.request, landmark);
    expect(after.reviews).toEqual([
      expect.objectContaining({ id: reviewId, rating: 3, body: "Author's words" }),
    ]);
  } finally {
    await author.dispose();
  }
});

// ---------------------------------------------------------------------------
// Keyboard only
// ---------------------------------------------------------------------------

test("keyboard only: create, edit, and delete with focus moving predictably", async ({
  page,
  favoriteFixtures: { public: landmark },
}) => {
  await signUpAndIn(page.request);
  await openProfile(page, landmark);
  const region = reviewsRegion(page);

  // Create: Tab into the radio group, arrows choose, Tab to the text, Tab to Post.
  await tabTo(page, page.getByRole("radio", { name: "1 star" }));
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "3 stars" })).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(textArea(page)).toBeFocused();
  await page.keyboard.type("Typed with the keyboard");
  await page.keyboard.press("Tab");
  await expect(region.getByRole("button", { name: "Post review" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    region.getByRole("heading", { level: 4, name: "Your review", exact: true }),
  ).toBeFocused();

  // Edit: Tab to Edit, Enter, arrows, Tab to Save, Enter.
  await tabTo(page, region.getByRole("button", { name: "Edit your review" }));
  await page.keyboard.press("Enter");
  await expect(region.getByRole("heading", { name: "Edit your review" })).toBeFocused();
  await tabTo(page, page.getByRole("radio", { name: "3 stars" }));
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio", { name: "4 stars" })).toBeChecked();
  await tabTo(page, region.getByRole("button", { name: "Save changes" }));
  await page.keyboard.press("Enter");
  await expect(
    region.getByRole("heading", { level: 4, name: "Your review", exact: true }),
  ).toBeFocused();
  await expect(region.getByText("4.0 out of 5 · 1 review")).toBeVisible();

  // Delete: Tab to Delete, Enter (focus to the prompt), Tab, Enter.
  await tabTo(page, region.getByRole("button", { name: "Delete your review" }));
  await page.keyboard.press("Enter");
  await expect(region.getByText("Delete your review? This can't be undone.")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(region.getByRole("button", { name: "Delete review" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(region.getByRole("heading", { level: 3, name: "Reviews" })).toBeFocused();
  await expect(region.getByText("No reviews yet")).toBeVisible();
});

// ---------------------------------------------------------------------------
// Rendering in a real browser
// ---------------------------------------------------------------------------

test("review text is inert and bidirectional text is isolated in the rendered page", async ({
  page,
  playwright,
  favoriteFixtures: { public: landmark },
}) => {
  const hostile = '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b>bold</b>';
  const bidi = "safe ‮evil‬ words שלום";
  const writers = [
    await playwright.request.newContext({ baseURL: ORIGIN }),
    await playwright.request.newContext({ baseURL: ORIGIN }),
  ];
  try {
    await signUpAndIn(writers[0]!);
    await postReview(writers[0]!, landmark, 2, hostile);
    await signUpAndIn(writers[1]!);
    await postReview(writers[1]!, landmark, 4, `${bidi}\nsecond line`);

    await openProfile(page, landmark);
    const hostileBody = reviewsRegion(page).getByText(hostile, { exact: true });
    await expect(hostileBody).toBeVisible();
    expect(await hostileBody.evaluate((el) => el.children.length)).toBe(0);
    expect(
      await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
    ).toBeUndefined();
    await expect(reviewsRegion(page).locator("img, script, b")).toHaveCount(0);

    const bidiBody = reviewsRegion(page)
      .locator("p[dir='auto']")
      .filter({ hasText: "second line" });
    await expect(bidiBody).toHaveCount(1);
    const style = await bidiBody.evaluate((el) => {
      const computed = getComputedStyle(el);
      return { unicodeBidi: computed.unicodeBidi, whiteSpace: computed.whiteSpace };
    });
    expect(style.unicodeBidi).toBe("isolate");
    expect(style.whiteSpace).toBe("pre-wrap");
    // The attribution line beside it is not reordered by the body's controls.
    const meta = bidiBody.locator("xpath=preceding-sibling::p[1]");
    await expect(meta).toHaveText(/^Community Member · .+$/);
    expect(await meta.evaluate((el) => getComputedStyle(el).direction)).toBe("ltr");
  } finally {
    for (const writer of writers) await writer.dispose();
  }
});

test("Show more appends the next page, skips a duplicate after a new review, and moves focus", async ({
  page,
  playwright,
  favoriteFixtures: { public: landmark },
}) => {
  test.setTimeout(90_000);
  const writers: APIRequestContext[] = [];
  try {
    for (let i = 0; i < 22; i += 1)
      writers.push(await playwright.request.newContext({ baseURL: ORIGIN }));
    for (let i = 0; i < 21; i += 1) {
      await signUpAndIn(writers[i]!);
      await postReview(
        writers[i]!,
        landmark,
        (i % 5) + 1,
        `Review ${String(i + 1).padStart(2, "0")}`,
      );
    }
    await openProfile(page, landmark);
    const region = reviewsRegion(page);
    await expect(reviewItems(page)).toHaveCount(20);
    await expect(region.getByText("Showing 20 of 21 reviews.")).toBeVisible();

    // A 22nd review arrives at the top meanwhile: page 2 now repeats the 20th shown review.
    await signUpAndIn(writers[21]!);
    await postReview(writers[21]!, landmark, 5, "Review 22");

    await region.getByRole("button", { name: "Show more reviews" }).click();
    await expect(reviewItems(page)).toHaveCount(21);
    const texts = await reviewItems(page).allTextContents();
    expect(new Set(texts).size).toBe(21);
    expect(texts.filter((t) => t.includes("Review 01"))).toHaveLength(1);
    await expect(reviewItems(page).nth(20)).toBeFocused();
    await expect(region.getByRole("button", { name: /show more/i })).toHaveCount(0);
    await expect(region.getByText("Showing 21 of 22 reviews.")).toBeVisible();
    await expect(region.getByText("out of 5 · 22 reviews")).toBeVisible();
  } finally {
    for (const writer of writers) await writer.dispose();
  }
});

// ---------------------------------------------------------------------------
// Sessions and accounts
// ---------------------------------------------------------------------------

test("session expiry: a 401 on posting keeps the draft and shows the sign-in prompt", async ({
  page,
  favoriteFixtures: { public: landmark },
}) => {
  await signUpAndIn(page.request);
  await openProfile(page, landmark);
  const region = reviewsRegion(page);
  await page.getByRole("radio", { name: "5 stars" }).check();
  await textArea(page).fill("Written before my session ended");

  await page.context().clearCookies();
  const post = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/reviews"),
  );
  await region.getByRole("button", { name: "Post review" }).click();
  expect((await post).status()).toBe(401);

  await expect(region.getByRole("alert")).toContainText("Your session has ended.");
  await expect(region.getByRole("link", { name: "Sign in to write a review" })).toBeVisible();
  await expect(textArea(page)).toHaveValue("Written before my session ended");
  await expect(page.getByRole("radio", { name: "5 stars" })).toBeChecked();
  expect((await serverReviews(page.request, landmark)).aggregate.rating_count).toBe(0);
});

test("signing out removes ownership controls and stale data; another account never sees them", async ({
  page,
  favoriteFixtures: { public: landmark },
}) => {
  await signUpAndIn(page.request);
  await openProfile(page, landmark);
  const region = reviewsRegion(page);
  await page.getByRole("radio", { name: "3 stars" }).check();
  await region.getByRole("button", { name: "Post review" }).click();
  await expect(region.getByRole("button", { name: "Edit your review" })).toBeVisible();
  await expect(region.getByText("Your review was posted.")).toBeVisible();

  await page
    .getByRole("navigation", { name: "Account" })
    .getByRole("button", { name: "Sign out" })
    .click();
  await expect(
    page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Sign in" }),
  ).toBeVisible();
  await expect(region.getByRole("button", { name: /edit|delete/i })).toHaveCount(0);
  await expect(region.getByText("Your review", { exact: true })).toHaveCount(0);
  // Increment 6: the earlier success announcement does not outlive the session.
  await expect(region.getByText("Your review was posted.")).toHaveCount(0);
  await expect(reviewItems(page).first()).toContainText("Community Member");
  await expect(region.getByRole("link", { name: "Sign in to write a review" })).toBeVisible();

  await signUpAndIn(page.request);
  await page.reload();
  await expect(reviewsRegion(page).getByRole("form", { name: "Write a review" })).toBeVisible();
  await expect(reviewsRegion(page).getByRole("button", { name: /edit|delete/i })).toHaveCount(0);
  await expect(reviewItems(page).first()).toContainText("Community Member");
});

// ---------------------------------------------------------------------------
// Failure paths
// ---------------------------------------------------------------------------

test("409 (real): a review posted elsewhere is shown, and the unsent text can be used in an edit", async ({
  page,
  favoriteFixtures: { public: landmark },
}) => {
  await signUpAndIn(page.request);
  await openProfile(page, landmark);
  const region = reviewsRegion(page);
  await page.getByRole("radio", { name: "5 stars" }).check();
  await textArea(page).fill("My unsent second attempt");

  // The same account posts from "another tab" first.
  await postReview(page.request, landmark, 2, "Posted elsewhere");
  await region.getByRole("button", { name: "Post review" }).click();

  await expect(region.getByRole("alert")).toContainText("You've already reviewed this landmark.");
  await expect(
    region.getByRole("heading", { level: 4, name: "Your review", exact: true }),
  ).toBeVisible();
  await expect(region.getByRole("textbox", { name: "Text you hadn't posted" })).toHaveValue(
    "My unsent second attempt",
  );
  await region.getByRole("button", { name: "Edit using the text you hadn't posted" }).click();
  await expect(textArea(page)).toHaveValue("My unsent second attempt");
  await region.getByRole("button", { name: "Save changes" }).click();
  await expect(
    region.getByRole("status").filter({ hasText: "Your review was updated." }),
  ).toBeVisible();
  const server = await serverReviews(page.request, landmark);
  expect(server.reviews).toEqual([
    expect.objectContaining({ rating: 5, body: "My unsent second attempt" }),
  ]);
});

test("404 (real): deleting a review that was already deleted elsewhere is a neutral notice", async ({
  page,
  favoriteFixtures: { public: landmark },
}) => {
  await signUpAndIn(page.request);
  const id = await postReview(page.request, landmark, 4, "Soon gone");
  await openProfile(page, landmark);
  const region = reviewsRegion(page);
  await expect(region.getByRole("button", { name: "Delete your review" })).toBeVisible();

  // Deleted from "another tab".
  const gone = await page.request.delete(`/api/v1/reviews/${id}`, { headers: { Origin: ORIGIN } });
  expect(gone.status()).toBe(200);

  await region.getByRole("button", { name: "Delete your review" }).click();
  await region.getByRole("button", { name: "Delete review" }).click();
  await expect(region.getByRole("alert")).toHaveText(
    "This review has already been deleted or can no longer be changed.",
  );
  await expect(region.getByRole("heading", { level: 3, name: "Reviews" })).toBeFocused();
  await expect(region.getByText("No reviews yet")).toBeVisible();
});

test("429 (intercepted) keeps the draft and shows the wait; a later post succeeds", async ({
  page,
  favoriteFixtures: { public: landmark },
}) => {
  await signUpAndIn(page.request);
  await openProfile(page, landmark);
  const region = reviewsRegion(page);
  const postPattern = (url: URL) => url.pathname === "/api/v1/reviews";
  await page.route(postPattern, (route) =>
    route.request().method() === "POST"
      ? route.fulfill({
          status: 429,
          headers: { "Retry-After": "30" },
          json: {
            error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
          },
        })
      : route.continue(),
  );
  await page.getByRole("radio", { name: "4 stars" }).check();
  await textArea(page).fill("Throttled draft");
  await region.getByRole("button", { name: "Post review" }).click();
  await expect(region.getByRole("alert")).toHaveText(
    "Too many requests. Please try again in 30 seconds.",
  );
  await expect(textArea(page)).toHaveValue("Throttled draft");

  await page.unroute(postPattern);
  await region.getByRole("button", { name: "Post review" }).click();
  await expect(
    region.getByRole("status").filter({ hasText: "Your review was posted." }),
  ).toBeVisible();
});

test("a network failure on save keeps the edit; a failing list shows Try again and recovers", async ({
  page,
  favoriteFixtures: { public: landmark },
}, testInfo) => {
  await signUpAndIn(page.request);
  await postReview(page.request, landmark, 3, "Before");
  await openProfile(page, landmark);
  const region = reviewsRegion(page);

  // M06-T02 Increment 3b-i (amendment approved by the developer 2026-11-25):
  // a network-level failure is evidence that the server is unreachable, so
  // saving is unavailable until an explicit recovery (OFF-UX-5). Every review
  // mutation and every health check the page sends is counted.
  const mutations: string[] = [];
  const healthChecks: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (/^\/api\/v1\/reviews(\/|$)/.test(path) && request.method() !== "GET") {
      mutations.push(request.method());
    }
    if (path === "/health") healthChecks.push(request.method());
  });
  /** One animation frame: any request an earlier action started has been reported. */
  const settle = () =>
    page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(null))));
  const saveButton = region.getByRole("button", { name: "Save changes" });
  const originalRating = () => region.getByRole("radio", { name: "3 stars" });

  // PATCH aborted at the network level.
  await page.route(/\/api\/v1\/reviews\/[0-9a-f-]+$/, (route) =>
    route.request().method() === "PATCH" ? route.abort("failed") : route.continue(),
  );
  await region.getByRole("button", { name: "Edit your review" }).click();
  await textArea(page).fill("After");
  await saveButton.click();
  await expect(region.getByRole("alert")).toHaveText(
    "Your changes couldn't be saved. Please try again.",
  );
  await expect(textArea(page)).toHaveValue("After");
  await expect(originalRating()).toBeChecked();
  expect(mutations).toEqual(["PATCH"]);

  // Saving is now unavailable, with a visible reason linked to the button.
  const reason = "Unavailable while the server can't be reached.";
  await expect(saveButton).toHaveAttribute("aria-disabled", "true");
  await expect(region.getByText(reason)).toBeVisible();
  await expect(saveButton).toHaveAccessibleDescription(reason);
  // INTENTIONAL test action, not ordinary use: `force` presses the
  // aria-disabled button to prove the handler itself refuses (Playwright would
  // otherwise wait for it to become enabled).
  await saveButton.click({ force: true });
  await settle();
  expect(mutations).toEqual(["PATCH"]);

  // Removing the interception alone is not recovery and submits nothing.
  await page.unrouteAll();
  await stubTiles(page);
  await settle();
  await expect(saveButton).toHaveAttribute("aria-disabled", "true");
  expect(mutations).toEqual(["PATCH"]);
  expect(healthChecks).toEqual([]);

  // Explicit recovery: exactly one healthy GET /health.
  const health = page.waitForResponse((response) => new URL(response.url()).pathname === "/health");
  await page.getByRole("button", { name: "Check connection" }).click();
  const healthResponse = await health;
  expect(healthResponse.status()).toBe(200);
  expect(await healthResponse.json()).toMatchObject({ status: "ok" });
  await expect(page.locator("[data-connectivity-banner] [aria-live='polite']")).toHaveText(
    "Connected to the server.",
  );
  await settle();
  expect(healthChecks).toEqual(["GET"]);

  // Available again; the edit is unchanged and nothing was sent automatically.
  await expect(saveButton).not.toHaveAttribute("aria-disabled");
  await expect(saveButton).not.toHaveAccessibleDescription(reason);
  await expect(textArea(page)).toHaveValue("After");
  await expect(originalRating()).toBeChecked();
  expect(mutations).toEqual(["PATCH"]);

  // The explicit retry (an ordinary click, not forced).
  await saveButton.click();
  await expect(
    region.getByRole("status").filter({ hasText: "Your review was updated." }),
  ).toBeVisible();
  expect(mutations).toEqual(["PATCH", "PATCH"]);

  // The public list failing with a server error.
  const listPattern = (url: URL) => url.pathname === `/api/v1/landmarks/${landmark.id}/reviews`;
  await page.route(listPattern, (route) =>
    route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "x" } } }),
  );
  await page.reload();
  const alert = reviewsRegion(page)
    .getByRole("alert")
    .filter({ hasText: "Reviews couldn't be loaded." });
  await expect(alert).toBeVisible();
  await scan(page, testInfo, "reviews-list-error");
  await page.unroute(listPattern);
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(reviewItems(page).first()).toContainText("After");
});

// ---------------------------------------------------------------------------
// Unicode edge cases in the real browser (M04-T04 Increment 2). Every special
// string comes from the shared corpus (frontend/src/reviews/testdata), so the
// browser sees exactly the inputs the validator parity tests use.
// ---------------------------------------------------------------------------

function unicodeCase(id: string): string {
  const found = UNICODE_REVIEW_CASES.find((c) => c.id === id);
  if (!found) throw new Error(`No corpus case ${id}`);
  return found.input;
}

/** Horizontal overflow of the whole page in CSS pixels (0 = none). */
async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(
    () =>
      Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) -
      document.documentElement.clientWidth,
  );
}

/** The element lies horizontally inside the viewport. */
async function expectWithinWidth(locator: Locator, width: number, label: string) {
  const box = await locator.boundingBox();
  expect(box, label).not.toBeNull();
  expect(box!.x, label).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width, label).toBeLessThanOrEqual(width + 0.5);
}

test("zero-width-only text (D1) is accepted through the form, stored exactly, and rendered as inert text", async ({
  page,
  favoriteFixtures: { public: landmark },
}) => {
  const zeroWidth = unicodeCase("zw-space-only");
  expect(Array.from(zeroWidth).map((c) => c.codePointAt(0))).toEqual([0x200b]);
  await signUpAndIn(page.request);
  await openProfile(page, landmark);
  const region = reviewsRegion(page);
  await page.getByRole("radio", { name: "2 stars" }).check();
  await textArea(page).fill(zeroWidth);
  await expect(region.getByText("1 of 2,000 characters")).toBeVisible();
  await region.getByRole("button", { name: "Post review" }).click();
  await expect(
    region.getByRole("status").filter({ hasText: "Your review was posted." }),
  ).toBeVisible();
  // Neither the client nor the server refused it (no new rejection rule or warning).
  await expect(region.getByText("There's a problem with your review:")).toHaveCount(0);
  const server = await serverReviews(page.request, landmark);
  expect(server.reviews).toEqual([expect.objectContaining({ rating: 2, body: zeroWidth })]);

  const item = reviewItems(page).first();
  await expect(item).toContainText("Rated 2 out of 5");
  const body = item.locator("p[dir='auto']");
  await expect(body).toHaveCount(1);
  expect(
    await body.evaluate((el) => ({ text: el.textContent, children: el.children.length })),
  ).toEqual({ text: zeroWidth, children: 0 });

  // The owner's controls keep working: Edit shows the stored text exactly.
  const edit = region.getByRole("button", { name: "Edit your review" });
  await edit.click();
  await expect(textArea(page)).toHaveValue(zeroWidth);
  await region.getByRole("button", { name: "Cancel" }).click();
  await expect(edit).toBeFocused();
});

test("at 320 px, long unbroken, combining-mark, and astral text wraps without horizontal overflow; review controls stay usable", async ({
  page,
  playwright,
  favoriteFixtures: { public: landmark },
}, testInfo) => {
  const WIDTH = 320;
  await page.setViewportSize({ width: WIDTH, height: 720 });
  await signUpAndIn(page.request);
  await openProfile(page, landmark);
  expect(await horizontalOverflow(page), "the profile alone at 320 px").toBe(0);

  const longUnbroken = "W".repeat(2000);
  // "a" + 1,999 combining acute accents. Layout boxes, overflow, and
  // hit-testing ignore glyph ink, so this test asserts only horizontal fit and
  // control usability; that the marks (about 5,400 px of ink) are painted only
  // inside their review is verified by the paint-containment test below.
  const combining = unicodeCase("combining-2000");
  const astral = unicodeCase("astral-2000"); // 2,000 emoji (4,000 UTF-16 units)
  const ownText = `https://example.com/${"x".repeat(1980)}`; // one 2,000-code-point "word"
  for (const text of [longUnbroken, combining, astral, ownText]) {
    expect(Array.from(text)).toHaveLength(2000);
  }

  const writers = [
    await playwright.request.newContext({ baseURL: ORIGIN }),
    await playwright.request.newContext({ baseURL: ORIGIN }),
    await playwright.request.newContext({ baseURL: ORIGIN }),
  ];
  try {
    const others = [longUnbroken, combining, astral];
    for (const [i, text] of others.entries()) {
      await signUpAndIn(writers[i]!);
      await postReview(writers[i]!, landmark, 3, text);
    }
    await postReview(page.request, landmark, 4, ownText);
    await openProfile(page, landmark);
    const region = reviewsRegion(page);
    await expect(reviewItems(page)).toHaveCount(4);
    await expect(region.getByText(/3\.3 out of 5 . 4 reviews/)).toBeVisible();

    // No horizontal page overflow; every review and the own panel fit the width.
    expect(await horizontalOverflow(page), "with the reviews").toBe(0);
    for (let i = 0; i < 4; i += 1) {
      await expectWithinWidth(reviewItems(page).nth(i), WIDTH, `review ${i + 1}`);
    }
    const ownHeading = region.getByRole("heading", { level: 4, name: "Your review", exact: true });
    await expectWithinWidth(ownHeading, WIDTH, "own review heading");

    // Inert: each body is one text node with exactly the posted text.
    const bodies = await region
      .locator("p[dir='auto']")
      .evaluateAll((els) =>
        els.map((el) => ({ text: el.textContent, children: el.children.length })),
      );
    expect(bodies.every((b) => b.children === 0)).toBe(true);
    expect(bodies.map((b) => b.text).sort()).toEqual(
      [longUnbroken, combining, astral, ownText, ownText].sort(), // own text: panel + list
    );
    expect(await region.locator("img, script").count()).toBe(0);

    await page.screenshot({ path: testInfo.outputPath("reviews-320.png"), fullPage: true });
    await testInfo.attach("reviews-320", {
      path: testInfo.outputPath("reviews-320.png"),
      contentType: "image/png",
    });

    // The controls beside the long text stay visible, unobscured, and working.
    const edit = region.getByRole("button", { name: "Edit your review" });
    await edit.scrollIntoViewIfNeeded();
    await expectWithinWidth(edit, WIDTH, "Edit");
    await edit.click({ trial: true }); // actionability: visible, stable, not covered
    await edit.click();
    await expect(textArea(page)).toHaveValue(ownText);
    await expectWithinWidth(textArea(page), WIDTH, "edit text area");
    expect(await horizontalOverflow(page), "while editing").toBe(0);
    await region.getByRole("button", { name: "Cancel" }).click();
    await expect(edit).toBeFocused();

    const del = region.getByRole("button", { name: "Delete your review" });
    await expectWithinWidth(del, WIDTH, "Delete");
    await del.click({ trial: true });
    await del.click();
    const confirm = region.getByRole("button", { name: "Delete review" });
    await expectWithinWidth(confirm, WIDTH, "Delete review");
    await confirm.click({ trial: true });
    expect(await horizontalOverflow(page), "while confirming").toBe(0);
    await region
      .getByRole("group", { name: "Delete your review? This can't be undone." })
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(del).toBeFocused();
    expect((await serverReviews(page.request, landmark)).aggregate.rating_count).toBe(4);
  } finally {
    for (const writer of writers) await writer.dispose();
  }
});

// ---------------------------------------------------------------------------
// Paint containment of review text (M04-T04 Increment 2 rendering fix).
// ---------------------------------------------------------------------------

const cp = (...codes: number[]) => String.fromCodePoint(...codes);

/**
 * Paint geometry of every review body: its computed clipping and wrapping,
 * its box, and how far its glyph ink reaches above and below the box (from
 * canvas text metrics with the element's own computed font). Ink is never part
 * of layout boxes, overflow sizes, or hit-testing, so it is measured directly.
 */
async function bodyGeometry(page: Page) {
  return page.evaluate(() => {
    const ctx = document.createElement("canvas").getContext("2d")!;
    return Array.from(document.querySelectorAll<HTMLElement>("section p[dir='auto']")).map((el) => {
      const style = getComputedStyle(el);
      ctx.font = style.font;
      const lines = (el.textContent ?? "").split("\n");
      let inkAbove = 0;
      let inkBelow = 0;
      for (const line of lines) {
        const m = ctx.measureText(line);
        inkAbove = Math.max(inkAbove, m.actualBoundingBoxAscent);
        inkBelow = Math.max(inkBelow, m.actualBoundingBoxDescent);
      }
      const ref = ctx.measureText("x");
      const lineHeight = parseFloat(style.lineHeight);
      const halfLeading =
        (lineHeight - (ref.fontBoundingBoxAscent + ref.fontBoundingBoxDescent)) / 2;
      const paddingTop = parseFloat(style.paddingTop);
      const paddingBottom = parseFloat(style.paddingBottom);
      const box = el.getBoundingClientRect();
      const container = el.closest("li") ?? el.parentElement!;
      const outer = container.getBoundingClientRect();
      return {
        text: el.textContent ?? "",
        overflowX: style.overflowX,
        overflowY: style.overflowY,
        whiteSpace: style.whiteSpace,
        overflowWrap: style.overflowWrap,
        lines: lines.length,
        height: box.height,
        lineHeight,
        paddingTop,
        paddingBottom,
        // Room inside the clip box above the first baseline / below the last one.
        roomAbove: paddingTop + halfLeading + ref.fontBoundingBoxAscent,
        roomBelow: paddingBottom + halfLeading + ref.fontBoundingBoxDescent,
        inkAbove,
        inkBelow,
        contentCut:
          el.scrollHeight > el.clientHeight + 0.5 || el.scrollWidth > el.clientWidth + 0.5,
        insideContainer:
          box.top >= outer.top - 0.5 &&
          box.bottom <= outer.bottom + 0.5 &&
          box.left >= outer.left - 0.5 &&
          box.right <= outer.right + 0.5,
      };
    });
  });
}

test("stacked combining marks are painted only inside their review; ordinary accents, line breaks, and long text stay readable", async ({
  page,
  playwright,
  favoriteFixtures: { public: landmark },
}, testInfo) => {
  const WIDTH = 320;
  await page.setViewportSize({ width: WIDTH, height: 720 });
  await signUpAndIn(page.request);
  await openProfile(page, landmark);

  // The static regions above the reviews, captured with no review present. The
  // Leaflet map is excluded: its rendering varies between page loads under
  // full-suite load, so it is not a stable pixel baseline.
  const above = {
    header: page.locator("header").first(),
    heading: page.getByRole("heading", { level: 2, name: landmark.displayName }),
    profileDisclaimer: page.getByText(/^Coordinates and labels shown here do not establish/),
    reviewsDisclaimer: reviewsRegion(page).getByText(/^Reviews are personal opinions\./),
  };
  const before: Record<string, Buffer> = {};
  for (const [name, locator] of Object.entries(above)) {
    before[name] = await locator.screenshot({ animations: "disabled" });
  }

  // A valid 2,000-code-point review of stacked marks (the signed-in user's own,
  // so it appears directly below the disclaimers, in "Your review"), plus
  // ordinary accented multi-line text and long unbroken text by other users.
  const stacked = `a${cp(0x301).repeat(1999)}`;
  expect(Array.from(stacked)).toHaveLength(2000);
  const accented = [
    `Ti${cp(0x1ebf)}ng Vi${cp(0x1ec7)}t: ${cp(0x1ec4, 0x1eaa, 0x1ed6, 0x1eb6, 0x1ef8)}`,
    `E${cp(0x302, 0x303)} A${cp(0x306, 0x301)} O${cp(0x302, 0x309)} A${cp(0x30a, 0x301, 0x304)}`,
    `${cp(0x1fa, 0x1e16, 0x1d5, 0xc5)} gjpqy y${cp(0x323)} g${cp(0x327)} ${cp(0x1f04, 0x1f8c)}`,
  ].join("\n");
  const longUnbroken = "W".repeat(2000);
  const writers = [
    await playwright.request.newContext({ baseURL: ORIGIN }),
    await playwright.request.newContext({ baseURL: ORIGIN }),
  ];
  try {
    for (const [i, text] of [accented, longUnbroken].entries()) {
      await signUpAndIn(writers[i]!);
      await postReview(writers[i]!, landmark, 4, text);
    }
    await postReview(page.request, landmark, 3, stacked);
    await openProfile(page, landmark);
    const region = reviewsRegion(page);
    await expect(reviewItems(page)).toHaveCount(3);

    const geometry = await bodyGeometry(page);
    expect(geometry).toHaveLength(4); // the own panel plus three list entries
    for (const body of geometry) {
      const label = `${body.text.slice(0, 12)}... (${Array.from(body.text).length} code points)`;
      // The clip, with wrapping and line breaks unchanged.
      expect(body.overflowX, label).toBe("hidden");
      expect(body.overflowY, label).toBe("hidden");
      expect(body.whiteSpace, label).toBe("pre-wrap");
      expect(body.overflowWrap, label).toBe("anywhere");
      // Nothing is cut off: the box holds all of its lines.
      expect(body.contentCut, label).toBe(false);
      expect(body.insideContainer, label).toBe(true);
    }

    const stackedBodies = geometry.filter((b) => b.text === stacked);
    expect(stackedBodies).toHaveLength(2);
    for (const body of stackedBodies) {
      // Its ink reaches thousands of pixels beyond the box, so the clip is what contains it.
      expect(body.inkAbove).toBeGreaterThan(1000);
      expect(body.inkAbove).toBeGreaterThan(body.roomAbove + body.height);
    }
    const ordinary = geometry.filter((b) => b.text !== stacked);
    expect(ordinary.map((b) => b.text).sort()).toEqual([accented, longUnbroken].sort());
    for (const body of ordinary) {
      // Ordinary accents fit inside the clip box (nothing readable is clipped).
      expect(body.inkAbove, "ink above the first line").toBeLessThanOrEqual(body.roomAbove);
      expect(body.inkBelow, "ink below the last line").toBeLessThanOrEqual(body.roomBelow);
    }
    const multiline = geometry.find((b) => b.text === accented)!;
    expect(multiline.lines).toBe(3);
    expect(multiline.height).toBeGreaterThanOrEqual(3 * multiline.lineHeight);
    expect(await horizontalOverflow(page)).toBe(0);

    // Supplementary pixel check in the same browser: nothing above the reviews
    // was painted over (the original defect drew a column of marks over all of it).
    for (const [name, locator] of Object.entries(above)) {
      const after = await locator.screenshot({ animations: "disabled" });
      expect(after.equals(before[name]!), `${name} is unchanged`).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath("contained-320.png"), fullPage: true });
    await testInfo.attach("contained-320", {
      path: testInfo.outputPath("contained-320.png"),
      contentType: "image/png",
    });

    // Editing exposes the complete original text; the controls stay usable.
    const edit = region.getByRole("button", { name: "Edit your review" });
    await edit.click({ trial: true });
    await edit.click();
    await expect(textArea(page)).toHaveValue(stacked);
    await region.getByRole("button", { name: "Cancel" }).click();
    await expect(edit).toBeFocused();
    const del = region.getByRole("button", { name: "Delete your review" });
    await del.click({ trial: true });
    await del.click();
    await expect(region.getByRole("button", { name: "Delete review" })).toBeVisible();
    await scan(page, testInfo, "reviews-stacked-marks-320");
    await region
      .getByRole("group", { name: "Delete your review? This can't be undone." })
      .getByRole("button", { name: "Cancel" })
      .click();
    await expect(del).toBeFocused();
    expect((await serverReviews(page.request, landmark)).aggregate.rating_count).toBe(3);
  } finally {
    for (const writer of writers) await writer.dispose();
  }
});

// ---------------------------------------------------------------------------
// The REAL reviews limiter in the browser (M04-T04 Increment 4). A dedicated
// account spends its own quota, so other tests and workers are unaffected
// (limits are per user; the 10,000-key capacity is far away).
// ---------------------------------------------------------------------------

test("429 (real limiter): after 20 mutations the UI shows the server's wait time, keeps the draft, and creates nothing", async ({
  page,
  favoriteFixtures: { public: landmark },
}) => {
  await signUpAndIn(page.request);
  // Spend the real mutation quota (20 per minute). Invalid requests are admitted
  // and counted before validation, so nothing is created while doing so.
  for (let i = 0; i < 20; i += 1) {
    const spent = await page.request.post("/api/v1/reviews", {
      headers: { Origin: ORIGIN },
      data: { landmark_id: landmark.id, rating: 9 },
    });
    expect(spent.status(), `quota request ${i + 1}`).toBe(400);
  }
  const probe = await page.request.post("/api/v1/reviews", {
    headers: { Origin: ORIGIN },
    data: { landmark_id: landmark.id, rating: 3 },
  });
  expect(probe.status()).toBe(429);

  await openProfile(page, landmark); // the lookup bucket is separate, so the page loads normally
  const region = reviewsRegion(page);
  await page.getByRole("radio", { name: "4 stars" }).check();
  await textArea(page).fill("Throttled by the real server");
  const post = page.waitForResponse(
    (r) => r.request().method() === "POST" && r.url().endsWith("/api/v1/reviews"),
  );
  await region.getByRole("button", { name: "Post review" }).click();
  const response = await post;
  expect(response.status()).toBe(429);
  expect(response.headers()["cache-control"]).toBe("private, no-store");
  const retryAfter = Number(response.headers()["retry-after"]);
  expect(retryAfter).toBeGreaterThanOrEqual(1);
  expect(retryAfter).toBeLessThanOrEqual(60);

  // The server's own wait time, announced as an alert.
  const unit = retryAfter === 1 ? "second" : "seconds";
  const alert = region.getByRole("alert");
  await expect(alert).toHaveText(`Too many requests. Please try again in ${retryAfter} ${unit}.`);
  await expect(textArea(page)).toHaveValue("Throttled by the real server");
  await expect(page.getByRole("radio", { name: "4 stars" })).toBeChecked();
  await expect(region.getByRole("button", { name: "Post review" })).toBeEnabled();
  await expect(region.getByText("Your review was posted.")).toHaveCount(0);

  // Nothing was created (the lookup bucket still answers).
  const lookup = await page.request.get(`/api/v1/reviews?landmark_id=${landmark.id}`);
  expect(lookup.status()).toBe(200);
  expect(await lookup.json()).toEqual({ review: null });
  expect((await serverReviews(page.request, landmark)).aggregate.rating_count).toBe(0);
});
