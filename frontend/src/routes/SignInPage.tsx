import { useRef, useState, type FormEvent } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router";
import { ApiError } from "../api/client";
import {
  AuthRefusal,
  refusalMessage,
  RESTRICTION_MESSAGES,
  useAccountSecurity,
} from "../auth/accountSecurity";
import { safeReturnPath, HOME_PATH } from "../auth/returnPath";
import { useAuth } from "../auth/session";
import { signInSchema, validate, type FieldErrors } from "../auth/validation";
import type { SignInLocationState } from "./RegisterPage";
import { OnlineOnlyReason } from "../connectivity/OnlineOnlyReason";
import { useOnlineOnlyAction } from "../connectivity/useOnlineOnlyAction";
import { useUnsavedInput } from "../pwa/useUnsavedInput";
import styles from "./AuthForm.module.css";

/** Router state this page understands: registration's notice, plus the password-reset one (Increment 5). */
export interface SignInNoticeState extends SignInLocationState {
  passwordReset?: boolean;
}

type Field = "email" | "password";
const FIELD_ORDER: Field[] = ["email", "password"];

export const SIGN_IN_MESSAGES = {
  registered: "Registration received. Sign in with your email address and password.",
  passwordReset: "Your password has been reset. Sign in with your new password.",
  credentials: "The email address or password is incorrect.",
  network: "Couldn't reach the server. Check your connection and try again.",
  generic: "Sign-in couldn't be completed. Please try again.",
  rateLimited: (seconds?: number) =>
    seconds !== undefined && seconds > 0
      ? `Too many sign-in attempts. Please wait ${formatWait(seconds)} and try again.`
      : "Too many sign-in attempts. Please wait a minute and try again.",
} as const;

function formatWait(seconds: number): string {
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.ceil(seconds / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}

/**
 * One message per failure, never the server's wording. A wrong password and
 * an unknown address both arrive as the same 401 (M03-T02), and both get the
 * same generic credential message (spec §4.2) — as does any other 4xx the
 * sign-in endpoint might return, so no response can single out an address.
 */
function describeFailure(error: unknown): { message: string; credentials: boolean } {
  if (error instanceof AuthRefusal)
    return { message: refusalMessage(error.reason), credentials: false };
  if (error instanceof ApiError) {
    if (error.code === "NETWORK_ERROR")
      return { message: SIGN_IN_MESSAGES.network, credentials: false };
    if (error.status === 429) {
      return { message: SIGN_IN_MESSAGES.rateLimited(error.retryAfterSeconds), credentials: false };
    }
    if (error.status === 400 || error.status === 401) {
      return { message: SIGN_IN_MESSAGES.credentials, credentials: true };
    }
  }
  return { message: SIGN_IN_MESSAGES.generic, credentials: false };
}

/**
 * Sign-in (spec §4.2; M03-T03 Increment 4). Email and password, checked for
 * presence only (the policy is not restated to someone guessing a password),
 * then sent through the existing auth API wrapper. On success the session
 * provider is refreshed — the server's answer, not the sign-in response, is
 * what marks the user signed in — and the user is sent to the safe `returnTo`
 * destination, or `/`.
 *
 * Shows the neutral registration notice when arriving from registration
 * (`{ registered: true }` router state). A signed-in visitor is sent on to the
 * safe destination; `loading`, `anonymous`, and `unavailable` all show the
 * form, so a failed session check never blocks signing in (refinement 3).
 *
 * Accessibility follows the registration form: labels, errors tied to fields,
 * focus to the first invalid field, a `role="alert"` for form-level failures,
 * and a pending state that keeps the button focusable but ignores repeats. On
 * a credential failure the password is cleared and focused for a retry.
 *
 * M06-T03 3c-1a: the submission goes through the provider's coordinated
 * sign-in, which publishes signed-in state only after the offline security
 * checks. While a restriction blocks sign-in (no usable Web Locks, D22 present
 * or unreadable, unreadable sign-out status), the submission is refused
 * locally with the reason and nothing is sent. With a pending sign-out intent
 * the action becomes the explicit "Sign in again" (OFF-OUT-6).
 */
export function SignInPage() {
  const { session } = useAuth();
  const account = useAccountSecurity();
  const signInAgain = account.restriction === "sign-out-pending";
  const blocked = account.restriction !== null && !signInAgain;
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const destination = safeReturnPath(searchParams.get("returnTo"));
  const registerPath =
    destination === HOME_PATH
      ? "/register"
      : `/register?returnTo=${encodeURIComponent(destination)}`;
  const noticeState = location.state as SignInNoticeState | null;
  const notice =
    noticeState?.passwordReset === true
      ? SIGN_IN_MESSAGES.passwordReset
      : noticeState?.registered === true
        ? SIGN_IN_MESSAGES.registered
        : null;

  const [values, setValues] = useState<Record<Field, string>>({ email: "", password: "" });
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
    "sign-in",
    values.email !== "" || values.password !== "",
  );

  // While a sign-in is completing, this page navigates itself; otherwise an
  // already signed-in visitor is sent straight on.
  if (session.status === "authenticated" && !pending) {
    return <Navigate to={destination} replace />;
  }

  function focusFirstInvalid(errors: FieldErrors) {
    const first = FIELD_ORDER.find((field) => field in errors);
    if (first) inputs.current[first]?.focus();
  }

  function handleChange(field: Field, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    const next = { ...values, [field]: value };
    markFieldsEdited(next.email !== "" || next.password !== "");
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
    if (submitting.current || online.unavailable || blocked) return;

    setFormError(null);
    const result = validate(signInSchema, values);
    if (!result.ok) {
      setFieldErrors(result.errors);
      focusFirstInvalid(result.errors);
      return;
    }
    setFieldErrors({});

    submitting.current = true;
    setPending(true);
    try {
      await account.signIn(result.data.email, result.data.password, { again: signInAgain });
    } catch (error) {
      const failure = describeFailure(error);
      setFormError(failure.message);
      if (failure.credentials) {
        setValues((current) => ({ ...current, password: "" }));
        inputs.current.password?.focus();
      }
      submitting.current = false;
      setPending(false);
      return;
    }

    // Signed in: the provider already confirmed the session with the server
    // and applied the security checks before publishing it.
    navigate(destination, { replace: true });
  }

  function describedBy(...ids: (string | false)[]): string | undefined {
    const list = ids.filter(Boolean).join(" ");
    return list === "" ? undefined : list;
  }

  return (
    <section aria-labelledby="sign-in-heading" className={styles.page}>
      <h2 id="sign-in-heading">Sign in</h2>

      {notice ? (
        <div role="status" className={styles.notice}>
          <p>{notice}</p>
        </div>
      ) : null}

      {account.restriction !== null ? (
        <div role="status" id="sign-in-restriction" className={styles.notice}>
          <p>{RESTRICTION_MESSAGES[account.restriction]}</p>
          {signInAgain ? (
            <p>Sign in again first finishes signing out the earlier session, then signs you in.</p>
          ) : null}
        </div>
      ) : null}

      {formError ? (
        <div role="alert" className={styles.formError}>
          <p>{formError}</p>
        </div>
      ) : null}

      <form noValidate onSubmit={(event) => void handleSubmit(event)} aria-busy={pending}>
        <div className={styles.field}>
          <label htmlFor="sign-in-email">Email address</label>
          <input
            ref={(el) => {
              inputs.current.email = el;
            }}
            id="sign-in-email"
            name="email"
            type="email"
            autoComplete="email"
            spellCheck={false}
            value={values.email}
            onChange={(event) => handleChange("email", event.target.value)}
            aria-invalid={"email" in fieldErrors}
            aria-describedby={describedBy("email" in fieldErrors && "sign-in-email-error")}
          />
          {fieldErrors.email ? (
            <p id="sign-in-email-error" className={styles.fieldError}>
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className={styles.field}>
          <label htmlFor="sign-in-password">Password</label>
          <input
            ref={(el) => {
              inputs.current.password = el;
            }}
            id="sign-in-password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={values.password}
            onChange={(event) => handleChange("password", event.target.value)}
            aria-invalid={"password" in fieldErrors}
            aria-describedby={describedBy("password" in fieldErrors && "sign-in-password-error")}
          />
          {fieldErrors.password ? (
            <p id="sign-in-password-error" className={styles.fieldError}>
              {fieldErrors.password}
            </p>
          ) : null}
        </div>

        <button
          type="submit"
          className={styles.submit}
          aria-disabled={pending || online.unavailable || blocked}
          aria-describedby={blocked ? "sign-in-restriction" : online.describedBy}
          data-pending={pending ? "true" : undefined}
        >
          {pending ? "Signing in…" : signInAgain ? "Sign in again" : "Sign in"}
        </button>
        <OnlineOnlyReason action={online} className={styles.hint} />
      </form>

      <p className={styles.alternative}>
        New here? <Link to={registerPath}>Create an account</Link>
      </p>
      <p>
        <Link to="/forgot-password">Forgot password?</Link>
      </p>
    </section>
  );
}
