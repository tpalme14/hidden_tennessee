import { DisabledMailTransport } from "./disabled-transport.js";
import type { MailTransport } from "./mail-transport.js";
import { createSmtpMailTransport } from "./smtp-transport.js";

export type MailTransportKind = "smtp" | "disabled";

export interface MailConfig {
  transport: MailTransportKind;
  smtpUrl?: string;
  from?: string;
}

/** Selects the transport from validated configuration (see src/config/env.ts). */
export function createMailTransport(config: MailConfig): MailTransport {
  if (config.transport === "smtp") {
    if (!config.smtpUrl || !config.from) {
      throw new Error("MAIL_TRANSPORT=smtp requires SMTP_URL and MAIL_FROM");
    }
    return createSmtpMailTransport({ url: config.smtpUrl, from: config.from });
  }
  return new DisabledMailTransport();
}

export type { MailMessage, MailTransport } from "./mail-transport.js";
