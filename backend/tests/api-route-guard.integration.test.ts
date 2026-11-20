import { describe, expect, it } from "vitest";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import { createApp } from "../src/app.js";
import { authInfrastructureErrorHandler } from "../src/auth/mount.js";
import { mountProtected } from "../src/auth/mount-protected.js";
import { noStore, protectedRouteErrorHandler } from "../src/auth/protected-route.js";
import { requireSession } from "../src/auth/require-session.js";
import { requireTrustedOrigin } from "../src/auth/require-trusted-origin.js";
import { apiRouter } from "../src/routes/index.js";
import { GLOBAL_MIDDLEWARE_NAMES } from "./helpers/public-api-routes.js";
import {
  STATE_CHANGING_METHODS,
  findUnguardedStateChangingRoutes,
  inspectApp,
  listRoutes,
  type InspectionPolicy,
} from "./helpers/route-inspection.js";

/**
 * M03-T02 Increment 4 — structural enforcement of the authentication boundary
 * documented in src/auth/require-trusted-origin.ts: every state-changing
 * route under /api/v1 must run `requireSession` before its handler, and the
 * /api/v1 mount must carry `requireTrustedOrigin` ahead of the router. Runs
 * against the REAL app; the deliberately unprotected routers below exist only
 * inside this file.
 *
 * Revised in M03-T05 Increment 3 (developer-approved Option A) to recognise
 * the M03-T04 protected-mount architecture (ADR-012), where `requireSession`
 * is registered on the mount rather than on each route. A state-changing
 * route is accepted ONLY when the M03-T04 inspector VERIFIES one of:
 *  (a) it is inside a `mountProtected` group — the contiguous
 *      [noStore, requireSession, router, protectedRouteErrorHandler] layers,
 *      each matched by function IDENTITY — with nothing that could answer
 *      ahead of `requireSession` in its effective chain (no `problems`); or
 *  (b) the real `requireSession` (by identity) is one of the route's OWN
 *      handlers, before the final one, again with no `problems` (the original
 *      M03-T02 rule, now also checked against the inherited chain).
 * Path, name, or classification labels alone never count.
 */

const handler = (_req: Request, res: Response) => {
  res.json({ ok: true });
};

const policy: InspectionPolicy = {
  requireSession: requireSession as never,
  noStore: noStore as never,
  protectedRouteErrorHandler: protectedRouteErrorHandler as never,
  requireTrustedOrigin: requireTrustedOrigin as never,
  externalAuthErrorHandler: authInfrastructureErrorHandler as never,
  globalMiddlewareNames: GLOBAL_MIDDLEWARE_NAMES,
};

/**
 * Every state-changing ROUTE under /api/v1 of `app` that is not verifiably
 * guarded by rule (a) or (b) above. Bare middleware endpoints are covered by
 * the M03-T04 deny-by-default inventory (route-inventory.integration.test.ts).
 */
function unguardedStateChangingApiRoutes(app: express.Express): string[] {
  const inventory = inspectApp(app, policy);
  return inventory.endpoints
    .filter(
      (e) =>
        e.kind === "route" &&
        e.path.startsWith("/api/v1") &&
        e.methods.some(
          (m) => m === "*" || (STATE_CHANGING_METHODS as readonly string[]).includes(m),
        ),
    )
    .filter((e) => {
      if (e.problems.length > 0) return true;
      const viaProtectedMount = e.protection === "protected-mount" && e.protectedMountPath !== null;
      const ownGuard = e.handlers.indexOf(requireSession as never);
      const viaRouteGuard = ownGuard !== -1 && ownGuard < e.handlers.length - 1;
      return !(viaProtectedMount || viaRouteGuard);
    })
    .map((e) => `${e.methods.join(",")} ${e.path}`);
}

/** A test-only app wired like src/app.ts at /api/v1 (structure only; never serves a request). */
function appWith(mount: (api: Router) => void): express.Express {
  const app = express();
  app.use(express.json());
  const api = Router();
  mount(api);
  app.use("/api/v1", requireTrustedOrigin, api);
  return app;
}

function favoritesLikeRouter(...beforeHandler: ((...args: never[]) => unknown)[]) {
  const router = Router();
  router.put("/:id", ...(beforeHandler as never[]), handler);
  router.delete("/:id", ...(beforeHandler as never[]), handler);
  router.get("/", handler);
  return router;
}

describe("API route guard (structural, M03-T02 Increment 4)", () => {
  it("lists the real router's routes (today: landmark GETs only)", () => {
    const routes = listRoutes(apiRouter);
    expect(routes.length).toBeGreaterThan(0);
    expect(routes.map((r) => `${r.methods.join(",")} ${r.path}`)).toEqual(
      expect.arrayContaining(["get /landmarks", "get /landmarks/:id"]),
    );
  });

  it("the real application has no state-changing /api/v1 route without verified requireSession protection", () => {
    expect(unguardedStateChangingApiRoutes(createApp())).toEqual([]);
  });

  it("the real application's state-changing routes are exactly the favorites PUT/DELETE, verified via the protected mount", () => {
    const inventory = inspectApp(createApp(), policy);
    const stateChanging = inventory.endpoints.filter(
      (e) =>
        e.kind === "route" &&
        e.path.startsWith("/api/v1") &&
        e.methods.some((m) => (STATE_CHANGING_METHODS as readonly string[]).includes(m)),
    );
    expect(
      stateChanging.map((e) => ({
        route: `${e.methods.join(",")} ${e.path}`,
        protection: e.protection,
        mount: e.protectedMountPath,
        problems: e.problems,
      })),
    ).toEqual([
      {
        route: "put /api/v1/favorites/:landmarkId",
        protection: "protected-mount",
        mount: "/api/v1/favorites",
        problems: [],
      },
      {
        route: "delete /api/v1/favorites/:landmarkId",
        protection: "protected-mount",
        mount: "/api/v1/favorites",
        problems: [],
      },
    ]);
  });

  describe("the revised check accepts only verified protection (fixture apps)", () => {
    it("accepts a router mounted with mountProtected", () => {
      const app = appWith((api) => mountProtected(api, "/favorites", favoritesLikeRouter()));
      expect(unguardedStateChangingApiRoutes(app)).toEqual([]);
    });

    it("accepts requireSession attached directly to each route before its handler (original rule)", () => {
      const app = appWith((api) => api.use("/favorites", favoritesLikeRouter(requireSession)));
      expect(unguardedStateChangingApiRoutes(app)).toEqual([]);
    });

    it("rejects state-changing routes mounted with no authentication", () => {
      const app = appWith((api) => api.use("/favorites", favoritesLikeRouter()));
      expect(unguardedStateChangingApiRoutes(app)).toEqual([
        "put /api/v1/favorites/:id",
        "delete /api/v1/favorites/:id",
      ]);
    });

    it("rejects authentication that runs after the handler", () => {
      const router = Router();
      router.put("/:id", handler, requireSession);
      router.delete("/:id", handler, requireSession);
      const app = appWith((api) => api.use("/favorites", router));
      expect(unguardedStateChangingApiRoutes(app)).toEqual([
        "put /api/v1/favorites/:id",
        "delete /api/v1/favorites/:id",
      ]);
    });

    it("rejects an impostor function merely named requireSession, on the route or in a look-alike mount group", () => {
      const impostor = function requireSession(_req: Request, _res: Response, next: NextFunction) {
        next();
      };
      const onRoute = appWith((api) => api.use("/favorites", favoritesLikeRouter(impostor)));
      expect(unguardedStateChangingApiRoutes(onRoute)).toHaveLength(2);

      const lookAlikeGroup = appWith((api) =>
        api.use("/favorites", noStore, impostor, favoritesLikeRouter(), protectedRouteErrorHandler),
      );
      expect(unguardedStateChangingApiRoutes(lookAlikeGroup)).toHaveLength(2);
    });

    it("rejects requireSession on the mount without the full protected group (not mountProtected)", () => {
      const app = appWith((api) => api.use("/favorites", requireSession, favoritesLikeRouter()));
      expect(unguardedStateChangingApiRoutes(app)).toEqual([
        "put /api/v1/favorites/:id",
        "delete /api/v1/favorites/:id",
      ]);
    });

    it("rejects a protected mount when something that could answer runs ahead of requireSession", () => {
      const shortCircuit = (_req: Request, res: Response) => {
        res.json({ answered: "before the guard" });
      };
      const app = appWith((api) => {
        api.use("/favorites", shortCircuit as never);
        mountProtected(api, "/favorites", favoritesLikeRouter());
      });
      expect(unguardedStateChangingApiRoutes(app)).toEqual([
        "put /api/v1/favorites/:id",
        "delete /api/v1/favorites/:id",
      ]);
    });

    it("the original M03-T02 helper still flags mount-level protection (why the real-app check moved to the inspector)", () => {
      const router = Router();
      mountProtected(router, "/favorites", favoritesLikeRouter());
      expect(findUnguardedStateChangingRoutes(router, requireSession).map((v) => v.path)).toEqual([
        "/:id",
        "/:id",
      ]);
    });
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
