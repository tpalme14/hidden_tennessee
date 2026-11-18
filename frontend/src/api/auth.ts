import { ApiError, getJson, postJson } from "./client";

/**
 * Typed wrappers over the six Better Auth endpoints the application uses,
 * mirroring the contracts verified in M03-T02 (backend tests
 * auth/session-policy/password-reset.integration.test.ts). No Better Auth
 * client package: the endpoints are plain JSON, cookies are HttpOnly and
 * handled by the browser, and the backend's CSRF check only needs the
 * `Origin` header the browser adds to these requests itself.
 *
 * Response bodies are checked for the fields the UI relies on; anything
 * else surfaces as an `INVALID_RESPONSE` ApiError rather than a crash.
 */

const AUTH_BASE = "/api/auth";

/** The user as the backend returns it; `name` is always "" (ADR-011) and no secrets are present. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
}

/** `GET /api/auth/get-session`: `null` when there is no valid session. */
export interface SessionResponse {
  session: AuthSession;
  user: AuthUser;
}

interface RegistrationResponse {
  token: null;
  user: AuthUser;
}

interface SignInResponse {
  redirect: boolean;
  token: string;
  user: AuthUser;
}

function isAuthUser(value: unknown): value is AuthUser {
  if (typeof value !== "object" || value === null) return false;
  const user = value as Record<string, unknown>;
  return typeof user.id === "string" && typeof user.email === "string";
}

function invalidResponse(): ApiError {
  return new ApiError(200, "INVALID_RESPONSE", "The server returned an unexpected response.");
}

/**
 * Registration (spec §4.1). Better Auth requires a `name`; the product has no
 * display name, so the API sends "" and the backend hook forces "" anyway
 * (M03-T01 decision 1). Registration never creates a session (`autoSignIn`
 * is off): a duplicate address receives the same success response as a new
 * one, so callers must not infer account existence from this call.
 */
export async function register(email: string, password: string): Promise<AuthUser> {
  const body = await postJson<RegistrationResponse>(`${AUTH_BASE}/sign-up/email`, {
    name: "",
    email,
    password,
  });
  if (!isAuthUser(body?.user)) throw invalidResponse();
  return body.user;
}

/** Sign-in (spec §4.2). A wrong password and an unknown address produce the identical 401. */
export async function signIn(email: string, password: string): Promise<AuthUser> {
  const body = await postJson<SignInResponse>(`${AUTH_BASE}/sign-in/email`, { email, password });
  if (!isAuthUser(body?.user)) throw invalidResponse();
  return body.user;
}

/** Current session from the server — the only source of truth for signed-in state (spec §3.2). */
export async function getSession(): Promise<SessionResponse | null> {
  const body = await getJson<SessionResponse | null>(`${AUTH_BASE}/get-session`);
  if (body === null) return null;
  if (!isAuthUser(body?.user) || typeof body?.session?.id !== "string") throw invalidResponse();
  return body;
}

/** Sign-out of the current session only (spec §4.4). Resolves only when the server confirmed it. */
export async function signOut(): Promise<void> {
  const body = await postJson<{ success?: unknown }>(`${AUTH_BASE}/sign-out`, {});
  if (body?.success !== true) throw invalidResponse();
}

/**
 * Password-reset request (spec §4.3). The server answers the same neutral
 * body whether or not the address exists; the reset link is built by the
 * backend from the configured public origin, so no redirect target is sent.
 * A 503 with code RESET_UNAVAILABLE means delivery is not available.
 */
export async function requestPasswordReset(email: string): Promise<void> {
  await postJson<{ status?: unknown }>(`${AUTH_BASE}/request-password-reset`, { email });
}

/** Password-reset completion: the token goes in the body only, never a URL. */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const body = await postJson<{ status?: unknown }>(`${AUTH_BASE}/reset-password`, {
    token,
    newPassword,
  });
  if (body?.status !== true) throw invalidResponse();
}
