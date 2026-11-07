import { Router } from "express";
import { landmarksRouter } from "../landmarks/router.js";

// Application API routes mount here. Landmark retrieval (M01-T05) is mounted
// below; favorites (M03), reviews (M04), and trip (M05) routers are added in
// their respective milestones. /api/auth/* (Better Auth, M03-T02) mounts
// under the same /api/v1 parent in app.ts, ahead of this router.
export const apiRouter = Router();
apiRouter.use(landmarksRouter);
