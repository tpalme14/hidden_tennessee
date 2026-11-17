import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Request, type Response } from "express";
import { toNodeHandler } from "better-auth/node";
import request, { type Response as HttpResponse } from "supertest";
import { auth } from "../src/auth/auth.js";
import { requireSession } from "../src/auth/require-session.js";
import {
  createRequireTrustedOrigin,
  hasSessionCookie,
  requireTrustedOrigin,
} from "../src/auth/require-trusted-origin.js";
import { MAX_LOG_ENTRY_LENGTH } from "../src/auth/log-sanitizer.js";
import { createApp } from "../src/app.js";
import { prisma } from "../src/db/prisma.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T02 Increment 4 — CSRF behaviour of `requireTrustedOrigin` on a
 * test-only app (real auth handler, real cookies), the library's own origin
 * check on /api/auth/*, and the sanitised logging of attacker-controlled
 * Origin / callbackURL values.
 */

const ORIGIN = "http://localhost:3000";
const DEV_ORIGIN = "http://localhost:5173";
const PASSWORD = "correct-horse-battery-staple";
const INVALID_ORIGIN = {
  error: { code: "INVALID_ORIGIN", message: "Request origin not allowed." },
};
const UNAUTHENTICATED = { error: { code: "UNAUTHENTICATED", message: "Authentication required." } };
/** The sanitizer's entry format (src/auth/log-sanitizer.ts); the library's default logger starts with an ANSI escape instead. */
const SANITIZED_ENTRY =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z (WARN|ERROR) \[Better Auth\]: /;

// ---- test-only app: /api/v1 guarded like the real one, plus probe routes ----
const probeHandler = vi.fn((req: Request, res: Response) => {
  res.json({ userId: req.auth!.user.id });
});
const unauthenticatedRouteHandler = vi.fn((_req: Request, res: Response) => {
  // A route that does not use requireSession (allowed only for routes that
  // touch no user-owned state); it answers 401 on its own when needed.
  res.status(401).json(UNAUTHENTICATED);
});

function buildTestApp() {
  const app = express();
  app.all("/api/auth/*", toNodeHandler(auth));
  app.use(express.json());
  const api = express.Router();
  api.post("/probe", requireSession, probeHandler);
  api.get("/probe", requireSession, probeHandler);
  api.post("/no-session-route", unauthenticatedRouteHandler);
  // Same allow-list the application uses in development.
  app.use("/api/v1", createRequireTrustedOrigin([ORIGIN, DEV_ORIGIN]), api);
  return app;
}

const app = buildTestApp();

function setCookies(response: HttpResponse): string[] {
  return (response.headers["set-cookie"] as unknown as string[] | undefined) ?? [];
}

async function signIn(email: string) {
  await request(app).post("/api/auth/sign-up/email").send({ name: "", email, password: PASSWORD });
  const response = await request(app)
    .post("/api/auth/sign-in/email")
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  return setCookies(response)[0]!.split(";")[0]!;
}

describe("CSRF (integration, M03-T02 Increment 4)", () => {
  let logged: { level: string; line: string }[] = [];
  beforeAll(async () => {
    await resetTestDatabase();
  });
  beforeEach(() => {
    logged = [];
    probeHandler.mockClear();
    unauthenticatedRouteHandler.mockClear();
    for (const level of ["log", "warn", "error"] as const) {
      vi.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        logged.push({ level, line: args.map(String).join(" ") });
      });
    }
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  describe("requireTrustedOrigin on /api/v1", () => {
    it("lets GET through regardless of cookie or Origin", async () => {
      const cookie = await signIn("get@example.com");
      const response = await request(app)
        .get("/api/v1/probe")
        .set("Cookie", cookie)
        .set("Origin", "https://attacker.example");
      expect(response.status).toBe(200);
      expect(probeHandler).toHaveBeenCalledTimes(1);
    });

    it("lets a cookie-less POST through to the route, which answers its own 401", async () => {
      const response = await request(app).post("/api/v1/probe").send({});
      expect(response.status).toBe(401);
      expect(response.body).toEqual(UNAUTHENTICATED);
      expect(probeHandler).not.toHaveBeenCalled();

      const plain = await request(app).post("/api/v1/no-session-route").send({});
      expect(plain.status).toBe(401);
      expect(unauthenticatedRouteHandler).toHaveBeenCalledTimes(1);
    });

    it("accepts an exact Origin match (public origin or dev origin) and passes to requireSession", async () => {
      const cookie = await signIn("origin@example.com");
      for (const origin of [ORIGIN, DEV_ORIGIN]) {
        const response = await request(app)
          .post("/api/v1/probe")
          .set("Cookie", cookie)
          .set("Origin", origin)
          .send({});
        expect(response.status).toBe(200);
      }
      expect(probeHandler).toHaveBeenCalledTimes(2);
    });

    it("rejects null, foreign, wrong-port, wrong-scheme, and path-suffixed Origins with 403 and never reaches the route", async () => {
      const cookie = await signIn("bad-origin@example.com");
      for (const origin of [
        "null",
        "https://attacker.example",
        "http://localhost:3001",
        "https://localhost:3000",
        "http://localhost:3000/",
        "http://localhost:3000.attacker.example",
        "",
      ]) {
        const response = await request(app)
          .post("/api/v1/probe")
          .set("Cookie", cookie)
          .set("Origin", origin)
          .send({});
        expect(response.status, `Origin: ${JSON.stringify(origin)}`).toBe(403);
        expect(response.body).toEqual(INVALID_ORIGIN);
      }
      expect(probeHandler).not.toHaveBeenCalled();
      expect(logged).toEqual([]); // the application middleware logs nothing
    });

    it("falls back to the Referer's origin only when Origin is absent", async () => {
      const cookie = await signIn("referer@example.com");

      const good = await request(app)
        .post("/api/v1/probe")
        .set("Cookie", cookie)
        .set("Referer", `${ORIGIN}/landmarks/abc?x=1`)
        .send({});
      expect(good.status).toBe(200);

      for (const referer of [
        "https://attacker.example/page",
        "not a url",
        `${ORIGIN.replace("3000", "3001")}/`,
      ]) {
        const bad = await request(app)
          .post("/api/v1/probe")
          .set("Cookie", cookie)
          .set("Referer", referer)
          .send({});
        expect(bad.status, `Referer: ${referer}`).toBe(403);
        expect(bad.body).toEqual(INVALID_ORIGIN);
      }

      // A good Referer does not rescue a bad Origin.
      const mixed = await request(app)
        .post("/api/v1/probe")
        .set("Cookie", cookie)
        .set("Origin", "https://attacker.example")
        .set("Referer", `${ORIGIN}/`)
        .send({});
      expect(mixed.status).toBe(403);
      expect(probeHandler).toHaveBeenCalledTimes(1);
    });

    it("rejects a cookie-bearing POST with neither Origin nor Referer", async () => {
      const cookie = await signIn("no-evidence@example.com");
      const response = await request(app).post("/api/v1/probe").set("Cookie", cookie).send({});
      expect(response.status).toBe(403);
      expect(response.body).toEqual(INVALID_ORIGIN);
      expect(probeHandler).not.toHaveBeenCalled();
    });

    it("recognises both session-cookie names and treats cookie presence as evidence to check, not as authentication", async () => {
      expect(hasSessionCookie("better-auth.session_token=abc.def")).toBe(true);
      expect(hasSessionCookie("other=1; __Secure-better-auth.session_token=abc.def")).toBe(true);
      expect(hasSessionCookie("other=1; better-auth.session_data=x")).toBe(false);
      expect(hasSessionCookie(undefined)).toBe(false);

      // A forged cookie under either name with a foreign Origin → 403 (origin check).
      for (const name of ["better-auth.session_token", "__Secure-better-auth.session_token"]) {
        const response = await request(app)
          .post("/api/v1/probe")
          .set("Cookie", `${name}=forged.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=`)
          .set("Origin", "https://attacker.example")
          .send({});
        expect(response.status).toBe(403);
      }
      // The same forged cookie with a TRUSTED Origin passes the origin check and
      // is then refused by requireSession — cookie presence proved nothing.
      const forgedTrusted = await request(app)
        .post("/api/v1/probe")
        .set(
          "Cookie",
          "better-auth.session_token=forged.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
        )
        .set("Origin", ORIGIN)
        .send({});
      expect(forgedTrusted.status).toBe(401);
      expect(forgedTrusted.body).toEqual(UNAUTHENTICATED);
      expect(probeHandler).not.toHaveBeenCalled();
    });

    it("the real app's existing GET routes are unaffected", async () => {
      const real = createApp();
      expect((await request(real).get("/api/v1/landmarks")).status).toBe(200);
      expect((await request(real).get("/api/v1/categories")).status).toBe(200);
      // The application middleware is the exported one, built from env.
      expect(typeof requireTrustedOrigin).toBe("function");
    });
  });

  describe("Better Auth's own origin check on /api/auth/*", () => {
    it("rejects a cookie-bearing sign-out from a foreign Origin, accepts the public origin, and the Referer-origin fallback works", async () => {
      const cookie = await signIn("auth-csrf@example.com");

      const foreign = await request(app)
        .post("/api/auth/sign-out")
        .set("Cookie", cookie)
        .set("Origin", "https://attacker.example")
        .send({});
      expect(foreign.status).toBe(403);
      expect(foreign.body.code).toBe("INVALID_ORIGIN");
      expect(await prisma.session.count()).toBe(1);

      const viaReferer = await request(app)
        .post("/api/auth/sign-out")
        .set("Cookie", cookie)
        .set("Referer", `${ORIGIN}/account`)
        .send({});
      expect(viaReferer.status).toBe(200);
      expect(await prisma.session.count()).toBe(0);
    });
  });

  describe("sanitised logging of attacker-controlled values", () => {
    it("bounds the complete log entry when an 8 KB Origin is rejected, keeping error severity", async () => {
      const cookie = await signIn("long-origin@example.com");
      const hugeOrigin = `https://${"a".repeat(8000)}.example`;

      const response = await request(app)
        .post("/api/auth/sign-out")
        .set("Cookie", cookie)
        .set("Origin", hugeOrigin)
        .send({});

      expect(response.status).toBe(403);
      const errors = logged.filter((l) => l.level === "error");
      expect(errors.length).toBeGreaterThan(0);
      for (const entry of logged) {
        expect(entry.line.length).toBeLessThanOrEqual(MAX_LOG_ENTRY_LENGTH);
        expect(entry.line).not.toContain("a".repeat(600));
        // Every line — including the router's own API-error line, which the
        // library would otherwise write through its module-level logger —
        // comes out in the sanitizer's format, never the default colored one.
        expect(entry.line).toMatch(SANITIZED_ENTRY);
      }
      expect(errors.some((e) => e.line.includes("Invalid origin"))).toBe(true);
    });

    it("strips control characters from a hostile callbackURL before it reaches the log, keeping the diagnostic", async () => {
      const cookie = await signIn("injection@example.com");
      const hostile = "https://attacker.example/x\r\nFORGED LOG LINE\u001b[31m";

      const response = await request(app)
        .post("/api/auth/sign-out")
        .set("Cookie", cookie)
        .set("Origin", ORIGIN)
        .send({ callbackURL: hostile });

      expect(response.status).toBe(403);
      expect(response.body.code).toBe("INVALID_CALLBACK_URL");
      const errors = logged.filter((l) => l.level === "error");
      expect(errors.some((e) => e.line.includes("Invalid callbackURL"))).toBe(true);
      for (const entry of logged) {
        // eslint-disable-next-line no-control-regex -- asserting these bytes are absent
        expect(entry.line).not.toMatch(/[\r\n\u001b]/);
        expect(entry.line).not.toContain("\nFORGED");
        expect(entry.line).toMatch(SANITIZED_ENTRY);
      }
      // The session was not touched by the rejected request.
      expect(await prisma.session.count()).toBe(1);
    });
  });
});
