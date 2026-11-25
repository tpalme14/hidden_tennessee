import { name, type MessagePart } from "./messageParts";
import type { AddFeedback, TripRef } from "./useAddToTrip";

/**
 * Wording for "Add to trip" (M05-T04 Increments 5–6; spec v1.1 §§6.1, 8).
 * Every message is either a polite status (success) or an alert (anything
 * that did not do what was asked). Landmark and trip names are separate
 * `{ name }` parts, rendered direction-isolated (Increment 6 correction: a
 * name with bidirectional controls must not reorder the rest of the message).
 */

export interface AddMessage {
  tone: "status" | "alert";
  /** The message before the trip link (if any). */
  parts: MessagePart[];
  /** A "View trip" link to this trip. */
  viewTrip?: TripRef;
  /** Offer "Try adding again" (to `viewTrip` only — never another create). */
  retryAdd?: boolean;
}

function wait(retryAfterSeconds?: number): string {
  return retryAfterSeconds === undefined
    ? "Too many requests. Please wait a moment and try again."
    : `Too many requests. Please try again in ${retryAfterSeconds} second${
        retryAfterSeconds === 1 ? "" : "s"
      }.`;
}

export function addMessage(feedback: AddFeedback, landmark: string): AddMessage {
  const place = name(landmark);
  switch (feedback.kind) {
    case "added":
      return {
        tone: "status",
        parts: ["Added ", place, " to ", name(feedback.trip.name)],
        viewTrip: feedback.trip,
      };
    case "already_exists":
      return { tone: "alert", parts: ["Already in this trip."], viewTrip: feedback.trip };
    case "limit_reached":
      return { tone: "alert", parts: ["This trip has 25 stops."] };
    case "landmark_unavailable":
      return { tone: "alert", parts: ["This landmark can't be added."] };
    case "trip_gone":
      return { tone: "alert", parts: ["That trip is no longer available. Choose another trip."] };
    case "rate_limited":
      return { tone: "alert", parts: [wait(feedback.retryAfterSeconds)] };
    case "add_failed":
      return {
        tone: "alert",
        parts: ["Couldn't add ", place, " to ", name(feedback.trip.name), ". Please try again."],
      };
    case "add_uncertain":
      return {
        tone: "alert",
        parts: [
          "We couldn't confirm whether ",
          place,
          " was added to ",
          name(feedback.trip.name),
          ". Check the trip before trying again.",
        ],
        viewTrip: feedback.trip,
      };
    case "verify_failed":
      return {
        tone: "alert",
        parts: [
          "We still couldn't confirm whether ",
          place,
          " is in ",
          name(feedback.trip.name),
          ", so nothing was sent. Check the trip before trying again.",
        ],
        viewTrip: feedback.trip,
        // Safe: every further attempt reads the trip first and sends nothing if it cannot.
        retryAdd: true,
      };
    case "partial": {
      const why: MessagePart[] =
        feedback.reason === "uncertain"
          ? [
              " We couldn't confirm whether ",
              place,
              " was added. Check the trip before trying again.",
            ]
          : feedback.reason === "limit"
            ? [" This trip has 25 stops."]
            : feedback.reason === "unavailable"
              ? [" This landmark can't be added."]
              : feedback.reason === "rate_limited"
                ? [` ${wait(feedback.retryAfterSeconds)}`]
                : [" Please try again."];
      return {
        tone: "alert",
        parts: [
          "The trip ",
          name(feedback.trip.name),
          " was created, but ",
          place,
          " couldn't be added to it.",
          ...why,
        ],
        viewTrip: feedback.trip,
        retryAdd: feedback.reason !== "unavailable" && feedback.reason !== "limit",
      };
    }
    case "create_failed":
      return { tone: "alert", parts: ["Couldn't create the trip. Please try again."] };
    case "create_uncertain":
      return {
        tone: "alert",
        parts: [
          "We couldn't confirm whether the trip was created. Check your trips below before trying again.",
        ],
      };
  }
}
