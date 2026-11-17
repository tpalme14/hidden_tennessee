import { createHash } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { betterAuth } from "better-auth";
import request, { type Response } from "supertest";
import { buildAuthOptions } from "../src/auth/auth-options.js";
import { createClientIpMiddleware } from "../src/auth/client-ip.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { RESET_TOKEN_LIFETIME_SECONDS } from "../src/auth/password-reset.js";
import { prisma } from "../src/db/prisma.js";
import { MemoryMailTransport } from "./helpers/memory-mail-transport.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T02 Increment 6 — password reset end to end on a dedicated instance
 * (same option builder as the app, in-memory mail transport), real
 * landmarks_test rows, real cookies. Time is faked (`Date` only) for expiry.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const NEW_PASSWORD = "a-brand-new-password-42";
const NEUTRAL = {
  status: true,
  message: "If this email exists in our system, check your email for the reset link",
};
const LINK = /^http:\/\/localhost:3000\/reset-password\?token=([A-Za-z0-9]{24})$/m;

const mail = new MemoryMailTransport();
const auth = betterAuth(
  buildAuthOptions({
    prisma,
    baseUrl: ORIGIN,
    secret: process.env.BETTER_AUTH_SECRET!,
    trustedOrigins: [],
    rateLimitEnabled: false,
    mailTransport: mail,
  }),
);
const app = express();
app.set("trust proxy", 1);
app.use(createClientIpMiddleware({ trustedProxyHops: 1 }));
mountBetterAuth(app, auth);

function setCookies(response: Response): string[] {
  return (response.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
}

async function register(email: string) {
  const response = await request(app)
    .post("/api/auth/sign-up/email")
    .send({ name: "", email, password: PASSWORD });
  expect(response.status).toBe(200);
}

async function signIn(email: string, password = PASSWORD) {
  return request(app).post("/api/auth/sign-in/email").send({ email, password });
}

function requestReset(email: string, redirectTo = "/reset-password") {
  return request(app).post("/api/auth/request-password-reset").send({ email, redirectTo });
}

function completeReset(token: string, newPassword = NEW_PASSWORD) {
  return request(app).post("/api/auth/reset-password").send({ token, newPassword });
}

/** The token from the single captured email. */
function tokenFromMail(): string {
  expect(mail.messages).toHaveLength(1);
  const match = mail.messages[0]!.text.match(LINK);
  expect(match).not.toBeNull();
  return match![1]!;
}

/** What the library stores for a reset token under `storeIdentifier: "hashed"` (SHA-256, base64url, unpadded). */
function hashedIdentifier(token: string) {
  return createHash("sha256").update(`reset-password:${token}`).digest("base64url");
}

describe("password reset (integration, M03-T02 Increment 6)", () => {
  let logged: string[] = [];
  beforeAll(async () => {
    await resetTestDatabase();
  });
  beforeEach(() => {
    mail.reset();
    logged = [];
    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push(args.map(String).join(" "));
      });
    }
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  describe("request", () => {
    it("known address: neutral 200, one hashed 30-minute verification row, one email with the canonical link, no token in response or logs", async () => {
      await register("known@example.com");
      const response = await requestReset("known@example.com");

      expect(response.status).toBe(200);
      expect(response.body).toEqual(NEUTRAL);

      const token = tokenFromMail();
      expect(mail.messages[0]!.to).toBe("known@example.com");
      expect(mail.messages[0]!.text).not.toContain("/api/auth/");
      expect(mail.messages[0]!.text).not.toContain("callbackURL");

      const rows = await prisma.verification.findMany();
      expect(rows).toHaveLength(1);
      expect(rows[0]!.identifier).toBe(hashedIdentifier(token));
      expect(rows[0]!.identifier).not.toContain(token);
      expect(rows[0]!.value).toBe((await prisma.user.findFirstOrThrow()).id);
      expect(
        Math.abs(rows[0]!.expiresAt.getTime() - (Date.now() + RESET_TOKEN_LIFETIME_SECONDS * 1000)),
      ).toBeLessThan(5_000);

      expect(response.text).not.toContain(token);
      for (const line of logged) {
        expect(line).not.toContain(token);
        expect(line).not.toContain("known@example.com");
      }
      expect(RESET_TOKEN_LIFETIME_SECONDS).toBe(30 * 60);
    });

    it("unknown address: identical status and body, no row, no email, no address in logs", async () => {
      await register("someone@example.com");
      const known = await requestReset("someone@example.com");
      mail.messages.length = 0;
      await prisma.verification.deleteMany();

      const unknown = await requestReset("nobody@example.com");

      expect(unknown.status).toBe(known.status);
      expect(unknown.text).toBe(known.text);
      expect(await prisma.verification.count()).toBe(0);
      expect(mail.messages).toHaveLength(0);
      for (const line of logged) expect(line).not.toContain("nobody@example.com");
    });

    it("transport unavailable: the same 503 for known and unknown addresses, before any record is created", async () => {
      await register("gated@example.com");
      mail.ready = false;

      const known = await requestReset("gated@example.com");
      const unknown = await requestReset("nobody@example.com");

      for (const response of [known, unknown]) {
        expect(response.status).toBe(503);
        expect(response.body).toEqual({
          code: "RESET_UNAVAILABLE",
          message: "Password reset is temporarily unavailable. Please try again later.",
        });
      }
      expect(known.text).toBe(unknown.text);
      expect(await prisma.verification.count()).toBe(0);
      expect(mail.sendCalls).toBe(0);
      expect(logged.some((l) => l.includes("RESET_UNAVAILABLE"))).toBe(true);
    });

    it("a failed send still yields the neutral 200, logs an event code only, and raises no unhandled rejection", async () => {
      await register("failing@example.com");
      mail.behavior = "reject";
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      try {
        const response = await requestReset("failing@example.com");
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(response.status).toBe(200);
        expect(response.body).toEqual(NEUTRAL);
      } finally {
        process.off("unhandledRejection", onUnhandled);
      }
      expect(unhandled).toEqual([]);
      const line = logged.find((l) => l.includes("MAIL_SEND_FAILED"));
      expect(line).toBeDefined();
      expect(line).toContain("provider=memory");
      expect(line).toContain("code=ESIMULATED");
      expect(line).not.toContain("failing@example.com");
      expect(await prisma.verification.count()).toBe(1); // the token exists; only delivery failed
    });

    it("a slow send does not block the HTTP response", async () => {
      await register("slow@example.com");
      mail.behavior = { delayMs: 2_000 };
      const started = Date.now();
      const response = await requestReset("slow@example.com");
      expect(response.status).toBe(200);
      expect(Date.now() - started).toBeLessThan(500);
      expect(mail.sendCalls).toBe(1);
    });

    it("rejects an untrusted redirect target with the library's 403 (the application link never uses it anyway)", async () => {
      await register("redirect@example.com");
      const response = await requestReset("redirect@example.com", "https://attacker.example/steal");
      expect(response.status).toBe(403);
      expect(response.body.code).toBe("INVALID_REDIRECT_URL");
      expect(mail.messages).toHaveLength(0);
    });
  });

  describe("completion", () => {
    it("changes the password, deletes the token, and revokes every session — on both devices", async () => {
      const email = "reset-me@example.com";
      await register(email);
      const deviceA = setCookies(await signIn(email))[0]!.split(";")[0]!;
      const deviceB = setCookies(await signIn(email))[0]!.split(";")[0]!;
      expect(await prisma.session.count()).toBe(2);

      await requestReset(email);
      const token = tokenFromMail();

      const response = await completeReset(token);
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ status: true });
      expect(setCookies(response)).toEqual([]); // no session issued by the reset itself

      expect(await prisma.session.count()).toBe(0);
      for (const cookie of [deviceA, deviceB]) {
        const session = await request(app).get("/api/auth/get-session").set("Cookie", cookie);
        expect(session.body).toBeNull();
      }
      expect(await prisma.verification.count()).toBe(0);

      expect((await signIn(email, PASSWORD)).status).toBe(401); // old credentials
      expect((await signIn(email, NEW_PASSWORD)).status).toBe(200); // new credentials
      const account = await prisma.account.findFirstOrThrow();
      expect(account.password).not.toContain(NEW_PASSWORD);
    });

    it("a token works once: reuse, an unknown token, and a tampered token are all 400 INVALID_TOKEN", async () => {
      await register("once@example.com");
      await requestReset("once@example.com");
      const token = tokenFromMail();
      expect((await completeReset(token)).status).toBe(200);

      const reuse = await completeReset(token);
      const unknown = await completeReset("A".repeat(24));
      const tampered = await completeReset(
        `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`,
      );
      for (const response of [reuse, unknown, tampered]) {
        expect(response.status).toBe(400);
        expect(response.body).toEqual({ code: "INVALID_TOKEN", message: expect.any(String) });
      }
      expect(reuse.text).toBe(unknown.text);
      expect(reuse.text).toBe(tampered.text);
    });

    it("an expired token is rejected and the expired row is cleaned up", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      await register("late@example.com");
      await requestReset("late@example.com");
      const token = tokenFromMail();

      vi.setSystemTime(new Date(Date.now() + RESET_TOKEN_LIFETIME_SECONDS * 1000 + 60_000));
      const response = await completeReset(token);

      expect(response.status).toBe(400);
      expect(response.body.code).toBe("INVALID_TOKEN");
      expect(await prisma.verification.count()).toBe(0);
      expect((await signIn("late@example.com", PASSWORD)).status).toBe(200); // password unchanged
    });

    it("password-policy failures do not consume the token", async () => {
      await register("policy@example.com");
      await requestReset("policy@example.com");
      const token = tokenFromMail();

      const short = await completeReset(token, "1234567");
      expect(short.status).toBe(400);
      expect(short.body.code).toBe("PASSWORD_TOO_SHORT");
      const long = await completeReset(token, "x".repeat(129));
      expect(long.status).toBe(400);
      expect(long.body.code).toBe("PASSWORD_TOO_LONG");
      expect(await prisma.verification.count()).toBe(1);

      expect((await completeReset(token)).status).toBe(200); // still valid
      expect((await signIn("policy@example.com", NEW_PASSWORD)).status).toBe(200);
    });

    it("the library's GET callback route is not what the email uses, and a bad token there only redirects with an error", async () => {
      await register("callback@example.com");
      await requestReset("callback@example.com");
      expect(mail.messages[0]!.text).not.toMatch(/\/api\/auth\/reset-password\//);

      const response = await request(app).get(
        "/api/auth/reset-password/not-a-token?callbackURL=/reset-password",
      );
      expect(response.status).toBe(302);
      expect(response.headers["location"]).toBe(`${ORIGIN}/reset-password?error=INVALID_TOKEN`);
      expect(await prisma.verification.count()).toBe(1); // nothing consumed
    });
  });
});
