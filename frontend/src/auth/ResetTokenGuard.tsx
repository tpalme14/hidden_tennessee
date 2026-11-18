import { useEffect } from "react";
import { useLocation } from "react-router";
import { RESET_PASSWORD_PATH, clearResetToken } from "./resetToken";

/**
 * Forgets the in-memory password-reset token as soon as the app is on any
 * route other than `/reset-password` (M03-T03 Increment 6). Rendered once at
 * the application root, outside `<Routes>`, so it runs for every route —
 * including unmatched ones that render no layout — and never depends on the
 * reset page unmounting (which React's development mode also simulates).
 *
 * While the visitor stays on `/reset-password` it does nothing, so the token
 * captured by `main.tsx` survives re-renders and development-mode remounts.
 * Once cleared, returning with Back shows the "incomplete link" state: the
 * token was already stripped from the URL, so nothing can restore it.
 */
export function ResetTokenGuard() {
  const { pathname } = useLocation();
  useEffect(() => {
    if (pathname !== RESET_PASSWORD_PATH) clearResetToken();
  }, [pathname]);
  return null;
}
