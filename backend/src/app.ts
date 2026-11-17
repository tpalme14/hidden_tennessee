import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { auth } from "./auth/auth.js";
import { createClientIpMiddleware } from "./auth/client-ip.js";
import { mountBetterAuth } from "./auth/mount.js";
import { requireTrustedOrigin } from "./auth/require-trusted-origin.js";
import { env } from "./config/env.js";
import { apiRouter } from "./routes/index.js";
import { healthRouter } from "./routes/health.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Built frontend output, once `frontend` is built (ADR-008 single-origin deployment).
const frontendDistPath = path.resolve(__dirname, "../../frontend/dist");

export function createApp() {
  const app = express();

  // 0. Client address (M03-T02 Increment 5): Express resolves it through the
  //    configured trusted-proxy hop count (default 0 = the socket peer), and
  //    the middleware hands the validated result to Better Auth through a
  //    private header — the library never reads X-Forwarded-For itself.
  app.set("trust proxy", env.auth.trustedProxyHops);
  app.use(createClientIpMiddleware({ trustedProxyHops: env.auth.trustedProxyHops }));

  // 1. /api/auth/* — Better Auth (M03-T02). Mounted BEFORE express.json():
  //    the handler reads the raw request body itself, and a body parser
  //    registered ahead of it would consume the stream first (library docs).
  //    Unknown paths under this prefix get Better Auth's own 404, not the
  //    application envelope below (approved M03-T02 decision). A rejected
  //    handler (infrastructure failure) becomes a 503 envelope — see mount.ts.
  mountBetterAuth(app, auth);

  app.use(express.json());

  // 2. /api/v1/* — application API router, behind the CSRF origin check for
  //    cookie-bearing state-changing requests (M03-T02 Increment 4). The
  //    check is origin evidence only; identity comes from `requireSession`
  //    on each protected route (see require-trusted-origin.ts).
  app.use("/api/v1", requireTrustedOrigin, apiRouter);

  // 3. /health — top-level readiness endpoint (ADR-008 routing contract),
  //    not nested under /api/v1.
  app.use(healthRouter);

  // 4. Unknown /api/* requests, any method: standardized JSON 404, never
  //    falls through to the SPA fallback.
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found." } });
  });

  // 5. Static frontend assets (also covers a future root-level service
  //    worker/manifest once M06 adds vite-plugin-pwa — Vite's default build
  //    output already places those at the dist root).
  app.use(express.static(frontendDistPath));

  // 6. SPA fallback — GET only, registered last, for client-side routed
  //    navigation requests only. Never intercepts /api/* (already handled
  //    above) or non-GET methods.
  app.get("*", (_req: Request, res: Response) => {
    res.sendFile(path.join(frontendDistPath, "index.html"), (err) => {
      if (err) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found." } });
      }
    });
  });

  return app;
}
