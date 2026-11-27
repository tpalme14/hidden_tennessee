import { useId, useRef, useState, type FormEvent } from "react";
import { OnlineOnlyReason } from "../connectivity/OnlineOnlyReason";
import { useOnlineOnlyAction } from "../connectivity/useOnlineOnlyAction";
import { useUnsavedInput } from "../pwa/useUnsavedInput";
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
  // M06-T02 Increment 3b-ii: creating the trip (and then adding) needs the
  // server (OFF-UX-5). The typed name is kept; nothing resumes on recovery.
  const online = useOnlineOnlyAction();
  // M06-T02 Increment 4b-ii: a typed name is protected from an update reload (presence only).
  const markNameEdited = useUnsavedInput("trip-name", name.trim() !== "");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    // The form's own submit path (button click, Enter, or requestSubmit) is guarded.
    if (disabled || busy || online.unavailable) return;
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
        onChange={(event) => {
          setName(event.target.value);
          markNameEdited(event.target.value.trim() !== "");
        }}
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
        aria-disabled={disabled || busy || online.unavailable ? true : undefined}
        data-pending={busy ? "true" : undefined}
        aria-label={`Create trip and add ${landmarkName}`}
        aria-describedby={online.describedBy}
      >
        Create trip and add
      </button>
      <OnlineOnlyReason action={online} className={styles.note} />
    </form>
  );
}
