import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

// By the time this file's imports run, tests/setup/vitest.setup.integration.ts
// has already verified and pointed DATABASE_URL at landmarks_test (same
// pattern as health.integration.test.ts / routing.integration.test.ts).
// Exercises the real M01-T05 Landmark Retrieval API end-to-end (Supertest +
// real PostGIS), per ADR-009.

type Sensitivity = "UNREVIEWED" | "PUBLIC" | "SENSITIVE";

interface FixtureOptions {
  category?: "ARCH" | "BALD" | "FALLS" | "LAKE" | "OTHER" | "PEAK" | "ROCK" | "SINK";
  sourceFile?: "TNARCHES" | "TNBALDS" | "TNFALLS" | "TNLAKES" | "TNOTHER" | "TNPEAKS" | "TNROCKS" | "TNSINKS";
  sensitivityStatus?: Sensitivity;
  isActive?: boolean;
  baseLat?: number;
  baseLon?: number;
}

async function createBoundaryFixtures(count: number, prefix: string, options: FixtureOptions = {}) {
  const {
    category = "FALLS",
    sourceFile = "TNFALLS",
    sensitivityStatus = "UNREVIEWED",
    isActive = true,
    baseLat = 35.1,
    baseLon = -84.9,
  } = options;

  const data = Array.from({ length: count }, (_, i) => {
    const n = i + 1;
    return {
      sourceCode: `ZZZ${String(n).padStart(3, "0")}`,
      sourceFile,
      category,
      displayName: `${prefix} ${String(n).padStart(3, "0")}`,
      latitude: baseLat + n * 0.0001,
      longitude: baseLon + n * 0.0001,
      isActive,
      sensitivityStatus,
    };
  });

  await prisma.landmark.createMany({ data });
}

describe("Landmark Retrieval API (integration)", () => {
  afterEach(async () => {
    await resetTestDatabase();
  });

  describe("GET /api/v1/landmarks — plain name/category search", () => {
    it("surfaces UNREVIEWED/SENSITIVE landmarks by name without any coordinates or distance, and PUBLIC ones with coordinates", async () => {
      await prisma.landmark.create({
        data: {
          sourceCode: "FAL100",
          sourceFile: "TNFALLS",
          category: "FALLS",
          displayName: "Hidden Cove Falls",
          latitude: 35.2,
          longitude: -85.1,
          sensitivityStatus: "SENSITIVE",
        },
      });
      await prisma.landmark.create({
        data: {
          sourceCode: "FAL101",
          sourceFile: "TNFALLS",
          category: "FALLS",
          displayName: "Open Cove Falls",
          latitude: 35.3,
          longitude: -85.2,
          sensitivityStatus: "PUBLIC",
        },
      });

      const app = createApp();
      const response = await request(app).get("/api/v1/landmarks").query({ q: "Cove Falls" });

      expect(response.status).toBe(200);
      const byName = Object.fromEntries(response.body.items.map((item: Record<string, unknown>) => [item.display_name, item]));

      expect(byName["Hidden Cove Falls"]).toEqual({
        id: expect.any(String),
        display_name: "Hidden Cove Falls",
        category: "falls",
      });
      expect(byName["Open Cove Falls"]).toEqual({
        id: expect.any(String),
        display_name: "Open Cove Falls",
        category: "falls",
        latitude: 35.3,
        longitude: -85.2,
      });
    });

    it("escapes literal %, _, and backslash so they match literally rather than as wildcards", async () => {
      await prisma.landmark.create({
        data: {
          sourceCode: "OTH100",
          sourceFile: "TNOTHER",
          category: "OTHER",
          displayName: "100% Natural_Spot",
          latitude: 35.5,
          longitude: -85.5,
          sensitivityStatus: "PUBLIC",
        },
      });
      await prisma.landmark.create({
        data: {
          sourceCode: "OTH101",
          sourceFile: "TNOTHER",
          category: "OTHER",
          displayName: "100X NaturalZSpot",
          latitude: 35.6,
          longitude: -85.6,
          sensitivityStatus: "PUBLIC",
        },
      });

      const app = createApp();

      const literalMatch = await request(app).get("/api/v1/landmarks").query({ q: "100% Natural_Spot" });
      expect(literalMatch.body.items.map((i: { display_name: string }) => i.display_name)).toEqual([
        "100% Natural_Spot",
      ]);

      // If % / _ were unescaped wildcards, this would also match "100X NaturalZSpot".
      const wouldOverMatchIfUnescaped = await request(app).get("/api/v1/landmarks").query({ q: "100% Natural_Spot" });
      expect(wouldOverMatchIfUnescaped.body.items).toHaveLength(1);
    });

    it("rejects an unknown query parameter, malformed bbox, and a near/bbox conflict with a 400 INVALID_QUERY envelope", async () => {
      const app = createApp();

      const unknownParam = await request(app).get("/api/v1/landmarks").query({ sort: "name" });
      expect(unknownParam.status).toBe(400);
      expect(unknownParam.body.error.code).toBe("INVALID_QUERY");

      const malformedBbox = await request(app).get("/api/v1/landmarks").query({ bbox: "170,35,-170,36" });
      expect(malformedBbox.status).toBe(400);
      expect(malformedBbox.body.error.code).toBe("INVALID_QUERY");

      const conflict = await request(app)
        .get("/api/v1/landmarks")
        .query({ near: "35,-85", radius: "25", bbox: "-85,35,-84,36" });
      expect(conflict.status).toBe(400);
      expect(conflict.body.error.code).toBe("INVALID_QUERY");
    });
  });

  describe("GET /api/v1/landmarks — geographic discovery (bbox/near) restricted to active PUBLIC landmarks", () => {
    it("excludes a SENSITIVE landmark from bbox results even though its real coordinates fall inside the queried box", async () => {
      await prisma.landmark.create({
        data: {
          sourceCode: "PEK100",
          sourceFile: "TNPEAKS",
          category: "PEAK",
          displayName: "Secret Peak",
          latitude: 35.5,
          longitude: -85.0,
          sensitivityStatus: "SENSITIVE",
        },
      });
      await prisma.landmark.create({
        data: {
          sourceCode: "PEK101",
          sourceFile: "TNPEAKS",
          category: "PEAK",
          displayName: "Open Peak",
          latitude: 35.5,
          longitude: -85.0,
          sensitivityStatus: "PUBLIC",
        },
      });

      const app = createApp();
      const response = await request(app).get("/api/v1/landmarks").query({ bbox: "-86,35,-84,36" });

      expect(response.status).toBe(200);
      const names = response.body.items.map((item: { display_name: string }) => item.display_name);
      expect(names).toContain("Open Peak");
      expect(names).not.toContain("Secret Peak");
      expect(JSON.stringify(response.body)).not.toContain("Secret Peak");
    });

    it("excludes a SENSITIVE landmark from proximity results, with no distance leak, even when it is the closest point", async () => {
      await prisma.landmark.create({
        data: {
          sourceCode: "PEK200",
          sourceFile: "TNPEAKS",
          category: "PEAK",
          displayName: "Secret Near Peak",
          latitude: 35.500,
          longitude: -85.000,
          sensitivityStatus: "SENSITIVE",
        },
      });
      await prisma.landmark.create({
        data: {
          sourceCode: "PEK201",
          sourceFile: "TNPEAKS",
          category: "PEAK",
          displayName: "Open Far Peak",
          latitude: 35.520,
          longitude: -85.020,
          sensitivityStatus: "PUBLIC",
        },
      });

      const app = createApp();
      const response = await request(app)
        .get("/api/v1/landmarks")
        .query({ near: "35.500,-85.000", radius: "25" });

      expect(response.status).toBe(200);
      const names = response.body.items.map((item: { display_name: string }) => item.display_name);
      expect(names).toEqual(["Open Far Peak"]);
      expect(JSON.stringify(response.body)).not.toContain("Secret Near Peak");
    });
  });

  describe("pagination and is_truncated boundaries", () => {
    it.each([199, 200, 201])(
      "reports has_more/is_truncated correctly for %i matching rows (plain name search)",
      async (total) => {
        await createBoundaryFixtures(total, "BoundaryPlain");
        const app = createApp();
        const response = await request(app).get("/api/v1/landmarks").query({ q: "BoundaryPlain" });

        expect(response.status).toBe(200);
        expect(response.body.items).toHaveLength(Math.min(total, 200));
        expect(response.body.has_more).toBe(total > 200);
        expect(response.body.is_truncated).toBe(total > 200);
      },
    );

    it.each([199, 200, 201])(
      "reports has_more/is_truncated correctly for %i matching rows under a bbox filter (shared WHERE-builder)",
      async (total) => {
        await createBoundaryFixtures(total, "BoundaryGeo", { sensitivityStatus: "PUBLIC" });
        const app = createApp();
        const response = await request(app).get("/api/v1/landmarks").query({ bbox: "-85,35,-84,36" });

        expect(response.status).toBe(200);
        expect(response.body.items).toHaveLength(Math.min(total, 200));
        expect(response.body.has_more).toBe(total > 200);
        expect(response.body.is_truncated).toBe(total > 200);
      },
    );

    it("returns the second page's remaining row when a plain search has 201 total matches", async () => {
      await createBoundaryFixtures(201, "BoundaryPage2");
      const app = createApp();
      const page2 = await request(app).get("/api/v1/landmarks").query({ q: "BoundaryPage2", page: "2" });

      expect(page2.status).toBe(200);
      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.has_more).toBe(false);
      expect(page2.body.is_truncated).toBe(true);
    });

    it("pages through 120 rows at limit=50 with no overlap, no gaps, and order matching a single full fetch", async () => {
      await createBoundaryFixtures(120, "BoundaryCross");
      const app = createApp();

      const full = await request(app).get("/api/v1/landmarks").query({ q: "BoundaryCross", limit: "200" });
      const canonicalIds = full.body.items.map((i: { id: string }) => i.id);
      expect(canonicalIds).toHaveLength(120);

      const page1 = await request(app).get("/api/v1/landmarks").query({ q: "BoundaryCross", limit: "50", page: "1" });
      const page2 = await request(app).get("/api/v1/landmarks").query({ q: "BoundaryCross", limit: "50", page: "2" });
      const page3 = await request(app).get("/api/v1/landmarks").query({ q: "BoundaryCross", limit: "50", page: "3" });

      expect(page1.body.has_more).toBe(true);
      expect(page2.body.has_more).toBe(true);
      expect(page3.body.has_more).toBe(false);
      expect([page1, page2, page3].every((r) => r.body.is_truncated === false)).toBe(true);

      const concatenatedIds = [...page1.body.items, ...page2.body.items, ...page3.body.items].map(
        (i: { id: string }) => i.id,
      );
      expect(concatenatedIds).toEqual(canonicalIds);
    });
  });

  describe("GET /api/v1/landmarks/:id — full, minimal, and generic-404 profiles", () => {
    it("returns the full profile for an active PUBLIC landmark", async () => {
      const landmark = await prisma.landmark.create({
        data: {
          sourceCode: "ARC100",
          sourceFile: "TNARCHES",
          category: "ARCH",
          displayName: "Public Arch",
          latitude: 36.2,
          longitude: -84.1,
          sourceDescription: "Anderson",
          sourceAccessLabel: "private",
          sourceUrl: "http://example.com/public-arch",
          sensitivityStatus: "PUBLIC",
        },
      });

      const app = createApp();
      const response = await request(app).get(`/api/v1/landmarks/${landmark.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: landmark.id,
        display_name: "Public Arch",
        category: "arch",
        latitude: 36.2,
        longitude: -84.1,
        source_description: "Anderson",
        source_access_label: "private",
        source_url: "http://example.com/public-arch",
      });
    });

    it("returns exactly the §9.4a allowlist for an active UNREVIEWED landmark, with no other field present", async () => {
      const landmark = await prisma.landmark.create({
        data: {
          sourceCode: "ARC101",
          sourceFile: "TNARCHES",
          category: "ARCH",
          displayName: "Unreviewed Arch",
          latitude: 36.3,
          longitude: -84.2,
          sourceDescription: "Anderson",
          sourceAccessLabel: "private",
          sourceUrl: "http://example.com/unreviewed-arch",
          sensitivityStatus: "UNREVIEWED",
        },
      });

      const app = createApp();
      const response = await request(app).get(`/api/v1/landmarks/${landmark.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: landmark.id,
        display_name: "Unreviewed Arch",
        category: "arch",
        redacted: true,
      });
      expect(Object.keys(response.body).sort()).toEqual(["category", "display_name", "id", "redacted"]);
      expect(JSON.stringify(response.body)).not.toContain("36.3");
      expect(JSON.stringify(response.body)).not.toContain("Anderson");
      expect(JSON.stringify(response.body)).not.toContain("example.com");
    });

    it("returns exactly the §9.4a allowlist for an active SENSITIVE landmark", async () => {
      const landmark = await prisma.landmark.create({
        data: {
          sourceCode: "ARC102",
          sourceFile: "TNARCHES",
          category: "ARCH",
          displayName: "Sensitive Arch",
          latitude: 36.4,
          longitude: -84.3,
          sensitivityStatus: "SENSITIVE",
        },
      });

      const app = createApp();
      const response = await request(app).get(`/api/v1/landmarks/${landmark.id}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        id: landmark.id,
        display_name: "Sensitive Arch",
        category: "arch",
        redacted: true,
      });
    });

    it("returns the identical generic 404 for an unknown ID, a retired PUBLIC landmark, and a retired SENSITIVE landmark", async () => {
      const retiredPublic = await prisma.landmark.create({
        data: {
          sourceCode: "ARC103",
          sourceFile: "TNARCHES",
          category: "ARCH",
          displayName: "Retired Public Arch",
          latitude: 36.5,
          longitude: -84.4,
          isActive: false,
          sensitivityStatus: "PUBLIC",
        },
      });
      const retiredSensitive = await prisma.landmark.create({
        data: {
          sourceCode: "ARC104",
          sourceFile: "TNARCHES",
          category: "ARCH",
          displayName: "Retired Sensitive Arch",
          latitude: 36.6,
          longitude: -84.5,
          isActive: false,
          sensitivityStatus: "SENSITIVE",
        },
      });

      const app = createApp();
      const unknownId = "00000000-0000-0000-0000-000000000000";

      const responses = await Promise.all([
        request(app).get(`/api/v1/landmarks/${unknownId}`),
        request(app).get(`/api/v1/landmarks/${retiredPublic.id}`),
        request(app).get(`/api/v1/landmarks/${retiredSensitive.id}`),
        request(app).get("/api/v1/landmarks/not-a-uuid"),
      ]);

      const expectedBody = { error: { code: "NOT_FOUND", message: "Resource not found." } };
      for (const response of responses) {
        expect(response.status).toBe(404);
        expect(response.body).toEqual(expectedBody);
      }

      // No response leaks the retired landmarks' real names anywhere in the body.
      for (const response of responses) {
        expect(JSON.stringify(response.body)).not.toContain("Retired");
      }
    });
  });

  describe("GET /api/v1/categories", () => {
    it("returns all 8 approved category slugs and labels", async () => {
      const app = createApp();
      const response = await request(app).get("/api/v1/categories");

      expect(response.status).toBe(200);
      expect(response.body).toEqual([
        { slug: "arch", label: "Natural Arch" },
        { slug: "bald", label: "Mountain Bald" },
        { slug: "falls", label: "Waterfall" },
        { slug: "lake", label: "Lake" },
        { slug: "other", label: "Other Natural Feature" },
        { slug: "peak", label: "Mountain Peak" },
        { slug: "rock", label: "Rock Formation" },
        { slug: "sink", label: "Sinkhole" },
      ]);
    });
  });
});
