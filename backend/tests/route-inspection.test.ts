import { describe, expect, it } from "vitest";
import express, { Router, type NextFunction, type Request, type Response } from "express";
import {
  createMountProtected,
  noStore,
  protectedRouteErrorHandler,
} from "../src/auth/protected-route.js";
import {
  assertSupportedExpress,
  decodeMountPath,
  evaluateInventory,
  inspectApp,
  type AllowlistEntry,
  type Endpoint,
  type InspectionPolicy,
} from "./helpers/route-inspection.js";

/**
 * M03-T04 Increment 2 — self-tests for the deny-by-default route inspector on
 * SYNTHETIC apps. They pin every Express 4 internal the inspector relies on,
 * so an Express change fails here loudly. Stand-in guards are used (by
 * identity), so no Better Auth configuration is loaded; the real app is
 * covered by route-inventory.integration.test.ts.
 */

// Stand-ins, recognised by IDENTITY (names deliberately match the real ones).
function requireSession(_req: Request, _res: Response, next: NextFunction) {
  next();
}
function requireTrustedOrigin(_req: Request, _res: Response, next: NextFunction) {
  next();
}
function authInfrastructureErrorHandler(_e: unknown, _q: Request, _s: Response, n: NextFunction) {
  n();
}

const policy: InspectionPolicy = {
  requireSession: requireSession as never,
  noStore: noStore as never,
  protectedRouteErrorHandler: protectedRouteErrorHandler as never,
  requireTrustedOrigin: requireTrustedOrigin as never,
  externalAuthErrorHandler: authInfrastructureErrorHandler as never,
  globalMiddlewareNames: ["query", "expressInit", "jsonParser"],
};
const mountProtected = createMountProtected(requireSession);
const handler = (_req: Request, res: Response) => {
  res.json({});
};

function endpoint(app: unknown, path: string): Endpoint {
  const found = inspectApp(app, policy).endpoints.filter((e) => e.path === path);
  expect(found, `endpoints at ${path}`).toHaveLength(1);
  return found[0]!;
}
function violations(app: unknown, allowlist: readonly AllowlistEntry[] = []) {
  return evaluateInventory(inspectApp(app, policy), allowlist, policy).violations;
}

describe("Express internals the inspector relies on", () => {
  it("the installed Express is major version 4", () => {
    expect(assertSupportedExpress()).toMatch(/^4\./);
  });

  it("decodes literal mount paths exactly and refuses anything else", () => {
    const app = express();
    app.use("/", handler);
    app.use("/api/v1", handler);
    app.use("/a/b_c-d", handler);
    app.use("/items/:id", handler);
    app.use(/^\/regex/, handler);
    const stack = (
      app as unknown as { _router: { stack: Parameters<typeof decodeMountPath>[0][] } }
    )._router.stack;
    const decoded = stack.slice(-5).map((layer) => decodeMountPath(layer));
    expect(decoded).toEqual(["/", "/api/v1", "/a/b_c-d", null, null]);
  });
});

describe("full paths and inherited middleware", () => {
  it("a direct app route is found with its full path and is unprotected", () => {
    const app = express();
    app.get("/api/v1/favorites", handler);
    const e = endpoint(app, "/api/v1/favorites");
    expect(e).toMatchObject({ kind: "route", methods: ["get"], protection: "none" });
    expect(violations(app)).toEqual([
      "route get /api/v1/favorites: not protected and not in the public allowlist",
    ]);
  });

  it("three nested routers give the joined path and the applicable ancestor chain, in order", () => {
    const app = express();
    const v1 = Router();
    const inner = Router();
    const leaf = Router();
    leaf.get("/:id", handler);
    inner.use("/leaf", leaf);
    v1.use("/inner", inner);
    app.use("/api/v1", requireTrustedOrigin, v1);
    const e = endpoint(app, "/api/v1/inner/leaf/:id");
    expect(e.chain.map((c) => c.name)).toEqual([
      "query",
      "expressInit",
      "requireTrustedOrigin",
      "handler",
    ]);
  });

  it("routers mounted at / add nothing to the path, at the top level and nested", () => {
    const app = express();
    const top = Router();
    top.get("/health", handler);
    app.use(top);
    const api = Router();
    const inner = Router();
    inner.get("/landmarks", handler);
    api.use("/", inner);
    app.use("/api/v1", api);
    const paths = inspectApp(app, policy).endpoints.map((e) => e.path);
    expect(paths).toEqual(["/health", "/api/v1/landmarks"]);
  });

  it("route(), all(), and multi-method routes are enumerated", () => {
    const app = express();
    app.route("/r").get(handler).post(handler);
    const router = Router();
    router.all("/everything", handler);
    app.use("/x", router);
    expect(endpoint(app, "/r").methods).toEqual(["get", "post"]);
    expect(endpoint(app, "/x/everything").methods).toEqual(["*"]);
  });
});

describe("protection is credited only for the real guard, in the right place", () => {
  it("a mountProtected group protects nested and parameterised routes with no violations", () => {
    const app = express();
    const api = Router();
    const favorites = Router();
    favorites.get("/", handler);
    favorites.put("/:landmarkId", handler);
    const nested = Router();
    nested.get("/:id", handler);
    favorites.use("/nested", nested);
    mountProtected(api, "/favorites", favorites);
    app.use("/api/v1", requireTrustedOrigin, api);

    const inventory = inspectApp(app, policy);
    const protectedPaths = inventory.endpoints
      .filter((e) => e.protection === "protected-mount")
      .map((e) => `${e.methods.join(",")} ${e.path}`);
    expect(protectedPaths).toEqual([
      "get /api/v1/favorites",
      "put /api/v1/favorites/:landmarkId",
      "get /api/v1/favorites/nested/:id",
    ]);
    expect(inventory.endpoints.every((e) => e.protectedMountPath === "/api/v1/favorites")).toBe(
      true,
    );
    expect(evaluateInventory(inventory, [], policy).violations).toEqual([]);
  });

  it("requireSession on the route alone is reported: account routes must use mountProtected", () => {
    const app = express();
    app.get("/api/v1/favorites", requireSession, handler);
    expect(endpoint(app, "/api/v1/favorites").protection).toBe("route-level-only");
    expect(violations(app)).toEqual([
      "route get /api/v1/favorites: requireSession on the route only — account routes must use mountProtected",
    ]);
  });

  it("a guard after the handler does not protect it", () => {
    const app = express();
    app.get("/api/v1/favorites", handler, requireSession);
    expect(violations(app)).toContain(
      "route get /api/v1/favorites: requireSession is the final handler, not ahead of one",
    );
  });

  it("a guard registered AFTER the router does not apply to it", () => {
    const app = express();
    const favorites = Router();
    favorites.get("/", handler);
    app.use("/favorites", favorites);
    app.use("/favorites", requireSession);
    expect(endpoint(app, "/favorites").protection).toBe("none");
  });

  it.each(["/fav", "/favorites-old", "/favoritesX"])(
    "a guard on the sibling path %s is not inherited by /favorites",
    (sibling) => {
      const app = express();
      const favorites = Router();
      favorites.get("/", handler);
      app.use(sibling, requireSession);
      app.use("/favorites", favorites);
      expect(endpoint(app, "/favorites").protection).toBe("none");
    },
  );

  it("an impostor function NAMED requireSession is not protection", () => {
    const app = express();
    const impostor = {
      requireSession(_req: Request, _res: Response, next: NextFunction) {
        next();
      },
    }.requireSession;
    const favorites = Router();
    favorites.get("/", handler);
    app.use("/favorites", noStore, impostor, favorites, protectedRouteErrorHandler);
    expect(impostor.name).toBe("requireSession");
    const atPath = inspectApp(app, policy).endpoints.filter((e) => e.path === "/favorites");
    const route = atPath.find((e) => e.kind === "route")!;
    expect(route.protection).toBe("none");
    expect(route.protectedMountPath).toBeNull();
    // Not the real guard, so the impostor is itself an unclassified endpoint.
    expect(atPath.find((e) => e.kind === "middleware")?.handlers).toEqual([impostor]);
  });

  it("the same four functions in separate use() calls at different paths are not a protected mount", () => {
    const app = express();
    const favorites = Router();
    favorites.get("/", handler);
    app.use("/favorites", noStore);
    app.use("/other", requireSession);
    app.use("/favorites", favorites);
    app.use("/favorites", protectedRouteErrorHandler);
    expect(endpoint(app, "/favorites").protectedMountPath).toBeNull();
  });
});

describe("registrations outside mountProtected are detected", () => {
  it("a plain router.use() mount flags every route under it", () => {
    const app = express();
    const api = Router();
    const favorites = Router();
    favorites.get("/", handler);
    favorites.delete("/:landmarkId", handler);
    api.use("/favorites", favorites);
    app.use("/api/v1", requireTrustedOrigin, api);
    expect(violations(app)).toEqual([
      "route get /api/v1/favorites: not protected and not in the public allowlist",
      "route delete /api/v1/favorites/:landmarkId: not protected and not in the public allowlist",
    ]);
  });

  it("a bare function mounted with use() is an endpoint and is flagged", () => {
    const app = express();
    const api = Router();
    api.use("/favorites", function listFavorites(_req: Request, res: Response) {
      res.json([]);
    });
    app.use("/api/v1", api);
    const e = endpoint(app, "/api/v1/favorites");
    expect(e).toMatchObject({ kind: "middleware", methods: ["*"], protection: "none" });
    expect(violations(app)).toEqual([
      "middleware * /api/v1/favorites: not protected and not in the public allowlist",
    ]);
  });

  it("a middleware that could answer BEFORE requireSession is reported even inside a protected mount (short-circuit)", () => {
    const app = express();
    const api = Router();
    const favorites = Router();
    favorites.get("/", handler);
    api.use("/favorites", function leakyCache(_req: Request, _res: Response, next: NextFunction) {
      next();
    });
    mountProtected(api, "/favorites", favorites);
    app.use("/api/v1", api);
    const routeEndpoint = inspectApp(app, policy).endpoints.find((e) => e.kind === "route")!;
    expect(routeEndpoint.protection).toBe("protected-mount");
    expect(routeEndpoint.problems).toEqual([
      '"leakyCache" runs before requireSession and could answer first',
    ]);
    expect(violations(app)).toEqual([
      "middleware * /api/v1/favorites: not protected and not in the public allowlist",
      'route get /api/v1/favorites: "leakyCache" runs before requireSession and could answer first',
    ]);
  });

  it("a route handler placed before requireSession on the same route is reported", () => {
    const app = express();
    app.get(
      "/api/v1/favorites",
      function peek(_req: Request, _res: Response, next: NextFunction) {
        next();
      },
      requireSession,
      handler,
    );
    expect(violations(app)).toContain(
      'route get /api/v1/favorites: "peek" runs before requireSession and could answer first',
    );
  });

  it("an unknown global middleware at / is flagged for review", () => {
    const app = express();
    app.use(function sneaky(_req: Request, _res: Response, next: NextFunction) {
      next();
    });
    expect(violations(app)).toEqual([
      "middleware * /: not protected and not in the public allowlist",
    ]);
  });

  it("parameter mounts, regular-expression mounts, and sub-applications are unrecognised (fail closed)", () => {
    const app = express();
    app.use("/users/:id", Router());
    app.use(/^\/re/, handler);
    app.use("/sub", express());
    expect(violations(app)).toEqual([
      expect.stringMatching(/^unrecognized layer at .*: mount path is not a literal path/),
      expect.stringMatching(/^unrecognized layer at .*: mount path is not a literal path/),
      "unrecognized layer at /sub: a mounted sub-application cannot be inspected",
    ]);
  });
});

describe("allowlist rules", () => {
  const getEntry = (path: string): AllowlistEntry => ({
    kind: "application",
    endpointKind: "route",
    methods: ["get"],
    path,
    reason: "test",
  });

  it("matches exactly: same path and method set; a prefix or a different method does not match", () => {
    const app = express();
    app.get("/api/v1/landmarks", handler);
    app.post("/api/v1/landmarks", handler);
    app.get("/api/v1/landmarks/extra", handler);
    expect(violations(app, [getEntry("/api/v1/landmarks")])).toEqual([
      "route post /api/v1/landmarks: not protected and not in the public allowlist",
      "route get /api/v1/landmarks/extra: not protected and not in the public allowlist",
    ]);
  });

  it("reports stale entries that match no endpoint", () => {
    const app = express();
    app.get("/a", handler);
    const result = evaluateInventory(
      inspectApp(app, policy),
      [getEntry("/a"), getEntry("/gone")],
      policy,
    );
    expect(result.violations).toEqual([]);
    expect(result.staleAllowlistEntries.map((e) => e.path)).toEqual(["/gone"]);
  });

  it("an application entry that is not GET-only is itself a violation", () => {
    const app = express();
    app.post("/a", handler);
    const entry: AllowlistEntry = { ...getEntry("/a"), methods: ["post"] };
    expect(violations(app, [entry])).toEqual([
      "allowlist entry /a is an application route but not GET-only",
    ]);
  });

  it("the external-auth entry needs the auth mount's error handler, not just the path", () => {
    const external: AllowlistEntry = {
      kind: "external-auth",
      endpointKind: "route",
      methods: "*",
      path: "/api/auth/*",
      reason: "test",
    };
    const genuine = express();
    genuine.all("/api/auth/*", handler, authInfrastructureErrorHandler);
    expect(violations(genuine, [external])).toEqual([]);

    const imitation = express();
    imitation.all("/api/auth/*", handler);
    expect(violations(imitation, [external])).toHaveLength(1);
  });
});
