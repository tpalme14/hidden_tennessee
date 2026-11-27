import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { register } from "../api/auth";
import { ApiError } from "../api/client";
import { safeReturnPath, HOME_PATH } from "../auth/returnPath";
import { useAuth } from "../auth/session";
import {
  MESSAGES,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  registrationSchema,
  validate,
  type FieldErrors,
} from "../auth/validation";
import { OnlineOnlyReason } from "../connectivity/OnlineOnlyReason";
import { useOnlineOnlyAction } from "../connectivity/useOnlineOnlyAction";
import { useUnsavedInput } from "../pwa/useUnsavedInput";
import styles from "./AuthForm.module.css";

/** Router state the sign-in page (M03-T03 Increment 4) reads to show its confirmation notice. */
export interface SignInLocationState {
  registered?: boolean;
}

type Field = "email" | "password" | "confirmPassword";
const FIELD_ORDER: Field[] = ["email", "password", "confirmPassword"];

const FORM_MESSAGES = {
  network: "Couldn't reach the server. Check your connection and try again.",
  generic: "Registration couldn't be completed. Please try again.",
  rateLimited: (seconds?: number) =>
    seconds !== undefined && seconds > 0
      ? `Too many registration attempts. Please wait ${formatWait(seconds)} and try again.`
      : "Too many registration attempts. Please wait a few minutes and try again.",
} as const;

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * Maps a registration failure to field errors or one form-level message. The
 * server's own message text is never shown, and no outcome can reveal whether
 * an address is already registered: the backend answers a duplicate exactly
 * like a new account (M03-T02), so that case arrives here as success.
 */
function describeFailure(error: unknown): { fields?: FieldErrors; form?: string } {
  if (!(error instanceof ApiError)) return { form: FORM_MESSAGES.generic };
  switch (error.code) {
    case "PASSWORD_TOO_SHORT":
      return { fields: { password: MESSAGES.passwordTooShort } };
    case "PASSWORD_TOO_LONG":
      return { fields: { password: MESSAGES.passwordTooLong } };
    case "VALIDATION_ERROR":
    case "INVALID_EMAIL":
      return { fields: { email: MESSAGES.emailInvalid } };
    case "NETWORK_ERROR":
      return { form: FORM_MESSAGES.network };
  }
  if (error.status === 429) return { form: FORM_MESSAGES.rateLimited(error.retryAfterSeconds) };
  return { form: FORM_MESSAGES.generic };
}

/**
 * Registration (spec §4.1; M03-T03 Increment 3). Email, password, and
 * confirmation, validated client-side with the shared Zod schema (never
 * authoritative), then sent through the existing auth API wrapper.
 * Registration never signs the user in (decision 3): success navigates to
 * the sign-in page with a neutral confirmation, forwarding a safe `returnTo`.
 *
 * Session states: a signed-in user is sent on (to the safe return path);
 * `loading`, `anonymous`, and `unavailable` all show the form, so a failed
 * session check never blocks registration (refinement 3).
 *
 * Accessibility: explicit labels, a password hint, errors tied to fields with
 * `aria-describedby`/`aria-invalid`, focus moved to the first invalid field
 * on a rejected submit, form-level failures in a `role="alert"`, and a pending
 * state that keeps the submit button focusable but ignores repeat submits.
 */
export function RegisterPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const returnTo = safeReturnPath(searchParams.get("returnTo"));
  const signInPath =
    returnTo === HOME_PATH ? "/sign-in" : `/sign-in?returnTo=${encodeURIComponent(returnTo)}`;

  const [values, setValues] = useState<Record<Field, string>>({
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({});
  // M06-T02 Increment 3b-iii: submitting needs the server (OFF-UX-5). Only the
  // submission is refused while it is unreachable; typing, links, and messages
  // are unaffected, and nothing is submitted on recovery.
  const online = useOnlineOnlyAction();
  // M06-T02 Increment 4b-ii: entered fields are protected from an update reload —
  // their presence only; no value reaches the registry.
  const markFieldsEdited = useUnsavedInput(
    "registration",
    values.email !== "" || values.password !== "" || values.confirmPassword !== "",
  );

  if (session.status === "authenticated") {
    return <Navigate to={returnTo} replace />;
  }

  function focusFirstInvalid(errors: FieldErrors) {
    const first = FIELD_ORDER.find((field) => field in errors);
    if (first) inputs.current[first]?.focus();
  }

  function handleChange(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    const next = { ...values, [field]: value };
    markFieldsEdited(next.email !== "" || next.password !== "" || next.confirmPassword !== "");
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
    // The form's own submit path (button, Enter, or requestSubmit) is guarded.
    if (submitting.current || online.unavailable) return;

    setFormError(null);
    const result = validate(registrationSchema, values);
    if (!result.ok) {
      setFieldErrors(result.errors);
      focusFirstInvalid(result.errors);
      return;
    }
    setFieldErrors({});

    submitting.current = true;
    setPending(true);
    try {
      await register(result.data.email, result.data.password);
      const state: SignInLocationState = { registered: true };
      navigate(signInPath, { state });
    } catch (error) {
      const failure = describeFailure(error);
      if (failure.fields) {
        setFieldErrors(failure.fields);
        focusFirstInvalid(failure.fields);
      }
      if (failure.form) setFormError(failure.form);
    } finally {
      submitting.current = false;
      setPending(false);
    }
  }

  function describedBy(...ids: (string | false)[]): string | undefined {
    const list = ids.filter(Boolean).join(" ");
    return list === "" ? undefined : list;
  }

  return (
    <section aria-labelledby="register-heading" className={styles.page}>
      <h2 id="register-heading">Create an account</h2>
      <p>Save favorite landmarks with an account. You only need an email address and a password.</p>

      {formError ? (
        <div role="alert" className={styles.formError}>
          <p>{formError}</p>
        </div>
      ) : null}

      <form noValidate onSubmit={(event) => void handleSubmit(event)} aria-busy={pending}>
        <div className={styles.field}>
          <label htmlFor="register-email">Email address</label>
          <input
            ref={(el) => {
              inputs.current.email = el;
            }}
            id="register-email"
            name="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            value={values.email}
            onChange={(event) => handleChange("email", event.target.value)}
            aria-invalid={"email" in fieldErrors}
            aria-describedby={describedBy("email" in fieldErrors && "register-email-error")}
          />
          {fieldErrors.email ? (
            <p id="register-email-error" className={styles.fieldError}>
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label htmlFor="register-password">Password</label>
          <p id="register-password-hint" className={styles.hint}>
            Use {PASSWORD_MIN_LENGTH} to {PASSWORD_MAX_LENGTH} characters.
          </p>
          <input
            ref={(el) => {
              inputs.current.password = el;
            }}
            id="register-password"
            name="password"
            type="password"
            autoComplete="new-password"
            value={values.password}
            onChange={(event) => handleChange("password", event.target.value)}
            aria-invalid={"password" in fieldErrors}
            aria-describedby={describedBy(
              "register-password-hint",
              "password" in fieldErrors && "register-password-error",
            )}
          />
          {fieldErrors.password ? (
            <p id="register-password-error" className={styles.fieldError}>
              {fieldErrors.password}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label htmlFor="register-confirm-password">Confirm password</label>
          <input
            ref={(el) => {
              inputs.current.confirmPassword = el;
            }}
            id="register-confirm-password"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            value={values.confirmPassword}
            onChange={(event) => handleChange("confirmPassword", event.target.value)}
            aria-invalid={"confirmPassword" in fieldErrors}
            aria-describedby={describedBy(
              "confirmPassword" in fieldErrors && "register-confirm-password-error",
            )}
          />
          {fieldErrors.confirmPassword ? (
            <p id="register-confirm-password-error" className={styles.fieldError}>
              {fieldErrors.confirmPassword}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          className={styles.submit}
          aria-disabled={pending || online.unavailable}
          aria-describedby={online.describedBy}
          data-pending={pending ? "true" : undefined}
        >
          {pending ? "Creating account…" : "Create account"}
        </button>
        <OnlineOnlyReason action={online} className={styles.hint} />
      </form>

      <p className={styles.alternative}>
        Already have an account? <Link to={signInPath}>Sign in</Link>
      </p>
    </section>
  );
}
