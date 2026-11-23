import { Router } from "express";
import { mountProtected } from "../auth/mount-protected.js";
import { favoritesRouter } from "../favorites/router.js";
import { landmarksRouter } from "../landmarks/router.js";
import { publicReviewsRouter } from "../reviews/public-router.js";
import { reviewsRouter } from "../reviews/router.js";

// Application API routes mount here. Landmark retrieval (M01-T05) and the
// public review list (M04-T02; GET-only, in the reviewed public allowlist)
// are public; favorites (M03-T05) and the authenticated reviews API (M04-T02)
// are account-scoped and mounted ONLY through `mountProtected` (ADR-012) —
// never `apiRouter.use` or route-level guards. Trips (M05) follow the same
// pattern.
// /api/auth/* (Better Auth, M03-T02) is a separate top-level mount in app.ts,
// registered ahead of this router.
export const apiRouter = Router();
apiRouter.use(landmarksRouter);
apiRouter.use(publicReviewsRouter);
mountProtected(apiRouter, "/favorites", favoritesRouter);
mountProtected(apiRouter, "/reviews", reviewsRouter);
