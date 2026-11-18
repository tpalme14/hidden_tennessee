import { describe, expect, it } from "vitest";
import {
  MESSAGES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordResetRequestSchema,
  passwordResetSchema,
  registrationSchema,
  signInSchema,
  validate,
} from "./validation";

/** M03-T03 Increment 1 — client validation mirrors the server's 8–128 policy and email shape. */

describe("validation schemas", () => {
  it("states the same password policy as the server (8–128, no character classes)", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(8);
    expect(PASSWORD_MAX_LENGTH).toBe(128);
  });

  describe("registration", () => {
    it("accepts a valid email, a policy-conforming password, and a matching confirmation", () => {
      const result = validate(registrationSchema, {
        email: "  Hiker@Example.com ",
        password: "12345678",
        confirmPassword: "12345678",
      });
      expect(result).toEqual({
        ok: true,
        data: { email: "Hiker@Example.com", password: "12345678", confirmPassword: "12345678" },
      });
    });

    it("accepts the longest allowed password and any characters, including spaces", () => {
      const password = "p w ".repeat(32); // 128 characters
      expect(password).toHaveLength(128);
      expect(
        validate(registrationSchema, { email: "a@b.co", password, confirmPassword: password }).ok,
      ).toBe(true);
    });

    it("reports one message per field for each policy failure", () => {
      expect(
        validate(registrationSchema, { email: "", password: "1234567", confirmPassword: "" }),
      ).toEqual({
        ok: false,
        errors: {
          email: MESSAGES.emailRequired,
          password: MESSAGES.passwordTooShort,
          confirmPassword: MESSAGES.passwordMismatch,
        },
      });

      expect(
        validate(registrationSchema, {
          email: "not-an-email",
          password: "x".repeat(129),
          confirmPassword: "x".repeat(129),
        }),
      ).toEqual({
        ok: false,
        errors: { email: MESSAGES.emailInvalid, password: MESSAGES.passwordTooLong },
      });
    });

    it("flags a mismatched confirmation on the confirmation field", () => {
      expect(
        validate(registrationSchema, {
          email: "a@b.co",
          password: "12345678",
          confirmPassword: "12345679",
        }),
      ).toEqual({ ok: false, errors: { confirmPassword: MESSAGES.passwordMismatch } });
    });

    it("does not trim passwords (a leading or trailing space is part of the password)", () => {
      const result = validate(registrationSchema, {
        email: "a@b.co",
        password: " 1234567",
        confirmPassword: " 1234567",
      });
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.data.password).toBe(" 1234567");
    });
  });

  describe("sign-in", () => {
    it("requires presence only and never restates the password policy", () => {
      expect(validate(signInSchema, { email: "a@b.co", password: "x" }).ok).toBe(true);
      expect(validate(signInSchema, { email: "a@b.co", password: "" })).toEqual({
        ok: false,
        errors: { password: MESSAGES.passwordRequired },
      });
      expect(validate(signInSchema, { email: "nope", password: "x" })).toEqual({
        ok: false,
        errors: { email: MESSAGES.emailInvalid },
      });
    });
  });

  describe("password reset", () => {
    it("request: email only", () => {
      expect(validate(passwordResetRequestSchema, { email: "a@b.co" }).ok).toBe(true);
      expect(validate(passwordResetRequestSchema, { email: " " })).toEqual({
        ok: false,
        errors: { email: MESSAGES.emailRequired },
      });
    });

    it("completion: the new password follows the policy and must be confirmed", () => {
      expect(
        validate(passwordResetSchema, { newPassword: "12345678", confirmPassword: "12345678" }).ok,
      ).toBe(true);
      expect(
        validate(passwordResetSchema, { newPassword: "1234567", confirmPassword: "1234567" }),
      ).toEqual({ ok: false, errors: { newPassword: MESSAGES.passwordTooShort } });
      expect(
        validate(passwordResetSchema, { newPassword: "12345678", confirmPassword: "different1" }),
      ).toEqual({ ok: false, errors: { confirmPassword: MESSAGES.passwordMismatch } });
    });
  });

  it("validate() tolerates non-object input without throwing", () => {
    expect(validate(signInSchema, undefined).ok).toBe(false);
    expect(validate(signInSchema, "string").ok).toBe(false);
  });
});
