import type { ApiErrorBody } from "./types";

/**
 * The single place that calls `fetch`, parses JSON, and maps a non-2xx
 * response to a typed error — every API call in the app goes through this,
 * per the fullstack-typescript skill's centralization guidance. Relative
 * paths work in both dev (Vite's existing /api proxy) and production
 * (ADR-008 single-origin deployment), so no base URL configuration exists.
 *
 * Request options are the browser defaults, stated explicitly (M03-T03):
 * `mode: "cors"` keeps the real `Origin` header on POSTs under the global
 * `strict-origin` referrer policy in index.html (the Fetch standard can null
 * it for non-cors modes under restrictive policies), which the backend's CSRF
 * checks require; `credentials: "same-origin"`
 * sends the HttpOnly session cookie to our own origin and nowhere else.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Present on 429 responses when the server said how long to wait. */
  readonly retryAfterSeconds?: number;

  constructor(status: number, code: string, message: string, retryAfterSeconds?: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    if (retryAfterSeconds !== undefined) this.retryAfterSeconds = retryAfterSeconds;
  }
}

const REQUEST_DEFAULTS = { mode: "cors", credentials: "same-origin" } as const;

/** A successful response's HTTP status and parsed JSON body. */
export interface JsonResponse<T> {
  status: number;
  body: T;
}

/**
 * The one `fetch` call: sends the request with the defaults above, parses the
 * JSON body, and maps any non-2xx response to an `ApiError`. Every helper below
 * is a thin wrapper, so they all share identical error behaviour.
 */
async function requestJson<T>(path: string, init: RequestInit): Promise<JsonResponse<T>> {
  let response: Response;
  try {
    response = await fetch(path, { ...REQUEST_DEFAULTS, ...init });
  } catch {
    throw networkError();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw invalidResponse(response.status);
  }

  if (!response.ok) {
    throw errorFromBody(response, body);
  }

  return { status: response.status, body: body as T };
}

export async function getJson<T>(path: string): Promise<T> {
  return (await requestJson<T>(path, { headers: { Accept: "application/json" } })).body;
}

/**
 * JSON POST with the same error mapping as `getJson`, plus the two shapes the
 * authentication endpoints produce that the application envelope does not
 * cover (M03-T02): Better Auth's flat `{ code, message }` and the rate
 * limiter's `{ message }` with an `X-Retry-After` header.
 */
export async function postJson<T>(path: string, payload: unknown): Promise<T> {
  return (
    await requestJson<T>(path, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
  ).body;
}

/**
 * Body-less PUT (M03-T06). Returns the status as well as the body, because
 * some endpoints distinguish outcomes by status alone (the favorites API
 * answers 201 for a new favorite and 200 for an existing one). No body and no
 * `Content-Type` are sent: the favorites API accepts only an absent or empty
 * body. The browser adds the `Origin` header the backend's CSRF check needs.
 */
export async function putJson<T>(path: string): Promise<JsonResponse<T>> {
  return requestJson<T>(path, { method: "PUT", headers: { Accept: "application/json" } });
}

/** Body-less DELETE with the same behaviour as `putJson` (M03-T06). */
export async function deleteJson<T>(path: string): Promise<JsonResponse<T>> {
  return requestJson<T>(path, { method: "DELETE", headers: { Accept: "application/json" } });
}

function networkError(): ApiError {
  return new ApiError(
    0,
    "NETWORK_ERROR",
    "Unable to reach the server. Check your connection and try again.",
  );
}

function invalidResponse(status: number): ApiError {
  return new ApiError(status, "INVALID_RESPONSE", "The server returned an unexpected response.");
}

/** `Retry-After` (standard) or `X-Retry-After` (Better Auth), in whole seconds, when parseable. */
function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers?.get("retry-after") ?? response.headers?.get("x-retry-after");
  if (raw === null || raw === undefined || raw === "") return undefined;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

function errorFromBody(response: Response, body: unknown): ApiError {
  const retryAfter = retryAfterSeconds(response);
  const record = (body ?? {}) as Partial<ApiErrorBody> & { code?: unknown; message?: unknown };

  // 1. The application envelope: { error: { code, message } }.
  if (record.error && typeof record.error === "object") {
    const code = typeof record.error.code === "string" ? record.error.code : "UNKNOWN_ERROR";
    const message =
      typeof record.error.message === "string"
        ? record.error.message
        : "Something went wrong. Please try again.";
    return new ApiError(response.status, code, message, retryAfter);
  }

  // 2. Better Auth's flat shape: { code, message } — or { message } alone on 429.
  const flatMessage = typeof record.message === "string" ? record.message : undefined;
  const flatCode =
    typeof record.code === "string"
      ? record.code
      : response.status === 429
        ? "RATE_LIMITED"
        : "UNKNOWN_ERROR";
  return new ApiError(
    response.status,
    flatCode,
    flatMessage ?? "Something went wrong. Please try again.",
    retryAfter,
  );
}
