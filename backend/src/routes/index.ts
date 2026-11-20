import { Router } from "express";
import { mountProtected } from "../auth/mount-protected.js";
import { favoritesRouter } from "../favorites/router.js";
import { landmarksRouter } from "../landmarks/router.js";

// Application API routes mount here. Landmark retrieval (M01-T05) is public;
// favorites (M03-T05) is the first account-scoped router and is mounted ONLY
// through `mountProtected` (ADR-012) — never `apiRouter.use` or route-level
// guards. Reviews (M04) and trips (M05) follow the same pattern.
// /api/auth/* (Better Auth, M03-T02) is a separate top-level mount in app.ts,
// registered ahead of this router.
export const apiRouter = Router();
apiRouter.use(landmarksRouter);
mountProtected(apiRouter, "/favorites", favoritesRouter);
