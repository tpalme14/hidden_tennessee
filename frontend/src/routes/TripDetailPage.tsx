import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router";
import { MAX_TRIP_STOPS, type TripStop } from "../api/trips";
import { parseUuid } from "../api/tripValidation";
import type { NearbyLandmarkView } from "../trips/nearbyLandmarks";
import { useAuth } from "../auth/session";
import { TripDistanceSummary } from "../trips/TripDistanceSummary";
import type { TripStopControls } from "../trips/TripStopItem";
import { TripStopList } from "../trips/TripStopList";
import { TripStopsMap } from "../trips/TripStopsMap";
import { MessageText } from "../trips/MessageText";
import { name as namePart, type MessagePart } from "../trips/messageParts";
import { DeleteTripConfirm } from "../trips/DeleteTripConfirm";
import { RenameTripForm } from "../trips/RenameTripForm";
import { SHARING_SECTION_ID, TripSharingPanel } from "../trips/TripSharingPanel";
import { validateTripName } from "../trips/tripNameRule";
import { readCreatedTripNotice, tripsListState } from "../trips/tripNotice";
import { TRIPS_PATH } from "../trips/tripsPageParam";
import manageStyles from "../trips/TripManage.module.css";
import { NearbyPanel, NEARBY_PANEL_ID } from "../trips/NearbyPanel";
import { closedParts } from "../trips/nearbyMessages";
import {
  RENAME_CONFLICT_TEXT,
  loadFailureText,
  outcomeMessage,
  staleText,
} from "../trips/tripMessages";
import { tripSignInHref } from "../trips/tripPaths";
import { useNearbyLandmarks } from "../trips/useNearbyLandmarks";
import { useTrip, type MoveDirection, type MutationOutcome } from "../trips/useTrip";
import styles from "./TripDetailPage.module.css";

/**
 * Trip detail and stop editing (M05-T04 Increments 2–3; spec v1.1 §§4, 5.3,
 * 5.6, 6.2–6.4, 8).
 *
 * Signed-in owners only. While the session is unverified nothing is fetched
 * or held; signed out, the page offers sign-in returning to this trip. A
 * missing trip, someone else's trip, and a malformed ID all show the same
 * generic not-found message (spec §4).
 *
 * Editing (Increment 3): Move up, Move down, and Remove on every stop. Nothing
 * changes on screen until the server confirms; while a change or its re-read
 * runs, the controls are `aria-disabled` and the status region says so.
 *
 * Feedback: exactly one polite status region for the trip (loading, pending,
 * and announcements — keyed so a repeated message is announced again; it also
 * carries the notice when a nearby search is closed by a change) and at most
 * one alert (a failed load, a refused change, or a trip that must be reloaded).
 * While open, the nearby panel has its own status line and failure alert
 * (M05-T05 Increment 2), so its search progress never replaces a trip
 * announcement.
 *
 * Focus, applied only after the resulting state has rendered, and only if
 * focus is still on the control that started the change (or was lost with it):
 * - removed → the next surviving stop's Remove button, else the previous
 *   one's, else the Stops heading (surviving stops identified by stop ID);
 * - moved → the same Move button of the moved stop, or its other Move button
 *   when it reached the boundary, else the heading;
 * - a conflict or uncertain outcome → the Stops heading;
 * - a trip that must be reloaded → the Reload button.
 *
 * Nearby landmarks (M05-T05 Increment 2): "Find nearby" on each available stop
 * opens ONE read-only panel below the list (`useNearbyLandmarks`, fed with the
 * same verified trip). Opening moves focus to the panel heading. When the panel
 * closes — explicitly (Close, Escape) or because its stop was removed, became
 * unavailable, or changed — focus returns to that stop's "Find nearby" button,
 * else the Stops heading, but only if focus was inside the panel (never taken
 * from a control the user moved to). A change-driven close is announced in the
 * page's nearby status line.
 *
 * Creation notice (M05-T06 Increment 2): arriving from My Trips after a
 * confirmed creation, the history state carries a one-time notice. It is read
 * once per history entry and the entry is replaced without it (so Back,
 * Forward, or a reload never repeats it). It is announced in the status region
 * only when it names the confirmed user and this trip; once the trip has
 * loaded, the trip heading takes focus if focus was lost in the navigation.
 *
 * Rename and delete (M05-T06 Increment 3; spec v1.1 §§5.5, 8; decisions D3,
 * D4; refinement R3). Both are `useTrip` mutations, so they share its single
 * change lock, epochs, re-reads, and session isolation; nothing is
 * optimistic. Only the rename DRAFT (with its field error and conflict note)
 * and the open delete confirmation live here; both belong to the current
 * user and trip and are dropped when either changes.
 * - Rename opens an inline form prefilled with the authoritative name (focus
 *   on its input; Cancel and success return focus to Rename). The draft is
 *   kept through refusals, conflicts, uncertain outcomes, and a trip that must
 *   be reloaded. After a conflict the latest trip is shown and the form stays
 *   open with a note to review the current name; the next explicit Save uses
 *   the latest version.
 * - Delete trip opens a confirmation naming the CURRENT trip (focus on its
 *   text; Cancel returns focus to Delete trip); it closes if the trip leaves
 *   the ready state. Only "Delete trip permanently" deletes. A confirmed
 *   deletion, a `404`, or an uncertain delete whose re-read finds no trip
 *   navigates to My Trips with a one-time notice for this user — confirmed
 *   deletion and "no longer available" are worded differently.
 */

const HEADING_ID = "trip-heading";

type FocusPlan =
  | { kind: "afterRemove"; removedId: string; orderBefore: string[] }
  | { kind: "afterAdd"; landmarkId: string }
  | { kind: "afterMove"; stopId: string; direction: MoveDirection }
  | { kind: "heading" }
  | { kind: "reload" }
  | { kind: "renameInput" }
  | { kind: "renameButton" }
  | { kind: "deleteButton" }
  | { kind: "deleteText" }
  | { kind: "copyButton" }
  | { kind: "shareCreate" }
  | { kind: "sharingHeading" };

interface RenameDraft {
  /** The user and trip the draft belongs to. */
  scope: string;
  value: string;
  error: string | null;
  note: string | null;
}

interface Message {
  /** Landmark names are `{ name }` parts, rendered direction-isolated. */
  parts: MessagePart[];
  seq: number;
  /** The user and trip the message belongs to; shown only while both still apply. */
  scope: string;
}

type ButtonKind = "up" | "down" | "remove" | "nearby";

export function TripDetailPage() {
  const { tripId } = useParams();
  const { session } = useAuth();
  const {
    state,
    pending,
    retry,
    removeStop,
    moveStop,
    addStop,
    renameTrip,
    deleteTrip,
    shareLink,
    isShareLinkCurrent,
    enableSharing,
    revokeSharing,
  } = useTrip(tripId);

  const userId = session.status === "authenticated" ? session.user.id : null;
  const scope = `${userId ?? ""}:${tripId ?? ""}`;

  const location = useLocation();
  const navigate = useNavigate();
  const tripHeadingRef = useRef<HTMLHeadingElement>(null);
  const focusTripHeadingWhenReady = useRef(false);
  const stopsHeadingRef = useRef<HTMLHeadingElement>(null);
  const reloadButtonRef = useRef<HTMLButtonElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const messageSeq = useRef(0);
  const focusPlan = useRef<{ plan: FocusPlan; origin: HTMLElement } | null>(null);
  const [focusRequest, setFocusRequest] = useState(0);
  const [announcement, setAnnouncement] = useState<Message | null>(null);
  const [alert, setAlert] = useState<Message | null>(null);

  // Rename draft and delete confirmation: local UI state, never trip data.
  const renameButtonRef = useRef<HTMLButtonElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameSaveRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const deleteTextRef = useRef<HTMLParagraphElement>(null);
  // Sharing (Increment 4): refs only — the link itself lives in `useTrip`.
  const sharingHeadingRef = useRef<HTMLHeadingElement>(null);
  const shareFieldRef = useRef<HTMLInputElement>(null);
  const shareCopyRef = useRef<HTMLButtonElement>(null);
  const shareCreateRef = useRef<HTMLButtonElement>(null);
  const shareRevokeRef = useRef<HTMLButtonElement>(null);
  const sharingFocusWithin = useRef(false);
  const [renameDraft, setRenameDraft] = useState<RenameDraft | null>(null);
  const [confirmScope, setConfirmScope] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const authenticated = session.status === "authenticated";
  const trip = authenticated && state.status === "ready" ? state.trip : null;
  const busy = pending !== null;

  const nearby = useNearbyLandmarks(trip);
  const nearbyHeadingRef = useRef<HTMLHeadingElement>(null);
  const nearbyFocusWithin = useRef(false);
  const nearbyOpenFocus = useRef<HTMLElement | null>(null);
  const [nearbyOpenRequest, setNearbyOpenRequest] = useState(0);
  const panelOpen = nearby.status.kind !== "closed" && nearby.origin !== null;
  const lastNearbyStop = useRef<string | null>(null);
  const wasPanelOpen = useRef(false);
  if (nearby.origin !== null) lastNearbyStop.current = nearby.origin.stopId;

  // A search closed by a change (its stop removed, unavailable, or changed) is
  // announced in the page's ONE status region, after any change announcement.
  const [nearbyNotice, setNearbyNotice] = useState<Message | null>(null);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const nearbyCloseReason = nearby.status.kind === "closed" ? nearby.status.reason : null;
  useEffect(() => {
    const parts = closedParts(nearbyCloseReason);
    if (parts === null) return;
    setNearbyNotice({ parts, seq: ++messageSeq.current, scope: scopeRef.current });
  }, [nearbyCloseReason]);

  // The one-time creation notice: consumed once per history entry, shown only
  // for the confirmed user and this trip, then removed from the history entry.
  const consumedNoticeKey = useRef<string | null>(null);
  useEffect(() => {
    const notice = readCreatedTripNotice(location.state);
    if (notice === null || consumedNoticeKey.current === location.key) return;
    consumedNoticeKey.current = location.key;
    navigate(
      { pathname: location.pathname, search: location.search, hash: location.hash },
      { replace: true, state: null },
    );
    if (userId === null || notice.userId !== userId || notice.tripId !== parseUuid(tripId)) return;
    setAnnouncement({
      parts: ["Created trip ", namePart(notice.name), "."],
      seq: ++messageSeq.current,
      scope,
    });
    focusTripHeadingWhenReady.current = true;
    // Runs per history entry; the values read are those of that entry.
  }, [location.key]);

  // After a creation, the trip heading takes focus once the trip has loaded —
  // only if focus was lost in the navigation (never taken from a control).
  const tripReady = state.status === "ready";
  useLayoutEffect(() => {
    if (!focusTripHeadingWhenReady.current) return;
    if (state.status === "loading" || state.status === "idle") return;
    focusTripHeadingWhenReady.current = false;
    if (!tripReady) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    tripHeadingRef.current?.focus();
  }, [state.status, tripReady]);

  // The Sharing section disappears (sharing switched off on the server, or the
  // trip is no longer ready) while focus was inside it: if focus is now lost,
  // it goes to the Stops heading, else the trip heading. Focus the user moved
  // elsewhere is never taken. `focusin` only, as for the nearby panel.
  const sharingVisible = authenticated && state.status === "ready" && state.trip.sharing_enabled;
  const wasSharingVisible = useRef(false);
  useLayoutEffect(() => {
    const was = wasSharingVisible.current;
    wasSharingVisible.current = sharingVisible;
    if (!was || sharingVisible) return;
    const hadFocus = sharingFocusWithin.current;
    sharingFocusWithin.current = false;
    if (!hadFocus) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    (stopsHeadingRef.current ?? tripHeadingRef.current)?.focus();
  }, [sharingVisible]);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const section = document.getElementById(SHARING_SECTION_ID);
      sharingFocusWithin.current =
        section !== null && event.target instanceof Node && section.contains(event.target);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  // A different user or trip (or an unconfirmed session) drops the rename draft
  // and the delete confirmation at once.
  useEffect(() => {
    setRenameDraft(null);
    setConfirmScope(null);
  }, [scope]);

  // The confirmation is closed whenever the trip is not ready (loading, stale,
  // gone), so it never stands over an unverified trip.
  useEffect(() => {
    if (state.status !== "ready") setConfirmScope(null);
  }, [state.status]);

  const setButtonRef = useCallback(
    (stopId: string, kind: ButtonKind) => (node: HTMLButtonElement | null) => {
      const key = `${kind}:${stopId}`;
      if (node) buttons.current.set(key, node);
      else buttons.current.delete(key);
    },
    [],
  );

  // Declared BEFORE the trip focus effect: when a change closes the panel in
  // the same render as a trip focus plan, focus that was inside the panel is
  // placed first, so the plan (which only acts on lost focus) leaves it.
  // The panel closed (explicitly or because of a change): if focus was inside
  // it — and is now lost — return it to the stop's "Find nearby" button, else
  // the Stops heading. Focus the user moved elsewhere is never taken.
  useLayoutEffect(() => {
    const was = wasPanelOpen.current;
    wasPanelOpen.current = panelOpen;
    if (!was || panelOpen) return;
    const hadFocus = nearbyFocusWithin.current;
    nearbyFocusWithin.current = false;
    if (!hadFocus) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body) return;
    const stopId = lastNearbyStop.current;
    const button = stopId === null ? undefined : enabledButton(stopId, "nearby");
    (button ?? stopsHeadingRef.current)?.focus();
  }, [panelOpen]);

  // Focus is moved after the state produced by a change has rendered (the
  // request counter is bumped after the hook's own updates), and only when
  // focus has not moved somewhere else deliberately in the meantime.
  useLayoutEffect(() => {
    const request = focusPlan.current;
    focusPlan.current = null;
    if (request === null) return;
    const active = document.activeElement;
    const focusLostOrKept =
      active === null || active === document.body || active === request.origin;
    if (!focusLostOrKept) return;
    const target = focusTarget(request.plan);
    target?.focus();
  }, [focusRequest]);

  // Explicit "Find nearby": focus the panel heading once it has rendered,
  // unless focus has deliberately moved elsewhere meanwhile.
  useLayoutEffect(() => {
    const origin = nearbyOpenFocus.current;
    nearbyOpenFocus.current = null;
    if (origin === null) return;
    const active = document.activeElement;
    if (active !== null && active !== document.body && active !== origin) return;
    nearbyHeadingRef.current?.focus();
  }, [nearbyOpenRequest]);

  // Where keyboard focus is, relative to the nearby panel. `focusin` only
  // (never blur): removing the panel with focus inside must still count as
  // "focus was in the panel" when the close is handled.
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      const panelElement = document.getElementById(NEARBY_PANEL_ID);
      nearbyFocusWithin.current =
        panelElement !== null &&
        event.target instanceof Node &&
        panelElement.contains(event.target);
    };
    document.addEventListener("focusin", onFocusIn);
    return () => document.removeEventListener("focusin", onFocusIn);
  }, []);

  function handleFindNearby(stop: TripStop, origin: HTMLElement) {
    if (!nearby.open(stop.id)) return;
    setNearbyNotice(null);
    nearbyOpenFocus.current = origin;
    setNearbyOpenRequest((n) => n + 1);
  }

  function enabledButton(stopId: string, kind: ButtonKind): HTMLButtonElement | undefined {
    const button = buttons.current.get(`${kind}:${stopId}`);
    return button && !button.disabled ? button : undefined;
  }

  function focusTarget(plan: FocusPlan): HTMLElement | null {
    const heading = stopsHeadingRef.current;
    switch (plan.kind) {
      case "afterRemove": {
        const index = plan.orderBefore.indexOf(plan.removedId);
        const next = plan.orderBefore.slice(index + 1);
        const previous = plan.orderBefore.slice(0, Math.max(index, 0)).reverse();
        for (const id of [...next, ...previous]) {
          const button = enabledButton(id, "remove");
          if (button) return button;
        }
        return heading;
      }
      case "afterMove": {
        const same = enabledButton(plan.stopId, plan.direction);
        const other = enabledButton(plan.stopId, plan.direction === "up" ? "down" : "up");
        return same ?? other ?? heading;
      }
      case "afterAdd": {
        // The row's Add control if it is still offered (a failure), else the
        // row's profile link (now a member), else the panel, else Stops.
        const panelElement = document.getElementById(NEARBY_PANEL_ID);
        const escaped = CSS.escape(plan.landmarkId);
        const add = panelElement?.querySelector<HTMLElement>(`[data-nearby-add="${escaped}"]`);
        const link = panelElement?.querySelector<HTMLElement>(`[data-nearby-link="${escaped}"]`);
        return add ?? link ?? nearbyHeadingRef.current ?? heading;
      }
      case "reload":
        return reloadButtonRef.current ?? heading;
      case "renameInput":
        return renameInputRef.current ?? renameButtonRef.current ?? heading;
      case "renameButton":
        return renameButtonRef.current ?? heading;
      case "deleteButton":
        return deleteButtonRef.current ?? heading;
      case "deleteText":
        return deleteTextRef.current ?? deleteButtonRef.current ?? heading;
      case "copyButton":
        return shareCopyRef.current ?? sharingHeadingRef.current ?? heading;
      case "shareCreate":
        return shareCreateRef.current ?? sharingHeadingRef.current ?? heading;
      case "sharingHeading":
        return sharingHeadingRef.current ?? heading;
      default:
        return heading;
    }
  }

  function report(outcome: MutationOutcome) {
    const message = outcomeMessage(outcome);
    if (message.status !== undefined) {
      setAnnouncement({ parts: message.status, seq: ++messageSeq.current, scope });
    }
    if (message.alert !== undefined) {
      setAlert({ parts: [message.alert], seq: ++messageSeq.current, scope });
    }
  }

  function planFocus(plan: FocusPlan | null, origin: HTMLElement) {
    if (plan === null) return;
    focusPlan.current = { plan, origin };
    setFocusRequest((n) => n + 1);
  }

  function focusPlanFor(outcome: MutationOutcome, base: FocusPlan): FocusPlan | null {
    switch (outcome.kind) {
      case "removed":
      case "already_removed":
      case "moved":
      case "added":
      case "add_conflict":
      case "add_unavailable":
      case "add_uncertain_refreshed":
        return base;
      case "conflict_refreshed":
      case "uncertain_refreshed":
        return { kind: "heading" };
      case "refresh_failed":
        return { kind: "reload" };
      default:
        return null; // rejected: focus stays; ignored/discarded/not_found/unauthenticated: nothing
    }
  }

  async function handleRemove(stop: TripStop, origin: HTMLElement, orderBefore: string[]) {
    if (busy) return;
    setAlert(null);
    setAnnouncement(null);
    setNearbyNotice(null);
    const outcome = await removeStop(stop.id);
    if (outcome.kind === "ignored" || outcome.kind === "discarded") return;
    report(outcome);
    planFocus(
      focusPlanFor(outcome, { kind: "afterRemove", removedId: stop.id, orderBefore }),
      origin,
    );
  }

  async function handleMove(stop: TripStop, direction: MoveDirection, origin: HTMLElement) {
    if (busy) return;
    setAlert(null);
    setAnnouncement(null);
    setNearbyNotice(null);
    const outcome = await moveStop(stop.id, direction);
    if (outcome.kind === "ignored" || outcome.kind === "discarded") return;
    report(outcome);
    planFocus(focusPlanFor(outcome, { kind: "afterMove", stopId: stop.id, direction }), origin);
  }

  async function handleAdd(landmark: NearbyLandmarkView, origin: HTMLElement) {
    if (busy) return;
    setAlert(null);
    setAnnouncement(null);
    setNearbyNotice(null);
    const outcome = await addStop(landmark.id, landmark.display_name);
    if (outcome.kind === "ignored" || outcome.kind === "discarded") return;
    report(outcome);
    planFocus(focusPlanFor(outcome, { kind: "afterAdd", landmarkId: landmark.id }), origin);
  }

  // ---- Rename (Increment 3) ----

  const currentDraft = renameDraft !== null && renameDraft.scope === scope ? renameDraft : null;
  const confirmOpen = confirmScope !== null && confirmScope === scope;

  function openRename(origin: HTMLElement) {
    if (trip === null) return;
    setConfirmScope(null);
    setRenameDraft({ scope, value: trip.name, error: null, note: null });
    planFocus({ kind: "renameInput" }, origin);
  }

  function cancelRename(origin: HTMLElement) {
    setRenameDraft(null);
    planFocus({ kind: "renameButton" }, origin);
  }

  /** Updates the draft only while it still belongs to `draftScope`. */
  function updateDraft(draftScope: string, change: Partial<RenameDraft> | null) {
    setRenameDraft((d) => {
      if (d === null || d.scope !== draftScope) return d;
      return change === null ? null : { ...d, ...change };
    });
  }

  async function submitRename() {
    const draft = currentDraft;
    if (draft === null || trip === null) return;
    const origin = renameSaveRef.current ?? document.body;
    const checked = validateTripName(draft.value);
    if (!checked.ok) {
      updateDraft(draft.scope, { error: checked.message });
      renameInputRef.current?.focus();
      return;
    }
    setAlert(null);
    setAnnouncement(null);
    setNearbyNotice(null);
    const outcome = await renameTrip(checked.value);
    switch (outcome.kind) {
      case "ignored":
      case "discarded":
        return;
      case "renamed":
        updateDraft(draft.scope, null);
        report(outcome);
        planFocus({ kind: "renameButton" }, origin);
        return;
      case "rename_invalid":
        updateDraft(draft.scope, { error: outcome.message, note: null });
        planFocus({ kind: "renameInput" }, origin);
        return;
      case "rename_conflict":
        // The latest trip is shown; the draft is kept for review and an explicit Save.
        updateDraft(draft.scope, { error: null, note: RENAME_CONFLICT_TEXT });
        report(outcome);
        planFocus({ kind: "renameInput" }, origin);
        return;
      case "rename_uncertain_refreshed":
        if (outcome.hasName) {
          updateDraft(draft.scope, null);
          report(outcome);
          planFocus({ kind: "renameButton" }, origin);
        } else {
          updateDraft(draft.scope, { error: null, note: null });
          report(outcome);
          planFocus({ kind: "renameInput" }, origin);
        }
        return;
      case "refresh_failed":
        planFocus({ kind: "reload" }, origin);
        return;
      default:
        report(outcome); // rejected: an alert; the draft stays. not_found / unauthenticated: nothing.
    }
  }

  // ---- Delete (Increment 3) ----

  function openDelete(origin: HTMLElement) {
    if (trip === null) return;
    setRenameDraft(null);
    setConfirmScope(scope);
    planFocus({ kind: "deleteText" }, origin);
  }

  function cancelDelete(origin: HTMLElement) {
    setConfirmScope(null);
    planFocus({ kind: "deleteButton" }, origin);
  }

  async function confirmDelete(origin: HTMLElement) {
    if (!confirmOpen || trip === null || userId === null) return;
    const startScope = scope;
    const confirmedUser = userId;
    setAlert(null);
    setAnnouncement(null);
    setNearbyNotice(null);
    const outcome = await deleteTrip();
    if (outcome.kind === "ignored" || outcome.kind === "discarded") return;
    // Leaving the page only for the same user and trip, while still here.
    const current = () => mounted.current && scopeRef.current === startScope;
    switch (outcome.kind) {
      case "deleted":
        if (!current()) return;
        navigate(TRIPS_PATH, {
          state: tripsListState({
            kind: "trip-deleted",
            userId: confirmedUser,
            name: outcome.name,
          }),
        });
        return;
      case "delete_unavailable":
      case "delete_uncertain_gone":
        if (!current()) return;
        navigate(TRIPS_PATH, {
          state: tripsListState({
            kind: "trip-unavailable",
            userId: confirmedUser,
            uncertain: outcome.kind === "delete_uncertain_gone",
          }),
        });
        return;
      case "delete_uncertain_exists":
        setConfirmScope(null);
        report(outcome);
        planFocus({ kind: "heading" }, origin);
        return;
      case "refresh_failed":
        planFocus({ kind: "reload" }, origin);
        return;
      default:
        report(outcome); // rejected: an alert; the confirmation stays open.
    }
  }

  // ---- Sharing (Increment 4) ----

  function sharingFocusPlan(outcome: MutationOutcome): FocusPlan | null {
    switch (outcome.kind) {
      case "share_created":
        return { kind: "copyButton" };
      case "sharing_revoked":
        return { kind: "shareCreate" };
      case "share_unconfirmed":
      case "share_uncertain":
      case "sharing_unavailable":
      case "revoke_superseded":
      case "revoke_uncertain":
        return { kind: "sharingHeading" };
      case "refresh_failed":
        return { kind: "reload" };
      default:
        return null; // rejected: focus stays; ignored/discarded/not_found/unauthenticated: nothing
    }
  }

  async function handleShare(origin: HTMLElement) {
    setAlert(null);
    setAnnouncement(null);
    setNearbyNotice(null);
    const outcome = await enableSharing();
    if (outcome.kind === "ignored" || outcome.kind === "discarded") return;
    report(outcome);
    planFocus(sharingFocusPlan(outcome), origin);
  }

  async function handleUnshare(origin: HTMLElement) {
    setAlert(null);
    setAnnouncement(null);
    setNearbyNotice(null);
    const outcome = await revokeSharing();
    if (outcome.kind === "ignored" || outcome.kind === "discarded") return;
    report(outcome);
    planFocus(sharingFocusPlan(outcome), origin);
  }

  /**
   * Copy link: the clipboard is written only on this explicit activation, and
   * only with the currently held (confirmed) link. Success is reported only
   * after `writeText` resolves. On failure, or without the Clipboard API, the
   * link field's text is selected for manual copying — only if focus is still
   * on Copy link (or was lost). Any result is dropped when the page, user,
   * trip, or held link has changed meanwhile. The link itself is never
   * announced or logged.
   */
  async function handleCopy(origin: HTMLElement) {
    const link = shareLink;
    if (link === null) return;
    const startScope = scope;
    let copied = false;
    try {
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (clipboard !== undefined && typeof clipboard.writeText === "function") {
        await clipboard.writeText(link);
        copied = true;
      }
    } catch {
      copied = false;
    }
    if (!mounted.current || scopeRef.current !== startScope || !isShareLinkCurrent(link)) return;
    setAlert(null);
    setAnnouncement(null);
    if (copied) {
      setAnnouncement({ parts: ["Share link copied."], seq: ++messageSeq.current, scope });
      return;
    }
    const active = document.activeElement;
    const field = shareFieldRef.current;
    const mayMoveFocus = active === null || active === document.body || active === origin;
    if (field !== null && mayMoveFocus) {
      field.focus();
      field.select();
    }
    setAlert({
      parts: [
        field !== null && mayMoveFocus
          ? "Couldn't copy the link automatically. The link is selected in the Share link field — copy it with your keyboard or your browser's Copy command."
          : "Couldn't copy the link automatically. Select the link in the Share link field and copy it with your keyboard or your browser's Copy command.",
      ],
      seq: ++messageSeq.current,
      scope,
    });
  }

  function controlsFor(stops: readonly TripStop[]) {
    const order = stops.map((s) => s.id);
    return (stop: TripStop, index: number): TripStopControls => ({
      isFirst: index === 0,
      isLast: index === stops.length - 1,
      busy,
      onMove: (direction, origin) => void handleMove(stop, direction, origin),
      onRemove: (origin) => void handleRemove(stop, origin, order),
      setButtonRef: (kind) => setButtonRef(stop.id, kind),
      nearby: {
        onFind: (origin) => handleFindNearby(stop, origin),
        isOpen: panelOpen && nearby.origin?.stopId === stop.id,
        panelId: NEARBY_PANEL_ID,
      },
    });
  }

  // ---- Status region (exactly one) ----
  let statusParts: MessagePart[] = [];
  let statusKey = 0;
  if (session.status === "loading") {
    statusParts = ["Checking whether you're signed in…"];
  } else if (authenticated && (state.status === "loading" || state.status === "idle")) {
    statusParts = ["Loading trip…"];
  } else if (authenticated && pending !== null) {
    statusParts = [
      pending === "remove"
        ? "Removing stop…"
        : pending === "move"
          ? "Moving stop…"
          : pending === "add"
            ? "Adding stop…"
            : pending === "rename"
              ? "Renaming trip…"
              : pending === "delete"
                ? "Deleting trip…"
                : pending === "share"
                  ? "Creating share link…"
                  : pending === "unshare"
                    ? "Turning off sharing…"
                    : "Updating the trip…",
    ];
  } else if (authenticated) {
    const current = announcement !== null && announcement.scope === scope ? announcement : null;
    const notice = nearbyNotice !== null && nearbyNotice.scope === scope ? nearbyNotice : null;
    if (current !== null) {
      statusParts = current.parts;
      statusKey = current.seq;
    }
    if (notice !== null) {
      statusParts = statusParts.length > 0 ? [...statusParts, " ", ...notice.parts] : notice.parts;
      statusKey = Math.max(statusKey, notice.seq);
    }
  }

  // ---- Alert (at most one) ----
  let alertView: ReactNode = null;
  if (authenticated) {
    if (state.status === "error") {
      alertView = (
        <div role="alert" className={styles.alert}>
          <p>{loadFailureText(state.failure)}</p>
          <button type="button" className={styles.button} onClick={retry}>
            Try again
          </button>
        </div>
      );
    } else if (state.status === "stale") {
      alertView = (
        <div role="alert" className={styles.alert}>
          <p>{staleText(state.reason, state.failure)}</p>
          <button ref={reloadButtonRef} type="button" className={styles.button} onClick={retry}>
            Reload trip
          </button>
        </div>
      );
    } else if (state.status === "ready" && alert !== null && alert.scope === scope) {
      alertView = (
        <div role="alert" className={styles.alert} key={alert.seq}>
          <p>
            <MessageText parts={alert.parts} />
          </p>
        </div>
      );
    }
  }

  return (
    <section aria-labelledby={HEADING_ID} className={styles.page}>
      <h2 id={HEADING_ID} ref={tripHeadingRef} tabIndex={-1} className={styles.heading}>
        {trip === null ? "Trip" : <bdi>{trip.name}</bdi>}
      </h2>
      <p role="status" className={styles.status}>
        {statusParts.length > 0 ? (
          <span key={statusKey}>
            <MessageText parts={statusParts} />
          </span>
        ) : null}
      </p>
      {alertView}
      {renderBody()}
    </section>
  );

  function renderBody() {
    switch (session.status) {
      case "loading":
        return null;
      case "unavailable":
        return (
          <p>
            We couldn&apos;t check whether you&apos;re signed in, so this trip can&apos;t be shown
            right now. Use Retry in the account area to check again.
          </p>
        );
      case "anonymous":
        return (
          <p>
            <Link to={tripSignInHref(tripId ?? "")}>Sign in to see this trip</Link>
          </p>
        );
      default:
        break;
    }

    if (state.status === "not_found") {
      return (
        <div className={styles.notFound}>
          <p>
            This trip couldn&apos;t be found. It may have been deleted, or the link may be wrong.
          </p>
          <p>
            <Link to="/">Discover landmarks</Link>
          </p>
        </div>
      );
    }
    if (state.status !== "ready") return null;
    const busyFlag = busy ? true : undefined;
    return (
      <>
        <div className={manageStyles.toolbar}>
          {currentDraft === null ? (
            <button
              ref={renameButtonRef}
              type="button"
              className={manageStyles.button}
              aria-disabled={busyFlag}
              onClick={(event) => openRename(event.currentTarget)}
            >
              Rename
            </button>
          ) : null}
          {confirmOpen ? null : (
            <button
              ref={deleteButtonRef}
              type="button"
              className={`${manageStyles.button} ${manageStyles.danger}`}
              aria-disabled={busyFlag}
              onClick={(event) => openDelete(event.currentTarget)}
            >
              Delete trip
            </button>
          )}
        </div>
        {currentDraft !== null ? (
          <RenameTripForm
            value={currentDraft.value}
            error={currentDraft.error}
            note={currentDraft.note}
            busy={busy}
            inputRef={renameInputRef}
            saveRef={renameSaveRef}
            onChange={(value) => updateDraft(currentDraft.scope, { value })}
            onSubmit={() => void submitRename()}
            onCancel={() => cancelRename(document.activeElement as HTMLElement)}
          />
        ) : null}
        {confirmOpen ? (
          <DeleteTripConfirm
            tripName={state.trip.name}
            busy={busy}
            textRef={deleteTextRef}
            onConfirm={(origin) => void confirmDelete(origin)}
            onCancel={() => cancelDelete(document.activeElement as HTMLElement)}
          />
        ) : null}
        <TripStopList
          stops={state.trip.stops}
          headingRef={stopsHeadingRef}
          controlsFor={controlsFor(state.trip.stops)}
          busy={busy}
        />
        <TripDistanceSummary summary={state.trip.distance_summary} />
        <NearbyPanel
          nearby={nearby}
          headingRef={nearbyHeadingRef}
          onClose={nearby.close}
          adding={{
            busy,
            tripFull: state.trip.stops.length >= MAX_TRIP_STOPS,
            maxStops: MAX_TRIP_STOPS,
            onAdd: (landmark, origin) => void handleAdd(landmark, origin),
          }}
        />
        {/* Keyed by trip: another trip never inherits this map's markers or viewport. */}
        <TripStopsMap
          key={state.trip.id}
          stops={state.trip.stops}
          onFocusLost={() => stopsHeadingRef.current?.focus()}
        />
        {/* Only when the server reports sharing enabled (spec §§5.4, 8; §9 #28). */}
        {sharingVisible ? (
          <TripSharingPanel
            isShared={state.trip.is_shared}
            link={shareLink}
            busy={busy}
            headingRef={sharingHeadingRef}
            fieldRef={shareFieldRef}
            copyRef={shareCopyRef}
            createRef={shareCreateRef}
            revokeRef={shareRevokeRef}
            onCreate={(origin) => void handleShare(origin)}
            onRevoke={(origin) => void handleUnshare(origin)}
            onCopy={(origin) => void handleCopy(origin)}
          />
        ) : null}
      </>
    );
  }
}
