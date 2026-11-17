import { MailError, type MailMessage, type MailTransport } from "../../src/mail/mail-transport.js";

/**
 * Test-only transport (M03-T02 Increment 6): records every message, with a
 * switchable readiness flag and a configurable send behaviour so tests can
 * exercise unavailability, provider failure, and slow delivery. `reset()`
 * starts a new generation: a slow send still in flight from an earlier test
 * is discarded when it finally completes instead of leaking into the next.
 */
export class MemoryMailTransport implements MailTransport {
  readonly kind = "memory";
  readonly messages: MailMessage[] = [];
  sendCalls = 0;
  ready = true;
  behavior: "ok" | "reject" | { delayMs: number } = "ok";
  private generation = 0;

  reset() {
    this.generation += 1;
    this.messages.length = 0;
    this.sendCalls = 0;
    this.ready = true;
    this.behavior = "ok";
  }

  async isReady(): Promise<boolean> {
    return this.ready;
  }

  async send(message: MailMessage): Promise<void> {
    const generation = this.generation;
    this.sendCalls += 1;
    if (this.behavior === "reject") throw new MailError("MAIL_SEND_FAILED", "ESIMULATED");
    if (typeof this.behavior === "object") {
      await new Promise((resolve) => setTimeout(resolve, this.behavior.delayMs));
    }
    if (generation === this.generation) this.messages.push(message);
  }
}
