import AxeBuilder from "@axe-core/playwright";
import { test, expect, type Page, type TestInfo } from "@playwright/test";

/**
 * M02-T08 Increment 5b — automated accessibility scans (axe-core via
 * `@axe-core/playwright`) of the production build in real Chromium, across
 * the approved discovery/profile states, against WCAG 2.0, 2.1, and 2.2
 * Level A and AA rule tags.
 *
 * Policy (approved 2026-11-04):
 * - serious and critical violations FAIL the scan;
 * - minor and moderate violations are captured (attached as JSON and printed)
 *   for triage — they never silently pass unnoticed;
 * - axe "incomplete" (needs-review) checks are captured separately and are
 *   NOT counted as violations;
 * - no rules, elements, or Leaflet-generated markup are excluded. Any
 *   exclusion requires explicit developer approval first;
 * - an automated scan is evidence, not proof of conformance.
 *
 * The discovery API is intercepted at the browser's network layer with
 * synthetic PUBLIC fixtures (the real database has no PUBLIC landmarks and is
 * never touched); map tiles are stubbed so no external tile server is hit.
 * Every scan first waits for the intended state to be fully rendered — and
 * for no loading/updating text to remain — so a transient loading state is
 * never what gets scanned.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

const TRANSPARENT_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

const CATEGORIES = [
  { slug: "arch", label: "Natural Arch" },
  { slug: "bald", label: "Mountain Bald" },
  { slug: "falls", label: "Waterfall" },
  { slug: "lake", label: "Lake" },
  { slug: "other", label: "Other Natural Feature" },
  { slug: "peak", label: "Mountain Peak" },
  { slug: "rock", label: "Rock Formation" },
  { slug: "sink", label: "Sinkhole" },
];

const ALPHA = {
  id: "11111111-1111-4111-8111-111111111111",
  display_name: "Alpha Falls",
  category: "falls",
  latitude: 35.6,
  longitude: -85.6,
};
const BRAVO = {
  id: "22222222-2222-4222-8222-222222222222",
  display_name: "Bravo Peak",
  category: "peak",
  latitude: 35.9,
  longitude: -84.9,
};
const CHARLIE = {
  id: "33333333-3333-4333-8333-333333333333",
  display_name: "Charlie Arch",
  category: "arch",
  latitude: 36.2,
  longitude: -86.3,
};
const REDACTED_ID = "44444444-4444-4444-8444-444444444444";

type Item = typeof ALPHA;

function collection(items: Item[]) {
  return { items, page: 1, limit: 200, has_more: false, is_truncated: false };
}

/** Name/category only — what the plain list query returns for every status (never coordinates). */
function listItems(items: Item[]) {
  return items.map(({ id, display_name, category }) => ({ id, display_name, category }));
}

async function stubTiles(page: Page) {
  await page.route(/tile\.openstreetmap\.org/, (route) =>
    route.fulfill({ status: 200, contentType: "image/png", body: TRANSPARENT_PNG }),
  );
}

async function mockDiscoveryApi(page: Page, options: { fail?: boolean } = {}) {
  await stubTiles(page);
  await page.route("**/api/v1/categories", (route) => route.fulfill({ json: CATEGORIES }));
  await page.route("**/api/v1/landmarks?**", (route) => {
    if (options.fail) {
      return route.fulfill({
        status: 500,
        json: { error: { code: "INTERNAL", message: "Server error." } },
      });
    }
    const url = new URL(route.request().url());
    const isGeographic = url.searchParams.has("bbox") || url.searchParams.has("near");
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const all = [ALPHA, BRAVO, CHARLIE];
    const matching = q ? all.filter((i) => i.display_name.toLowerCase().includes(q)) : all;
    return route.fulfill({
      json: isGeographic ? collection(matching) : collection(listItems(matching) as Item[]),
    });
  });
}

async function mockProfileApi(page: Page, body: unknown) {
  await stubTiles(page);
  await page.route(/\/api\/v1\/landmarks\/[^/?]+$/, (route) => route.fulfill({ json: body }));
}

/** The intended state is only "stable" once no loading/updating text remains anywhere on the page. */
async function expectNoLoadingText(page: Page) {
  await expect(page.getByText(/loading|updating/i)).toHaveCount(0);
}

interface ScanSummary {
  state: string;
  violations: {
    id: string;
    impact: string;
    description: string;
    nodes: number;
    firstTarget: string;
    helpUrl: string;
  }[];
  incomplete: { id: string; impact: string; nodes: number; firstTarget: string }[];
  passes: number;
}

/** Runs axe against the whole page for the current state, attaches the full result, prints a summary, and fails on serious/critical violations. */
async function scan(page: Page, testInfo: TestInfo, state: string): Promise<ScanSummary> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();

  const summary: ScanSummary = {
    state,
    violations: results.violations.map((v) => ({
      id: v.id,
      impact: v.impact ?? "unknown",
      description: v.description,
      nodes: v.nodes.length,
      firstTarget: String(v.nodes[0]?.target ?? ""),
      helpUrl: v.helpUrl,
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
      { violations: results.violations, incomplete: results.incomplete, passes: summary.passes },
      null,
      2,
    ),
  });
  // Printed so the run output itself records every finding, not only failures.
  console.log(`[axe] ${state}: ${JSON.stringify(summary)}`);

  const blocking = summary.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  expect(
    blocking,
    `serious/critical axe violations in state "${state}": ${JSON.stringify(blocking, null, 2)}`,
  ).toEqual([]);
  return summary;
}

async function tabToFirstMarker(page: Page) {
  const marker = page.locator(".leaflet-marker-icon").first();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    if (await marker.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error("Could not reach the first marker with Tab within 25 presses");
}

test.describe("automated accessibility scans (axe-core, WCAG 2.0/2.1/2.2 A+AA)", () => {
  test("discovery page after initial load", async ({ page }, testInfo) => {
    await mockDiscoveryApi(page);
    await page.goto("/");
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(3);
    await expect(page.getByRole("heading", { name: "Landmarks on the map" })).toBeVisible();
    await expectNoLoadingText(page);
    await scan(page, testInfo, "discovery-initial");
  });

  test("discovery page with a landmark marker popup open", async ({ page }, testInfo) => {
    await mockDiscoveryApi(page);
    await page.goto("/");
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(3);
    await tabToFirstMarker(page);
    await page.keyboard.press("Enter");
    const group = page.getByRole("group", { name: /details$/ });
    await expect(group).toBeFocused();
    await expect(page.getByRole("link", { name: "View profile" })).toBeVisible();
    await expectNoLoadingText(page);
    await scan(page, testInfo, "discovery-popup-open");
  });

  test("name search with populated results", async ({ page }, testInfo) => {
    await mockDiscoveryApi(page);
    await page.goto("/");
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(3);
    await page.getByRole("textbox", { name: "Search landmarks by name" }).fill("Falls");
    const searchSection = page.locator("section", { has: page.locator("#search-heading") });
    await expect(searchSection.getByRole("link", { name: "Alpha Falls" })).toBeVisible();
    await expect(page.locator(".leaflet-marker-icon")).toHaveCount(1); // the map refetched with the same filter
    await expectNoLoadingText(page);
    await scan(page, testInfo, "name-search-populated");
  });

  test("discovery error state", async ({ page }, testInfo) => {
    await mockDiscoveryApi(page, { fail: true });
    await page.goto("/");
    const alerts = page.getByRole("alert");
    await expect(alerts.first()).toContainText("Server error.");
    await expect(page.getByRole("button", { name: "Try again" }).first()).toBeVisible();
    await expectNoLoadingText(page);
    await scan(page, testInfo, "discovery-error");
  });

  test("full PUBLIC landmark profile", async ({ page }, testInfo) => {
    await mockProfileApi(page, {
      ...ALPHA,
      source_description: "Synthetic County",
      source_access_label: "state park",
      source_url: "https://example.org/alpha-falls",
    });
    await page.goto(`/landmarks/${ALPHA.id}`);
    await expect(page.getByRole("heading", { name: "Alpha Falls" })).toBeVisible();
    await expect(
      page.getByRole("region", { name: /map showing the location of alpha falls/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "https://example.org/alpha-falls" })).toBeVisible();
    await expectNoLoadingText(page);
    await scan(page, testInfo, "profile-full");
  });

  test("redacted landmark profile", async ({ page }, testInfo) => {
    await mockProfileApi(page, {
      id: REDACTED_ID,
      display_name: "Hidden Sink",
      category: "sink",
      redacted: true,
    });
    await page.goto(`/landmarks/${REDACTED_ID}`);
    await expect(page.getByRole("heading", { name: "Hidden Sink" })).toBeVisible();
    await expect(
      page.getByText(/full details for this landmark are not currently available/i),
    ).toBeVisible();
    await expectNoLoadingText(page);
    await scan(page, testInfo, "profile-redacted");
  });
});
