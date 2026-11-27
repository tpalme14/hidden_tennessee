import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { isMutationMethod, updateSafety } from "../pwa/updateSafety";
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
 * Local refusal while an application update owns the transition gate
 * (M06-T02 Increment 4b-i). A client-side code only — the server never sends
 * it — meaning the request was NOT sent: no network request, no connectivity
 * evidence, nothing queued or retried.
 */
export const UPDATE_IN_PROGRESS = "UPDATE_IN_PROGRESS";

/**
 * Update-safety accounting for one request (M06-T02 Increment 4b-i). A
 * mutation (any method other than GET or HEAD) is counted synchronously,
 * before connectivity accounting and `fetch`; while an update transition holds
 * the gate it is refused here instead, before anything else happens. Returns
 * the idempotent release, which callers run in `finally`.
 */
function accountForRequest(method: string | undefined): () => void {
  if (!isMutationMethod(method)) return () => {};
  const release = updateSafety.beginMutationRequest();
  if (release === null) {
    throw new ApiError(
      0,
      UPDATE_IN_PROGRESS,
      "The request was not sent because the app is updating.",
    );
  }
  return release;
}

/** `sendJson` within the update-safety accounting: counted until the response is read and mapped. */
async function requestJson<T>(path: string, init: RequestInit): Promise<JsonResponse<T>> {
  const release = accountForRequest(init.method);
  try {
    return await sendJson<T>(path, init);
  } finally {
    release();
  }
}

/**
 * The one `fetch` call: sends the request with the defaults above, parses the
 * JSON body, and maps any non-2xx response to an `ApiError`. Every helper below
 * is a thin wrapper, so they all share identical error behaviour.
 */
async function sendJson<T>(path: string, init: RequestInit): Promise<JsonResponse<T>> {
  const sequence = connectivity.beginRequest();
  let response: Response;
  try {
    response = await fetch(path, { ...REQUEST_DEFAULTS, ...init });
  } catch (error) {
    connectivity.reportOutcome(sequence, transportFailureEvidence(error));
    throw networkError();
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    connectivity.reportOutcome(sequence, "server-problem");
    throw invalidResponse(response.status);
  }

  connectivity.reportOutcome(sequence, responseEvidence(response.status));
  if (!response.ok) {
    throw errorFromBody(response, body);
  }

  return { status: response.status, body: body as T };
}

/**
 * Connectivity evidence (M06-T02 Increment 3a; src/connectivity): any HTTP
 * response proves the server was reached — a 4xx (401, 403, 404, 429, …) is
 * ordinary reachability, a 5xx (including 503) is a server problem, never a
 * disconnection. Only a failed fetch is a network failure, and an intentional
 * abort is no evidence. Reporting never changes what the caller receives.
 */
function responseEvidence(status: number): RequestEvidence {
  return status >= 500 ? "server-problem" : "response";
}

function transportFailureEvidence(error: unknown): RequestEvidence {
  return error instanceof DOMException && error.name === "AbortError"
    ? "cancelled"
    : "network-failure";
}

export async function getJson<T>(path: string): Promise<T> {
  return (await requestJson<T>(path, { headers: { Accept: "application/json" } })).body;
}

/**
 * Public, unauthenticated JSON GET (M05-T06 Increment 1, decision D5) — only
 * for public reads that must not carry the session (the shared-trip page).
 * `credentials: "omit"` keeps cookies (and any other browser credentials) off
 * the request; the only header sent is `Accept`. Parsing and error mapping are
 * exactly `getJson`'s; nothing here re-checks the session, retries, or logs —
 * callers pass paths that may contain capability tokens, so neither the path
 * nor the response is ever written anywhere.
 */
export async function getPublicJson<T>(path: string): Promise<T> {
  return (
    await requestJson<T>(path, {
      credentials: "omit",
      headers: { Accept: "application/json" },
    })
  ).body;
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

/**
 * JSON PATCH (M04-T03): sends `payload` as the JSON body, with the same
 * request defaults and error mapping as every other helper, and returns the
 * status as well as the body (as `putJson` does). The browser adds the
 * `Origin` header the backend's CSRF check needs.
 */
export async function patchJson<T>(path: string, payload: unknown): Promise<JsonResponse<T>> {
  return requestJson<T>(path, {
    method: "PATCH",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * JSON PUT with a body (M05-T04; the trip reorder request). Like `patchJson`:
 * sends `payload` as JSON and returns the status as well as the body. The
 * body-less `putJson` above is unchanged (the favorites API accepts no body).
 */
export async function putJsonBody<T>(path: string, payload: unknown): Promise<JsonResponse<T>> {
  return requestJson<T>(path, {
    method: "PUT",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
}

/**
 * A request whose success is `204 No Content` (M05-T04; the trips API's stop
 * removal, trip deletion, and share revocation). Same request defaults and
 * the same error mapping as every JSON helper:
 *  - a `204` resolves, whatever headers it carries; its body is never read;
 *  - any other 2xx is unexpected for these endpoints → `INVALID_RESPONSE`
 *    with that status;
 *  - a non-2xx response is parsed as JSON and mapped exactly like
 *    `requestJson` (application envelope, `Retry-After`, a non-JSON body →
 *    `INVALID_RESPONSE`); a transport failure is `NETWORK_ERROR`.
 */
export async function requestNoContent(path: string, init: RequestInit): Promise<void> {
  const release = accountForRequest(init.method);
  try {
    await sendNoContent(path, init);
  } finally {
    release();
  }
}

async function sendNoContent(path: string, init: RequestInit): Promise<void> {
  const sequence = connectivity.beginRequest();
  let response: Response;
  try {
    response = await fetch(path, { ...REQUEST_DEFAULTS, ...init });
  } catch (error) {
    connectivity.reportOutcome(sequence, transportFailureEvidence(error));
    throw networkError();
  }

  if (response.status === 204) {
    connectivity.reportOutcome(sequence, "response");
    return;
  }
  if (response.ok) {
    connectivity.reportOutcome(sequence, "server-problem");
    throw invalidResponse(response.status);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    connectivity.reportOutcome(sequence, "server-problem");
    throw invalidResponse(response.status);
  }
  connectivity.reportOutcome(sequence, responseEvidence(response.status));
  throw errorFromBody(response, body);
}

/** Body-less DELETE that succeeds only with `204 No Content` (M05-T04). */
export async function deleteNoContent(path: string): Promise<void> {
  return requestNoContent(path, { method: "DELETE", headers: { Accept: "application/json" } });
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
