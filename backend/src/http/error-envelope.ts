export interface ErrorEnvelope {
  error: { code: string; message: string };
}

/** Spec LANDMARK_DISCOVERY_SPEC.md §7.3: a stable machine-readable code and a safe, user-facing message only. */
export function invalidQueryEnvelope(message: string): ErrorEnvelope {
  return { error: { code: "INVALID_QUERY", message } };
}

/** Matches the existing unknown-route 404 shape in src/app.ts, byte-for-byte, so every "not found" response in the API is identical. */
export function notFoundEnvelope(): ErrorEnvelope {
  return { error: { code: "NOT_FOUND", message: "Resource not found." } };
}
