/**
 * Mail delivery abstraction (M03-T02 Increment 6; approved plan decision).
 *
 * The application never talks to a mail provider directly: the password-reset
 * flow composes a plain-text message and hands it to a `MailTransport`. Three
 * implementations exist — SMTP (nodemailer), disabled (never ready), and an
 * in-memory recorder for tests.
 */

export interface MailMessage {
  /** Recipient address. Never logged by any transport. */
  to: string;
  subject: string;
  /** Plain text only — no HTML, no remote resources, no third-party scripts. */
  text: string;
}

export interface MailTransport {
  /** Stable, non-sensitive label used in log event codes ("smtp", "disabled", "memory"). */
  readonly kind: string;
  /**
   * AVAILABILITY, not delivery: true when the transport is configured and
   * its most recent check of the provider succeeded. Acceptance by a mail
   * server is not delivery to a mailbox; nothing here can promise that.
   */
  isReady(): Promise<boolean>;
  /**
   * Hands the message to the provider. Resolves when the provider accepted
   * it, rejects with a `MailError` otherwise. Callers must attach their own
   * rejection handling synchronously — the reset flow never awaits delivery.
   */
  send(message: MailMessage): Promise<void>;
}

/** Stable event codes for delivery problems. Only these — never a message, address, or token — reach the logs. */
export type MailErrorCode =
  "MAIL_TRANSPORT_DISABLED" | "MAIL_QUEUE_FULL" | "MAIL_SEND_TIMEOUT" | "MAIL_SEND_FAILED";

export class MailError extends Error {
  constructor(
    readonly code: MailErrorCode,
    /** The provider's own error/response code when one exists (e.g. "EAUTH", 535) — never its text. */
    readonly providerCode?: string,
  ) {
    super(code);
    this.name = "MailError";
  }
}

/**
 * Reduces any error raised by a provider to a short, safe code. SMTP
 * responses and library messages can echo server text, so the message is
 * never used — only a `code`/`responseCode` property, or the class name.
 */
export function providerErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const withCodes = error as { code?: unknown; responseCode?: unknown; name?: unknown };
    if (typeof withCodes.code === "string" || typeof withCodes.code === "number") {
      return String(withCodes.code).slice(0, 32);
    }
    if (typeof withCodes.responseCode === "number") return String(withCodes.responseCode);
    if (typeof withCodes.name === "string") return withCodes.name.slice(0, 32);
  }
  return "unknown";
}
