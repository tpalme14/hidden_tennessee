import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { requestPasswordReset } from "../api/auth";
import { ApiError } from "../api/client";
import {
  MESSAGES,
  passwordResetRequestSchema,
  validate,
  type FieldErrors,
} from "../auth/validation";
import styles from "./AuthForm.module.css";

export const FORGOT_PASSWORD_MESSAGES = {
  sent: "If an account exists for that email address, a link to reset its password is on its way. The link works once and expires after 30 minutes.",
  // The approved wording (M03-T02 Increment 6): it never claims an email was sent.
  unavailable: "Password reset is temporarily unavailable. Please try again later.",
  network: "Couldn't reach the server. Check your connection and try again.",
  generic: "The reset request couldn't be completed. Please try again.",
  rateLimited: (seconds?: number) =>
    seconds !== undefined && seconds > 0
      ? `Too many reset requests. Please wait ${formatWait(seconds)} and try again.`
      : "Too many reset requests. Please wait a few minutes and try again.",
} as const;

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * The backend answers every address the same way — the same neutral 200, or
 * the same 503 when mail delivery is unavailable — so none of these outcomes
 * can reveal whether an account exists. Server wording is never shown.
 */
function describeFailure(error: unknown): { field?: string; form?: string } {
  if (!(error instanceof ApiError)) return { form: FORGOT_PASSWORD_MESSAGES.generic };
  if (error.code === "RESET_UNAVAILABLE") return { form: FORGOT_PASSWORD_MESSAGES.unavailable };
  if (error.code === "NETWORK_ERROR") return { form: FORGOT_PASSWORD_MESSAGES.network };
  if (error.code === "VALIDATION_ERROR" || error.code === "INVALID_EMAIL") {
    return { field: MESSAGES.emailInvalid };
  }
  if (error.status === 429) {
    return { form: FORGOT_PASSWORD_MESSAGES.rateLimited(error.retryAfterSeconds) };
  }
  return { form: FORGOT_PASSWORD_MESSAGES.generic };
}

/**
 * Password-reset request (spec §4.3; M03-T03 Increment 5). One email field;
 * on success the form is replaced by a neutral confirmation, which takes
 * focus so it is announced. The reset link itself is built by the backend
 * from its configured origin — this page sends only the address.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const submitting = useRef(false);
  const emailInput = useRef<HTMLInputElement>(null);
  const confirmation = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (sent) confirmation.current?.focus();
  }, [sent]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;

    setFormError(null);
    const result = validate(passwordResetRequestSchema, { email });
    if (!result.ok) {
      setFieldErrors(result.errors);
      emailInput.current?.focus();
      return;
    }
    setFieldErrors({});

    submitting.current = true;
    setPending(true);
    try {
      await requestPasswordReset(result.data.email);
      setSent(true);
    } catch (error) {
      const failure = describeFailure(error);
      if (failure.field) {
        setFieldErrors({ email: failure.field });
        emailInput.current?.focus();
      }
      if (failure.form) setFormError(failure.form);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  return (
    <section aria-labelledby="forgot-password-heading" className={styles.page}>
      <h2 id="forgot-password-heading">Reset your password</h2>

      {sent ? (
        <div ref={confirmation} role="status" tabIndex={-1} className={styles.notice}>
          <p>{FORGOT_PASSWORD_MESSAGES.sent}</p>
        </div>
      ) : (
        <>
          <p>
            Enter the email address for your account and we&apos;ll send a link to reset its
            password.
          </p>

          {formError ? (
            <div role="alert" className={styles.formError}>
              <p>{formError}</p>
            </div>
          ) : null}

          <form noValidate onSubmit={(event) => void handleSubmit(event)} aria-busy={pending}>
            <div className={styles.field}>
              <label htmlFor="forgot-password-email">Email address</label>
              <input
                ref={emailInput}
                id="forgot-password-email"
                name="email"
                type="email"
                autoComplete="email"
                spellCheck={false}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (fieldErrors.email) setFieldErrors({});
                }}
                aria-invalid={"email" in fieldErrors}
                aria-describedby={fieldErrors.email ? "forgot-password-email-error" : undefined}
              />
              {fieldErrors.email ? (
                <p id="forgot-password-email-error" className={styles.fieldError}>
                  {fieldErrors.email}
                </p>
              ) : null}
            </div>

            <button type="submit" className={styles.submit} aria-disabled={pending}>
              {pending ? "Sending link…" : "Send reset link"}
            </button>
          </form>
        </>
      )}

      <p className={styles.alternative}>
        <Link to="/sign-in">Back to sign in</Link>
      </p>
    </section>
  );
}
