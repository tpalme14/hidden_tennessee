import { describe, expect, it } from "vitest";
import { Router, type Request, type Response } from "express";
import { createApp } from "../src/app.js";
import { requireSession } from "../src/auth/require-session.js";
import { requireTrustedOrigin } from "../src/auth/require-trusted-origin.js";
import { apiRouter } from "../src/routes/index.js";
import { findUnguardedStateChangingRoutes, listRoutes } from "./helpers/route-inspection.js";

/**
 * M03-T02 Increment 4 — structural enforcement of the authentication boundary
 * documented in src/auth/require-trusted-origin.ts: every state-changing
 * route in the application's API router must run `requireSession` before its
 * handler, and the /api/v1 mount must carry `requireTrustedOrigin` ahead of
 * the router. Runs against the REAL router and app; the deliberately
 * unprotected routers below exist only inside this file.
 */

const handler = (_req: Request, res: Response) => {
  res.json({ ok: true });
};

describe("API route guard (structural, M03-T02 Increment 4)", () => {
  it("lists the real router's routes (today: landmark GETs only)", () => {
    const routes = listRoutes(apiRouter);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.map((r) => `${r.methods.join(",")} ${r.path}`)).toEqual(
      expect.arrayContaining(["get /landmarks", "get /landmarks/:id"]),
    );
  });

  it("the application API router has no state-changing route without requireSession before its handler", () => {
    const violations = findUnguardedStateChangingRoutes(apiRouter, requireSession);
    expect(violations.map((v) => `${v.methods.join(",")} ${v.path}`)).toEqual([]);
  });

  it("detects a deliberately unprotected POST route, including inside a nested router", () => {
    const outer = Router();
    const nested = Router();
    nested.post("/favorites", handler); // no requireSession at all
    outer.use(nested);
    outer.get("/public", handler); // GETs are not required to be guarded

    const violations = findUnguardedStateChangingRoutes(outer, requireSession);
    expect(violations.map((v) => `${v.methods.join(",")} ${v.path}`)).toEqual(["post /favorites"]);
  });

  it("detects requireSession placed AFTER the handler, and accepts it placed before", () => {
    const wrong = Router();
    wrong.delete("/favorites/:id", handler, requireSession); // too late to protect the handler
    expect(findUnguardedStateChangingRoutes(wrong, requireSession).map((v) => v.path)).toEqual([
      "/favorites/:id",
    ]);

    const right = Router();
    right.post("/favorites", requireSession, handler);
    right.delete("/favorites/:id", requireSession, handler);
    right.get("/favorites", requireSession, handler);
    expect(findUnguardedStateChangingRoutes(right, requireSession)).toEqual([]);
  });

  it("mounts requireTrustedOrigin on /api/v1 ahead of the API router in the real app", () => {
    const app = createApp();
    const stack = (app as unknown as { _router: { stack: { handle: unknown; regexp: RegExp }[] } })
      ._router.stack;
    const apiV1Layers = stack.filter((layer) => layer.regexp.test("/api/v1/anything"));
    const originIndex = apiV1Layers.findIndex((layer) => layer.handle === requireTrustedOrigin);
    const routerIndex = apiV1Layers.findIndex((layer) => layer.handle === apiRouter);

    expect(originIndex).toBeGreaterThanOrEqual(0);
    expect(routerIndex).toBeGreaterThan(originIndex);
  });
});
