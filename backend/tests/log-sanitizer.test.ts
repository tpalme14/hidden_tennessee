import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_LOG_ENTRY_LENGTH,
  MAX_MESSAGE_LENGTH,
  describeLogArgument,
  formatLogEntry,
  safeAuthLog,
  sanitizeText,
} from "../src/auth/log-sanitizer.js";

/** M03-T02 Increment 4 — the Better Auth logger callback's sanitiser (unit). */

const ENTRY_PREFIX =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z (DEBUG|INFO|WARN|ERROR) \[Better Auth\]: /;

describe("log sanitizer (unit)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("replaces control characters (newline, carriage return, escape, DEL, C1) and keeps printable text", () => {
    const out = sanitizeText("Invalid origin: https://x\r\nFORGED\u001b[31m\u007f\u0085end");
    // eslint-disable-next-line no-control-regex -- asserting these bytes are absent
    expect(out).not.toMatch(/[\u0000-\u001f\u007f-\u009f]/);
    expect(out).toBe("Invalid origin: https://x��FORGED�[31m��end");
  });

  it("truncates over-long text with a visible marker", () => {
    const out = sanitizeText("a".repeat(1000), 100);
    expect(out.startsWith("a".repeat(100))).toBe(true);
    expect(out).toContain("[+900 chars]");
    expect(out.length).toBeLessThan(130);
  });

  it("renders an Error as name, sanitized message, and code — never its stack or other properties", () => {
    const err = Object.assign(new Error("boom\nline2 " + "x".repeat(600)), {
      code: "E_TEST",
      secret: "hunter2",
      stack: "Error: boom\n    at secretFunction (/srv/app/auth.ts:1:1)",
    });
    const out = describeLogArgument(err);
    expect(out.startsWith("Error: boom�line2 ")).toBe(true);
    expect(out).toContain("(code E_TEST)");
    expect(out).not.toContain("hunter2");
    expect(out).not.toContain("secretFunction");
    expect(out).not.toContain("/srv/app");
    expect(out.length).toBeLessThan(MAX_MESSAGE_LENGTH);
  });

  it("renders a database-layer error as name and code only (its message may echo query arguments)", () => {
    class PrismaClientKnownRequestError extends Error {
      code = "P2002";
      meta = { target: ["email"] };
    }
    const err = new PrismaClientKnownRequestError(
      'Invalid `prisma.user.create()` invocation: { data: { email: "victim@example.com" } }',
    );
    err.name = "PrismaClientKnownRequestError";
    expect(describeLogArgument(err)).toBe("PrismaClientKnownRequestError (code P2002)");

    const pgError = Object.assign(
      new Error('duplicate key value violates unique constraint "users_email_key"'),
      {
        code: "23505",
        detail: "Key (email)=(victim@example.com) already exists.",
      },
    );
    pgError.name = "error"; // node-postgres uses the bare name "error"
    const out = describeLogArgument(pgError);
    expect(out).toBe("error (code 23505)");
    expect(out).not.toContain("victim");
  });

  it("keeps only known diagnostic keys of a plain object and omits every other value", () => {
    const out = describeLogArgument({
      provider: "google",
      code: "state_mismatch",
      details: { state: "attacker\ncontrolled", cookie: "better-auth.session_token=abc.def" },
      password: "hunter2",
    });
    expect(out).toBe(
      "{ provider=google, code=state_mismatch, details=[omitted], password=[omitted] }",
    );
  });

  it("bounds the COMPLETE formatted entry, not just its parts, and keeps the prefix intact", () => {
    const entry = formatLogEntry("error", "m".repeat(5000), [
      "a".repeat(5000),
      new Error("e".repeat(5000)),
      { issues: "i".repeat(5000) },
    ]);
    expect(entry.length).toBeLessThanOrEqual(MAX_LOG_ENTRY_LENGTH);
    expect(entry).toMatch(ENTRY_PREFIX);
    expect(entry.endsWith("…")).toBe(true);
    expect(entry).not.toMatch(/[\r\n]/);
  });

  it("preserves severity: errors go to console.error, warnings to console.warn, the rest to console.log", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    safeAuthLog("error", "Failed to create user", new Error("db down"));
    safeAuthLog("warn", "Invalid password");
    safeAuthLog("info", "informational");
    safeAuthLog("debug", "debugging");

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0]![0]).toMatch(
      / ERROR \[Better Auth\]: Failed to create user Error: db down$/,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/ WARN \[Better Auth\]: Invalid password$/);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      expect.stringMatching(/ INFO \[Better Auth\]: informational$/),
      expect.stringMatching(/ DEBUG \[Better Auth\]: debugging$/),
    ]);
  });
});
