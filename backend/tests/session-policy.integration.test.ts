import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request, { type Response } from "supertest";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T02 Increment 3 — the approved session policy (spec §3: renewable
 * 30-day sessions, renewed when used within seven days of expiry; ordinary
 * sign-out revokes only the current session), verified through Better Auth's
 * own `/api/auth/get-session` endpoint on the real app and database.
 *
 * Time is controlled by faking ONLY `Date` (Vitest `toFake: ["Date"]`), so
 * the HTTP stack and the database driver run normally while the library's
 * expiry/renewal arithmetic sees the advanced clock.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const DAY = 24 * 60 * 60 * 1000;
const THIRTY_DAYS = 30 * DAY;

const app = createApp();

function setCookies(response: Response): string[] {
  return (response.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
}

function sessionTokenCookies(response: Response): string[] {
  return setCookies(response).filter((c) => c.startsWith("better-auth.session_token="));
}

async function signIn(email: string) {
  const signUp = await request(app)
    .post("/api/auth/sign-up/email")
    .send({ name: "", email, password: PASSWORD });
  expect(signUp.status).toBe(200);
  const response = await request(app)
    .post("/api/auth/sign-in/email")
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  const [cookie] = sessionTokenCookies(response);
  return { cookie: cookie!.split(";")[0]!, token: response.body.token as string };
}

function getSession(cookie: string) {
  return request(app).get("/api/auth/get-session").set("Cookie", cookie);
}

function advanceBy(ms: number) {
  vi.setSystemTime(new Date(Date.now() + ms));
}

/** The session row's `expiresAt`, or null when the row is gone. */
async function storedExpiry(token: string) {
  const row = await prisma.session.findUnique({ where: { token } });
  return row?.expiresAt ?? null;
}

describe("session policy (integration, M03-T02 Increment 3)", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await resetTestDatabase();
  });

  it("issues a session that expires 30 days after sign-in", async () => {
    const { token } = await signIn("issue@example.com");
    const expiresAt = await storedExpiry(token);
    expect(expiresAt).not.toBeNull();
    expect(Math.abs(expiresAt!.getTime() - (Date.now() + THIRTY_DAYS))).toBeLessThan(5_000);
  });

  it("does not renew a session used 22 days in (more than seven days left)", async () => {
    const { cookie, token } = await signIn("early@example.com");
    const originalExpiry = (await storedExpiry(token))!;

    advanceBy(22 * DAY);
    const response = await getSession(cookie);

    expect(response.status).toBe(200);
    expect(response.body.session.token).toBe(token);
    expect(new Date(response.body.session.expiresAt).getTime()).toBe(originalExpiry.getTime());
    expect(sessionTokenCookies(response)).toEqual([]);
    expect((await storedExpiry(token))!.getTime()).toBe(originalExpiry.getTime());
  });

  it("renews a session used 23 days in for another 30 days, keeping the same token, and renews again after another 23 days", async () => {
    const { cookie, token } = await signIn("renew@example.com");
    const originalExpiry = (await storedExpiry(token))!;

    // First renewal: 23 days + 1 minute → fewer than seven days remain.
    advanceBy(23 * DAY + 60_000);
    const first = await getSession(cookie);

    expect(first.status).toBe(200);
    expect(first.body.session.token).toBe(token);
    const firstExpiry = new Date(first.body.session.expiresAt).getTime();
    expect(Math.abs(firstExpiry - (Date.now() + THIRTY_DAYS))).toBeLessThan(5_000);
    expect(firstExpiry).toBeGreaterThan(originalExpiry.getTime());
    expect((await storedExpiry(token))!.getTime()).toBe(firstExpiry);
    // Exactly one re-issued session cookie, same token, fresh 30-day Max-Age.
    const renewedCookies = sessionTokenCookies(first);
    expect(renewedCookies).toHaveLength(1);
    expect(renewedCookies[0]).toMatch(
      /^better-auth\.session_token=[^;]+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/,
    );
    expect(decodeURIComponent(renewedCookies[0]!.split(";")[0]!.split("=")[1]!).split(".")[0]).toBe(
      token,
    );
    expect(await prisma.session.count()).toBe(1);

    // Renewable interval, not an absolute cap: 23 more days → renewed again.
    advanceBy(23 * DAY + 60_000);
    const second = await getSession(cookie);

    expect(second.status).toBe(200);
    const secondExpiry = new Date(second.body.session.expiresAt).getTime();
    expect(Math.abs(secondExpiry - (Date.now() + THIRTY_DAYS))).toBeLessThan(5_000);
    expect(secondExpiry).toBeGreaterThan(firstExpiry);
    expect(sessionTokenCookies(second)).toHaveLength(1);
    expect((await storedExpiry(token))!.getTime()).toBe(secondExpiry);
  });

  it("rejects a session left unused past its 30-day expiry, clears the cookie, and deletes the row", async () => {
    // Independent of the renewal tests: a fresh session, no reads in between.
    const { cookie, token } = await signIn("idle@example.com");
    expect(await prisma.session.count()).toBe(1);

    advanceBy(THIRTY_DAYS + 60_000);
    const response = await getSession(cookie);

    expect(response.status).toBe(200);
    expect(response.body).toBeNull();
    expect(setCookies(response)).toContain(
      "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
    );
    expect(await storedExpiry(token)).toBeNull();
    expect(await prisma.session.count()).toBe(0);
  });

  it("ordinary sign-out revokes only the current session; another device's session stays valid", async () => {
    const email = "devices@example.com";
    const deviceA = await signIn(email);
    // Second sign-in for the same account (the helper also tries to register
    // again, which is the approved generic no-op for an existing address).
    const deviceB = await signIn(email);
    expect(await prisma.session.count()).toBe(2);
    expect(deviceA.token).not.toBe(deviceB.token);

    const signOut = await request(app)
      .post("/api/auth/sign-out")
      .set("Cookie", deviceA.cookie)
      .set("Origin", ORIGIN)
      .send({});
    expect(signOut.status).toBe(200);

    expect(await prisma.session.count()).toBe(1);
    expect(await storedExpiry(deviceA.token)).toBeNull();
    expect(await storedExpiry(deviceB.token)).not.toBeNull();
    expect((await getSession(deviceA.cookie)).body).toBeNull();
    const stillSignedIn = await getSession(deviceB.cookie);
    expect(stillSignedIn.body.session.token).toBe(deviceB.token);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.account.count()).toBe(1);
  });
});
