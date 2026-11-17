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
