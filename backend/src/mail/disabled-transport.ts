import { MailError, type MailMessage, type MailTransport } from "./mail-transport.js";

/**
 * The transport used when no mail provider is configured (the default
 * outside production, and an explicit production choice). Never ready, so
 * the password-reset readiness gate answers 503 and no reset record is ever
 * created; a stray send is refused rather than silently dropped.
 */
export class DisabledMailTransport implements MailTransport {
  readonly kind = "disabled";

  async isReady(): Promise<boolean> {
    return false;
  }

  async send(_message: MailMessage): Promise<void> {
    throw new MailError("MAIL_TRANSPORT_DISABLED");
  }
}
