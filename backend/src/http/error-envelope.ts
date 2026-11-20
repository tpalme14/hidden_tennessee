export interface ErrorEnvelope {
  error: { code: string; message: string };
}

/** Spec LANDMARK_DISCOVERY_SPEC.md §7.3: a stable machine-readable code and a safe, user-facing message only. */
export function invalidQueryEnvelope(message: string): ErrorEnvelope {
  return { error: { code: "INVALID_QUERY", message } };
}

/**
 * Spec AUTHENTICATION_FAVORITES_SPEC.md §§3, 5: protected API calls without a
 * valid session return 401. One identical body for missing, expired, forged,
 * and revoked sessions — the response never says which.
 */
export function unauthenticatedEnvelope(): ErrorEnvelope {
  return { error: { code: "UNAUTHENTICATED", message: "Authentication required." } };
}

/**
 * Spec AUTHENTICATION_FAVORITES_SPEC.md §9.1 / ADR-006: a cookie-bearing
 * state-changing request without trustworthy origin evidence. One body for a
 * missing, `null`, mismatched, or unparseable Origin/Referer — the response
 * never echoes the offending value.
 */
export function invalidOriginEnvelope(): ErrorEnvelope {
  return { error: { code: "INVALID_ORIGIN", message: "Request origin not allowed." } };
}

/**
 * An unexpected infrastructure failure (e.g. rate-limit storage unavailable)
 * while handling an authentication request — the library itself could not
 * answer. Fail closed: nothing was performed, nothing internal is disclosed.
 */
export function serviceUnavailableEnvelope(): ErrorEnvelope {
  return {
    error: { code: "SERVICE_UNAVAILABLE", message: "Service temporarily unavailable." },
  };
}

/**
 * An unexpected failure inside a protected (account-scoped) route, including a
 * handler that ran without an established identity (M03-T04; ADR-012 Accepted,
 * decision 8). A fixed body: no message text, stack, or internal detail.
 */
export function internalErrorEnvelope(): ErrorEnvelope {
  return { error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." } };
}

/** Matches the existing unknown-route 404 shape in src/app.ts, byte-for-byte, so every "not found" response in the API is identical. */
export function notFoundEnvelope(): ErrorEnvelope {
  return { error: { code: "NOT_FOUND", message: "Resource not found." } };
}
