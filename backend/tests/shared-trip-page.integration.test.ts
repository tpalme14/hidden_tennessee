import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SHARED_TRIP_PAGE_PATH, createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";

/**
 * M05-T06 Increment 5b — the shared-trip PAGE's HTTP headers (decisions D1,
 * D1a; spec v1.1 §7.2). The SPA fallback answers `/shared/trips/<segment>`
 * (the paths the frontend router matches to that route) with
 * `X-Robots-Tag: noindex, nofollow` and `Cache-Control: no-store`, for any
 * segment, with no lookup, authentication, or sharing-setting dependence —
 * and nothing else changes: other pages, static assets, and the shared-trip
 * API keep their existing headers. Final response headers are asserted.
 *
 * Like routing.integration.test.ts, this needs frontend/dist (built before the
 * tests, locally and in CI) and runs under the guarded integration setup
 * because importing app.ts loads the Prisma module. It makes no database
 * query and creates no fixture.
 */

const VALID_TOKEN = `${"A".repeat(21)}_${"z".repeat(21)}`; // 43 base64url characters
const ROBOTS = "noindex, nofollow";
const SEND_DEFAULT_CACHE = "public, max-age=0"; // send/serve-static default (maxAge 0)

const assetsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../frontend/dist/assets",
);
const ASSET = `/assets/${readdirSync(assetsDir).find((f) => f.endsWith(".js"))}`;

function expectPageHeaders(response: request.Response) {
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toMatch(/text\/html/);
  expect(response.text).toContain("Tennessee Natural Landmarks Explorer");
  expect(response.headers["x-robots-tag"]).toBe(ROBOTS);
  expect(response.headers["cache-control"]).toBe("no-store");
}

function expectOrdinaryPage(response: request.Response) {
  expect(response.status).toBe(200);
  expect(response.headers["content-type"]).toMatch(/text\/html/);
  expect(response.headers["x-robots-tag"]).toBeUndefined();
  expect(response.headers["cache-control"]).toBe(SEND_DEFAULT_CACHE);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("shared-trip page headers", () => {
  it.each([
    ["a valid-looking token", `/shared/trips/${VALID_TOKEN}`],
    ["a malformed short token", "/shared/trips/bad"],
    ["a token with padding", `/shared/trips/${VALID_TOKEN.slice(1)}=`],
    ["an encoded slash in the segment", "/shared/trips/a%2Fb"],
    ["a trailing slash", `/shared/trips/${VALID_TOKEN}/`],
    ["several trailing slashes", `/shared/trips/${VALID_TOKEN}//`],
    ["upper case", `/SHARED/Trips/${VALID_TOKEN}`],
    ["a query string", `/shared/trips/${VALID_TOKEN}?utm_source=x&ref=1`],
    ["a query string containing slashes", `/shared/trips/${VALID_TOKEN}?next=/trips/x&back=/`],
    ["a fragment-like query", `/shared/trips/bad?#x`],
  ])("%s gets the SPA HTML with both headers", async (_label, url) => {
    expectPageHeaders(await request(createApp()).get(url));
  });

  it("HEAD gets the same headers", async () => {
    const response = await request(createApp()).head(`/shared/trips/${VALID_TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers["x-robots-tag"]).toBe(ROBOTS);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("does not depend on authentication (no cookie, a forged cookie)", async () => {
    const app = createApp();
    expectPageHeaders(await request(app).get(`/shared/trips/${VALID_TOKEN}`));
    expectPageHeaders(
      await request(app)
        .get(`/shared/trips/${VALID_TOKEN}`)
        .set("Cookie", "better-auth.session_token=forged.value"),
    );
  });

  it("makes no database query and keeps the token out of the response headers", async () => {
    const spies = [
      vi.spyOn(prisma, "$queryRaw"),
      vi.spyOn(prisma, "$queryRawUnsafe"),
      vi.spyOn(prisma, "$executeRaw"),
      vi.spyOn(prisma, "$transaction"),
    ];
    const response = await request(createApp()).get(`/shared/trips/${VALID_TOKEN}`);
    expectPageHeaders(response);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    expect(JSON.stringify(response.headers)).not.toContain(VALID_TOKEN);
    expect(response.text).not.toContain(VALID_TOKEN);
  });

  it("keeps the HTML's referrer policy", async () => {
    const response = await request(createApp()).get(`/shared/trips/${VALID_TOKEN}`);
    expect(response.text).toContain('<meta name="referrer" content="strict-origin"');
  });
});

/**
 * M06-T02 Increment 2a — percent-encoded forms of the shared-trip page path.
 * React Router decodes the path before matching, so these display the shared
 * trip; before the correction the server matched only the raw path and sent
 * neither header (confirmed in Increment 2 with a real synthetic shared trip).
 * Synthetic tokens only.
 */
describe("percent-encoded shared-trip page paths (Increment 2a)", () => {
  const ENCODED_FIRST = `%${VALID_TOKEN.charCodeAt(0).toString(16)}${VALID_TOKEN.slice(1)}`;

  it.each([
    ["an encoded letter in 'shared'", `/%73hared/trips/${VALID_TOKEN}`],
    ["an encoded letter in 'trips'", `/shared/%74rips/${VALID_TOKEN}`],
    ["encoded letters in both fixed segments", `/%73hared/%74rips/${VALID_TOKEN}`],
    ["encoded upper-case letters", `/%53HARED/TRIPS/${VALID_TOKEN}`],
    ["mixed case with an encoded letter", `/Shar%65d/Trips/${VALID_TOKEN}`],
    ["an encoded letter and a trailing slash", `/%73hared/trips/${VALID_TOKEN}/`],
    ["an encoded letter and a query string", `/shared/%74rips/${VALID_TOKEN}?ref=link`],
    ["an encoded letter and an encoded token character", `/%73hared/trips/${ENCODED_FIRST}`],
    ["an encoded token character alone (already protected)", `/shared/trips/${ENCODED_FIRST}`],
    ["the canonical path (unchanged)", `/shared/trips/${VALID_TOKEN}`],
  ])("%s gets the SPA HTML with both headers", async (_label, url) => {
    expectPageHeaders(await request(createApp()).get(url));
  });

  it("an encoded slash between the fixed segments is conservatively protected too (still the SPA)", async () => {
    // The frontend does not render a shared trip here (React Router does not
    // decode %2F), but the decoded form names the shared route; the headers
    // are harmless and no other route contract is affected.
    expectPageHeaders(await request(createApp()).get(`/shared%2Ftrips/${VALID_TOKEN}`));
  });

  it("HEAD of an encoded path gets the same headers", async () => {
    const response = await request(createApp()).head(`/%73hared/trips/${VALID_TOKEN}`);
    expect(response.status).toBe(200);
    expect(response.headers["x-robots-tag"]).toBe(ROBOTS);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it.each([
    `/%73hared/trips/%E0%A4%A`,
    "/shared/trips/%",
    "/%zzshared/trips/a",
    "/%73hared/trips/a%ZZ",
  ])("malformed percent-encoding (%s) never causes a server error", async (url) => {
    const response = await request(createApp()).get(url);
    expect(response.status).toBeLessThan(500);
  });

  it.each(["/%74rips", "/%73haredx/trips/a", "/%73hared/trips", "/landm%61rks/x"])(
    "an encoded unrelated path (%s) keeps its existing headers",
    async (url) => {
      expectOrdinaryPage(await request(createApp()).get(url));
    },
  );
});

describe("sharing-setting independence", () => {
  it.each([true, false])("TRIP_SHARING_ENABLED = %s: the same page headers", async (enabled) => {
    vi.resetModules();
    const { env } = await import("../src/config/env.js");
    const previous = env.trips.sharingEnabled;
    (env.trips as { sharingEnabled: boolean }).sharingEnabled = enabled;
    try {
      const { createApp: freshApp } = await import("../src/app.js");
      const app = freshApp();
      expectPageHeaders(await request(app).get(`/shared/trips/${VALID_TOKEN}`));
      // The API keeps its own behavior: with sharing off every shared read is the generic 404.
      if (!enabled) {
        const api = await request(app).get(`/api/v1/shared/trips/${VALID_TOKEN}`);
        expect(api.status).toBe(404);
        expect(api.body).toEqual({ error: { code: "NOT_FOUND", message: "Resource not found." } });
      }
    } finally {
      (env.trips as { sharingEnabled: boolean }).sharingEnabled = previous;
      vi.resetModules();
    }
  });
});

describe("isolation", () => {
  it("the root page keeps its existing headers", async () => {
    const response = await request(createApp()).get("/");
    expectOrdinaryPage(response);
  });

  it.each([
    "/trips",
    "/trips/0f8fad5b-d9cb-469f-a165-70867728950e",
    "/favorites",
    "/landmarks/x",
    "/sign-in",
  ])("the unrelated page %s keeps its existing headers", async (url) => {
    expectOrdinaryPage(await request(createApp()).get(url));
  });

  it.each([
    "/shared/trips",
    "/shared/trips/",
    "/shared/trips/a/b",
    "/shared//trips/a",
    "/shared/trips//a",
    "/sharedx/trips/a",
    "/shared/tripsx/a",
    "/x/shared/trips/a",
    "/shared/trips-a",
  ])("the similar path %s (not the shared route) gets no new headers", async (url) => {
    expect(SHARED_TRIP_PAGE_PATH.test(url)).toBe(false);
    expectOrdinaryPage(await request(createApp()).get(url));
  });

  it("static assets keep their existing caching", async () => {
    const response = await request(createApp()).get(ASSET);
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/javascript/);
    expect(response.headers["cache-control"]).toBe(SEND_DEFAULT_CACHE);
    expect(response.headers["x-robots-tag"]).toBeUndefined();
  });

  it("the shared-trip API keeps its own headers and generic 404", async () => {
    const app = createApp();
    for (const url of [`/api/v1/shared/trips/bad`, `/api/v1/shared/trips/bad?x=1`]) {
      const response = await request(app).get(url);
      expect(response.status).toBe(404);
      expect(response.headers["content-type"]).toMatch(/application\/json/);
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(response.headers["x-robots-tag"]).toBe(ROBOTS);
      expect(response.body).toEqual({
        error: { code: "NOT_FOUND", message: "Resource not found." },
      });
    }
  });

  it("an unknown API path under the shared prefix is still the JSON 404, never the page", async () => {
    const response = await request(createApp()).get("/api/v1/shared/trips/a/b");
    expect(response.status).toBe(404);
    expect(response.headers["content-type"]).toMatch(/application\/json/);
    expect(response.headers["x-robots-tag"]).toBeUndefined();
  });

  it("a non-GET request to the page path is not the SPA (unchanged)", async () => {
    const response = await request(createApp()).post(`/shared/trips/${VALID_TOKEN}`);
    expect(response.status).toBe(404);
    expect(response.headers["x-robots-tag"]).toBeUndefined();
  });
});
