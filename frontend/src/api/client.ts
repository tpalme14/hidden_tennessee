import type { ApiErrorBody } from "./types";

/**
 * The single place that calls `fetch`, parses JSON, and maps a non-2xx
 * response to a typed error — every API call in the app goes through this,
 * per the fullstack-typescript skill's centralization guidance. Relative
 * paths work in both dev (Vite's existing /api proxy) and production
 * (ADR-008 single-origin deployment), so no base URL configuration exists.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function getJson<T>(path: string): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" } });
  } catch {
    throw new ApiError(0, "NETWORK_ERROR", "Unable to reach the server. Check your connection and try again.");
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new ApiError(response.status, "INVALID_RESPONSE", "The server returned an unexpected response.");
  }

  if (!response.ok) {
    const errorBody = body as Partial<ApiErrorBody> | null;
    const code = errorBody?.error?.code ?? "UNKNOWN_ERROR";
    const message = errorBody?.error?.message ?? "Something went wrong. Please try again.";
    throw new ApiError(response.status, code, message);
  }

  return body as T;
}
