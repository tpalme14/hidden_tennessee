import { useId, useRef, useState, type FormEvent } from "react";
import { validateTripName } from "./tripNameRule";
import styles from "./AddToTrip.module.css";

/**
 * The New trip name form inside the picker (M05-T04 Increment 5; spec v1.1
 * §§5.1.1, 8). The client mirrors the server's name rule for immediate
 * feedback; the server's own validation message is shown when it disagrees.
 * The error is associated with the input (`aria-invalid`, `aria-describedby`)
 * and the input takes focus — on a client error at once; on a server error
 * only if focus is still on the submit button (or was lost).
 */
export interface NewTripFormProps {
  landmarkName: string;
  disabled: boolean;
  busy: boolean;
  onCreate: (name: string) => Promise<{ nameError?: string }>;
}

export function NewTripForm({ landmarkName, disabled, busy, onCreate }: NewTripFormProps) {
  const inputId = useId();
  const errorId = useId();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (disabled || busy) return;
    const result = validateTripName(name);
    if (!result.ok) {
      setError(result.message);
      inputRef.current?.focus();
      return;
    }
    setError(null);
    const { nameError } = await onCreate(result.value);
    if (nameError !== undefined) {
      setError(nameError);
      const active = document.activeElement;
      if (active === null || active === document.body || active === submitRef.current) {
        inputRef.current?.focus();
      }
    }
  }

  return (
    <form className={styles.newTrip} onSubmit={(event) => void handleSubmit(event)} noValidate>
      <label htmlFor={inputId}>New trip name</label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={name}
        autoComplete="off"
        className={styles.input}
        aria-invalid={error !== null ? true : undefined}
        aria-describedby={error !== null ? errorId : undefined}
        onChange={(event) => setName(event.target.value)}
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
        aria-disabled={disabled || busy ? true : undefined}
        aria-label={`Create trip and add ${landmarkName}`}
      >
        Create trip and add
      </button>
    </form>
  );
}
