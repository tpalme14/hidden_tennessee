import { useContext, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Link, useLocation } from "react-router";
import { AuthContext } from "../auth/session";
import { addMessage } from "./addToTripMessages";
import { MessageText } from "./MessageText";
import { name } from "./messageParts";
import { TripPicker } from "./TripPicker";
import { tripPath } from "./tripPaths";
import { useTripsAnnouncer, type TripsAnnouncerValue } from "./TripsAnnouncer";
import { useAddToTrip } from "./useAddToTrip";
import styles from "./AddToTrip.module.css";

/**
 * "Add to trip" for one landmark (M05-T04 Increment 5; spec v1.1 §§6.1, 8;
 * decisions D1, D2, D5). Rendered ONLY where the landmark is known to be an
 * active `PUBLIC` landmark — the full landmark profile and the geographic
 * results list — never for a redacted or unavailable landmark. The server
 * still decides on every add.
 *
 * Fails closed: nothing is rendered without a session context, or (list
 * variant) without the `TripsAnnouncer` that carries its announcements.
 *
 * - While the session is unverified, nothing is shown (no request is made).
 * - Signed out: "Sign in to add to a trip", returning to this page.
 * - Signed in: a disclosure button (`aria-expanded`, `aria-controls`) that
 *   opens an inline picker region. Opening moves focus into the region;
 *   Escape inside it, or Close, closes it and returns focus to the button.
 *
 * Feedback is kept OUTSIDE the picker, so a result still reaches the user if
 * the picker was closed while the request ran: the profile variant renders
 * one polite status region (pending, then "Added … — View trip") and at most
 * one alert; the list variant sends the same messages, prefixed with the
 * landmark's name, to the surrounding `TripsAnnouncer` (no live regions
 * inside the results list, M02-T08). No focus is moved after an asynchronous
 * result, and nothing navigates automatically.
 */

export interface AddToTripButtonProps {
  landmarkId: string;
  displayName: string;
  /** `list`: compact, announcing through the surrounding `TripsAnnouncer`. */
  variant?: "profile" | "list";
}

export function AddToTripButton(props: AddToTripButtonProps) {
  const auth = useContext(AuthContext);
  const announcer = useTripsAnnouncer();
  if (auth === null) return null;
  if (props.variant === "list" && announcer === null) return null;
  return <AddToTripControl {...props} announcer={announcer} />;
}

function AddToTripControl({
  landmarkId,
  displayName,
  variant = "profile",
  announcer,
}: AddToTripButtonProps & { announcer: TripsAnnouncerValue | null }) {
  const [open, setOpen] = useState(false);
  const flow = useAddToTrip(landmarkId, open);
  const location = useLocation();
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const focusPanelOnOpen = useRef(false);
  const isList = variant === "list";
  const containerClass = isList ? `${styles.addToTrip} ${styles.compact}` : styles.addToTrip;

  // A different landmark, or losing the verified session, closes the picker.
  useEffect(() => {
    setOpen(false);
  }, [landmarkId]);
  useEffect(() => {
    if (flow.session !== "signed-in") setOpen(false);
  }, [flow.session]);

  useEffect(() => {
    if (open && focusPanelOnOpen.current) {
      focusPanelOnOpen.current = false;
      panelRef.current?.focus();
    }
  }, [open]);

  const message = flow.feedback === null ? null : addMessage(flow.feedback, displayName);
  const pendingText =
    flow.action === "creating"
      ? "Creating the trip…"
      : flow.action === "adding"
        ? "Adding to the trip…"
        : "";

  // List variant: mirror the current pending state / message into the shared announcer.
  const { retryAdd } = flow;
  const busy = flow.action !== null;
  useEffect(() => {
    if (!isList || announcer === null) return;
    if (pendingText !== "") {
      announcer.announce(landmarkId, {
        tone: "status",
        parts: [name(displayName), `: ${pendingText}`],
      });
    } else if (message !== null) {
      announcer.announce(landmarkId, {
        tone: message.tone,
        parts:
          message.tone === "status" ? message.parts : [name(displayName), ": ", ...message.parts],
        ...(message.viewTrip ? { viewTripId: message.viewTrip.id } : {}),
        ...(message.retryAdd && flow.pendingTrip !== null
          ? { onRetry: () => void retryAdd(), retryDisabled: busy }
          : {}),
      });
    } else {
      announcer.clear(landmarkId);
    }
    // Re-announce only when the outcome or pending state changes.
  }, [isList, announcer, landmarkId, displayName, pendingText, flow.feedback, flow.pendingTrip]);

  useEffect(() => {
    if (!isList || announcer === null) return;
    return () => announcer.clear(landmarkId);
  }, [isList, announcer, landmarkId]);

  if (flow.session === "unverified") return null;

  if (flow.session === "signed-out") {
    const returnTo = `${location.pathname}${location.search}`;
    return (
      <div className={containerClass}>
        <Link
          className={styles.link}
          to={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}
          aria-label={`Sign in to add to a trip: ${displayName}`}
        >
          Sign in to add to a trip
        </Link>
      </div>
    );
  }

  function close() {
    setOpen(false);
    toggleRef.current?.focus();
  }

  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  }

  return (
    <div className={containerClass}>
      <button
        ref={toggleRef}
        type="button"
        className={styles.button}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Add to trip: ${displayName}`}
        onClick={() => {
          if (open) {
            setOpen(false);
          } else {
            focusPanelOnOpen.current = true;
            setOpen(true);
          }
        }}
      >
        Add to trip
      </button>

      {isList ? null : (
        <>
          <p role="status" className={styles.status}>
            {pendingText !== "" ? (
              pendingText
            ) : message?.tone === "status" ? (
              <>
                <MessageText parts={message.parts} />
                {message.viewTrip ? (
                  <>
                    {" — "}
                    <Link to={tripPath(message.viewTrip.id)}>View trip</Link>
                  </>
                ) : null}
              </>
            ) : null}
          </p>
          {message?.tone === "alert" ? (
            <div role="alert" className={styles.alert}>
              <p>
                <MessageText parts={message.parts} />
                {message.viewTrip ? (
                  <>
                    {" "}
                    <Link to={tripPath(message.viewTrip.id)}>View trip</Link>
                  </>
                ) : null}
              </p>
              {message.retryAdd && flow.pendingTrip !== null ? (
                <button
                  type="button"
                  className={styles.button}
                  aria-disabled={busy ? true : undefined}
                  onClick={() => void retryAdd()}
                >
                  Try adding again
                </button>
              ) : null}
            </div>
          ) : null}
        </>
      )}

      {open ? (
        <div
          id={panelId}
          ref={panelRef}
          role="region"
          aria-label={`Add ${displayName} to a trip`}
          tabIndex={-1}
          className={styles.panel}
          onKeyDown={onPanelKeyDown}
        >
          <TripPicker flow={flow} landmarkName={displayName} />
          <button type="button" className={styles.button} onClick={close}>
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}
