import { useId } from "react";
import { NewTripForm } from "./NewTripForm";
import { NEW_TRIP, type UseAddToTrip } from "./useAddToTrip";
import type { TripFailure } from "./useTrip";
import styles from "./AddToTrip.module.css";

/**
 * The picker's contents (M05-T04 Increment 5; spec v1.1 §8; decision D5): the
 * user's trips as a radio group (name, direction-isolated, and stop count),
 * "Show more trips" while the server reports `has_more`, and the New trip
 * option — always offered, even with no trips. Rendering only; all state and
 * requests live in `useAddToTrip`.
 */

function failureText(failure: TripFailure, what: string): string {
  switch (failure.kind) {
    case "rate-limited":
      return failure.retryAfterSeconds === undefined
        ? "Too many requests. Please wait a moment and try again."
        : `Too many requests. Please try again in ${failure.retryAfterSeconds} second${
            failure.retryAfterSeconds === 1 ? "" : "s"
          }.`;
    default:
      return `Couldn't load ${what}. Please try again.`;
  }
}

export interface TripPickerProps {
  flow: UseAddToTrip;
  landmarkName: string;
}

export function TripPicker({ flow, landmarkName }: TripPickerProps) {
  const groupName = useId();
  const busy = flow.action !== null;
  const blocked = flow.landmarkUnavailable;
  const { list } = flow;

  return (
    <div className={styles.picker}>
      {list.status === "loading" || list.status === "idle" ? (
        <p className={styles.note}>Loading your trips…</p>
      ) : null}
      {list.status === "error" ? (
        <div className={styles.inlineError}>
          <p>{failureText(list.failure, "your trips")}</p>
          <button type="button" className={styles.button} onClick={flow.retryList}>
            Try again
          </button>
        </div>
      ) : null}

      {list.status === "ready" ? (
        <fieldset className={styles.fieldset}>
          <legend>Choose a trip</legend>
          {list.trips.length === 0 ? (
            <p className={styles.note}>You don&apos;t have any trips yet.</p>
          ) : null}
          <ul className={styles.options}>
            {list.trips.map((trip) => (
              <li key={trip.id}>
                <label className={styles.option}>
                  <input
                    type="radio"
                    name={groupName}
                    value={trip.id}
                    checked={flow.selection === trip.id}
                    onChange={() => flow.select(trip.id)}
                  />
                  <span className={styles.optionText}>
                    <bdi>{trip.name}</bdi>{" "}
                    <span className={styles.count}>
                      ({trip.stop_count} stop{trip.stop_count === 1 ? "" : "s"})
                    </span>
                  </span>
                </label>
              </li>
            ))}
            <li>
              <label className={styles.option}>
                <input
                  type="radio"
                  name={groupName}
                  value={NEW_TRIP}
                  checked={flow.selection === NEW_TRIP}
                  onChange={() => flow.select(NEW_TRIP)}
                />
                <span className={styles.optionText}>New trip</span>
              </label>
            </li>
          </ul>
          {list.hasMore ? (
            <button
              type="button"
              className={styles.button}
              aria-disabled={list.loadingMore ? true : undefined}
              onClick={flow.loadMore}
            >
              {list.loadingMore ? "Loading more trips…" : "Show more trips"}
            </button>
          ) : null}
          {list.moreFailure !== null ? (
            <p className={styles.inlineError}>{failureText(list.moreFailure, "more trips")}</p>
          ) : null}
        </fieldset>
      ) : null}

      {flow.selectionCleared ? (
        <p className={styles.note}>
          The trip you selected is no longer in your list. Choose a trip.
        </p>
      ) : null}

      {list.status === "ready" && flow.selection !== null && flow.selection !== NEW_TRIP ? (
        <button
          type="button"
          className={styles.button}
          aria-disabled={busy || blocked ? true : undefined}
          aria-label={`Add to the selected trip: ${landmarkName}`}
          onClick={() => void flow.addToSelected()}
        >
          Add to the selected trip
        </button>
      ) : null}

      {list.status === "ready" && flow.selection === NEW_TRIP ? (
        <NewTripForm
          landmarkName={landmarkName}
          disabled={blocked}
          busy={busy}
          onCreate={flow.createAndAdd}
        />
      ) : null}
    </div>
  );
}
