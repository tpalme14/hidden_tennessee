import path from "node:path";
import { fileURLToPath } from "node:url";
import express, { type Request, type Response } from "express";
import { apiRouter } from "./routes/index.js";
import { healthRouter } from "./routes/health.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Built frontend output, once `frontend` is built (ADR-008 single-origin deployment).
const frontendDistPath = path.resolve(__dirname, "../../frontend/dist");

export function createApp() {
  const app = express();

  app.use(express.json());

  // 1. /api/auth/* — reserved mount point for Better Auth (M03-T02). Not
  //    wired up yet; intentionally left unmounted until that task.

  // 2. /api/v1/* — application API router (empty until M01+ feature work).
  app.use("/api/v1", apiRouter);

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
