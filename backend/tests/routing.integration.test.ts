import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";

// These don't exercise database behavior directly, but importing app.ts
// loads src/db/prisma.ts, whose module-level env check requires DATABASE_URL
// to be set — so this runs through the same guarded integration setup as
// health.integration.test.ts rather than needing a separate dummy value.
// Also depends on frontend/dist existing (built by `npm run build` before
// tests run, both locally and in CI).
describe("routing order", () => {
  it("returns a standardized JSON 404 for an unknown GET /api/* path", async () => {
    const app = createApp();
    const response = await request(app).get("/api/v1/nonexistent");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: "NOT_FOUND", message: "Resource not found." },
    });
  });

  it("returns a standardized JSON 404 for an unsupported method under /api/*", async () => {
    const app = createApp();
    const response = await request(app).post("/api/v1/nonexistent");

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: "NOT_FOUND", message: "Resource not found." },
    });
  });

  it("falls back to the built index.html for an unmatched GET navigation route", async () => {
    const app = createApp();
    const response = await request(app).get("/some/client/route");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/text\/html/);
    expect(response.text).toContain("Tennessee Natural Landmarks Explorer");
  });
});

/**
 * M06-T02 Increment 1a — ADR-008 routing contract: the SPA fallback must not
 * answer static or PWA infrastructure paths. A missing `/assets/*`,
 * `/icons/*`, `/sw.js`, `/manifest.webmanifest`, or `/workbox-*.js` file is a
 * JSON 404, never index.html with 200; existing files are still served by
 * `express.static`; every other GET navigation still gets the SPA.
 *
 * Uses two controlled build directories created in the OS temp directory, so
 * the presence or absence of each file is guaranteed regardless of what the
 * real frontend build contains. Nothing in the repository is written.
 */
describe("infrastructure file paths (ADR-008)", () => {
  const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Resource not found." } };
  const SHELL_MARKER = "controlled-test-shell";
  let root: string;
  let withoutFiles: string;
  let withFiles: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), "ht-routing-"));
    withoutFiles = path.join(root, "without");
    withFiles = path.join(root, "with");
    for (const dir of [withoutFiles, withFiles]) {
      mkdirSync(path.join(dir, "assets"), { recursive: true });
      writeFileSync(
        path.join(dir, "index.html"),
        `<!doctype html><html><head><title>${SHELL_MARKER}</title></head><body></body></html>`,
      );
      writeFileSync(path.join(dir, "assets", "present-abc123.js"), "export const present = 1;\n");
    }
    mkdirSync(path.join(withFiles, "icons"));
    writeFileSync(
      path.join(withFiles, "icons", "present.png"),
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    );
    writeFileSync(path.join(withFiles, "sw.js"), "self.addEventListener('install', () => {});\n");
    writeFileSync(path.join(withFiles, "manifest.webmanifest"), '{"name":"test"}\n');
    writeFileSync(path.join(withFiles, "workbox-present.js"), "export const workbox = 1;\n");
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function expectNotFoundJson(response: request.Response, label: string) {
    expect(response.status, label).toBe(404);
    expect(response.headers["content-type"], label).toMatch(/application\/json/);
    expect(response.body, label).toEqual(NOT_FOUND);
    expect(response.text, label).not.toContain(SHELL_MARKER);
  }

  it.each([
    "/assets/missing-x.js",
    "/icons/missing.png",
    "/sw.js",
    "/manifest.webmanifest",
    "/workbox-missing.js",
  ])("a missing %s is a JSON 404, not the application shell", async (missingPath) => {
    const response = await request(createApp({ frontendDistPath: withoutFiles })).get(missingPath);
    expectNotFoundJson(response, missingPath);
  });

  it.each([
    ["query string", "/sw.js?v=2"],
    ["query string", "/manifest.webmanifest?source=pwa"],
    ["query string", "/icons/missing.png?size=192"],
    ["upper case", "/SW.JS"],
    ["mixed case", "/Manifest.WebManifest"],
    ["upper-case directory", "/ASSETS/missing-x.js"],
    ["mixed-case Workbox file", "/Workbox-Missing.js"],
    ["percent-encoded directory", "/%61ssets/missing-x.js"],
    ["percent-encoded file name", "/sw%2Ejs"],
    ["nested missing asset", "/assets/nested/missing.css"],
  ])(
    "a missing infrastructure file with a %s variant (%s) is a JSON 404",
    async (_kind, variant) => {
      const response = await request(createApp({ frontendDistPath: withoutFiles })).get(variant);
      expectNotFoundJson(response, variant);
    },
  );

  it("HEAD for a missing infrastructure file is a 404 with no application shell", async () => {
    const response = await request(createApp({ frontendDistPath: withoutFiles })).head("/sw.js");
    expect(response.status).toBe(404);
    expect(response.text ?? "").not.toContain(SHELL_MARKER);
  });

  it.each([
    ["/assets/present-abc123.js", /javascript/],
    ["/icons/present.png", /image\/png/],
    ["/sw.js", /javascript/],
    ["/manifest.webmanifest", /application\/manifest\+json/],
    ["/workbox-present.js", /javascript/],
  ])("an existing %s is still served by express.static", async (existingPath, contentType) => {
    const response = await request(createApp({ frontendDistPath: withFiles })).get(existingPath);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(contentType);
    expect(response.text ?? "").not.toContain(SHELL_MARKER);
  });

  it.each([
    "/some/client/route",
    "/assetsx/missing.js",
    "/icons",
    "/sw.json",
    "/workbox.js",
    "/trips/assets/missing.js",
    "/landmarks/00000000-0000-4000-8000-000000000000",
  ])(
    "a non-infrastructure GET navigation (%s) still gets the application shell",
    async (navPath) => {
      const response = await request(createApp({ frontendDistPath: withoutFiles })).get(navPath);
      expect(response.status, navPath).toBe(200);
      expect(response.headers["content-type"], navPath).toMatch(/text\/html/);
      expect(response.text, navPath).toContain(SHELL_MARKER);
    },
  );

  it("API and health routing are unchanged by the controlled build directory", async () => {
    const app = createApp({ frontendDistPath: withoutFiles });
    const api = await request(app).get("/api/v1/nonexistent");
    expect(api.status).toBe(404);
    expect(api.body).toEqual(NOT_FOUND);
    const health = await request(app).get("/health");
    expect([200, 503]).toContain(health.status);
    expect(health.headers["content-type"]).toMatch(/application\/json/);
  });

  it("with the real frontend build, a missing asset is a JSON 404 and an existing one is served", async () => {
    const app = createApp();
    expectNotFoundJson(await request(app).get("/assets/missing-x.js"), "/assets/missing-x.js");
    const assetsDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../frontend/dist/assets",
    );
    const existing = `/assets/${readdirSync(assetsDir).find((f) => f.endsWith(".js"))}`;
    const response = await request(app).get(existing);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/javascript/);
  });
});
