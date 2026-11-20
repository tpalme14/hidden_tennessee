import { createRequire } from "node:module";
import type { Router } from "express";

/**
 * Read-only introspection of an Express 4 router's layer stack, so tests can
 * enforce the authentication boundary structurally (M03-T02 Increment 4):
 * every state-changing route must run `requireSession` before its handler.
 */

export interface InspectedRoute {
  path: string;
  /** Lower-case HTTP methods the route answers. */
  methods: string[];
  /** The route's handler chain, in registration order. */
  handlers: ((...args: unknown[]) => unknown)[];
}

interface Layer {
  name?: string;
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: { handle: InspectedRoute["handlers"][number] }[];
  };
  handle?: { stack?: Layer[] } & InspectedRoute["handlers"][number];
}

/** Lists every route registered on `router`, descending into nested routers. */
export function listRoutes(router: Router): InspectedRoute[] {
  const routes: InspectedRoute[] = [];
  for (const layer of (router as unknown as { stack: Layer[] }).stack) {
    if (layer.route) {
      routes.push({
        path: layer.route.path,
        methods: Object.keys(layer.route.methods).filter((m) => layer.route!.methods[m]),
        handlers: layer.route.stack.map((s) => s.handle),
      });
    } else if (layer.name === "router" && layer.handle?.stack) {
      routes.push(...listRoutes(layer.handle as unknown as Router));
    }
  }
  return routes;
}

export const STATE_CHANGING_METHODS = ["post", "put", "patch", "delete"] as const;

/**
 * Routes that answer a state-changing method but do not run `guard` strictly
 * before their final handler. Empty when the boundary holds.
 */
export function findUnguardedStateChangingRoutes(
  router: Router,
  guard: InspectedRoute["handlers"][number],
): InspectedRoute[] {
  return listRoutes(router).filter((route) => {
    const stateChanging = route.methods.some((m) =>
      (STATE_CHANGING_METHODS as readonly string[]).includes(m),
    );
    if (!stateChanging) return false;
    const guardIndex = route.handlers.indexOf(guard);
    return guardIndex === -1 || guardIndex >= route.handlers.length - 1;
  });
}

// =============================================================================
// Deny-by-default route inventory (M03-T04 Increment 2)
// =============================================================================
//
// `inspectApp` lists every endpoint an Express app can reach — routes and
// bare middleware functions that could answer a request — with its FULL path
// and its EFFECTIVE middleware chain (the earlier middleware, in every
// enclosing router, that applies to it). `evaluateInventory` then requires
// each endpoint to be either behind a protected mount (ADR-012, Accepted) or an
// exact entry in the reviewed public allowlist.
//
// Dependency on UNDOCUMENTED Express 4 internals (no public API exposes the
// routing tree). Everything below is confined to this test helper, guarded
// by `assertSupportedExpress()`, and pinned by the self-tests in
// tests/route-inspection.test.ts, so an Express change fails loudly:
//   - `app._router`                         the application's root router
//   - `router.stack`                        its ordered Layer list
//   - `layer.handle`                        the registered function (or a sub-router)
//   - `layer.name`                          the function's name (used ONLY to
//                                           recognise Express's own and the
//                                           app's global middleware at "/")
//   - `layer.route` {path, methods, stack[].handle}   route layers
//   - `layer.regexp` (+ `fast_slash`), `layer.keys`    compiled mount paths
//   - `Layer.prototype.match(path)`         Express's own path matching
//
// What structural inspection cannot see: logic INSIDE a function (a
// middleware that answers a request through its own `if`, `next("router")`
// tricks, or a guard whose implementation was weakened). Function identity
// and ordering are checked here; actual rejection is checked behaviourally.

type Fn = (...args: unknown[]) => unknown;

interface RawLayer {
  name?: string;
  handle: Fn & { stack?: RawLayer[]; handle?: unknown };
  regexp: RegExp & { fast_slash?: boolean; fast_star?: boolean };
  keys?: unknown[];
  route?: { path: string; methods: Record<string, boolean>; stack: { handle: Fn }[] };
  match(path: string): boolean;
}

/** The identities and names the inventory needs; passed in so self-tests can use stand-ins. */
export interface InspectionPolicy {
  requireSession: Fn;
  noStore: Fn;
  protectedRouteErrorHandler: Fn;
  requireTrustedOrigin: Fn;
  /** Error handler that marks the externally managed Better Auth route. */
  externalAuthErrorHandler: Fn;
  /** Application-wide middleware at "/" that can only be recognised by name. */
  globalMiddlewareNames: readonly string[];
}

export interface ChainEntry {
  fn: Fn;
  name: string;
  /** Global middleware at "/" recognised by name (never counts as protection). */
  global: boolean;
}

export type Protection = "protected-mount" | "route-level-only" | "none";

export interface Endpoint {
  /** "route" for route layers; "middleware" for a bare function that could answer a request. */
  kind: "route" | "middleware";
  /** Lower-case methods; ["*"] for a middleware endpoint (any method). */
  methods: string[];
  /** Full path as registered, e.g. "/api/v1/landmarks/:id" or "/api/auth/*". */
  path: string;
  /** Applicable middleware from enclosing routers, in order, then the route's own handlers. */
  chain: ChainEntry[];
  /** The route's own handlers (or the middleware function itself). */
  handlers: Fn[];
  /** Full path of the enclosing protected mount, if the endpoint is inside one. */
  protectedMountPath: string | null;
  protection: Protection;
  /** Ordering problems found even when `requireSession` is present. */
  problems: string[];
}

export interface Inventory {
  endpoints: Endpoint[];
  /** Layers the inspector cannot interpret; any entry fails the policy (fail closed). */
  unrecognized: { path: string; reason: string }[];
}

/** Fails unless the installed Express is major version 4 — the internals above are Express 4's. */
export function assertSupportedExpress(): string {
  const version = (createRequire(import.meta.url)("express/package.json") as { version: string })
    .version;
  if (!version.startsWith("4.")) {
    throw new Error(
      `route inspection relies on Express 4 internals; found express@${version} — review tests/helpers/route-inspection.ts`,
    );
  }
  return version;
}

const LITERAL_MOUNT = /^\^((?:\\\/[A-Za-z0-9_-]+)+)\\\/\?\(\?=\\\/\|\$\)$/;

/**
 * The literal path a `use()` layer is mounted at, decoded from the two shapes
 * path-to-regexp 0.1.x produces for literal mounts: "/" (`fast_slash`) and
 * `^\/a\/b\/?(?=\/|$)`. Anything else (parameters, regular expressions) → null.
 */
export function decodeMountPath(layer: Pick<RawLayer, "regexp" | "keys">): string | null {
  if (layer.regexp.fast_slash) return "/";
  if ((layer.keys ?? []).length > 0) return null;
  const match = LITERAL_MOUNT.exec(layer.regexp.source);
  return match ? match[1]!.replace(/\\\//g, "/") : null;
}

function joinPath(prefix: string, path: string): string {
  // A router mounted at "/" adds nothing to the paths beneath it.
  const base = prefix === "/" ? "" : prefix;
  if (path === "/") return base === "" ? "/" : base;
  if (path === "*") return base === "" ? "*" : `${base}/*`;
  return `${base}${path}`;
}

/** A concrete path for matching only: parameters and wildcards become a neutral sample segment. */
export function samplePath(path: string): string {
  if (path === "*") return "/sample";
  return path.replace(/:[A-Za-z0-9_]+\??/g, "sample").replace(/\*/g, "sample");
}

function isRouter(layer: RawLayer): boolean {
  return (
    !layer.route && typeof layer.handle?.handle === "function" && Array.isArray(layer.handle.stack)
  );
}

function routeMethods(route: NonNullable<RawLayer["route"]>): string[] {
  return Object.keys(route.methods)
    .filter((m) => route.methods[m])
    .map((m) => (m === "_all" ? "*" : m))
    .sort();
}

interface Pending {
  layer: RawLayer;
  mountPath: string;
  entry: ChainEntry;
}

/** Walks the whole application routing tree. */
export function inspectApp(app: unknown, policy: InspectionPolicy): Inventory {
  const root = (app as { _router?: { stack: RawLayer[] } })._router;
  if (!root) throw new Error("app has no router (no routes or middleware registered)");
  const inventory: Inventory = { endpoints: [], unrecognized: [] };
  walk(root.stack, "", [], null, policy, inventory);
  return inventory;
}

function walk(
  stack: RawLayer[],
  prefix: string,
  ancestors: ChainEntry[],
  protectedMountPath: string | null,
  policy: InspectionPolicy,
  inventory: Inventory,
): void {
  // Earlier non-route, non-router middleware in THIS router, in order.
  const earlier: Pending[] = [];
  const applicable = (target: string) =>
    earlier.filter((p) => p.layer.match(samplePath(target))).map((p) => p.entry);

  stack.forEach((layer, index) => {
    if (layer.route) {
      const fullPath = joinPath(prefix, layer.route.path);
      const handlers = layer.route.stack.map((s) => s.handle);
      const chain = [
        ...ancestors,
        ...applicable(layer.route.path),
        ...handlers.map((fn) => entryFor(fn, false)),
      ];
      inventory.endpoints.push(
        assess(
          "route",
          routeMethods(layer.route),
          fullPath,
          chain,
          handlers,
          protectedMountPath,
          policy,
        ),
      );
      return;
    }

    const mountPath = decodeMountPath(layer);
    if (mountPath === null) {
      inventory.unrecognized.push({
        path: `${prefix}<${layer.regexp.source}>`,
        reason: "mount path is not a literal path the inspector can decode",
      });
      return;
    }

    if (isRouter(layer)) {
      const childPrefix = joinPath(prefix, mountPath);
      const childAncestors = [...ancestors, ...applicable(mountPath)];
      const mountedHere = isProtectedMountGroup(stack, index, policy) ? childPrefix : null;
      walk(
        layer.handle.stack!,
        childPrefix,
        childAncestors,
        mountedHere ?? protectedMountPath,
        policy,
        inventory,
      );
      return;
    }

    if (layer.name === "mounted_app") {
      inventory.unrecognized.push({
        path: joinPath(prefix, mountPath),
        reason: "a mounted sub-application cannot be inspected",
      });
      return;
    }

    const fn = layer.handle;
    // Error handlers (four parameters) never run for a normal request.
    if (fn.length === 4) return;

    const isKnown =
      fn === policy.requireSession || fn === policy.noStore || fn === policy.requireTrustedOrigin;
    const isGlobal =
      prefix === "" && mountPath === "/" && policy.globalMiddlewareNames.includes(layer.name ?? "");
    if (isKnown || isGlobal) {
      earlier.push({ layer, mountPath, entry: entryFor(fn, isGlobal) });
      return;
    }

    // Any other bare function could answer requests itself: it is an endpoint.
    const fullPath = joinPath(prefix, mountPath);
    const chain = [...ancestors, ...applicable(mountPath), entryFor(fn, false)];
    inventory.endpoints.push(
      assess("middleware", ["*"], fullPath, chain, [fn], protectedMountPath, policy),
    );
    // It also runs before any later layer it matches, so it is part of their chain.
    earlier.push({ layer, mountPath, entry: entryFor(fn, false) });
  });
}

function entryFor(fn: Fn, global: boolean): ChainEntry {
  return { fn, name: fn.name || "<anonymous>", global };
}

/**
 * True when `stack[index]` (a router) is the third layer of exactly the group
 * `mountProtected` creates: [noStore, requireSession, router,
 * protectedRouteErrorHandler], contiguous and at the same mount path.
 */
function isProtectedMountGroup(
  stack: RawLayer[],
  index: number,
  policy: InspectionPolicy,
): boolean {
  const group = [stack[index - 2], stack[index - 1], stack[index], stack[index + 1]];
  if (group.some((l) => l === undefined)) return false;
  const [a, b, router, d] = group as RawLayer[];
  const sameMount = group.every((l) => l!.regexp.source === router!.regexp.source);
  return (
    sameMount &&
    a!.handle === policy.noStore &&
    b!.handle === policy.requireSession &&
    d!.handle === policy.protectedRouteErrorHandler
  );
}

/**
 * Protection is credited only for the real `requireSession` (by identity),
 * placed before the final handler, with nothing ahead of it in the chain that
 * could answer the request first — only global middleware recognised at "/",
 * `noStore`, and the CSRF check may precede it.
 */
function assess(
  kind: Endpoint["kind"],
  methods: string[],
  path: string,
  chain: ChainEntry[],
  handlers: Fn[],
  protectedMountPath: string | null,
  policy: InspectionPolicy,
): Endpoint {
  const problems: string[] = [];
  const guardIndex = chain.findIndex((e) => e.fn === policy.requireSession);
  let protection: Protection = "none";
  if (guardIndex !== -1) {
    if (guardIndex >= chain.length - 1) {
      problems.push("requireSession is the final handler, not ahead of one");
    }
    for (const entry of chain.slice(0, guardIndex)) {
      const harmless =
        entry.global || entry.fn === policy.noStore || entry.fn === policy.requireTrustedOrigin;
      if (!harmless)
        problems.push(`"${entry.name}" runs before requireSession and could answer first`);
    }
    protection = protectedMountPath !== null ? "protected-mount" : "route-level-only";
  }
  return { kind, methods, path, chain, handlers, protectedMountPath, protection, problems };
}

// ---- policy evaluation -------------------------------------------------------

/** A reviewed exception to "every endpoint must be protected". */
export interface AllowlistEntry {
  /**
   * "application": a public application endpoint — GET only.
   * "external-auth": Better Auth's mount — externally managed authentication
   *   endpoints with their own controls (not public application routes).
   * "spa": the single-page-application fallback.
   * "api-not-found": the JSON 404 fallback for unknown /api paths.
   */
  kind: "application" | "external-auth" | "spa" | "api-not-found";
  endpointKind: Endpoint["kind"];
  /** Exact method set, or "*" for any (external-auth and api-not-found only). */
  methods: readonly string[] | "*";
  /** Exact full path as registered. */
  path: string;
  reason: string;
}

export interface PolicyResult {
  violations: string[];
  staleAllowlistEntries: AllowlistEntry[];
}

function sameMethods(entry: AllowlistEntry, endpoint: Endpoint): boolean {
  if (entry.methods === "*") return true;
  const wanted = [...entry.methods].sort();
  return (
    wanted.length === endpoint.methods.length && wanted.every((m, i) => m === endpoint.methods[i])
  );
}

function matchesEntry(
  entry: AllowlistEntry,
  endpoint: Endpoint,
  policy: InspectionPolicy,
): boolean {
  if (entry.endpointKind !== endpoint.kind || entry.path !== endpoint.path) return false;
  if (!sameMethods(entry, endpoint)) return false;
  // Better Auth is identified by the function, not the path alone.
  if (entry.kind === "external-auth") {
    return endpoint.handlers.includes(policy.externalAuthErrorHandler);
  }
  return true;
}

/** Applies the deny-by-default rule to an inventory. Empty `violations` means the boundary holds. */
export function evaluateInventory(
  inventory: Inventory,
  allowlist: readonly AllowlistEntry[],
  policy: InspectionPolicy,
): PolicyResult {
  const violations: string[] = inventory.unrecognized.map(
    (u) => `unrecognized layer at ${u.path}: ${u.reason}`,
  );

  for (const entry of allowlist) {
    if (
      entry.kind === "application" &&
      (entry.methods === "*" || entry.methods.some((m) => m !== "get"))
    ) {
      violations.push(`allowlist entry ${entry.path} is an application route but not GET-only`);
    }
  }

  const used = new Set<AllowlistEntry>();
  for (const endpoint of inventory.endpoints) {
    const label = `${endpoint.kind} ${endpoint.methods.join(",")} ${endpoint.path}`;
    const entry = allowlist.find((e) => matchesEntry(e, endpoint, policy));
    if (entry) {
      used.add(entry);
      continue;
    }
    if (endpoint.protection === "none") {
      violations.push(`${label}: not protected and not in the public allowlist`);
    } else if (endpoint.protection === "route-level-only") {
      violations.push(
        `${label}: requireSession on the route only — account routes must use mountProtected`,
      );
    }
    for (const problem of endpoint.problems) violations.push(`${label}: ${problem}`);
  }

  return { violations, staleAllowlistEntries: allowlist.filter((e) => !used.has(e)) };
}
