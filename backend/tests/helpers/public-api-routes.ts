import type { AllowlistEntry } from "./route-inspection.js";

/**
 * The REVIEWED exceptions to the deny-by-default rule (M03-T04 Increment 2).
 *
 * tests/route-inventory.integration.test.ts requires every endpoint the
 * application can reach to be either behind a protected mount
 * (`mountProtected`) or listed here, matched EXACTLY on kind, method set, and
 * full path. Every entry must still match a real endpoint (stale entries
 * fail), and application entries must be GET-only — a public write can never
 * be allowlisted.
 *
 * Adding a public endpoint means adding an entry here, with its reason, in
 * the same change, so the exception is visible in review. An account-specific
 * route never belongs here: mount it with `mountProtected` instead.
 */
export const PUBLIC_ENDPOINT_ALLOWLIST: readonly AllowlistEntry[] = [
  {
    kind: "application",
    endpointKind: "route",
    methods: ["get"],
    path: "/api/v1/landmarks",
    reason: "Public landmark discovery (Specification 2; Specification 3 §5).",
  },
  {
    kind: "application",
    endpointKind: "route",
    methods: ["get"],
    path: "/api/v1/landmarks/:id",
    reason: "Public landmark profiles; redaction is enforced in the service (Specification 2).",
  },
  {
    kind: "application",
    endpointKind: "route",
    methods: ["get"],
    path: "/api/v1/categories",
    reason: "Public category list for discovery filters (Specification 2).",
  },
  {
    kind: "application",
    endpointKind: "route",
    methods: ["get"],
    path: "/health",
    reason: "Readiness endpoint required by the deployment routing contract (ADR-008).",
  },
  {
    kind: "external-auth",
    endpointKind: "route",
    methods: "*",
    path: "/api/auth/*",
    reason:
      "Better Auth's mount: externally managed authentication endpoints, not public application " +
      "routes. Each endpoint applies its own session, origin, validation, and rate-limit rules, and " +
      "unapproved ones are disabled; those controls are covered by the M03-T02 suites " +
      "(auth, csrf, disabled-endpoints, rate-limit, session-policy, password-reset). Identified by " +
      "its error handler, not by path alone.",
  },
  {
    kind: "spa",
    endpointKind: "route",
    methods: ["get"],
    path: "*",
    reason: "Single-page-application fallback: serves index.html only (ADR-008 routing contract).",
  },
  {
    kind: "api-not-found",
    endpointKind: "middleware",
    methods: "*",
    path: "/api",
    reason: "JSON 404 for unknown /api paths, so they never fall through to the SPA (ADR-008).",
  },
];

/** Application-wide middleware at "/" that can only be recognised by name (created inside createApp). */
export const GLOBAL_MIDDLEWARE_NAMES = [
  "query", // Express's own query parser
  "expressInit", // Express's own request/response setup
  "clientIp", // validated client address for rate limiting (M03-T02)
  "jsonParser", // express.json()
  "serveStatic", // express.static() for the built frontend
] as const;
