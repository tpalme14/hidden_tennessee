import { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { ApiError } from "../api/client";
import {
  REVIEW_ALREADY_EXISTS,
  createReview,
  deleteReview,
  updateReview,
  type Review,
} from "../api/reviews";
import { useAuth } from "../auth/session";
import { ErrorState } from "../components/ErrorState";
import { LoadingState } from "../components/LoadingState";
import { ReviewItem } from "./ReviewItem";
import { EMPTY_DRAFT, ReviewForm, hasDraftContent, type ReviewDraft } from "./ReviewForm";
import styles from "./ReviewsSection.module.css";
import type { OwnReview } from "./useOwnReview";
import {
  REVIEW_MESSAGES,
  validateReviewPatch,
  type ReviewDraftValue,
  type ReviewPatchValue,
} from "./validation";

/**
 * The signed-in user's own review (M04-T03 Increments 3–4; spec v1.1 §§3,
 * 4.1–4.3, 5, 8; decisions Q1, Q3, Q6).
 *
 * - Anonymous: a sign-in link back to this page (the `returnTo` convention).
 * - Session unavailable: says so, with the session's own "Try again".
 * - Signed in, no review: the review form (create).
 * - Signed in, with a review: "Your review" with Edit and Delete — the ONLY
 *   place ownership controls appear (never in the public list).
 *
 * Every draft (new review or edit) lives here, in memory only (Q6), and
 * survives every failure; nothing is shown as saved, posted, or deleted until
 * the server confirms, and nothing is removed optimistically. After each
 * confirmed change the own review and the public list are refreshed.
 *
 * Create (Increment 3): see the outcomes below; a 409 shows the existing
 * review and keeps the unsent text, which the user may deliberately carry
 * into an edit ("Edit using the text you hadn't posted").
 *
 * Edit (Increment 4): prefilled from the review (or from the unsent text);
 * Cancel changes nothing on the server and returns focus to Edit. Only
 * CHANGED fields are sent: an unchanged body is omitted, and emptying the
 * text sends `body: null` (spec §4.2). With nothing changed, nothing is sent.
 *
 * Delete (Increment 4; Q1 inline confirmation): Delete opens an in-page
 * confirmation that receives focus; Cancel returns focus to Delete; "Delete
 * review" sends the request; on success, focus moves to the Reviews heading
 * and the deletion is announced.
 *
 * Failures: 400 → the server's fixed message; 401 → the session is re-checked
 * and the draft kept; 404 → the review or landmark is no longer available
 * (no detail is shown; an edit's text is kept as a new-review draft); 409 →
 * as above; 429 → the wait time when known; 5xx / network / malformed → a
 * generic retry message. A result that arrives after a DIFFERENT account
 * signed in is ignored, and switching accounts clears every draft, message,
 * and mode (nothing is ever shown to another person).
 */

export const POSTED_ANNOUNCEMENT = "Your review was posted.";
export const UPDATED_ANNOUNCEMENT = "Your review was updated.";
export const DELETED_ANNOUNCEMENT = "Your review was deleted.";
export const SESSION_ENDED_MESSAGE =
  "Your session has ended. Sign in again to post your review — your text is kept on this page until you leave it.";
export const SESSION_ENDED_EDIT_MESSAGE =
  "Your session has ended. Sign in again to save your changes — they are kept on this page until you leave it.";
export const SESSION_ENDED_DELETE_MESSAGE =
  "Your session has ended. Sign in again to delete your review.";
export const CONFLICT_MESSAGE =
  "You've already reviewed this landmark. Your existing review is shown below, and the text you hadn't posted is kept here.";
export const LANDMARK_GONE_MESSAGE = "This landmark can no longer be reviewed.";
export const REVIEW_GONE_MESSAGE =
  "This review can no longer be changed. Any text you were editing is kept in the form.";
export const ALREADY_DELETED_MESSAGE =
  "This review has already been deleted or can no longer be changed.";
export const POST_FAILED_MESSAGE = "Your review couldn't be posted. Please try again.";
export const SAVE_FAILED_MESSAGE = "Your changes couldn't be saved. Please try again.";
export const DELETE_FAILED_MESSAGE = "Your review couldn't be deleted. Please try again.";
export const SESSION_UNKNOWN_MESSAGE = "We couldn't confirm whether you're signed in.";
export const DELETE_CONFIRM_PROMPT = "Delete your review? This can't be undone.";

function rateLimitText(error: ApiError): string {
  const seconds = error.retryAfterSeconds;
  return seconds === undefined
    ? "Too many requests. Please wait a moment and try again."
    : `Too many requests. Please try again in ${seconds} second${seconds === 1 ? "" : "s"}.`;
}

/** Only the fields that differ from the stored review (an unchanged body is omitted). */
export function changedFields(review: Review, value: ReviewDraftValue): ReviewPatchValue {
  const patch: ReviewPatchValue = {};
  if (value.rating !== review.rating) patch.rating = value.rating;
  if (value.body !== review.body) patch.body = value.body;
  return patch;
}

type Mode = "view" | "edit" | "confirm-delete";
type FocusTarget = "own-heading" | "edit-button" | "delete-button" | "confirm" | null;

export interface OwnReviewPanelProps {
  landmarkId: string;
  own: OwnReview;
  /** Refreshes the public list and aggregate — called after a confirmed change or a conflict. */
  onReviewsChanged: () => void;
  /** Moves focus to the section's "Reviews" heading (after a deletion). */
  focusReviewsHeading: () => void;
}

export function OwnReviewPanel({
  landmarkId,
  own,
  onReviewsChanged,
  focusReviewsHeading,
}: OwnReviewPanelProps) {
  const { session, refresh } = useAuth();
  const location = useLocation();
  const userId = session.status === "authenticated" ? session.user.id : null;

  // New-review draft (also the unsent text after a 409).
  const [draft, setDraft] = useState<ReviewDraft>(EMPTY_DRAFT);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);
  // Edit and delete.
  const [mode, setMode] = useState<Mode>("view");
  const [editDraft, setEditDraft] = useState<ReviewDraft | null>(null);
  const [editFromConflict, setEditFromConflict] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  // Panel-wide feedback.
  const [notice, setNotice] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusTarget, setFocusTarget] = useState<FocusTarget>(null);

  const ownHeadingRef = useRef<HTMLHeadingElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLParagraphElement>(null);
  const ownHeadingId = useId();
  const confirmId = useId();
  const conflictDraftId = useId();
  const unsavedId = useId();

  // The last signed-in account on this page; a different one clears everything.
  const lastUserId = useRef<string | null>(userId);
  const currentUserId = useRef<string | null>(userId);
  currentUserId.current = userId;
  useEffect(() => {
    if (userId === null) return;
    if (lastUserId.current !== null && lastUserId.current !== userId) {
      setDraft(EMPTY_DRAFT);
      setServerError(null);
      setConflict(false);
      setMode("view");
      setEditDraft(null);
      setEditFromConflict(false);
      setEditError(null);
      setDeleteError(null);
      setNotice(null);
      setAnnouncement("");
      setFocusTarget(null);
    }
    lastUserId.current = userId;
  }, [userId]);

  // Signing out (or a session that has ended) clears a previous success
  // announcement — "Your review was posted." no longer describes what is on
  // screen. Drafts and error messages are kept (Q6; Increment 6 fix).
  const anonymous = session.status === "anonymous";
  useEffect(() => {
    if (anonymous) setAnnouncement("");
  }, [anonymous]);

  // Moves focus once its target is on screen (some targets appear only after a reload).
  useEffect(() => {
    if (focusTarget === null) return;
    const element =
      focusTarget === "own-heading"
        ? ownHeadingRef.current
        : focusTarget === "edit-button"
          ? editButtonRef.current
          : focusTarget === "delete-button"
            ? deleteButtonRef.current
            : confirmRef.current;
    if (element) {
      element.focus();
      setFocusTarget(null);
    }
  }, [focusTarget, mode, own.state.kind]);

  /** Starts a new action: clears the previous action's messages. */
  function beginAction() {
    setAnnouncement("");
    setNotice(null);
  }

  // ---------------------------------------------------------------- create

  async function submit(value: ReviewDraftValue) {
    if (submitting) return;
    const startedFor = currentUserId.current;
    beginAction();
    setSubmitting(true);
    setServerError(null);
    try {
      await createReview(landmarkId, value);
      if (currentUserId.current !== startedFor) return; // another account now: say nothing
      setDraft(EMPTY_DRAFT);
      setConflict(false);
      setAnnouncement(POSTED_ANNOUNCEMENT);
      setFocusTarget("own-heading");
      own.reload();
      onReviewsChanged();
    } catch (error) {
      if (currentUserId.current !== startedFor) return;
      if (!(error instanceof ApiError)) {
        setServerError(POST_FAILED_MESSAGE);
      } else if (error.status === 401) {
        setServerError(SESSION_ENDED_MESSAGE);
        void refresh();
      } else if (error.status === 409 && error.code === REVIEW_ALREADY_EXISTS) {
        setConflict(true);
        own.reload();
        onReviewsChanged();
      } else if (error.status === 404) {
        setServerError(LANDMARK_GONE_MESSAGE);
        onReviewsChanged();
      } else if (error.status === 429) {
        setServerError(rateLimitText(error));
      } else if (error.status === 400) {
        setServerError(error.message);
      } else {
        setServerError(POST_FAILED_MESSAGE);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // ------------------------------------------------------------------ edit

  function startEdit(review: Review, fromConflict: boolean) {
    beginAction();
    setEditError(null);
    setEditFromConflict(fromConflict);
    setEditDraft(
      fromConflict
        ? { rating: draft.rating ?? review.rating, text: draft.text }
        : { rating: review.rating, text: review.body ?? "" },
    );
    setMode("edit");
  }

  function cancelEdit() {
    setMode("view");
    setEditDraft(null);
    setEditError(null);
    setEditFromConflict(false);
    setFocusTarget("edit-button");
  }

  async function saveEdit(review: Review, value: ReviewDraftValue) {
    if (saving) return;
    const patch = changedFields(review, value);
    const checked = validateReviewPatch(patch);
    if (!checked.ok) {
      setEditError(checked.errors.form ?? REVIEW_MESSAGES.nothingToUpdate);
      return;
    }
    const startedFor = currentUserId.current;
    const draftAtStart = editDraft;
    beginAction();
    setSaving(true);
    setEditError(null);
    try {
      await updateReview(review.id, checked.value);
      if (currentUserId.current !== startedFor) return;
      if (editFromConflict) {
        setDraft(EMPTY_DRAFT);
        setConflict(false);
      }
      setMode("view");
      setEditDraft(null);
      setEditFromConflict(false);
      setAnnouncement(UPDATED_ANNOUNCEMENT);
      setFocusTarget("own-heading");
      // Silent: "Your review" stays mounted (and focused) until the updated review arrives.
      own.reload({ silent: true });
      onReviewsChanged();
    } catch (error) {
      if (currentUserId.current !== startedFor) return;
      if (!(error instanceof ApiError)) {
        setEditError(SAVE_FAILED_MESSAGE);
      } else if (error.status === 401) {
        setEditError(SESSION_ENDED_EDIT_MESSAGE);
        void refresh();
      } else if (error.status === 404) {
        // Missing, no longer the user's, or the landmark is no longer public:
        // never say which. The edit's text becomes a new-review draft.
        if (draftAtStart) setDraft(draftAtStart);
        setConflict(false);
        setMode("view");
        setEditDraft(null);
        setEditFromConflict(false);
        setNotice(REVIEW_GONE_MESSAGE);
        own.reload();
        onReviewsChanged();
      } else if (error.status === 429) {
        setEditError(rateLimitText(error));
      } else if (error.status === 400) {
        setEditError(error.message);
      } else {
        setEditError(SAVE_FAILED_MESSAGE);
      }
    } finally {
      setSaving(false);
    }
  }

  // ---------------------------------------------------------------- delete

  function startDelete() {
    beginAction();
    setDeleteError(null);
    setMode("confirm-delete");
    setFocusTarget("confirm");
  }

  function cancelDelete() {
    setMode("view");
    setDeleteError(null);
    setFocusTarget("delete-button");
  }

  async function confirmDelete(review: Review) {
    if (deleting) return;
    const startedFor = currentUserId.current;
    beginAction();
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteReview(review.id);
      if (currentUserId.current !== startedFor) return;
      setMode("view");
      setConflict(false);
      setAnnouncement(DELETED_ANNOUNCEMENT);
      focusReviewsHeading();
      own.reload();
      onReviewsChanged();
    } catch (error) {
      if (currentUserId.current !== startedFor) return;
      if (error instanceof ApiError && error.status === 404) {
        setMode("view");
        setNotice(ALREADY_DELETED_MESSAGE);
        focusReviewsHeading();
        own.reload();
        onReviewsChanged();
      } else if (error instanceof ApiError && error.status === 401) {
        setDeleteError(SESSION_ENDED_DELETE_MESSAGE);
        void refresh();
      } else if (error instanceof ApiError && error.status === 429) {
        setDeleteError(rateLimitText(error));
      } else {
        setDeleteError(DELETE_FAILED_MESSAGE);
      }
    } finally {
      setDeleting(false);
    }
  }

  // ---------------------------------------------------------------- render

  const returnTo = `${location.pathname}${location.search}`;
  const signInLink = (
    <Link to={`/sign-in?returnTo=${encodeURIComponent(returnTo)}`}>Sign in to write a review</Link>
  );

  const createForm = (
    <ReviewForm
      heading="Write a review"
      submitLabel="Post review"
      submittingLabel="Posting…"
      draft={draft}
      onDraftChange={(next) => {
        setDraft(next);
        if (announcement !== "") setAnnouncement("");
      }}
      onSubmit={(value) => void submit(value)}
      submitting={submitting}
      serverError={serverError}
    />
  );

  /** Unsaved edit text shown read-only while signed out (after a 401 during an edit). */
  const unsavedEdit =
    mode === "edit" && editDraft !== null && editDraft.text.trim() !== "" ? (
      <p className={styles.unsent}>
        <label htmlFor={unsavedId}>Your unsaved changes</label>
        <textarea id={unsavedId} readOnly rows={4} value={editDraft.text} />
      </p>
    ) : null;

  let body;
  switch (own.state.kind) {
    case "checking":
      body = <LoadingState label="Checking for your review…" />;
      break;
    case "session-unavailable":
      body = (
        <div role="alert">
          <p>{SESSION_UNKNOWN_MESSAGE}</p>
          {session.status === "unavailable" ? (
            <button type="button" onClick={() => void session.retry()}>
              Try again
            </button>
          ) : null}
        </div>
      );
      break;
    case "signed-out":
      // After a 401 every draft stays on screen with the sign-in link.
      body = (
        <>
          <p>{signInLink}</p>
          {unsavedEdit}
          {hasDraftContent(draft) ? createForm : null}
        </>
      );
      break;
    case "none":
      body = createForm;
      break;
    case "found": {
      const review = own.state.review;
      body = (
        <div className={styles.own}>
          <h4 id={ownHeadingId} ref={ownHeadingRef} tabIndex={-1}>
            Your review
          </h4>
          {mode === "edit" && editDraft !== null ? (
            <ReviewForm
              heading="Edit your review"
              submitLabel="Save changes"
              submittingLabel="Saving…"
              draft={editDraft}
              onDraftChange={setEditDraft}
              onSubmit={(value) => void saveEdit(review, value)}
              submitting={saving}
              serverError={editError}
              onCancel={cancelEdit}
              focusHeadingOnMount
            />
          ) : (
            <>
              <ReviewItem review={review} authorLabel="You" />
              {mode === "confirm-delete" ? (
                <div role="group" aria-labelledby={confirmId} className={styles.confirm}>
                  <p id={confirmId} ref={confirmRef} tabIndex={-1}>
                    {DELETE_CONFIRM_PROMPT}
                  </p>
                  {deleteError !== null ? <p role="alert">{deleteError}</p> : null}
                  <p>
                    <button
                      type="button"
                      aria-disabled={deleting ? true : undefined}
                      aria-busy={deleting ? true : undefined}
                      onClick={() => void confirmDelete(review)}
                    >
                      {deleting ? "Deleting…" : "Delete review"}
                    </button>{" "}
                    <button type="button" onClick={cancelDelete}>
                      Cancel
                    </button>
                  </p>
                </div>
              ) : (
                <p>
                  <button
                    type="button"
                    ref={editButtonRef}
                    aria-label="Edit your review"
                    onClick={() => startEdit(review, false)}
                  >
                    Edit
                  </button>{" "}
                  <button
                    type="button"
                    ref={deleteButtonRef}
                    aria-label="Delete your review"
                    onClick={startDelete}
                  >
                    Delete
                  </button>
                </p>
              )}
              {conflict && mode === "view" ? (
                <>
                  <p role="alert">{CONFLICT_MESSAGE}</p>
                  {hasDraftContent(draft) ? (
                    <>
                      <p className={styles.unsent}>
                        <label htmlFor={conflictDraftId}>Text you hadn&apos;t posted</label>
                        <textarea id={conflictDraftId} readOnly rows={4} value={draft.text} />
                      </p>
                      <p>
                        <button type="button" onClick={() => startEdit(review, true)}>
                          Edit using the text you hadn&apos;t posted
                        </button>
                      </p>
                    </>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </div>
      );
      break;
    }
    case "error":
      body = <ErrorState message={own.state.message} onRetry={() => own.reload()} />;
      break;
    default:
      // "unavailable": the landmark can no longer be reviewed; the public list says so.
      body = null;
  }

  return (
    <div className={styles.panel}>
      <p role="status" className={styles.announcement}>
        {announcement}
      </p>
      {notice !== null ? <p role="alert">{notice}</p> : null}
      {body}
    </div>
  );
}
