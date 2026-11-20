import { createMountProtected } from "./protected-route.js";
import { requireSession } from "./require-session.js";

/**
 * Mounts an account-scoped router at a specific path behind the real session
 * check (M03-T04; see protected-route.ts). The way every account-scoped API
 * router is mounted — favorites (M03-T05) will be the first.
 */
export const mountProtected = createMountProtected(requireSession);
