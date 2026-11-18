import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { resetPassword } from "../api/auth";
import { ApiError } from "../api/client";
import { clearResetToken, getResetToken } from "../auth/resetToken";
import { useAuth } from "../auth/session";
import {
  MESSAGES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  passwordResetSchema,
  validate,
  type FieldErrors,
} from "../auth/validation";
import type { SignInNoticeState } from "./SignInPage";
import styles from "./AuthForm.module.css";

type Field = "newPassword" | "confirmPassword";
const FIELD_ORDER: Field[] = ["newPassword", "confirmPassword"];

export const RESET_PASSWORD_MESSAGES = {
  missing: "This password reset link is incomplete. Request a new link to reset your password.",
  invalid:
    "This password reset link is invalid or has expired. Each link works once and expires after 30 minutes. Request a new link to try again.",
  network: "Couldn't reach the server. Check your connection and try again.",
  generic: "Your password couldn't be reset. Please try again.",
  rateLimited: (seconds?: number) =>
    seconds !== undefined && seconds > 0
      ? `Too many attempts. Please wait ${formatWait(seconds)} and try again.`
      : "Too many attempts. Please wait a few minutes and try again.",
} as const;

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

type Status = "form" | "missing" | "invalid";

/**
 * Password-reset completion (spec §4.3; M03-T03 Increment 5). The token was
 * captured from the URL and stripped by `main.tsx` before React started; this
 * page reads it from memory (`getResetToken`), never from the URL, and sends
 * it only in the body of the reset POST. It is never rendered, logged, or put
 * in router state.
 *
 * States: the form (a token is present); `missing` (no token); `invalid`
 * (the server rejected the token, or the library's own redirect arrived with
 * `?error=INVALID_TOKEN`). A rejected token is forgotten at once. On success
 * the token is forgotten, the session is re-checked (a reset revokes every
 * session, including this browser's), and the user goes to sign-in with a
 * notice.
 */
export function ResetPasswordPage() {
  const { refresh } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [token] = useState(() => getResetToken());
  const [status, setStatus] = useState<Status>(() =>
    searchParams.get("error") === "INVALID_TOKEN" ? "invalid" : token ? "form" : "missing",
  );
  const [values, setValues] = useState<Record<Field, string>>({
    newPassword: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  const invalidMessage = useRef<HTMLDivElement>(null);
  const movedToInvalid = useRef(false);

  useEffect(() => {
    // Announce a link rejected after submitting by moving focus to the explanation.
    if (status === "invalid" && movedToInvalid.current) invalidMessage.current?.focus();
  }, [status]);

  function focusFirstInvalid(errors: FieldErrors) {
    const first = FIELD_ORDER.find((field) => field in errors);
    if (first) inputs.current[first]?.focus();
  }

  function handleChange(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    if (field in fieldErrors) {
      setFieldErrors((current) => {
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || token === null) return;

    setFormError(null);
    const result = validate(passwordResetSchema, values);
    if (!result.ok) {
      setFieldErrors(result.errors);
      focusFirstInvalid(result.errors);
      return;
    }
    setFieldErrors({});

    submitting.current = true;
    setPending(true);
    try {
      await resetPassword(token, result.data.newPassword);
    } catch (error) {
      submitting.current = false;
      setPending(false);
      if (error instanceof ApiError) {
        if (error.code === "INVALID_TOKEN") {
          clearResetToken();
          movedToInvalid.current = true;
          setStatus("invalid");
          return;
        }
        if (error.code === "PASSWORD_TOO_SHORT" || error.code === "PASSWORD_TOO_LONG") {
          const message =
            error.code === "PASSWORD_TOO_SHORT"
              ? MESSAGES.passwordTooShort
              : MESSAGES.passwordTooLong;
          setFieldErrors({ newPassword: message });
          inputs.current.newPassword?.focus();
          return;
        }
        if (error.code === "NETWORK_ERROR") {
          setFormError(RESET_PASSWORD_MESSAGES.network);
          return;
        }
        if (error.status === 429) {
          setFormError(RESET_PASSWORD_MESSAGES.rateLimited(error.retryAfterSeconds));
          return;
        }
      }
      setFormError(RESET_PASSWORD_MESSAGES.generic);
      return;
    }

    clearResetToken();
    await refresh();
    const state: SignInNoticeState = { passwordReset: true };
    navigate("/sign-in", { replace: true, state });
  }

  function describedBy(...ids: (string | false)[]): string | undefined {
    const list = ids.filter(Boolean).join(" ");
    return list === "" ? undefined : list;
  }

  return (
    <section aria-labelledby="reset-password-heading" className={styles.page}>
      <h2 id="reset-password-heading">Choose a new password</h2>

      {status === "form" ? (
        <>
          {formError ? (
            <div role="alert" className={styles.formError}>
              <p>{formError}</p>
            </div>
          ) : null}

          <form noValidate onSubmit={(event) => void handleSubmit(event)} aria-busy={pending}>
            <div className={styles.field}>
              <label htmlFor="reset-new-password">New password</label>
              <p id="reset-new-password-hint" className={styles.hint}>
                Use {PASSWORD_MIN_LENGTH} to {PASSWORD_MAX_LENGTH} characters.
              </p>
              <input
                ref={(el) => {
                  inputs.current.newPassword = el;
                }}
                id="reset-new-password"
                name="newPassword"
                type="password"
                autoComplete="new-password"
                value={values.newPassword}
                onChange={(event) => handleChange("newPassword", event.target.value)}
                aria-invalid={"newPassword" in fieldErrors}
                aria-describedby={describedBy(
                  "reset-new-password-hint",
                  "newPassword" in fieldErrors && "reset-new-password-error",
                )}
              />
              {fieldErrors.newPassword ? (
                <p id="reset-new-password-error" className={styles.fieldError}>
                  {fieldErrors.newPassword}
                </p>
              ) : null}
            </div>

            <div className={styles.field}>
              <label htmlFor="reset-confirm-password">Confirm new password</label>
              <input
                ref={(el) => {
                  inputs.current.confirmPassword = el;
                }}
                id="reset-confirm-password"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                value={values.confirmPassword}
                onChange={(event) => handleChange("confirmPassword", event.target.value)}
                aria-invalid={"confirmPassword" in fieldErrors}
                aria-describedby={describedBy(
                  "confirmPassword" in fieldErrors && "reset-confirm-password-error",
                )}
              />
              {fieldErrors.confirmPassword ? (
                <p id="reset-confirm-password-error" className={styles.fieldError}>
                  {fieldErrors.confirmPassword}
                </p>
              ) : null}
            </div>

            <button type="submit" className={styles.submit} aria-disabled={pending}>
              {pending ? "Resetting password…" : "Reset password"}
            </button>
          </form>
        </>
      ) : (
        <div
          ref={invalidMessage}
          role={status === "invalid" ? "alert" : undefined}
          tabIndex={-1}
          className={styles.formError}
        >
          <p>
            {status === "invalid"
              ? RESET_PASSWORD_MESSAGES.invalid
              : RESET_PASSWORD_MESSAGES.missing}
          </p>
        </div>
      )}

      <p className={styles.alternative}>
        {status === "form" ? (
          <Link to="/sign-in">Back to sign in</Link>
        ) : (
          <Link to="/forgot-password">Request a new reset link</Link>
        )}
      </p>
    </section>
  );
}
