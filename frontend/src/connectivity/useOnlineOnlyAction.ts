import { useId, useSyncExternalStore } from "react";
import { updateSafety, type UpdateSafety } from "../pwa/updateSafety";
import { connectivity, type ConnectivityStore } from "./connectivity";
import { useConnectivity } from "./useConnectivity";

/**
 * Availability of an online-only action (M06-T02 Increment 3b; Specification
 * 6 v1.1 OFF-UX-5; extended in Increment 4b-iii). The action is unavailable
 * ONLY while
 * - the connectivity store reports `unreachable` — never because of the
 *   browser's offline hint alone, unknown reachability, a server problem, an
 *   HTTP error, or a cancelled request; or
 * - an application update owns the update-safety transition gate (the page is
 *   about to reload). This is NOT presented as a connectivity failure.
 *
 * When both apply, the update reason is shown (`reason: "updating"`): it is
 * the immediate cause and ends with the update; the connectivity reason
 * returns afterwards if the server is still unreachable.
 *
 * It is an additional condition: callers keep their own authorization,
 * validation, busy, and pending checks, and must also refuse the action in the
 * handler itself (not only through `aria-disabled`). The rendered state is a
 * presentation layer only — the shared client's refusal before `fetch` and the
 * operation holds remain the synchronous safeguards.
 *
 * `reasonId` is unique per hook call; pass it to `OnlineOnlyReason` and add
 * `describedBy` to the control's `aria-describedby`. Nothing is ever run
 * automatically when the action becomes available again.
 */
export type OnlineOnlyReasonKind = "unreachable" | "updating";

export interface OnlineOnlyAction {
  unavailable: boolean;
  /** Why it is unavailable, or null when available. */
  reason: OnlineOnlyReasonKind | null;
  reasonId: string;
  /** The reason's id while unavailable, otherwise undefined (for aria-describedby). */
  describedBy: string | undefined;
}

export function useOnlineOnlyAction(
  store: ConnectivityStore = connectivity,
  safety: UpdateSafety = updateSafety,
): OnlineOnlyAction {
  const { reachability } = useConnectivity(store);
  const updating = useSyncExternalStore(
    safety.subscribe,
    () => safety.getSnapshot().gateHeld,
    () => safety.getSnapshot().gateHeld,
  );
  const reasonId = useId();
  const reason: OnlineOnlyReasonKind | null = updating
    ? "updating"
    : reachability === "unreachable"
      ? "unreachable"
      : null;
  const unavailable = reason !== null;
  return { unavailable, reason, reasonId, describedBy: unavailable ? reasonId : undefined };
}

/** Joins optional `aria-describedby` ids, or returns undefined when there are none. */
export function describedByIds(...ids: (string | null | undefined)[]): string | undefined {
  const joined = ids.filter(Boolean).join(" ");
  return joined === "" ? undefined : joined;
}
