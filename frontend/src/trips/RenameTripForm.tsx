import { useId, type FormEvent, type Ref } from "react";
import styles from "./TripManage.module.css";

/**
 * The inline Rename form on the trip page (M05-T06 Increment 3; spec v1.1
 * §§5.1.1, 5.5, 8; decision D3). Presentational only: the draft, its errors,
 * and the submission live in `TripDetailPage`, so the draft survives a
 * conflict, an uncertain outcome, or a trip that must be reloaded — and the
 * authoritative trip stays in `useTrip`. The field error (and, after a version
 * conflict, the note asking the user to review the current name) is associated
 * with the input; neither is a live region (the page's status region and alert
 * carry the announcements).
 */
export interface RenameTripFormProps {
  value: string;
  error: string | null;
  note: string | null;
  busy: boolean;
  inputRef: Ref<HTMLInputElement>;
  saveRef: Ref<HTMLButtonElement>;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
}

export function RenameTripForm({
  value,
  error,
  note,
  busy,
  inputRef,
  saveRef,
  onChange,
  onSubmit,
  onCancel,
}: RenameTripFormProps) {
  const inputId = useId();
  const errorId = useId();
  const noteId = useId();
  const describedBy = [error !== null ? errorId : null, note !== null ? noteId : null]
    .filter((id): id is string => id !== null)
    .join(" ");

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit} noValidate>
      <label htmlFor={inputId}>Trip name</label>
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        value={value}
        autoComplete="off"
        className={styles.input}
        aria-invalid={error !== null ? true : undefined}
        aria-describedby={describedBy === "" ? undefined : describedBy}
        onChange={(event) => onChange(event.target.value)}
      />
      {note !== null ? (
        <p id={noteId} className={styles.note}>
          {note}
        </p>
      ) : null}
      {error !== null ? (
        <p id={errorId} className={styles.fieldError}>
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
        <button
          ref={saveRef}
          type="submit"
          className={styles.button}
          aria-disabled={busy ? true : undefined}
        >
          Save name
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
