import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import type { APIRequestContext, Locator, Page, TestInfo } from "@playwright/test";
import {
  currentRunTag,
  expect,
  expectServerView,
  FIXTURE_REGION_BBOX,
  test,
  type FixtureLandmark,
  type TestFixtures,
} from "./helpers/favoritesFixtures";

/**
 * M03-T06 Increment 6C — real favorites journeys against the production-mode
 * server and `landmarks_test` (spec §8; §9.2 #11 and #15's UI half).
 *
 * Every test gets three synthetic PUBLIC fixtures from `favoriteFixtures`
 * (guarded inserts; server-database identity verified before the test body;
 * guaranteed teardown) and its OWN new user. Favorites are only ever created
 * through the real API or UI while the landmark is PUBLIC; redacted and
 * unavailable entries are produced afterwards by the guarded fixture
 * operations — never by inserting favorites rows.
 *
 * Interception is used only where a test says so: map tiles (no external
 * requests), one failing DELETE, and one failing favorites page GET.
 *
 * axe policy (as in accessibility.spec.ts): serious/critical violations fail;
 * every finding and needs-review item is printed and attached.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "e2e favorites password";
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
/** Coordinate text of the fixture region; must never appear on any page. */
const COORDINATE_TEXT = /160\.[0-9]|0\.5[0-9]?\b|latitude|longitude/i;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function stubTiles(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
}

/** Registers a new account (and optionally signs in) in the page's own cookie jar. */
async function createUser(page: Page, signIn: boolean): Promise<string> {
  const email = `e2e-fav-${currentRunTag()}-${randomUUID().slice(0, 8)}@example.com`;
  const headers = { Origin: ORIGIN };
  const signUp = await page.request.post("/api/auth/sign-up/email", {
    headers,
    data: { name: "", email, password: PASSWORD },
  });
  expect(signUp.status()).toBe(200);
  if (signIn) await signInViaApi(page.request, email);
  return email;
}

async function signInViaApi(request: APIRequestContext, email: string) {
  const response = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email, password: PASSWORD },
  });
  expect(response.status()).toBe(200);
}

/** Saves through the real API (session cookie + trusted Origin); the landmark must be PUBLIC. */
async function saveViaApi(request: APIRequestContext, landmark: FixtureLandmark) {
  const response = await request.put(`/api/v1/favorites/${landmark.id}`, {
    headers: { Origin: ORIGIN },
  });
  expect(response.status()).toBe(201);
}

/** The signed-in user's saved landmark IDs, newest first, from the real API. */
async function savedIds(request: APIRequestContext): Promise<string[]> {
  const response = await request.get("/api/v1/favorites?page=1&limit=100");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { favorites: { landmark_id: string }[] };
  return body.favorites.map((f) => f.landmark_id);
}

/**
 * Saves all three fixtures through the API while they are PUBLIC (public,
 * then hidden, then retired — so the list is retired, hidden, public), then
 * reclassifies hidden and retires retired with the guarded fixture operations,
 * and confirms the server's view of each.
 */
async function savedInAllThreeStates(page: Page, fixtures: TestFixtures) {
  await saveViaApi(page.request, fixtures.public);
  await saveViaApi(page.request, fixtures.hidden);
  await saveViaApi(page.request, fixtures.retired);
  await fixtures.makeHiddenSensitive();
  await fixtures.retire();
  await expectServerView(page.request, fixtures.hidden, "minimal");
  await expectServerView(page.request, fixtures.retired, "not_found");
}

const favoritesHeading = (page: Page) =>
  page.getByRole("heading", { level: 2, name: "My Favorites" });
const favoritesList = (page: Page) => page.getByRole("list", { name: "My Favorites" });
const profileToggle = (page: Page, landmark: FixtureLandmark) =>
  page.getByRole("button", { name: `Favorite ${landmark.displayName}` });
const removeNamed = (page: Page, landmark: FixtureLandmark) =>
  page.getByRole("button", { name: `Remove ${landmark.displayName} from favorites` });
const removeUnavailable = (page: Page, position: number) =>
  page.getByRole("button", { name: `Remove unavailable favorite, item ${position} on this page` });

/** Waits until the profile's favorite control has left the `checking` state. */
async function expectToggle(page: Page, landmark: FixtureLandmark, pressed: boolean) {
  const toggle = profileToggle(page, landmark);
  await expect(toggle).toHaveAttribute("aria-pressed", String(pressed));
  await expect(toggle).not.toHaveAttribute("aria-busy", "true");
}

async function openFavorites(page: Page) {
  await page.goto("/favorites");
  await expect(favoritesHeading(page)).toBeVisible();
  await expect(page.getByText(/Loading your favorites|Checking whether/)).toHaveCount(0);
}

/** Tabs forward until `target` has focus (bounded). */
async function tabTo(page: Page, target: Locator, max = 40) {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press("Tab");
    if (await target.evaluate((el) => el === document.activeElement)) return;
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
// Journeys
// ---------------------------------------------------------------------------

test("signed out: prompts on the profile and My Favorites; sign-in returns to the profile without saving", async ({
  page,
  favoriteFixtures: { public: landmark },
}, testInfo) => {
  const email = await createUser(page, false);
  const profilePath = `/landmarks/${landmark.id}`;

  // My Favorites: a sign-in prompt that returns here; no nav link.
  await openFavorites(page);
  await expect(page.getByRole("link", { name: "Sign in to see your favorites" })).toHaveAttribute(
    "href",
    "/sign-in?returnTo=%2Ffavorites",
  );
  await expect(
    page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "My Favorites" }),
  ).toHaveCount(0);
  await scan(page, testInfo, "favorites-signed-out");

  // Profile: "Sign in to save" with a safe returnTo of this profile.
  await page.goto(profilePath);
  const prompt = page.getByRole("link", { name: `Sign in to save ${landmark.displayName}` });
  await expect(prompt).toHaveAttribute(
    "href",
    `/sign-in?returnTo=${encodeURIComponent(profilePath)}`,
  );
  await prompt.click();

  const form = page.getByRole("region", { name: "Sign in" });
  await expect(form).toBeVisible();
  await form.getByLabel("Email address").fill(email);
  await form.getByLabel("Password").fill(PASSWORD);
  await form.getByRole("button", { name: "Sign in" }).click();

  // Back on the profile, signed in — and nothing was saved automatically (K4).
  await expect(page).toHaveURL(profilePath);
  await expectToggle(page, landmark, false);
  expect(await savedIds(page.request)).toEqual([]);
});

test("save from a PUBLIC profile: confirmed, announced, persists after reload, matches the API", async ({
  page,
  favoriteFixtures: { public: landmark },
}, testInfo) => {
  await createUser(page, true);
  await page.goto(`/landmarks/${landmark.id}`);
  await expectToggle(page, landmark, false);

  await profileToggle(page, landmark).click();
  await expectToggle(page, landmark, true);
  await expect(page.getByRole("status").filter({ hasText: "Saved to favorites." })).toBeVisible();
  expect(await savedIds(page.request)).toEqual([landmark.id]);
  await scan(page, testInfo, "profile-favorite-saved");

  await page.reload();
  await expectToggle(page, landmark, true);
  expect(await savedIds(page.request)).toEqual([landmark.id]);
});

test("saved state stays in sync across the profile, My Favorites, and the geographic results list", async ({
  page,
  favoriteFixtures: { public: landmark },
}) => {
  await createUser(page, true);
  const geoPath = `/?bbox=${FIXTURE_REGION_BBOX}&lat=0.52&lng=-160.48&zoom=12`;
  const geoButton = page
    .getByRole("region", { name: "Landmarks on the map" })
    .getByRole("button", { name: `Favorite ${landmark.displayName}` });

  // Save on the profile.
  await page.goto(`/landmarks/${landmark.id}`);
  await expectToggle(page, landmark, false);
  await profileToggle(page, landmark).click();
  await expectToggle(page, landmark, true);

  // The geographic list shows it saved.
  await page.goto(geoPath);
  await expect(geoButton).toHaveAttribute("aria-pressed", "true");

  // Remove on My Favorites (client-side navigation keeps the same provider).
  await page
    .getByRole("navigation", { name: "Primary" })
    .getByRole("link", { name: "My Favorites" })
    .click();
  await expect(favoritesList(page).getByRole("link", { name: landmark.displayName })).toBeVisible();
  await removeNamed(page, landmark).click();
  await expect(favoritesList(page)).toHaveCount(0);
  await expect(page.getByText("You haven't saved any landmarks yet.")).toBeVisible();

  // Profile and geographic list now show it unsaved; the API agrees.
  await page.goto(`/landmarks/${landmark.id}`);
  await expectToggle(page, landmark, false);
  await page.goto(geoPath);
  await expect(geoButton).toHaveAttribute("aria-pressed", "false");
  expect(await savedIds(page.request)).toEqual([]);
});

test("My Favorites lists available, redacted, and unavailable entries with only what each may show", async ({
  page,
  favoriteFixtures: fixtures,
}, testInfo) => {
  await createUser(page, true);
  await savedInAllThreeStates(page, fixtures);
  await openFavorites(page);

  const items = favoritesList(page).getByRole("listitem");
  await expect(items).toHaveCount(3);
  const [unavailable, redacted, available] = [items.nth(0), items.nth(1), items.nth(2)];

  // Unavailable: "No longer available" and Remove only — no name, category, link, or location.
  await expect(unavailable).toHaveText(/^\s*No longer available\s*Remove\s*$/);
  await expect(unavailable.getByRole("link")).toHaveCount(0);
  await expect(unavailable).not.toContainText(fixtures.retired.displayName);
  await expect(unavailable).not.toContainText("Mountain Bald");
  await expect(removeUnavailable(page, 1)).toBeVisible();

  // Redacted: link, name, category, note, Remove — no coordinates.
  await expect(redacted.getByRole("link", { name: fixtures.hidden.displayName })).toHaveAttribute(
    "href",
    `/landmarks/${fixtures.hidden.id}`,
  );
  await expect(redacted).toContainText("Natural Arch");
  await expect(redacted).toContainText("Full details aren't currently available.");
  await expect(removeNamed(page, fixtures.hidden)).toBeVisible();

  // Available: link, name, category, Remove — no coordinates.
  await expect(available.getByRole("link", { name: fixtures.public.displayName })).toHaveAttribute(
    "href",
    `/landmarks/${fixtures.public.id}`,
  );
  await expect(available).toContainText("Waterfall");
  await expect(removeNamed(page, fixtures.public)).toBeVisible();

  await expect(page.locator("main")).not.toContainText(COORDINATE_TEXT);
  await scan(page, testInfo, "favorites-populated");

  // The redacted link opens the minimal profile — still no coordinates.
  await redacted.getByRole("link", { name: fixtures.hidden.displayName }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: fixtures.hidden.displayName }),
  ).toBeVisible();
  await expect(
    page.getByText("Full details for this landmark are not currently available."),
  ).toBeVisible();
  await expect(page.locator("main")).not.toContainText(COORDINATE_TEXT);
  await expect(page.locator(".leaflet-container")).toHaveCount(0);
});

test("keyboard-only removal: focus moves next, then previous, then to the heading; empty state leads to Discover", async ({
  page,
  favoriteFixtures: fixtures,
}, testInfo) => {
  await createUser(page, true);
  await savedInAllThreeStates(page, fixtures);
  await openFavorites(page);
  await expect(favoritesList(page).getByRole("listitem")).toHaveCount(3);

  // Order: [unavailable, hidden (redacted), public]. Remove the MIDDLE entry by keyboard.
  await tabTo(page, removeNamed(page, fixtures.hidden));
  await page.keyboard.press("Enter");
  await expect(favoritesList(page).getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("status")).toHaveText(
    `Removed ${fixtures.hidden.displayName} from favorites.`,
  );
  // Next: the public entry's Remove button.
  await expect(removeNamed(page, fixtures.public)).toBeFocused();

  // Remove the LAST entry: focus falls back to the previous Remove button.
  await page.keyboard.press("Enter");
  await expect(favoritesList(page).getByRole("listitem")).toHaveCount(1);
  await expect(removeUnavailable(page, 1)).toBeFocused();

  // Remove the ONLY entry: focus goes to the heading; empty state appears.
  await page.keyboard.press("Space");
  await expect(page.getByText("You haven't saved any landmarks yet.")).toBeVisible();
  await expect(favoritesHeading(page)).toBeFocused();
  await expect(page.getByRole("status")).toHaveText("Removed an unavailable favorite.");
  expect(await savedIds(page.request)).toEqual([]);
  await scan(page, testInfo, "favorites-empty");

  // Discover, by keyboard.
  const discover = page.getByRole("link", { name: "Discover landmarks", exact: true });
  await tabTo(page, discover);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/^http:\/\/localhost:3000\/(\?.*)?$/);
  await expect(page.getByRole("heading", { name: "Discover Landmarks" })).toBeVisible();
});

test("a failed DELETE never removes the entry; a later attempt succeeds", async ({
  page,
  favoriteFixtures: { public: landmark },
}) => {
  await createUser(page, true);
  await saveViaApi(page.request, landmark);
  await openFavorites(page);

  // Only this landmark's DELETE fails, and only until unrouted.
  const deletePattern = `**/api/v1/favorites/${landmark.id}`;
  await page.route(deletePattern, (route) =>
    route.request().method() === "DELETE"
      ? route.fulfill({
          status: 503,
          json: { error: { code: "SERVICE_UNAVAILABLE", message: "Unavailable." } },
        })
      : route.continue(),
  );
  await removeNamed(page, landmark).click();
  await expect(page.getByRole("alert")).toHaveText(
    `${landmark.displayName}: Couldn't update favorites. Please try again.`,
  );
  await expect(favoritesList(page).getByRole("link", { name: landmark.displayName })).toBeVisible();
  await expect(removeNamed(page, landmark)).not.toHaveAttribute("aria-disabled", "true");
  expect(await savedIds(page.request)).toEqual([landmark.id]);

  await page.unroute(deletePattern);
  await removeNamed(page, landmark).click();
  await expect(page.getByText("You haven't saved any landmarks yet.")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await savedIds(page.request)).toEqual([]);
});

test("expired session: Remove gets 401, the session is re-checked, the sign-in prompt replaces the list", async ({
  page,
  favoriteFixtures: { public: landmark },
}) => {
  const email = await createUser(page, true);
  await saveViaApi(page.request, landmark);
  await openFavorites(page);
  await expect(favoritesList(page).getByRole("link", { name: landmark.displayName })).toBeVisible();

  await page.context().clearCookies();
  const deleteResponse = page.waitForResponse(
    (r) =>
      r.request().method() === "DELETE" && r.url().endsWith(`/api/v1/favorites/${landmark.id}`),
  );
  await removeNamed(page, landmark).click();
  expect((await deleteResponse).status()).toBe(401);

  // Only the verified session state signs the user out of the UI (K12).
  await expect(page.getByRole("link", { name: "Sign in to see your favorites" })).toBeVisible();
  await expect(favoritesList(page)).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: "Account" }).getByRole("link", { name: "Sign in" }),
  ).toBeVisible();
  await expect(page).toHaveURL("/favorites");

  // The favorite was never removed.
  await signInViaApi(page.request, email);
  expect(await savedIds(page.request)).toEqual([landmark.id]);
});

test("a failing favorites list request shows an alert with Try again, and recovers", async ({
  page,
  favoriteFixtures: { public: landmark },
}, testInfo) => {
  await createUser(page, true);
  await saveViaApi(page.request, landmark);

  // Only the My Favorites page request (limit=50) fails; membership (limit=100) is untouched.
  const listPattern = (url: URL) =>
    url.pathname === "/api/v1/favorites" &&
    url.searchParams.get("page") === "1" &&
    url.searchParams.get("limit") === "50";
  await page.route(listPattern, (route) =>
    route.fulfill({ status: 500, json: { error: { code: "INTERNAL_ERROR", message: "x" } } }),
  );
  await page.goto("/favorites");
  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Couldn't load your favorites. Please try again.");
  await expect(favoritesList(page)).toHaveCount(0);
  await scan(page, testInfo, "favorites-error");

  await page.unroute(listPattern);
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(favoritesList(page).getByRole("link", { name: landmark.displayName })).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
});
