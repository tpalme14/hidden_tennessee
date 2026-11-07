import { describe, expect, it } from "vitest";
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
