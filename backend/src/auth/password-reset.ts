import { APIError, createAuthMiddleware } from "better-auth/api";
import {
  MailError,
  providerErrorCode,
  type MailMessage,
  type MailTransport,
} from "../mail/mail-transport.js";
import { safeAuthLog } from "./log-sanitizer.js";

/**
 * Password reset (M03-T02 Increment 6; spec §4.3).
 *
 * Better Auth owns the token (24 random alphanumerics, stored as a SHA-256
 * hash, 30-minute lifetime, consumed atomically once) and the endpoints. The
 * application owns three things: the readiness gate, the email text, and the
 * link — built from the configured public origin as
 * `/reset-password?token=…`, never from the library's parameterised GET
 * callback route (which would place the token in a redirect URL).
 */

export const RESET_PASSWORD_PATH = "/request-password-reset";
export const RESET_PAGE_PATH = "/reset-password";
export const RESET_TOKEN_LIFETIME_SECONDS = 30 * 60;

/** Canonical reset link: `<public origin>/reset-password?token=<token>`. */
export function buildResetLink(publicOrigin: string, token: string): string {
  const url = new URL(RESET_PAGE_PATH, new URL(publicOrigin).origin);
  url.searchParams.set("token", token);
  return url.href;
}

/** Plain text only. No name (the product has none), no HTML, no tracking. */
export function composeResetEmail(to: string, link: string): MailMessage {
  return {
    to,
    subject: "Reset your Tennessee Natural Landmarks Explorer password",
    text: [
      "Someone asked to reset the password for this email address.",
      "",
      "If that was you, open this link within 30 minutes:",
      link,
      "",
      "The link works once. If you did not request a reset, you can ignore this message; your password has not changed.",
    ].join("\n"),
  };
}

/**
 * The library's `sendResetPassword` callback. The library AWAITS it (verified
 * in 1.7.18: `runInBackgroundOrAwait` with no background handler), so it must
 * return as soon as delivery is handed off — never await the provider. The
 * rejection handler is attached synchronously, so a failed or delayed send
 * can neither block the HTTP response nor become an unhandled rejection.
 * Failures are logged as event codes only: no address, no token.
 */
export function createResetPasswordSender(transport: MailTransport, publicOrigin: string) {
  return async ({ user, token }: { user: { email: string }; token: string }): Promise<void> => {
    const message = composeResetEmail(user.email, buildResetLink(publicOrigin, token));
    transport.send(message).catch((error: unknown) => {
      const code = error instanceof MailError ? error.code : "MAIL_SEND_FAILED";
      const providerCode =
        error instanceof MailError ? error.providerCode : providerErrorCode(error);
      safeAuthLog("error", code, {
        provider: transport.kind,
        ...(providerCode ? { code: providerCode } : {}),
      });
    });
  };
}

/**
 * Global before-hook: when the transport is not available, every caller of
 * the reset-request endpoint gets the same 503 BEFORE any account lookup, so
 * unavailability reveals nothing about the address and creates no record.
 */
export function createResetReadinessHook(transport: MailTransport) {
  return createAuthMiddleware(async (ctx) => {
    if (ctx.path !== RESET_PASSWORD_PATH) return;
    if (await transport.isReady()) return;
    safeAuthLog("warn", "RESET_UNAVAILABLE", { provider: transport.kind });
    throw APIError.from("SERVICE_UNAVAILABLE", {
      message: "Password reset is temporarily unavailable. Please try again later.",
      code: "RESET_UNAVAILABLE",
    });
  });
}
