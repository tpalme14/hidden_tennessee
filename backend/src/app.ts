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
import { SHARED_TRIP_CACHE_CONTROL, SHARED_TRIP_ROBOTS_TAG } from "./trips/shared-router.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Built frontend output, once `frontend` is built (ADR-008 single-origin deployment).
const frontendDistPath = path.resolve(__dirname, "../../frontend/dist");

/**
 * The public shared-trip PAGE (`/shared/trips/:shareToken`; M05-T06
 * Increment 5b, decisions D1/D1a; spec v1.1 §7.2). Mirrors the paths the
 * frontend router actually matches to that route (checked against React
 * Router's `matchRoutes`): exactly one non-empty segment after
 * `/shared/trips/`, any number of trailing slashes, case-insensitive. Purely
 * structural — any segment qualifies (valid, malformed, revoked, or unknown
 * token alike), so no lookup, authentication, or sharing setting is
 * involved. Tested against `req.path`, which never includes the query string,
 * both raw and percent-decoded (M06-T02 Increment 2a): React Router decodes
 * the path before matching, so `/%73hared/trips/<token>` also displays the
 * shared trip and must receive the same headers.
 */
export const SHARED_TRIP_PAGE_PATH = /^\/shared\/trips\/[^/]+\/*$/i;

/**
 * Static and PWA infrastructure files (ADR-008 routing contract; M06-T02
 * Increment 1a): the built `/assets/*` bundle, `/icons/*`, the service worker
 * script, the web app manifest, and generated Workbox runtime files. Existing
 * files are served by `express.static` first; a request that reaches the SPA
 * fallback for one of these paths is for a MISSING file and must get a 404,
 * never the application's index.html with 200. Case-insensitive; checked
 * against `req.path` (no query string), raw and percent-decoded, because
 * `express.static` decodes the path when it looks the file up.
 */
const INFRASTRUCTURE_FILE_PATH =
  /^\/(?:assets\/|icons\/|sw\.js$|manifest\.webmanifest$|workbox-[^/]+\.js$)/i;

/**
 * True when `pattern` matches the request path as received or after one
 * percent-decoding pass. Malformed percent-encoding never throws: it simply
 * cannot match in decoded form.
 */
function matchesRawOrDecodedPath(pattern: RegExp, requestPath: string): boolean {
  if (pattern.test(requestPath)) return true;
  try {
    return pattern.test(decodeURIComponent(requestPath));
  } catch {
    return false;
  }
}

/**
 * `options.frontendDistPath` exists so tests can serve a controlled build
 * directory (for example, one guaranteed not to contain `sw.js`); production
 * always uses the default, the built frontend.
 */
export function createApp(options: { frontendDistPath?: string } = {}) {
  const distPath = options.frontendDistPath ?? frontendDistPath;
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
  app.use(express.static(distPath));

  // 6. SPA fallback — GET only, registered last, for client-side routed
  //    navigation requests only. Never intercepts /api/* (already handled
  //    above) or non-GET methods.
  //    The shared-trip page's HTML is never indexed or stored (D1/D1a): the
  //    headers are set before sendFile, which leaves an existing
  //    Cache-Control in place (send 0.19: it sets its own only when none is
  //    present). Defensive measures only — not access control; the token in
  //    the URL is neither read nor logged here.
  //    A missing static or PWA infrastructure file is a 404, not the SPA
  //    (ADR-008; see INFRASTRUCTURE_FILE_PATH above).
  app.get("*", (req: Request, res: Response) => {
    if (matchesRawOrDecodedPath(INFRASTRUCTURE_FILE_PATH, req.path)) {
      res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found." } });
      return;
    }
    if (matchesRawOrDecodedPath(SHARED_TRIP_PAGE_PATH, req.path)) {
      res.setHeader("X-Robots-Tag", SHARED_TRIP_ROBOTS_TAG);
      res.setHeader("Cache-Control", SHARED_TRIP_CACHE_CONTROL);
    }
    res.sendFile(path.join(distPath, "index.html"), (err) => {
      if (err) {
        res.status(404).json({ error: { code: "NOT_FOUND", message: "Resource not found." } });
      }
    });
  });

  return app;
}
