import { useSyncExternalStore } from "react";
import { ApiError, getJson } from "../api/client";
import { connectivity, type ConnectivityState, type ConnectivityStore } from "./connectivity";

/** The current connectivity evidence (M06-T02 Increment 3a), re-rendering on change. */
export function useConnectivity(store: ConnectivityStore = connectivity): ConnectivityState {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}

/**
 * The outcome of the user's explicit "Check connection" request. Only a 200
 * with the documented body (`{ "status": "ok" }`, backend/src/routes/health.ts)
 * is a healthy server; a 503 (`{ "status": "unavailable" }`) or another HTTP
 * error proves the server was reached but is not healthy; an unreadable body
 * is unexpected; a failed request leaves the server unreachable.
 */
export type HealthCheckOutcome = "healthy" | "unhealthy" | "unexpected" | "unreachable";

export type HealthCheck = () => Promise<HealthCheckOutcome>;

/**
 * One `GET /health` through the central API client, so its outcome is
 * connectivity evidence ordered like every other request. Called only when
 * the user asks; never automatically, never retried.
 */
export const checkServerHealth: HealthCheck = async () => {
  try {
    const body = await getJson<unknown>("/health");
    return typeof body === "object" &&
      body !== null &&
      (body as { status?: unknown }).status === "ok"
      ? "healthy"
      : "unexpected";
  } catch (error) {
    if (!(error instanceof ApiError)) return "unexpected";
    if (error.code === "NETWORK_ERROR") return "unreachable";
    if (error.code === "INVALID_RESPONSE") return "unexpected";
    return "unhealthy";
  }
};
