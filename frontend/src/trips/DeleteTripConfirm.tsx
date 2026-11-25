import type { Ref } from "react";
import styles from "./TripManage.module.css";

/**
 * The inline delete confirmation on the trip page (M05-T06 Increment 3; spec
 * v1.1 §§5.5, 8; decision D4; the OwnReviewPanel Q1 pattern). Opening it sends
 * nothing; only "Delete trip permanently" asks the page to delete. The name is
 * the CURRENT authoritative name (rendered from `useTrip`'s trip on every
 * render), direction-isolated. The explanatory text is programmatically
 * focusable (`tabIndex={-1}`) and receives focus on opening.
 */
export interface DeleteTripConfirmProps {
  tripName: string;
  busy: boolean;
  textRef: Ref<HTMLParagraphElement>;
  onConfirm: (origin: HTMLElement) => void;
  onCancel: () => void;
}

export function DeleteTripConfirm({
  tripName,
  busy,
  textRef,
  onConfirm,
  onCancel,
}: DeleteTripConfirmProps) {
  return (
    <div className={styles.confirm}>
      <p ref={textRef} tabIndex={-1} className={styles.confirmText}>
        Delete <bdi>{tripName}</bdi> permanently? This can&apos;t be undone. Its stops are removed
        with it; the landmarks themselves aren&apos;t deleted.
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          className={`${styles.button} ${styles.danger}`}
          aria-disabled={busy ? true : undefined}
          onClick={(event) => onConfirm(event.currentTarget)}
        >
          Delete trip permanently
        </button>
        <button type="button" className={styles.button} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
