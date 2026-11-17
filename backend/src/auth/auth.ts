import { betterAuth } from "better-auth";
import { env } from "../config/env.js";
import { prisma } from "../db/prisma.js";
import { createMailTransport } from "../mail/index.js";
import { buildAuthOptions } from "./auth-options.js";

/** Password-reset mail delivery, selected from MAIL_TRANSPORT (disabled unless configured). */
export const mailTransport = createMailTransport(env.mail);

/**
 * The application's Better Auth instance (M03-T02). Options live in
 * auth-options.ts; only email + password is enabled, and endpoints outside
 * the approved specification are disabled there.
 */
export const auth = betterAuth(
  buildAuthOptions({
    prisma,
    baseUrl: env.auth.baseUrl,
    secret: env.auth.secret,
    trustedOrigins: env.auth.trustedOrigins,
    rateLimitEnabled: env.auth.rateLimitEnabled,
    mailTransport,
  }),
);
