import { z } from "zod";

/**
 * Client-side form validation (spec §4.1, §10.2 decision 1). These schemas
 * MIRROR the server's rules — the same 8–128 character password policy with
 * no character-class requirements, and a syntactically valid email — so the
 * user gets immediate feedback. They are never authoritative: the backend
 * (Better Auth's own validation) decides, and its errors are shown too.
 */

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

export const MESSAGES = {
  emailRequired: "Enter your email address.",
  emailInvalid: "Enter a valid email address.",
  passwordRequired: "Enter your password.",
  passwordTooShort: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  passwordTooLong: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  passwordMismatch: "The passwords do not match.",
} as const;

/** Trimmed, then checked for shape. Case is left to the server, which lowercases. */
const emailField = z
  .string()
  .trim()
  .min(1, MESSAGES.emailRequired)
  .pipe(z.email(MESSAGES.emailInvalid));

/** Not trimmed: a password is whatever the user typed. */
const newPasswordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, MESSAGES.passwordTooShort)
  .max(PASSWORD_MAX_LENGTH, MESSAGES.passwordTooLong);

export const registrationSchema = z
  .object({
    email: emailField,
    password: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: MESSAGES.passwordMismatch,
    path: ["confirmPassword"],
  });

/** Sign-in checks only presence: the policy is not re-stated to someone guessing a password. */
export const signInSchema = z.object({
  email: emailField,
  password: z.string().min(1, MESSAGES.passwordRequired),
});

export const passwordResetRequestSchema = z.object({
  email: emailField,
});

export const passwordResetSchema = z
  .object({
    newPassword: newPasswordField,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: MESSAGES.passwordMismatch,
    path: ["confirmPassword"],
  });

export type RegistrationInput = z.infer<typeof registrationSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
export type PasswordResetRequestInput = z.infer<typeof passwordResetRequestSchema>;
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;

/** Field name → first message, in schema order; what a form shows next to each field. */
export type FieldErrors = Record<string, string>;

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: FieldErrors };

/** Runs a schema and flattens its issues to one message per field. */
export function validate<T>(schema: z.ZodType<T>, input: unknown): ValidationResult<T> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  const errors: FieldErrors = {};
  for (const issue of result.error.issues) {
    const field = String(issue.path[0] ?? "form");
    if (!(field in errors)) errors[field] = issue.message;
  }
  return { ok: false, errors };
}
