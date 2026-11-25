import { useId, type Ref } from "react";
import styles from "./TripManage.module.css";

export const SHARING_SECTION_ID = "trip-sharing";
export const SHARING_HEADING_ID = "trip-sharing-heading";

/**
 * The owner's Sharing section on the trip page (M05-T06 Increment 4; spec
 * v1.1 §§4, 5.4, 8; decisions D7, D8). Presentational only: the trip, the
 * held link, and every change live in `useTrip`; the page renders this
 * section only when the trip reports `sharing_enabled: true`.
 *
 * Three states, all explaining the consequences BEFORE any button is used
 * (D8 — no extra confirmation dialogs):
 * - not shared — who can see a shared trip, that recipients can forward the
 *   link; "Create share link";
 * - shared, with the CONFIRMED link held in memory — a labelled read-only field
 *   with the link, "Copy link", "Create new link", "Turn off sharing";
 * - shared, but no link held (after a reload, or when a link could not be
 *   confirmed) — the link cannot be shown again; "Create new link" (the
 *   current link stops working) and "Turn off sharing". Nothing is
 *   reconstructed.
 * While any change is pending the buttons are `aria-disabled` (a focused
 * button keeps focus; the hook's lock refuses the action).
 */
export interface TripSharingPanelProps {
  isShared: boolean;
  /** The confirmed link, or null. Never a provisional one. */
  link: string | null;
  busy: boolean;
  headingRef: Ref<HTMLHeadingElement>;
  fieldRef: Ref<HTMLInputElement>;
  copyRef: Ref<HTMLButtonElement>;
  createRef: Ref<HTMLButtonElement>;
  revokeRef: Ref<HTMLButtonElement>;
  onCreate: (origin: HTMLElement) => void;
  onRevoke: (origin: HTMLElement) => void;
  onCopy: (origin: HTMLElement) => void;
}

export function TripSharingPanel({
  isShared,
  link,
  busy,
  headingRef,
  fieldRef,
  copyRef,
  createRef,
  revokeRef,
  onCreate,
  onRevoke,
  onCopy,
}: TripSharingPanelProps) {
  const fieldId = useId();
  const busyFlag = busy ? true : undefined;

  return (
    <section
      id={SHARING_SECTION_ID}
      aria-labelledby={SHARING_HEADING_ID}
      className={styles.sharing}
    >
      <h3 id={SHARING_HEADING_ID} ref={headingRef} tabIndex={-1} className={styles.sharingHeading}>
        Sharing
      </h3>
      {!isShared ? (
        <>
          <p className={styles.explain}>
            This trip is private. If you create a share link, anyone who has the link can view this
            trip&apos;s name, stops, and map without signing in, and people you send it to can
            forward it.
          </p>
          <div className={styles.actions}>
            <button
              ref={createRef}
              type="button"
              className={styles.button}
              aria-disabled={busyFlag}
              onClick={(event) => onCreate(event.currentTarget)}
            >
              Create share link
            </button>
          </div>
        </>
      ) : (
        <>
          {link !== null ? (
            <div className={styles.linkRow}>
              <label htmlFor={fieldId}>Share link</label>
              <input
                ref={fieldRef}
                id={fieldId}
                type="text"
                readOnly
                value={link}
                className={styles.input}
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                ref={copyRef}
                type="button"
                className={styles.button}
                onClick={(event) => onCopy(event.currentTarget)}
              >
                Copy link
              </button>
            </div>
          ) : null}
          <p className={styles.explain}>
            {link !== null
              ? "Sharing is on. Anyone who has this link can view this trip without signing in, and can forward it."
              : "Sharing is on, but the current link can't be shown again — links are shown only when they are created."}{" "}
            Create new link replaces the current link: the current link stops working. Turn off
            sharing stops the current link working.
          </p>
          <div className={styles.actions}>
            <button
              ref={createRef}
              type="button"
              className={styles.button}
              aria-disabled={busyFlag}
              onClick={(event) => onCreate(event.currentTarget)}
            >
              Create new link
            </button>
            <button
              ref={revokeRef}
              type="button"
              className={`${styles.button} ${styles.danger}`}
              aria-disabled={busyFlag}
              onClick={(event) => onRevoke(event.currentTarget)}
            >
              Turn off sharing
            </button>
          </div>
        </>
      )}
    </section>
  );
}
