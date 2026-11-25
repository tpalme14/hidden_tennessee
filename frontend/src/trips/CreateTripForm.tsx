import { useId, useRef, useState, type FormEvent } from "react";
import { validateTripName } from "./tripNameRule";
import styles from "./CreateTripForm.module.css";

/**
 * The Create trip form on My Trips (M05-T06 Increment 2; spec v1.1 §§5.1,
 * 5.1.1, 5.2, 8). Deliberately separate from `NewTripForm`, which belongs to
 * the picker's create-then-add workflow (its label and accessible name name a
 * landmark); both share `validateTripName` and the `createTrip` client.
 *
 * - The client mirrors the server's name rule for immediate feedback; the
 *   server's own name message is shown when it disagrees (server
 *   authoritative).
 * - The typed value is kept on every failure (it is cleared only by
 *   remounting, which the page does for a different user).
 * - A field error is associated with the input (`aria-invalid`,
 *   `aria-describedby`); the input takes focus on a client error at once, and
 *   on a server name error only if focus is still on the submit button (or was
 *   lost).
 * - Duplicate submissions are refused by the page's synchronous guard; while a
 *   creation (or the check after an uncertain one) runs, the button is
 *   `aria-disabled` so a focused button keeps focus.
 */
export interface CreateTripFormProps {
  /** A creation, or the list check after an uncertain one, is in progress. */
  busy: boolean;
  /** `name` already passed `validateTripName`. Returns the server's name error, if any. */
  onCreate: (name: string) => Promise<{ nameError?: string }>;
}

export function CreateTripForm({ busy, onCreate }: CreateTripFormProps) {
  const inputId = useId();
  const errorId = useId();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    const result = validateTripName(value);
    if (!result.ok) {
      setError(result.message);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    const { nameError } = await onCreate(result.value);
    if (nameError === undefined) return;
    setError(nameError);
    const active = document.activeElement;
    if (active === null || active === document.body || active === submitRef.current) {
      inputRef.current?.focus();
    }
  }

  return (
    <form className={styles.form} onSubmit={(event) => void handleSubmit(event)} noValidate>
      <label htmlFor={inputId}>New trip name</label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={value}
        autoComplete="off"
        className={styles.input}
        aria-invalid={error !== null ? true : undefined}
        aria-describedby={error !== null ? errorId : undefined}
        onChange={(event) => setValue(event.target.value)}
      />
      {error !== null ? (
        <p id={errorId} className={styles.fieldError}>
          {error}
        </p>
      ) : null}
      <button
        ref={submitRef}
        type="submit"
        className={styles.button}
        aria-disabled={busy ? true : undefined}
      >
        Create trip
      </button>
    </form>
  );
}
