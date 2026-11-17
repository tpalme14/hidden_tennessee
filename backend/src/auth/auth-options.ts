import { randomUUID } from "node:crypto";
import type { BetterAuthOptions } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import type { PrismaClient } from "@prisma/client";
import type { MailTransport } from "../mail/mail-transport.js";
import { CLIENT_IP_HEADER } from "./client-ip.js";
import { databaseHooks } from "./hooks.js";
import { safeAuthLog } from "./log-sanitizer.js";
import {
  RESET_TOKEN_LIFETIME_SECONDS,
  createResetPasswordSender,
  createResetReadinessHook,
} from "./password-reset.js";

const DAY_IN_SECONDS = 60 * 60 * 24;
const MINUTE_IN_SECONDS = 60;

export interface AuthConfig {
  prisma: PrismaClient;
  /** Public origin the auth endpoints are served from (drives cookie `Secure`/`__Secure-`). */
  baseUrl: string;
  secret: string;
  /** Additional trusted browser origins (the Vite dev server in development). */
  trustedOrigins: readonly string[];
  /** Rate limiting on/off (the library's default would be "production only"). */
  rateLimitEnabled: boolean;
  /** Password-reset mail delivery (Increment 6). */
  mailTransport: MailTransport;
}

/**
 * Approved rate-limit thresholds (developer decision, 2026-11-10), per client
 * address and path, window in seconds. A window runs from the client's last
 * ALLOWED request; blocked requests do not extend it (verified in the
 * installed 1.7.18 limiter).
 */
export const RATE_LIMIT_RULES = {
  "/sign-in/email": { window: MINUTE_IN_SECONDS, max: 5 },
  "/sign-up/email": { window: 10 * MINUTE_IN_SECONDS, max: 5 },
  "/request-password-reset": { window: 10 * MINUTE_IN_SECONDS, max: 3 },
  "/reset-password": { window: 10 * MINUTE_IN_SECONDS, max: 5 },
} as const;

/** Every other /api/auth path (get-session, sign-out, …). */
export const DEFAULT_RATE_LIMIT_RULE = { window: 10, max: 100 } as const;

/**
 * Better Auth endpoints the installed 1.7.18 router registers but the approved
 * specification does not include (account deletion, social login, profiles,
 * email verification, in-session password/email changes, session listing and
 * revocation). Each path is the exact string the router registers; the
 * library answers 404 before validation, rate limiting, or hooks run.
 * `/callback/:id` is parameterised and cannot be listed — with no social
 * provider configured it can perform no operation (verified by test).
 */
export const DISABLED_AUTH_PATHS: readonly string[] = [
  "/update-user",
  "/change-email",
  "/change-password",
  "/verify-password",
  "/update-session",
  "/delete-user",
  "/delete-user/callback",
  "/list-sessions",
  "/revoke-session",
  "/revoke-sessions",
  "/revoke-other-sessions",
  "/list-accounts",
  "/account-info",
  "/link-social",
  "/unlink-account",
  "/refresh-token",
  "/get-access-token",
  "/sign-in/social",
  "/verify-email",
  "/send-verification-email",
];

/**
 * Builds the Better Auth options (M03-T02 Increments 2–4; conventions from
 * ADR-011). A pure function of its inputs so a test can build a second
 * instance — e.g. with an https base URL — without touching the real one.
 */
export function buildAuthOptions(config: AuthConfig) {
  return {
    database: prismaAdapter(config.prisma, { provider: "postgresql" }),
    baseURL: config.baseUrl,
    secret: config.secret,
    trustedOrigins: [...config.trustedOrigins],
    emailAndPassword: {
      enabled: true,
      // Registration never signs the user in; they sign in explicitly
      // afterwards. This also makes a duplicate sign-up return the same
      // generic response as a first one (account-enumeration protection).
      autoSignIn: false,
      minPasswordLength: 8,
      maxPasswordLength: 128,
      // The generic duplicate response is built from a synthetic user. Make it
      // indistinguishable from a real one under THIS configuration: the hook
      // forces every stored name to "", and ids are database UUIDs.
      customSyntheticUser: ({ coreFields }) => ({ ...coreFields, name: "", id: randomUUID() }),
      // Password reset (spec §4.3): 30-minute single-use token; the link is
      // built from the public origin; delivery is handed off, never awaited.
      sendResetPassword: createResetPasswordSender(config.mailTransport, config.baseUrl),
      resetPasswordTokenExpiresIn: RESET_TOKEN_LIFETIME_SECONDS,
      // NOT automatic in the library (verified 1.7.18 utils/password.mjs):
      // with this on, every database session of the user is deleted inside
      // the same transaction that consumes the token and writes the hash.
      revokeSessionsOnPasswordReset: true,
    },
    verification: {
      // Reset tokens at rest are SHA-256 hashes of their identifier; lookups
      // and the atomic consume hash the same way.
      storeIdentifier: "hashed",
    },
    hooks: {
      before: createResetReadinessHook(config.mailTransport),
    },
    session: {
      expiresIn: 30 * DAY_IN_SECONDS,
      updateAge: 23 * DAY_IN_SECONDS,
    },
    user: {
      deleteUser: { enabled: false },
    },
    advanced: {
      // PostgreSQL generates every id (gen_random_uuid()); the library sends none.
      database: { generateId: false },
      // The library skips its Origin/Referer check when NODE_ENV=test. Keep it
      // on everywhere so the integration tests exercise the real behavior.
      disableOriginCheck: false,
      // The ONLY header the library reads for the client address: the one
      // src/auth/client-ip.ts derives server-side. Naming headers here
      // replaces the library's default (X-Forwarded-For) entirely.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },
    // Database-backed rate limiting (ADR-011 decision 9) on the Increment 1
    // `rate_limits` table. The library's own built-in path rules are
    // superseded by the approved custom rules; every other path gets the
    // default rule. Check-and-increment is one conditional database update,
    // so the limit holds across concurrent requests and processes.
    rateLimit: {
      enabled: config.rateLimitEnabled,
      storage: "database",
      window: DEFAULT_RATE_LIMIT_RULE.window,
      max: DEFAULT_RATE_LIMIT_RULE.max,
      customRules: { ...RATE_LIMIT_RULES },
    },
    disabledPaths: [...DISABLED_AUTH_PATHS],
    databaseHooks,
    // info-level lines include request details such as the email of a
    // duplicate sign-up attempt; only warnings and errors are emitted, and
    // every emitted line goes through the sanitizer (bounded, no control
    // characters, no stacks or object dumps).
    logger: { level: "warn", log: safeAuthLog },
    // Error routing (Increment 6, replacing the Increment 4 `onError` hook).
    // Verified in 1.7.18 (api/index.mjs onError + better-call router): with
    // `throw`, the router re-throws every error before its default logging;
    // API errors are still turned into their normal responses by the router's
    // inner catch (400/401/403/404/429 unchanged), while anything else
    // propagates to the Express 503 handler in mount.ts, which logs one
    // sanitized event line. The default handler would instead have written
    // the raw error object to the console and answered an empty 500.
    onAPIError: { throw: true },
    telemetry: { enabled: false },
  } satisfies BetterAuthOptions;
}
