import { createHmac } from "node:crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type NextFunction, type Request, type Response } from "express";
import { toNodeHandler } from "better-auth/node";
import request, { type Response as HttpResponse } from "supertest";
import { auth } from "../src/auth/auth.js";
import { requireSession, type AuthenticatedPrincipal } from "../src/auth/require-session.js";
import { prisma } from "../src/db/prisma.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T02 Increment 3 — `requireSession` on a TEST-ONLY Express app (approved
 * plan decision): the real Better Auth handler is mounted exactly as in
 * src/app.ts, and one probe route is protected. No application route is
 * touched. Real HTTP, real cookies, real landmarks_test rows.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const DAY = 24 * 60 * 60 * 1000;
const UNAUTHENTICATED = { error: { code: "UNAUTHENTICATED", message: "Authentication required." } };

// ---- test-only app ---------------------------------------------------------

/** What the probe route saw for the last request, so tests can assert on `req.auth`. */
let seen: { auth: AuthenticatedPrincipal | undefined } | undefined;
const probeHandler = vi.fn((req: Request, res: Response) => {
  res.setHeader("X-Probe", "handled");
  res.json({ userId: req.auth!.user.id, sessionId: req.auth!.session.id });
});

function buildTestApp() {
  const app = express();
  app.all("/api/auth/*", toNodeHandler(auth));
  app.use(express.json());
  app.get(
    "/probe",
    // Stands in for "whatever ran before": headers already on the response
    // must survive the middleware untouched.
    (req: Request, res: Response, next: NextFunction) => {
      res.append("Set-Cookie", "probe_marker=1; Path=/");
      res.setHeader("X-Probe", "before");
      seen = { auth: undefined };
      const original = seen;
      res.on("finish", () => {
        original.auth = req.auth;
      });
      next();
    },
    requireSession,
    probeHandler,
  );
  return app;
}

const app = buildTestApp();

// ---- helpers ----------------------------------------------------------------

function setCookies(response: HttpResponse): string[] {
  return (response.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
}

function sessionTokenCookies(response: HttpResponse): string[] {
  return setCookies(response).filter((c) => c.startsWith("better-auth.session_token="));
}

async function signIn(email: string) {
  await request(app).post("/api/auth/sign-up/email").send({ name: "", email, password: PASSWORD });
  const response = await request(app)
    .post("/api/auth/sign-in/email")
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  const header = sessionTokenCookies(response)[0]!;
  return { cookie: header.split(";")[0]!, token: response.body.token as string };
}

function probe(cookie?: string) {
  const req = request(app).get("/probe");
  return cookie ? req.set("Cookie", cookie) : req;
}

/**
 * Mirrors the installed signing scheme read from better-call 1.4.5
 * (`crypto.mjs`): HMAC-SHA256 over the raw value with the raw secret, base64
 * (44 chars ending "="), appended as `value.signature`, URL-encoded in the
 * cookie. Used ONLY to build a cookie with a valid signature for a token the
 * database does not know — proving the signature alone grants nothing.
 */
function signedCookieFor(value: string) {
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(value)
    .digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${value}.${signature}`)}`;
}

function expectUnauthenticated(response: HttpResponse) {
  expect(response.status).toBe(401);
  expect(response.body).toEqual(UNAUTHENTICATED);
  expect(response.headers["content-type"]).toMatch(/application\/json/);
}

describe("requireSession (integration, M03-T02 Increment 3)", () => {
  beforeAll(async () => {
    await resetTestDatabase();
  });
  beforeEach(() => {
    probeHandler.mockClear();
    seen = undefined;
  });
  afterEach(async () => {
    vi.useRealTimers();
    await resetTestDatabase();
  });

  it("sanity: the self-built signature matches the library's own cookie signature", async () => {
    const { cookie, token } = await signIn("sanity@example.com");
    expect(cookie).toBe(signedCookieFor(token));
  });

  describe("valid session", () => {
    it("attaches { user, session } and lets the handler run, leaving earlier headers and cookies intact", async () => {
      const { cookie, token } = await signIn("valid@example.com");
      const row = await prisma.session.findUniqueOrThrow({ where: { token } });

      const response = await probe(cookie);

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ userId: row.userId, sessionId: row.id });
      expect(probeHandler).toHaveBeenCalledTimes(1);
      expect(seen?.auth?.user.id).toBe(row.userId);
      expect(seen?.auth?.session.id).toBe(row.id);
      expect(JSON.stringify(seen?.auth)).not.toContain("password");
      // Earlier middleware's header and cookie survived; no session cookie was
      // re-issued because the session is not yet due for renewal.
      expect(response.headers["x-probe"]).toBe("handled");
      expect(setCookies(response)).toEqual(["probe_marker=1; Path=/"]);
    });

    it("renews a session used 23 days in and forwards exactly one renewed cookie beside the existing ones", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { cookie, token } = await signIn("renew-mw@example.com");
      const before = await prisma.session.findUniqueOrThrow({ where: { token } });

      vi.setSystemTime(new Date(Date.now() + 23 * DAY + 60_000));
      const response = await probe(cookie);

      expect(response.status).toBe(200);
      expect(probeHandler).toHaveBeenCalledTimes(1);
      const cookies = setCookies(response);
      expect(cookies[0]).toBe("probe_marker=1; Path=/");
      const renewed = sessionTokenCookies(response);
      expect(renewed).toHaveLength(1);
      expect(renewed[0]).toMatch(
        /^better-auth\.session_token=[^;]+; Max-Age=2592000; Path=\/; HttpOnly; SameSite=Lax$/,
      );
      expect(renewed[0]!.split(";")[0]).toBe(cookie); // same token, same signature
      expect(response.headers["x-probe"]).toBe("handled");

      const after = await prisma.session.findUniqueOrThrow({ where: { token } });
      expect(after.expiresAt.getTime()).toBeGreaterThan(before.expiresAt.getTime());
      expect(Math.abs(after.expiresAt.getTime() - (Date.now() + 30 * DAY))).toBeLessThan(5_000);
      expect(seen?.auth?.session.expiresAt.getTime()).toBe(after.expiresAt.getTime());
    });
  });

  describe("rejections — one identical 401 envelope, handler never runs, nothing attached", () => {
    it("missing cookie", async () => {
      const response = await probe();
      expectUnauthenticated(response);
      expect(probeHandler).not.toHaveBeenCalled();
      expect(seen?.auth).toBeUndefined();
    });

    it("malformed cookie (no signature separator)", async () => {
      await signIn("owner@example.com");
      const response = await probe("better-auth.session_token=not-even-signed");
      expectUnauthenticated(response);
      expect(probeHandler).not.toHaveBeenCalled();
      expect(await prisma.session.count()).toBe(1); // the real session is untouched
    });

    it("tampered signature on a real token", async () => {
      const { cookie } = await signIn("tamper@example.com");
      const [name, value] = cookie.split("=") as [string, string];
      const decoded = decodeURIComponent(value);
      const dot = decoded.lastIndexOf(".");
      const sig = decoded.slice(dot + 1);
      const flipped = sig[5] === "A" ? "B" : "A";
      const tampered = `${decoded.slice(0, dot + 1)}${sig.slice(0, 5)}${flipped}${sig.slice(6)}`;

      const response = await probe(`${name}=${encodeURIComponent(tampered)}`);

      expectUnauthenticated(response);
      expect(probeHandler).not.toHaveBeenCalled();
      expect(await prisma.session.count()).toBe(1);
    });

    it("correctly signed cookie for a token the database does not know", async () => {
      await signIn("other@example.com");
      const response = await probe(signedCookieFor("A".repeat(32)));
      expectUnauthenticated(response);
      expect(probeHandler).not.toHaveBeenCalled();
      expect(seen?.auth).toBeUndefined();
      expect(await prisma.session.count()).toBe(1);
    });

    it("expired session: rejected, cookie cleared on the 401, row deleted", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { cookie, token } = await signIn("expired@example.com");

      vi.setSystemTime(new Date(Date.now() + 30 * DAY + 60_000));
      const response = await probe(cookie);

      expectUnauthenticated(response);
      expect(probeHandler).not.toHaveBeenCalled();
      expect(setCookies(response)).toContain(
        "better-auth.session_token=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax",
      );
      expect(await prisma.session.findUnique({ where: { token } })).toBeNull();
    });

    it("revoked session: signed out on this device, or deleted server-side, while another device stays valid", async () => {
      const email = "revoked@example.com";
      const deviceA = await signIn(email);
      const deviceB = await signIn(email);

      const signOut = await request(app)
        .post("/api/auth/sign-out")
        .set("Cookie", deviceA.cookie)
        .set("Origin", ORIGIN)
        .send({});
      expect(signOut.status).toBe(200);

      expectUnauthenticated(await probe(deviceA.cookie));
      expect(probeHandler).not.toHaveBeenCalled();
      expect((await probe(deviceB.cookie)).status).toBe(200);

      // Server-side revocation (what password reset will do in Increment 6).
      await prisma.session.delete({ where: { token: deviceB.token } });
      probeHandler.mockClear();
      expectUnauthenticated(await probe(deviceB.cookie));
      expect(probeHandler).not.toHaveBeenCalled();
    });

    it("every rejection body is byte-identical", async () => {
      const { cookie } = await signIn("same@example.com");
      await prisma.session.deleteMany();
      const bodies = await Promise.all([
        probe(),
        probe("better-auth.session_token=garbage"),
        probe(signedCookieFor("B".repeat(32))),
        probe(cookie), // revoked (deleted above)
      ]).then((responses) => responses.map((r) => r.text));
      expect(new Set(bodies).size).toBe(1);
      expect(JSON.parse(bodies[0]!)).toEqual(UNAUTHENTICATED);
    });
  });
});
