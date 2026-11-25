import { createHmac } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, {
  Router,
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import request from "supertest";
import { createApp } from "../src/app.js";
import { auth } from "../src/auth/auth.js";
import { authInfrastructureErrorHandler, mountBetterAuth } from "../src/auth/mount.js";
import { mountProtected } from "../src/auth/mount-protected.js";
import {
  authenticatedUserId,
  createMountProtected,
  noStore,
  protectedRouteErrorHandler,
} from "../src/auth/protected-route.js";
import { requireSession } from "../src/auth/require-session.js";
import { requireTrustedOrigin } from "../src/auth/require-trusted-origin.js";
import { GLOBAL_MIDDLEWARE_NAMES, PUBLIC_ENDPOINT_ALLOWLIST } from "./helpers/public-api-routes.js";
import {
  assertSupportedExpress,
  evaluateInventory,
  inspectApp,
  samplePath,
  type AllowlistEntry,
  type Endpoint,
  type InspectionPolicy,
} from "./helpers/route-inspection.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T04 Increment 2 — deny-by-default structural enforcement on the REAL
 * application, plus behavioural checks. Structural inspection proves which
 * guard is registered where (by function identity and order); the behavioural
 * sweep proves anonymous requests to every discovered protected endpoint —
 * nested and parameterised included — are rejected before any handler runs.
 * Neither alone is treated as sufficient.
 */

const ORIGIN = "http://localhost:3000";
const PASSWORD = "correct-horse-battery-staple";
const UNAUTHENTICATED = { error: { code: "UNAUTHENTICATED", message: "Authentication required." } };
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Resource not found." } };

const policy: InspectionPolicy = {
  requireSession: requireSession as never,
  noStore: noStore as never,
  protectedRouteErrorHandler: protectedRouteErrorHandler as never,
  requireTrustedOrigin: requireTrustedOrigin as never,
  externalAuthErrorHandler: authInfrastructureErrorHandler as never,
  globalMiddlewareNames: GLOBAL_MIDDLEWARE_NAMES,
};

/** A validly signed session cookie for a token the database does not know. */
function forgedCookie(): string {
  const value = "ForgedTokenNotInTheDatabase0000";
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(value)
    .digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${value}.${signature}`)}`;
}

type Method = "get" | "post" | "put" | "patch" | "delete";
const SENDABLE: readonly Method[] = ["get", "post", "put", "patch", "delete"];

function send(app: Express, method: Method, path: string, cookie?: string) {
  const req = request(app)[method](path).set("Origin", ORIGIN);
  return cookie ? req.set("Cookie", cookie) : req;
}

/**
 * Behavioural sweep: for every PROTECTED endpoint the inspector discovered, and
 * every method it answers, an anonymous request and a forged-cookie request to
 * its own path (parameters filled with a neutral sample segment, no body) must
 * get 401 UNAUTHENTICATED with no-store. Returns the failures instead of
 * asserting, so the mutation check can show the sweep catching a mis-wiring.
 */
async function sweepProtectedEndpoints(app: Express, endpoints: Endpoint[]) {
  const failures: string[] = [];
  let requests = 0;
  for (const endpoint of endpoints) {
    const methods = endpoint.methods.includes("*")
      ? (["get"] as Method[])
      : (endpoint.methods.filter((m) => SENDABLE.includes(m as Method)) as Method[]);
    for (const method of methods) {
      const path = samplePath(endpoint.path);
      for (const cookie of [undefined, forgedCookie()]) {
        const response = await send(app, method, path, cookie);
        requests++;
        const ok =
          response.status === 401 &&
          JSON.stringify(response.body) === JSON.stringify(UNAUTHENTICATED) &&
          response.headers["cache-control"] === "private, no-store";
        if (!ok) {
          failures.push(
            `${method.toUpperCase()} ${path} (${cookie ? "forged cookie" : "anonymous"}) → ${response.status}`,
          );
        }
      }
    }
  }
  return { failures, requests };
}

// ---- fixture apps (test-only) ----------------------------------------------

const spies = {
  root: vi.fn((req: Request, res: Response) =>
    res.json({ at: "root", userId: authenticatedUserId(req) }),
  ),
  create: vi.fn((req: Request, res: Response) =>
    res.json({ at: "create", userId: authenticatedUserId(req) }),
  ),
  item: vi.fn((req: Request, res: Response) =>
    res.json({ at: "item", userId: authenticatedUserId(req), itemId: req.params.itemId }),
  ),
  remove: vi.fn((req: Request, res: Response) =>
    res.json({ at: "remove", userId: authenticatedUserId(req), itemId: req.params.itemId }),
  ),
  nested: vi.fn((req: Request, res: Response) =>
    res.json({ at: "nested", userId: authenticatedUserId(req), id: req.params.id }),
  ),
};
const allSpies = Object.values(spies);

/** An account-scoped router with root, nested, and parameterised routes. */
function accountRouter() {
  const router = Router();
  router.get("/", spies.root);
  router.post("/", spies.create);
  router.put("/items/:itemId", spies.item);
  router.delete("/items/:itemId", spies.remove);
  const nested = Router();
  nested.get("/:id", spies.nested);
  router.use("/nested", nested);
  return router;
}

/** Wired like src/app.ts; `mount` decides how the account router is attached. */
function fixtureApp(mount: (api: Router) => void) {
  const app = express();
  mountBetterAuth(app, auth);
  app.use(express.json());
  const api = Router();
  api.get("/public", (_req: Request, res: Response) => res.json({ ok: true }));
  mount(api);
  app.use("/api/v1", requireTrustedOrigin, api);
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json(NOT_FOUND);
  });
  return app;
}

const FIXTURE_ALLOWLIST: readonly AllowlistEntry[] = [
  {
    kind: "external-auth",
    endpointKind: "route",
    methods: "*",
    path: "/api/auth/*",
    reason: "fixture",
  },
  {
    kind: "application",
    endpointKind: "route",
    methods: ["get"],
    path: "/api/v1/public",
    reason: "fixture",
  },
  {
    kind: "api-not-found",
    endpointKind: "middleware",
    methods: "*",
    path: "/api",
    reason: "fixture",
  },
];

async function signedInCookie(app: Express, email: string) {
  await request(app).post("/api/auth/sign-up/email").send({ name: "", email, password: PASSWORD });
  const response = await request(app)
    .post("/api/auth/sign-in/email")
    .send({ email, password: PASSWORD });
  expect(response.status).toBe(200);
  const cookies = response.headers["set-cookie"] as unknown as string[];
  return cookies.find((c) => c.startsWith("better-auth.session_token="))!.split(";")[0]!;
}

describe("route inventory (integration, M03-T04 Increment 2)", () => {
  beforeAll(async () => {
    assertSupportedExpress();
    await resetTestDatabase();
  });
  beforeEach(() => {
    for (const spy of allSpies) spy.mockClear();
  });
  afterAll(async () => {
    await resetTestDatabase();
  });

  describe("the real application", () => {
    const app = createApp();
    const inventory = inspectApp(app, policy);

    it("every endpoint is behind a protected mount or an exact allowlist entry; nothing is unrecognised or stale", () => {
      const result = evaluateInventory(inventory, PUBLIC_ENDPOINT_ALLOWLIST, policy);
      expect(inventory.unrecognized).toEqual([]);
      expect(result.violations).toEqual([]);
      expect(result.staleAllowlistEntries).toEqual([]);
    });

    it("the inventory is the expected set — the favorites (M03-T05), reviews (M04-T02), and trips (M05-T03) endpoints are the only protected ones", () => {
      expect(inventory.endpoints.map((e) => `${e.kind} ${e.path}`)).toEqual([
        "route /api/auth/*",
        "route /api/v1/landmarks",
        "route /api/v1/landmarks/:id",
        "route /api/v1/categories",
        "route /api/v1/landmarks/:landmarkId/reviews",
        "route /api/v1/shared/trips/:shareToken",
        "route /api/v1/favorites",
        "route /api/v1/favorites/:landmarkId",
        "route /api/v1/favorites/:landmarkId",
        "route /api/v1/reviews",
        "route /api/v1/reviews",
        "route /api/v1/reviews/:reviewId",
        "route /api/v1/reviews/:reviewId",
        "route /api/v1/trips",
        "route /api/v1/trips",
        "route /api/v1/trips/:tripId",
        "route /api/v1/trips/:tripId",
        "route /api/v1/trips/:tripId",
        "route /api/v1/trips/:tripId/stops",
        "route /api/v1/trips/:tripId/stops/:stopId",
        "route /api/v1/trips/:tripId/stops/order",
        "route /api/v1/trips/:tripId/share",
        "route /api/v1/trips/:tripId/share",
        "route /health",
        "middleware /api",
        "route *",
      ]);
      expect(inventory.endpoints.filter((e) => e.protection === "protected-mount")).toHaveLength(
        17,
      );
    });

    it("exactly three protected favorites, four protected reviews, and ten protected trips endpoints, verified by HTTP method AND path", () => {
      const protectedEndpoints = inventory.endpoints
        .filter((e) => e.protection === "protected-mount")
        .map((e) => `${e.kind} ${e.methods.join(",")} ${e.path}`);
      expect(protectedEndpoints).toEqual([
        "route get /api/v1/favorites",
        "route put /api/v1/favorites/:landmarkId",
        "route delete /api/v1/favorites/:landmarkId",
        "route post /api/v1/reviews",
        "route get /api/v1/reviews",
        "route patch /api/v1/reviews/:reviewId",
        "route delete /api/v1/reviews/:reviewId",
        "route get /api/v1/trips",
        "route post /api/v1/trips",
        "route get /api/v1/trips/:tripId",
        "route patch /api/v1/trips/:tripId",
        "route delete /api/v1/trips/:tripId",
        "route post /api/v1/trips/:tripId/stops",
        "route delete /api/v1/trips/:tripId/stops/:stopId",
        "route put /api/v1/trips/:tripId/stops/order",
        "route post /api/v1/trips/:tripId/share",
        "route delete /api/v1/trips/:tripId/share",
      ]);
      // Every trips endpoint is under the one /api/v1/trips protected mount.
      expect(
        inventory.endpoints
          .filter((e) => e.path.startsWith("/api/v1/trips"))
          .every((e) => e.protectedMountPath === "/api/v1/trips" && e.problems.length === 0),
      ).toBe(true);
      // The only trips-related allowlist entry is the GET-only shared-trip read (M05-T03 Increment 5);
      // no owner trips path is public.
      expect(
        PUBLIC_ENDPOINT_ALLOWLIST.filter(
          (e) => e.path.includes("/trips") || e.path.includes("/shared"),
        ).map((e) => `${e.kind} ${e.endpointKind} ${JSON.stringify(e.methods)} ${e.path}`),
      ).toEqual(['application route ["get"] /api/v1/shared/trips/:shareToken']);
      const shared = inventory.endpoints.filter((e) => e.path.startsWith("/api/v1/shared"));
      expect(shared.map((e) => `${e.kind} ${e.methods.join(",")} ${e.protection}`)).toEqual([
        "route get none",
      ]);
      // Nothing else under /api/v1/favorites, /api/v1/reviews, or /api/v1/trips exists, protected or not.
      for (const prefix of ["/api/v1/favorites", "/api/v1/reviews", "/api/v1/trips"]) {
        expect(
          inventory.endpoints
            .filter((e) => e.path.startsWith(prefix))
            .every((e) => e.protection === "protected-mount" && e.kind === "route"),
          prefix,
        ).toBe(true);
      }
      // The public review list is one unprotected GET route, matched by exactly one
      // GET-only allowlist entry — nothing more.
      const publicReviews = inventory.endpoints.filter(
        (e) => e.path === "/api/v1/landmarks/:landmarkId/reviews",
      );
      expect(publicReviews.map((e) => `${e.kind} ${e.methods.join(",")} ${e.protection}`)).toEqual([
        "route get none",
      ]);
      expect(
        PUBLIC_ENDPOINT_ALLOWLIST.filter((e) => e.path === "/api/v1/landmarks/:landmarkId/reviews"),
      ).toEqual([expect.objectContaining({ kind: "application", methods: ["get"] })]);
    });

    it("Better Auth's mount is classified as externally managed, identified by its error handler", () => {
      const betterAuth = inventory.endpoints.find((e) => e.path === "/api/auth/*")!;
      expect(betterAuth.handlers).toContain(authInfrastructureErrorHandler);
      const entry = PUBLIC_ENDPOINT_ALLOWLIST.find((e) => e.path === "/api/auth/*")!;
      expect(entry.kind).toBe("external-auth");
      // Its own controls are covered by the M03-T02 suites; nothing here assumes
      // that every Better Auth endpoint accepts anonymous requests.
    });

    it("public application endpoints in the allowlist are all GET-only", () => {
      const app = PUBLIC_ENDPOINT_ALLOWLIST.filter((e) => e.kind === "application");
      expect(app.length).toBeGreaterThan(0);
      expect(app.every((e) => e.methods !== "*" && e.methods.every((m) => m === "get"))).toBe(true);
    });

    it("the public allowlist is exactly the reviewed set: the shared-trip read is the only entry added in M05", () => {
      expect(
        PUBLIC_ENDPOINT_ALLOWLIST.map(
          (e) => `${e.kind} ${e.endpointKind} ${JSON.stringify(e.methods)} ${e.path}`,
        ),
      ).toEqual([
        'application route ["get"] /api/v1/landmarks',
        'application route ["get"] /api/v1/landmarks/:id',
        'application route ["get"] /api/v1/landmarks/:landmarkId/reviews',
        'application route ["get"] /api/v1/shared/trips/:shareToken',
        'application route ["get"] /api/v1/categories',
        'application route ["get"] /health',
        'external-auth route "*" /api/auth/*',
        'spa route ["get"] *',
        'api-not-found middleware "*" /api',
      ]);
    });

    it("anonymous requests to literal public endpoints still succeed; unknown and look-alike /api paths still 404", async () => {
      for (const path of ["/api/v1/landmarks", "/api/v1/categories", "/health"]) {
        const response = await request(app).get(path);
        expect(response.status, path).toBe(200);
      }
      for (const path of ["/api/v1/unknown", "/api/v1/categoriesX", "/api/v1/landmarksX/1"]) {
        const response = await request(app).get(path);
        expect(response.status, path).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
      }
    });

    it("the behavioural sweep rejects anonymous and forged-cookie requests to every real protected endpoint (17 endpoints × 2 = 34 requests)", async () => {
      const result = await sweepProtectedEndpoints(
        app,
        inventory.endpoints.filter((e) => e.protection === "protected-mount"),
      );
      expect(result).toEqual({ failures: [], requests: 34 });
    });

    it("the public shared-trip path answers GET only: anonymous writes to it are the generic JSON 404, never a handler", async () => {
      const path = `/api/v1/shared/trips/${"A".repeat(43)}`;
      for (const method of ["post", "put", "patch", "delete"] as const) {
        const response = await request(app)[method](path).send({});
        expect(response.status, method).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
        expect(response.headers["x-robots-tag"], method).toBeUndefined();
      }
      const read = await request(app).get(path);
      expect(read.status).toBe(404);
      expect(read.body).toEqual(NOT_FOUND);
      expect(read.headers["x-robots-tag"]).toBe("noindex, nofollow");
    });

    it("an unprotected router attached to a fresh copy of the real app is detected", () => {
      const tampered = createApp();
      const extra = Router();
      extra.get("/favorites", (_req: Request, res: Response) => res.json([]));
      tampered.use("/api/v1", extra);
      const result = evaluateInventory(
        inspectApp(tampered, policy),
        PUBLIC_ENDPOINT_ALLOWLIST,
        policy,
      );
      expect(result.violations).toEqual([
        "route get /api/v1/favorites: not protected and not in the public allowlist",
      ]);
    });
  });

  describe("a protected mount (fixture)", () => {
    const app = fixtureApp((api) => mountProtected(api, "/account", accountRouter()));
    const inventory = inspectApp(app, policy);
    const protectedEndpoints = inventory.endpoints.filter(
      (e) => e.protection === "protected-mount",
    );

    it("passes the structural policy and lists every route, nested and parameterised", () => {
      expect(evaluateInventory(inventory, FIXTURE_ALLOWLIST, policy).violations).toEqual([]);
      expect(protectedEndpoints.map((e) => `${e.methods.join(",")} ${e.path}`)).toEqual([
        "get /api/v1/account",
        "post /api/v1/account",
        "put /api/v1/account/items/:itemId",
        "delete /api/v1/account/items/:itemId",
        "get /api/v1/account/nested/:id",
      ]);
    });

    it("anonymous and forged-cookie requests to EVERY discovered protected endpoint get 401 before any handler runs", async () => {
      const result = await sweepProtectedEndpoints(app, protectedEndpoints);
      expect(result.failures).toEqual([]);
      expect(result.requests).toBe(10);
      for (const spy of allSpies) expect(spy).not.toHaveBeenCalled();
    });

    it("the sampled paths really address those handlers: a signed-in request reaches each one", async () => {
      const cookie = await signedInCookie(app, "sweep@example.com");
      const reached: string[] = [];
      for (const endpoint of protectedEndpoints) {
        for (const method of endpoint.methods as Method[]) {
          const response = await send(app, method, samplePath(endpoint.path), cookie);
          expect(response.status, `${method} ${endpoint.path}`).toBe(200);
          reached.push(response.body.at);
        }
      }
      expect(reached).toEqual(["root", "create", "item", "remove", "nested"]);
      for (const spy of allSpies) expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe("improper registrations are detected (fixtures)", () => {
    it("direct routes, plain router mounts, bare functions, and route-level-only guards are each flagged", () => {
      const app = fixtureApp((api) => {
        api.get("/direct", spies.root);
        api.use("/plain", accountRouter());
        api.use("/bare", function listThings(_req: Request, res: Response) {
          res.json([]);
        });
        api.get("/route-level", requireSession, spies.root);
      });
      const violations = evaluateInventory(
        inspectApp(app, policy),
        FIXTURE_ALLOWLIST,
        policy,
      ).violations;
      expect(violations).toEqual([
        "route get /api/v1/direct: not protected and not in the public allowlist",
        "route get /api/v1/plain: not protected and not in the public allowlist",
        "route post /api/v1/plain: not protected and not in the public allowlist",
        "route put /api/v1/plain/items/:itemId: not protected and not in the public allowlist",
        "route delete /api/v1/plain/items/:itemId: not protected and not in the public allowlist",
        "route get /api/v1/plain/nested/:id: not protected and not in the public allowlist",
        "middleware * /api/v1/bare: not protected and not in the public allowlist",
        "route get /api/v1/route-level: requireSession on the route only — account routes must use mountProtected",
      ]);
    });

    it("short-circuit: a middleware ahead of a protected mount can answer anonymously, and the inspector reports it", async () => {
      const app = fixtureApp((api) => {
        api.use("/account", function leakyCache(req: Request, res: Response, next: NextFunction) {
          if (req.query.cached === "1") {
            res.json({ cached: "account data" });
            return;
          }
          next();
        });
        mountProtected(api, "/account", accountRouter());
      });

      // Behaviour: requireSession IS registered, yet an anonymous request is answered.
      const leaked = await request(app).get("/api/v1/account?cached=1");
      expect(leaked.status).toBe(200);
      expect(leaked.body).toEqual({ cached: "account data" });

      // Structure: the presence of requireSession is not accepted as proof.
      const violations = evaluateInventory(
        inspectApp(app, policy),
        FIXTURE_ALLOWLIST,
        policy,
      ).violations;
      expect(violations).toContain(
        "middleware * /api/v1/account: not protected and not in the public allowlist",
      );
      expect(violations).toContain(
        'route get /api/v1/account: "leakyCache" runs before requireSession and could answer first',
      );
    });

    it("ordering: a handler placed before requireSession on the same route answers anonymously, and is reported", async () => {
      const app = fixtureApp((api) => {
        api.get(
          "/ordered",
          function peek(_req: Request, res: Response) {
            res.json({ peeked: true });
          },
          requireSession,
          spies.root,
        );
      });
      const response = await request(app).get("/api/v1/ordered");
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ peeked: true });
      const violations = evaluateInventory(
        inspectApp(app, policy),
        FIXTURE_ALLOWLIST,
        policy,
      ).violations;
      expect(violations).toContain(
        'route get /api/v1/ordered: "peek" runs before requireSession and could answer first',
      );
    });

    it("mutation: a protected mount whose session check is replaced by a pass-through fails BOTH checks", async () => {
      const passThrough: RequestHandler = (_req, _res, next) => next();
      const app = fixtureApp((api) =>
        createMountProtected(passThrough)(api, "/account", accountRouter()),
      );
      const inventory = inspectApp(app, policy);

      const structural = evaluateInventory(inventory, FIXTURE_ALLOWLIST, policy).violations;
      // All five routes, plus the pass-through itself.
      expect(structural.filter((v) => v.includes("/api/v1/account"))).toHaveLength(6);
      // A pass-through looks like an ordinary middleware endpoint, which is flagged too.
      expect(structural).toContain(
        "middleware * /api/v1/account: not protected and not in the public allowlist",
      );

      // The sweep, pointed at the same discovered routes, reports every request.
      const routes = inventory.endpoints.filter(
        (e) => e.kind === "route" && e.path.startsWith("/api/v1/account"),
      );
      const behavioural = await sweepProtectedEndpoints(app, routes);
      expect(behavioural.requests).toBe(10);
      expect(behavioural.failures).toHaveLength(10);
    });
  });
});
