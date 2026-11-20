import { describe, expect, it } from "vitest";
import {
  TEST_PASSWORD,
  TestUserSetupError,
  sessionCookieFrom,
  uniqueTestEmail,
} from "./helpers/test-users.js";

/** M03-T04 Increment 3 — the pure parts of the two-user helpers (no app, database, or configuration). */

describe("sessionCookieFrom", () => {
  it("takes name=value of the plain session cookie and drops its attributes", () => {
    expect(
      sessionCookieFrom([
        "better-auth.session_token=abc.def%3D; Max-Age=2592000; Path=/; HttpOnly; SameSite=Lax",
      ]),
    ).toBe("better-auth.session_token=abc.def%3D");
  });

  it("accepts the __Secure- name used under https", () => {
    expect(
      sessionCookieFrom(["__Secure-better-auth.session_token=xyz; Path=/; HttpOnly; Secure"]),
    ).toBe("__Secure-better-auth.session_token=xyz");
  });

  it("ignores other cookies, including look-alike names", () => {
    expect(
      sessionCookieFrom([
        "probe_marker=1; Path=/",
        "better-auth.session_token_extra=nope",
        "better-auth.session_data=nope",
        "better-auth.session_token=yes; Path=/",
      ]),
    ).toBe("better-auth.session_token=yes");
  });

  it.each([[undefined], [[]], [["other=1"]]])(
    "returns null when no session cookie is set (%j)",
    (headers) => {
      expect(sessionCookieFrom(headers)).toBeNull();
    },
  );

  it("refuses an ambiguous response with two session cookies", () => {
    expect(() =>
      sessionCookieFrom(["better-auth.session_token=a", "__Secure-better-auth.session_token=b"]),
    ).toThrow("more than one session cookie");
  });
});

describe("uniqueTestEmail", () => {
  it("keeps a readable, lower-case label", () => {
    expect(uniqueTestEmail("User-A")).toMatch(/^user-a-\d+-[0-9a-f]{8}@example\.com$/);
  });

  it("replaces characters that do not belong in an address label", () => {
    expect(uniqueTestEmail("owner #1 / b")).toMatch(/^owner--1---b-\d+-[0-9a-f]{8}@example\.com$/);
  });

  it("never repeats", () => {
    const emails = Array.from({ length: 100 }, () => uniqueTestEmail("user"));
    expect(new Set(emails).size).toBe(100);
  });
});

describe("TestUserSetupError", () => {
  it("names only the step, the label, and the HTTP status", () => {
    const error = new TestUserSetupError("sign-in", "user-b", 401);
    expect(error.message).toBe("sign-in for user-b failed with HTTP 401");
    expect(error.name).toBe("TestUserSetupError");
    expect(error.cause).toBeUndefined();
  });

  it("reports a transport failure without detail", () => {
    expect(new TestUserSetupError("registration", "user-a", "no response").message).toBe(
      "registration for user-a failed with no response",
    );
  });

  it("never carries the test password", () => {
    const messages = (["registration", "sign-in", "session check", "sign-out"] as const).map(
      (step) => new TestUserSetupError(step, "user", 500).message,
    );
    for (const message of messages) expect(message).not.toContain(TEST_PASSWORD);
  });
});
