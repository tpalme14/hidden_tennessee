import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
import { createMailTransport } from "../src/mail/index.js";
import { DisabledMailTransport } from "../src/mail/disabled-transport.js";
import { MailError, providerErrorCode } from "../src/mail/mail-transport.js";
import { SMTP_TIMEOUTS, SmtpMailTransport, type Mailer } from "../src/mail/smtp-transport.js";
import { buildResetLink, composeResetEmail } from "../src/auth/password-reset.js";

/** M03-T02 Increment 6 — mail transports (unit: no network, no database). */

interface Deferred {
  promise: Promise<unknown>;
  resolve: (value?: unknown) => void;
  reject: (error: unknown) => void;
}
function deferred(): Deferred {
  let resolve!: Deferred["resolve"];
  let reject!: Deferred["reject"];
  const promise = new Promise<unknown>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** A mailer whose sends are controlled by the test. */
function fakeMailer() {
  const pending: Deferred[] = [];
  const sent: unknown[] = [];
  let verifyImpl: () => Promise<unknown> = async () => true;
  const mailer: Mailer = {
    verify: () => verifyImpl(),
    sendMail: async (message) => {
      sent.push(message);
      const d = deferred();
      pending.push(d);
      return d.promise;
    },
  };
  return {
    mailer,
    pending,
    sent,
    setVerify(impl: () => Promise<unknown>) {
      verifyImpl = impl;
    },
  };
}

/** Lets promise callbacks scheduled so far run. */
const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("SmtpMailTransport (unit)", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("passes the composed message with the configured sender and frees the slot when the provider accepts", async () => {
    const fake = fakeMailer();
    const transport = new SmtpMailTransport({
      mailer: fake.mailer,
      from: "Landmarks <no-reply@example.test>",
    });
    const send = transport.send({ to: "hiker@example.com", subject: "s", text: "t" });
    expect(transport.inFlightCount).toBe(1);
    expect(fake.sent[0]).toEqual({
      from: "Landmarks <no-reply@example.test>",
      to: "hiker@example.com",
      subject: "s",
      text: "t",
    });
    fake.pending[0]!.resolve({ accepted: ["hiker@example.com"] });
    await expect(send).resolves.toBeUndefined();
    expect(transport.inFlightCount).toBe(0);
  });

  it("refuses the (max + 1)th concurrent send with MAIL_QUEUE_FULL and never queues it", async () => {
    const fake = fakeMailer();
    const transport = new SmtpMailTransport({
      mailer: fake.mailer,
      from: "a@example.test",
      maxInFlight: 2,
    });
    const first = transport.send({ to: "1@example.com", subject: "s", text: "t" });
    const second = transport.send({ to: "2@example.com", subject: "s", text: "t" });
    await expect(
      transport.send({ to: "3@example.com", subject: "s", text: "t" }),
    ).rejects.toMatchObject({
      name: "MailError",
      code: "MAIL_QUEUE_FULL",
    });
    expect(fake.sent).toHaveLength(2); // the third never reached the provider
    expect(transport.inFlightCount).toBe(2);
    fake.pending[0]!.resolve();
    fake.pending[1]!.resolve();
    await Promise.all([first, second]);
    expect(transport.inFlightCount).toBe(0);
  });

  it("the deadline rejects the caller but does NOT release the slot until the provider call settles", async () => {
    const fake = fakeMailer();
    const transport = new SmtpMailTransport({
      mailer: fake.mailer,
      from: "a@example.test",
      sendTimeoutMs: 50,
    });
    const send = transport.send({ to: "1@example.com", subject: "s", text: "t" });
    const outcome = send.catch((e: unknown) => e);
    vi.advanceTimersByTime(50);
    await expect(outcome).resolves.toMatchObject({ name: "MailError", code: "MAIL_SEND_TIMEOUT" });
    expect(transport.inFlightCount).toBe(1); // still occupied

    fake.pending[0]!.resolve();
    await flush();
    expect(transport.inFlightCount).toBe(0);
    expect(
      warn.mock.calls.some((c) => String(c[0]).includes("MAIL_SEND_SETTLED_AFTER_TIMEOUT")),
    ).toBe(true);
  });

  it("timed-out sends cannot accumulate: with every slot held by stuck sends, new sends are refused", async () => {
    const fake = fakeMailer();
    const transport = new SmtpMailTransport({
      mailer: fake.mailer,
      from: "a@example.test",
      maxInFlight: 2,
      sendTimeoutMs: 10,
    });
    const stuck = [
      transport.send({ to: "1@example.com", subject: "s", text: "t" }).catch((e: unknown) => e),
      transport.send({ to: "2@example.com", subject: "s", text: "t" }).catch((e: unknown) => e),
    ];
    vi.advanceTimersByTime(10);
    const outcomes = await Promise.all(stuck);
    expect(outcomes.map((e) => (e as MailError).code)).toEqual([
      "MAIL_SEND_TIMEOUT",
      "MAIL_SEND_TIMEOUT",
    ]);
    expect(transport.inFlightCount).toBe(2);
    await expect(
      transport.send({ to: "3@example.com", subject: "s", text: "t" }),
    ).rejects.toMatchObject({ code: "MAIL_QUEUE_FULL" });
    expect(fake.sent).toHaveLength(2);
    // The provider's own timeouts eventually settle the stuck calls → slots return.
    fake.pending.forEach((p) =>
      p.reject(Object.assign(new Error("Connection timeout"), { code: "ETIMEDOUT" })),
    );
    await flush();
    expect(transport.inFlightCount).toBe(0);
  });

  it("a provider failure becomes MAIL_SEND_FAILED with only the provider's code — never its text — and clears readiness", async () => {
    const fake = fakeMailer();
    const transport = new SmtpMailTransport({ mailer: fake.mailer, from: "a@example.test" });
    expect(await transport.isReady()).toBe(true);
    const send = transport.send({ to: "1@example.com", subject: "s", text: "t" });
    fake.pending[0]!.reject(
      Object.assign(
        new Error("535 5.7.8 Username and Password not accepted: secret-looking text"),
        { code: "EAUTH", responseCode: 535 },
      ),
    );
    await expect(send).rejects.toMatchObject({
      name: "MailError",
      code: "MAIL_SEND_FAILED",
      providerCode: "EAUTH",
      message: "MAIL_SEND_FAILED",
    });
    expect(transport.inFlightCount).toBe(0);
    // Readiness is re-checked (and succeeds here) rather than assumed.
    let verifies = 0;
    fake.setVerify(async () => {
      verifies += 1;
      return true;
    });
    vi.advanceTimersByTime(60_000);
    expect(await transport.isReady()).toBe(true);
    expect(verifies).toBe(1);
  });

  it("readiness: a failed handshake logs an event code, is retried only after the backoff, and a later success sticks", async () => {
    const fake = fakeMailer();
    let verifies = 0;
    fake.setVerify(async () => {
      verifies += 1;
      throw Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:465"), { code: "ECONNECTION" });
    });
    const transport = new SmtpMailTransport({
      mailer: fake.mailer,
      from: "a@example.test",
      verifyBackoffMs: 1000,
    });

    expect(await transport.isReady()).toBe(false);
    expect(verifies).toBe(1);
    const line = String(
      warn.mock.calls.find((c) => String(c[0]).includes("MAIL_TRANSPORT_UNAVAILABLE"))?.[0],
    );
    expect(line).toContain("code=ECONNECTION");
    expect(line).not.toContain("127.0.0.1");

    expect(await transport.isReady()).toBe(false); // within backoff: no new attempt
    expect(verifies).toBe(1);

    vi.advanceTimersByTime(1000);
    fake.setVerify(async () => {
      verifies += 1;
      return true;
    });
    expect(await transport.isReady()).toBe(true);
    expect(verifies).toBe(2);
    expect(await transport.isReady()).toBe(true);
    expect(verifies).toBe(2); // ready sticks without further handshakes
  });

  it("the production factory configures bounded SMTP timeouts (well below nodemailer's defaults)", () => {
    expect(SMTP_TIMEOUTS).toEqual({
      dnsTimeout: 10_000,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  });

  it("nodemailer accepts the message shape this transport produces (JSON transport, no network)", async () => {
    vi.useRealTimers();
    const transporter = nodemailer.createTransport({ jsonTransport: true });
    let rendered: unknown;
    const mailer: Mailer = {
      verify: () => transporter.verify(),
      sendMail: async (message) => {
        const info = await transporter.sendMail(message);
        rendered = JSON.parse(String(info.message));
        return info;
      },
    };
    const transport = new SmtpMailTransport({ mailer, from: "Landmarks <no-reply@example.test>" });
    const message = composeResetEmail(
      "hiker@example.com",
      buildResetLink("https://landmarks.example.test", "tok3n"),
    );
    await transport.send(message);
    expect(rendered).toMatchObject({
      from: { address: "no-reply@example.test", name: "Landmarks" },
      to: [{ address: "hiker@example.com", name: "" }],
      subject: message.subject,
      text: expect.stringContaining("https://landmarks.example.test/reset-password?token=tok3n"),
    });
    expect(rendered).not.toHaveProperty("html");
  });
});

describe("reset email composition (unit)", () => {
  it("builds the canonical link from the public ORIGIN only and never from the library's callback route", () => {
    expect(buildResetLink("https://landmarks.example.test/api/auth", "abc")).toBe(
      "https://landmarks.example.test/reset-password?token=abc",
    );
    expect(buildResetLink("http://localhost:3000", "a+b/c")).toBe(
      "http://localhost:3000/reset-password?token=a%2Bb%2Fc",
    );
    const email = composeResetEmail(
      "hiker@example.com",
      "http://localhost:3000/reset-password?token=abc",
    );
    expect(email.text).toContain("http://localhost:3000/reset-password?token=abc");
    expect(email.text).not.toContain("/api/auth/");
    expect(email.text).toContain("30 minutes");
    expect(email.text).toContain("works once");
  });
});

describe("transport selection and error summaries (unit)", () => {
  it("disabled transport: never ready, refuses sends", async () => {
    const transport = new DisabledMailTransport();
    expect(await transport.isReady()).toBe(false);
    await expect(
      transport.send({ to: "x@example.com", subject: "s", text: "t" }),
    ).rejects.toMatchObject({ code: "MAIL_TRANSPORT_DISABLED" });
    expect(createMailTransport({ transport: "disabled" }).kind).toBe("disabled");
  });

  it("smtp selection requires both the connection URL and the sender", () => {
    expect(() => createMailTransport({ transport: "smtp", smtpUrl: "smtps://u:p@h:465" })).toThrow(
      /SMTP_URL and MAIL_FROM/,
    );
    expect(() => createMailTransport({ transport: "smtp", from: "a@example.test" })).toThrow(
      /SMTP_URL and MAIL_FROM/,
    );
    expect(
      createMailTransport({
        transport: "smtp",
        smtpUrl: "smtps://u:p@h:465",
        from: "a@example.test",
      }).kind,
    ).toBe("smtp");
  });

  it("providerErrorCode keeps a code or class name only", () => {
    expect(providerErrorCode({ code: "EAUTH", message: "535 secret" })).toBe("EAUTH");
    expect(providerErrorCode({ responseCode: 550, message: "mailbox x@y unavailable" })).toBe(
      "550",
    );
    expect(providerErrorCode(new TypeError("boom"))).toBe("TypeError");
    expect(providerErrorCode("string")).toBe("unknown");
    expect(providerErrorCode({ code: "x".repeat(100) })).toHaveLength(32);
  });
});
