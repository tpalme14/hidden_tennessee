import { MAX_TRIP_STOPS, type OwnerTrip, type TripStop } from "../api/trips";
import { name, type MessagePart } from "./messageParts";
import type { MutationOutcome, StaleReason, TripFailure } from "./useTrip";

/**
 * The trip page's user-facing wording (M05-T04 Increment 3). Announcements
 * name a stop by its landmark only when it is available; an unavailable stop
 * is named by position ("stop 3 (no longer available)") — never by hidden
 * landmark data.
 */

export const VERSION_CONFLICT_TEXT =
  "This trip changed since you loaded it. The latest order is shown — try again.";

function stopCount(trip: OwnerTrip): string {
  const n = trip.stops.length;
  return n === 0 ? "The trip has no stops." : `The trip has ${n} stop${n === 1 ? "" : "s"}.`;
}

function waitText(failure: TripFailure): string {
  if (failure.kind !== "rate-limited") return "";
  return failure.retryAfterSeconds === undefined
    ? "Too many requests. Please wait a moment and try again."
    : `Too many requests. Please try again in ${failure.retryAfterSeconds} second${
        failure.retryAfterSeconds === 1 ? "" : "s"
      }.`;
}

/** A failed load. */
export function loadFailureText(failure: TripFailure): string {
  switch (failure.kind) {
    case "unauthenticated":
      return "Couldn't load this trip because your session may have ended.";
    case "rate-limited":
      return waitText(failure);
    default:
      return "Couldn't load this trip. Please try again.";
  }
}

/** The trip could not be re-read after a change; nothing may be changed until it is reloaded. */
export function staleText(reason: StaleReason, failure: TripFailure): string {
  const lead =
    reason === "removed"
      ? "The stop was removed, but the updated trip couldn't be loaded."
      : reason === "added"
        ? "The stop was added, but the updated trip couldn't be loaded."
        : reason === "conflict"
          ? "This trip changed since you loaded it, and the latest version couldn't be loaded."
          : reason === "renamed"
            ? "Couldn't confirm whether the trip was renamed, and the trip couldn't be loaded."
            : reason === "delete_uncertain"
              ? "Couldn't confirm whether the trip was deleted, and the trip couldn't be loaded."
              : reason === "shared"
                ? "A share link was created, but the updated trip couldn't be loaded, so the link can't be shown. Any earlier link no longer works."
                : reason === "unshared"
                  ? "Sharing was turned off, but the updated trip couldn't be loaded."
                  : reason === "share_uncertain"
                    ? "Couldn't confirm whether the sharing change was saved, and the trip couldn't be loaded."
                    : reason === "sharing_unavailable"
                      ? "Sharing isn't available right now, and the trip couldn't be loaded."
                      : "Couldn't confirm whether your change was saved, and the trip couldn't be loaded.";
  const next =
    reason === "delete_uncertain"
      ? "Reload the trip to see whether it still exists."
      : "Reload the trip before making more changes.";
  const wait = waitText(failure);
  return `${lead} ${next}${wait ? ` ${wait}` : ""}`;
}

/** Shown in the rename form after a version conflict (the draft is kept). */
export const RENAME_CONFLICT_TEXT =
  "This trip changed since you opened the form. Review its current name above, then save again.";

export interface OutcomeMessage {
  /** Polite announcement in the status region; landmark names are `{ name }` parts (isolated). */
  status?: MessagePart[];
  /** Assertive alert (a failure). */
  alert?: string;
}

/** What to tell the user after a change. Outcomes that change the page state themselves say nothing here. */
export function outcomeMessage(outcome: MutationOutcome): OutcomeMessage {
  switch (outcome.kind) {
    case "removed": {
      const what: MessagePart[] = outcome.stop.is_available
        ? ["Removed ", name(outcome.stop.landmark.display_name), " from the trip."]
        : [`Removed stop ${outcome.stop.position + 1}, which was no longer available.`];
      return { status: [...what, ` ${stopCount(outcome.trip)}`] };
    }
    case "already_removed":
      return {
        status: [
          `That stop had already been removed. The latest trip is shown. ${stopCount(outcome.trip)}`,
        ],
      };
    case "moved": {
      const moved = outcome.trip.stops.find((s) => s.id === outcome.stop.id);
      if (moved === undefined) return { status: ["The latest trip is shown."] };
      const label: MessagePart = moved.is_available
        ? name(moved.landmark.display_name)
        : "the stop that is no longer available";
      return {
        status: [
          "Moved ",
          label,
          ` to position ${moved.position + 1} of ${outcome.trip.stops.length}.`,
        ],
      };
    }
    case "conflict_refreshed":
      return {
        status: [
          outcome.reason === "version"
            ? VERSION_CONFLICT_TEXT
            : "This trip's stops changed since you loaded it. The latest order is shown — try again.",
        ],
      };
    case "uncertain_refreshed":
      return {
        status: [
          "Couldn't confirm whether your change was saved. The latest trip is shown — check it and try again if needed.",
        ],
      };
    case "added":
      return {
        status:
          outcome.stop === null
            ? [
                "Added ",
                name(outcome.name),
                ", but the latest trip doesn't include it — it may have been changed elsewhere. The latest trip is shown.",
              ]
            : [
                "Added ",
                name(outcome.name),
                ` to the trip as stop ${outcome.stop.position + 1}. ${stopCount(outcome.trip)}`,
              ],
      };
    case "add_conflict":
      return {
        status:
          outcome.reason === "duplicate"
            ? [name(outcome.name), " is already in this trip. The latest trip is shown."]
            : [
                `This trip already has ${MAX_TRIP_STOPS} stops, the most a trip can hold. The latest trip is shown.`,
              ],
      };
    case "add_unavailable":
      return {
        status: [name(outcome.name), " can't be added to this trip. The latest trip is shown."],
      };
    case "add_uncertain_refreshed":
      return {
        status: outcome.present
          ? [
              "Couldn't confirm the change, but ",
              name(outcome.name),
              " is in the trip. The latest trip is shown.",
            ]
          : [
              "Couldn't confirm whether ",
              name(outcome.name),
              " was added. It isn't in the trip — you can try again.",
            ],
      };
    case "renamed":
      return { status: ["Renamed the trip to ", name(outcome.trip.name), "."] };
    case "rename_conflict":
      return {
        status: [
          "This trip changed since you opened the form. Its current name is ",
          name(outcome.trip.name),
          ". Review it, then save again.",
        ],
      };
    case "rename_uncertain_refreshed":
      return outcome.hasName
        ? {
            status: [
              "Couldn't confirm the rename, but the trip is now named ",
              name(outcome.trip.name),
              ".",
            ],
          }
        : {
            alert:
              "Couldn't confirm whether the new name was saved. The trip's current name is shown — save again if you still want to change it.",
          };
    // ---- Sharing (Increment 4). No message ever contains a share URL or token. ----
    case "share_created":
      return {
        status: [
          outcome.rotated
            ? "New share link created. The previous link no longer works."
            : "Share link created. Anyone with the link can view this trip.",
        ],
      };
    case "share_unconfirmed":
      return {
        alert:
          outcome.reason === "version"
            ? "A share link was created, but this trip changed at the same time, so that link couldn't be confirmed and isn't shown. Any earlier link no longer works. Choose Create new link to get a link you can copy."
            : "A share link was created, but sharing isn't active for this trip now, so the link isn't shown.",
      };
    case "sharing_unavailable":
      return { status: ["Sharing isn't available right now."] };
    case "share_uncertain":
      return outcome.active
        ? {
            alert:
              "Couldn't confirm whether a new link was created. Sharing is on, but no link can be shown: a new link may have been created, and an earlier link may no longer work. Choose Create new link to get a link you can copy.",
          }
        : {
            status: [
              "Couldn't confirm the sharing change. Sharing is currently off for this trip.",
            ],
          };
    case "sharing_revoked":
      return { status: ["Sharing turned off. The previous link no longer works."] };
    case "revoke_superseded":
      return {
        alert:
          "Sharing was turned off, but the trip is shared again now — it may have been changed in another window. No link can be shown; choose Create new link to get one, or Turn off sharing.",
      };
    case "revoke_uncertain":
      return outcome.active
        ? {
            alert:
              "Couldn't confirm that sharing was turned off. Sharing is still on. Choose Turn off sharing to try again.",
          }
        : { status: ["Couldn't confirm the change, but sharing is currently off for this trip."] };
    case "delete_uncertain_exists":
      return {
        alert:
          "Couldn't confirm that the trip was deleted. It still exists. To delete it, choose Delete trip and confirm again.",
      };
    case "rejected":
      return {
        alert:
          outcome.failure.kind === "rate-limited"
            ? `Couldn't change the trip. ${waitText(outcome.failure)}`
            : "Couldn't change the trip. Please try again.",
      };
    default:
      return {};
  }
}

/** How a stop is referred to in control names: by landmark when available, else by position only. */
export function stopLabel(stop: TripStop): string {
  return stop.is_available
    ? stop.landmark.display_name
    : `stop ${stop.position + 1} (no longer available)`;
}
