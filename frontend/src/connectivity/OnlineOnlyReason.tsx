import type { OnlineOnlyAction } from "./useOnlineOnlyAction";

/** The visible explanation shown beside an action that needs the server. */
export const ONLINE_ONLY_REASON = "Unavailable while the server can't be reached.";
/** Shown instead while an application update is in progress (M06-T02 Increment 4b-iii). */
export const UPDATING_REASON = "Unavailable while the app updates.";

/**
 * The visible reason for an online-only action that is currently unavailable
 * (M06-T02 Increment 3b). Rendered only while unavailable, with the id the
 * control references in `aria-describedby`. Deliberately NOT a live region:
 * the connectivity banner already announces the situation once, so this adds
 * no duplicate announcement. Styling comes from the host component's own
 * stylesheet (`className`).
 */
export function OnlineOnlyReason({
  action,
  className,
}: {
  action: OnlineOnlyAction;
  className?: string;
}) {
  if (!action.unavailable) return null;
  return (
    <p id={action.reasonId} className={className}>
      {action.reason === "updating" ? UPDATING_REASON : ONLINE_ONLY_REASON}
    </p>
  );
}
