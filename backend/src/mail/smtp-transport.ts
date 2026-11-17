import nodemailer from "nodemailer";
import { safeAuthLog } from "../auth/log-sanitizer.js";
import {
  MailError,
  providerErrorCode,
  type MailMessage,
  type MailTransport,
} from "./mail-transport.js";

/**
 * The subset of a nodemailer transporter this transport uses; injectable so
 * unit tests can drive timing without a network or a real provider.
 */
export interface Mailer {
  verify(): Promise<unknown>;
  sendMail(message: { from: string; to: string; subject: string; text: string }): Promise<unknown>;
}

export interface SmtpTransportOptions {
  mailer: Mailer;
  /** Verified sender identity (deployment decision). */
  from: string;
  /** Concurrent sends in flight before new ones are refused. Approved: 10. */
  maxInFlight?: number;
  /** Application deadline per send; the underlying operation is NOT cancelled by it (see below). */
  sendTimeoutMs?: number;
  /** Minimum gap between provider handshake re-checks while not ready. */
  verifyBackoffMs?: number;
  now?: () => number;
}

/** Bounded SMTP timeouts (nodemailer defaults are 120 s / 30 s / 600 s / 30 s). */
export const SMTP_TIMEOUTS = {
  dnsTimeout: 10_000,
  connectionTimeout: 10_000,
  greetingTimeout: 10_000,
  socketTimeout: 30_000,
} as const;

export const DEFAULT_MAX_IN_FLIGHT = 10;
export const DEFAULT_SEND_TIMEOUT_MS = 60_000;
export const DEFAULT_VERIFY_BACKOFF_MS = 60_000;

/**
 * SMTP delivery through nodemailer (M03-T02 Increment 6).
 *
 * Concurrency: at most `maxInFlight` sends may be active. A slot is taken
 * when `send` starts and released ONLY when the underlying provider call
 * settles — never by the application deadline (developer safeguard,
 * 2026-11-10). The deadline only decides what the caller is told and logs a
 * timeout event; nodemailer's own bounded socket/connection timeouts are what
 * terminate a stuck operation and free its slot. Because timed-out operations
 * keep their slot, they cannot accumulate past the cap: further sends are
 * refused with MAIL_QUEUE_FULL instead.
 *
 * Readiness: a successful `verify()` (SMTP handshake) marks the transport
 * ready. While not ready, `isReady()` re-checks at most once per backoff
 * window. Readiness is availability, not delivery.
 */
export class SmtpMailTransport implements MailTransport {
  readonly kind = "smtp";
  private readonly mailer: Mailer;
  private readonly from: string;
  private readonly maxInFlight: number;
  private readonly sendTimeoutMs: number;
  private readonly verifyBackoffMs: number;
  private readonly now: () => number;
  private inFlight = 0;
  private ready = false;
  private lastVerifyAttempt = Number.NEGATIVE_INFINITY;
  private verifying: Promise<boolean> | null = null;

  constructor(options: SmtpTransportOptions) {
    this.mailer = options.mailer;
    this.from = options.from;
    this.maxInFlight = options.maxInFlight ?? DEFAULT_MAX_IN_FLIGHT;
    this.sendTimeoutMs = options.sendTimeoutMs ?? DEFAULT_SEND_TIMEOUT_MS;
    this.verifyBackoffMs = options.verifyBackoffMs ?? DEFAULT_VERIFY_BACKOFF_MS;
    this.now = options.now ?? Date.now;
  }

  /** Sends currently holding a slot (diagnostic; used by tests). */
  get inFlightCount(): number {
    return this.inFlight;
  }

  async isReady(): Promise<boolean> {
    if (this.ready) return true;
    if (this.verifying) return this.verifying;
    if (this.now() - this.lastVerifyAttempt < this.verifyBackoffMs) return false;
    this.lastVerifyAttempt = this.now();
    this.verifying = this.mailer
      .verify()
      .then(() => {
        this.ready = true;
        return true;
      })
      .catch((error: unknown) => {
        safeAuthLog("warn", "MAIL_TRANSPORT_UNAVAILABLE", {
          provider: this.kind,
          code: providerErrorCode(error),
        });
        return false;
      })
      .finally(() => {
        this.verifying = null;
      });
    return this.verifying;
  }

  async send(message: MailMessage): Promise<void> {
    if (this.inFlight >= this.maxInFlight) {
      throw new MailError("MAIL_QUEUE_FULL");
    }
    this.inFlight += 1;
    let timedOut = false;

    // The provider call owns the slot until it settles, whatever the deadline says.
    const delivery = this.mailer
      .sendMail({ from: this.from, to: message.to, subject: message.subject, text: message.text })
      .then(
        () => {
          if (timedOut)
            safeAuthLog("warn", "MAIL_SEND_SETTLED_AFTER_TIMEOUT", { provider: this.kind });
          return "sent" as const;
        },
        (error: unknown) => {
          // Mark the transport for a fresh handshake check; acceptance failures
          // often mean the provider or credentials changed.
          this.ready = false;
          throw new MailError("MAIL_SEND_FAILED", providerErrorCode(error));
        },
      )
      .finally(() => {
        this.inFlight -= 1;
      });
    // Never let the slot-owning promise surface as an unhandled rejection.
    delivery.catch(() => {});

    let timer: NodeJS.Timeout | undefined;
    const deadline = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => resolve("timeout"), this.sendTimeoutMs);
    });
    try {
      const outcome = await Promise.race([delivery, deadline]);
      if (outcome === "timeout") {
        timedOut = true;
        throw new MailError("MAIL_SEND_TIMEOUT");
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Builds the production transport from the SMTP connection URL and sender. The URL carries credentials and is never logged. */
export function createSmtpMailTransport(config: { url: string; from: string }): SmtpMailTransport {
  const mailer = nodemailer.createTransport({ url: config.url, ...SMTP_TIMEOUTS });
  return new SmtpMailTransport({ mailer, from: config.from });
}
