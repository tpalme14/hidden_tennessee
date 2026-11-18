/**
 * Password-reset token handling (spec §4.3; M03-T03 refinement 1, Increment 5).
 *
 * The emailed link is `/reset-password?token=…`. `captureResetToken` runs
 * synchronously from `main.tsx` before React initializes, renders, or makes
 * any application request: it copies the token into this module's memory and
 * immediately rewrites the current history entry without it
 * (`history.replaceState`), so no later request URL, Referer, history entry,
 * or rendered link can carry it. The token is never written to browser
 * storage, cookies, the router, or any log; it leaves the browser only in the
 * body of the reset POST.
 *
 * Unavoidable and recorded as a deployment consideration: the initial
 * document request itself carries the token, so it can reach server or proxy
 * access logs before any script runs.
 */

export const RESET_PASSWORD_PATH = "/reset-password";
const TOKEN_PARAM = "token";
/** Better Auth issues 24-character tokens; anything implausible is discarded unseen. */
const MAX_TOKEN_LENGTH = 256;

let capturedToken: string | null = null;

interface CaptureEnvironment {
  location: Pick<Location, "pathname" | "search" | "hash">;
  history: Pick<History, "replaceState" | "state">;
}

/**
 * Captures and strips the token when the current URL is the reset page with a
 * `token` parameter. Other query parameters and the fragment are kept. Safe
 * to call more than once; a later call without a token keeps the earlier one.
 */
export function captureResetToken(
  env: CaptureEnvironment = { location: window.location, history: window.history },
): void {
  const { location, history } = env;
  if (location.pathname !== RESET_PASSWORD_PATH) return;

  const params = new URLSearchParams(location.search);
  if (!params.has(TOKEN_PARAM)) return;

  const raw = params.get(TOKEN_PARAM) ?? "";
  params.delete(TOKEN_PARAM);
  const search = params.toString();
  history.replaceState(
    history.state,
    "",
    `${location.pathname}${search === "" ? "" : `?${search}`}${location.hash}`,
  );

  capturedToken = raw.length > 0 && raw.length <= MAX_TOKEN_LENGTH ? raw : null;
}

/** The captured token, if any. Memory only. */
export function getResetToken(): string | null {
  return capturedToken;
}

/** Forgets the token — after a successful reset, or once the server has rejected it. */
export function clearResetToken(): void {
  capturedToken = null;
}
