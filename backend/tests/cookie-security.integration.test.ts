import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { betterAuth } from "better-auth";
import { toNodeHandler } from "better-auth/node";
import request, { type Response } from "supertest";
import { buildAuthOptions } from "../src/auth/auth-options.js";
import { prisma } from "../src/db/prisma.js";
import { MemoryMailTransport } from "./helpers/memory-mail-transport.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T02 Increment 4 — cookie attributes under the PRODUCTION shape (https
 * public origin) without touching the application's own instance: a second
 * Better Auth instance is built from the same option builder with an https
 * base URL and mounted on a test-only app. The http shape (no Secure, plain
 * cookie name) is covered by auth.integration.test.ts.
 */

const HTTPS_ORIGIN = "https://landmarks.example.test";
const PASSWORD = "correct-horse-battery-staple";
const DAY = 24 * 60 * 60 * 1000;
const SECURE_COOKIE = "__Secure-better-auth.session_token";

const productionShapedAuth = betterAuth(
  buildAuthOptions({
    prisma,
    baseUrl: HTTPS_ORIGIN,
    secret: process.env.BETTER_AUTH_SECRET!,
    trustedOrigins: [],
    rateLimitEnabled: false,
    mailTransport: new MemoryMailTransport(),
  }),
);

const app = express();
app.all("/api/auth/*", toNodeHandler(productionShapedAuth));

function setCookies(response: Response): string[] {
  return (response.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
}

function attributes(cookie: string): string[] {
  return cookie
    .split(";")
    .slice(1)
    .map((a) => a.trim());
}

async function signIn(email: string) {
  await request(app).post("/api/auth/sign-up/email").send({ name: "", email, password: PASSWORD });
  const response = await request(app)
    .post("/api/auth/sign-in/email")
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return response;
}

describe("cookie security under an https public origin (integration, M03-T02 Increment 4)", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });
  afterEach(async () => {
    vi.useRealTimers();
    await resetTestDatabase();
  });

  it("sign-in sets the __Secure- prefixed cookie with Secure, HttpOnly, SameSite=Lax, Path=/ and a 30-day Max-Age", async () => {
    const response = await signIn("secure@example.com");
    const cookies = setCookies(response);
    expect(cookies).toHaveLength(1);
    const [cookie] = cookies;
    expect(cookie!.startsWith(`${SECURE_COOKIE}=`)).toBe(true);
    expect(attributes(cookie!).sort()).toEqual(
      ["HttpOnly", "Max-Age=2592000", "Path=/", "SameSite=Lax", "Secure"].sort(),
    );
    // No Domain attribute (host-only cookie) and no plain-named cookie.
    expect(cookie).not.toMatch(/Domain=/);
    expect(cookies.some((c) => c.startsWith("better-auth.session_token="))).toBe(false);
  });

  it("the prefixed cookie authenticates get-session, and renewal re-issues it with the same attributes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const signInResponse = await signIn("renew-secure@example.com");
    const cookie = setCookies(signInResponse)[0]!.split(";")[0]!;

    const before = await request(app).get("/api/auth/get-session").set("Cookie", cookie);
    expect(before.status).toBe(200);
    expect(before.body.user.email).toBe("renew-secure@example.com");
    expect(setCookies(before)).toEqual([]);

    vi.setSystemTime(new Date(Date.now() + 23 * DAY + 60_000));
    const renewed = await request(app).get("/api/auth/get-session").set("Cookie", cookie);
    expect(renewed.status).toBe(200);
    const renewedCookies = setCookies(renewed).filter((c) => c.startsWith(`${SECURE_COOKIE}=`));
    expect(renewedCookies).toHaveLength(1);
    expect(attributes(renewedCookies[0]!).sort()).toEqual(
      ["HttpOnly", "Max-Age=2592000", "Path=/", "SameSite=Lax", "Secure"].sort(),
    );
  });

  it("sign-out from the https origin clears the prefixed cookie with the same security attributes", async () => {
    const signInResponse = await signIn("signout-secure@example.com");
    const cookie = setCookies(signInResponse)[0]!.split(";")[0]!;

    const response = await request(app)
      .post("/api/auth/sign-out")
      .set("Cookie", cookie)
      .set("Origin", HTTPS_ORIGIN)
      .send({});

    expect(response.status).toBe(200);
    const cleared = setCookies(response).find((c) => c.startsWith(`${SECURE_COOKIE}=;`));
    expect(cleared).toBeDefined();
    expect(attributes(cleared!).sort()).toEqual(
      ["HttpOnly", "Max-Age=0", "Path=/", "SameSite=Lax", "Secure"].sort(),
    );
    expect(await prisma.session.count()).toBe(0);
  });

  it("the https instance still refuses a sign-out from the plain-http origin (exact origin match)", async () => {
    const signInResponse = await signIn("origin-secure@example.com");
    const cookie = setCookies(signInResponse)[0]!.split(";")[0]!;

    const response = await request(app)
      .post("/api/auth/sign-out")
      .set("Cookie", cookie)
      .set("Origin", "http://landmarks.example.test")
      .send({});

    expect(response.status).toBe(403);
    expect(await prisma.session.count()).toBe(1);
  });
});
