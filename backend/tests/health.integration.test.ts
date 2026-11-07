import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

// By the time this file's imports run, tests/setup/vitest.setup.integration.ts
// has already verified and pointed DATABASE_URL at landmarks_test — createApp()
// (via src/db/prisma.ts) connects to the test database, never development.
describe("GET /health (integration)", () => {
  afterEach(async () => {
    await resetTestDatabase();
  });

  it("returns 200 and a safe body when the database is reachable", async () => {
    const app = createApp();
    const response = await request(app).get("/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });
});
