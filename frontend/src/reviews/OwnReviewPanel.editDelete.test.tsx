import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { LandmarkReviewsPage, Review } from "../api/reviews";
import type { AuthContextValue } from "../auth/session";
import { TEST_USER, deferred } from "../auth/testFixtures";
import { OTHER_USER, WithAuth, authValue, signedIn } from "./testAuth";

vi.mock("../api/reviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/reviews")>()),
  listLandmarkReviews: vi.fn(),
  getOwnReview: vi.fn(),
  createReview: vi.fn(),
  updateReview: vi.fn(),
  deleteReview: vi.fn(),
}));

const api = await import("../api/reviews");
const { ReviewsSection } = await import("./ReviewsSection");
const panel = await import("./OwnReviewPanel");
const { REVIEW_MESSAGES } = await import("./validation");
const list = vi.mocked(api.listLandmarkReviews);
const lookup = vi.mocked(api.getOwnReview);
const create = vi.mocked(api.createReview);
const update = vi.mocked(api.updateReview);
const remove = vi.mocked(api.deleteReview);

/**
 * M04-T03 Increment 4 — editing and deleting the user's own review through
 * the full ReviewsSection (API mocked): prefill, Cancel, changed-fields-only
 * PATCH (omitted body vs explicit null), the inline delete confirmation with
 * focus management, every failure path with draft preservation, 409 recovery
 * into edit mode, session expiry, and account switches.
 */

const L = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const OWN_ID = "00000000-0000-4000-8000-0000000000aa";

function review(overrides: Partial<Review> = {}): Review {
  return {
    id: OWN_ID,
    rating: 3,
    body: "Original text",
    created_at: "2026-11-21T16:31:04.123Z",
    updated_at: "2026-11-21T16:31:04.123Z",
    author_label: "Community Member",
    ...overrides,
  };
}

function page(reviews: Review[]): LandmarkReviewsPage {
  return {
    reviews,
    aggregate: { average_rating: reviews.length ? 3 : null, rating_count: reviews.length },
    page: 1,
    limit: 20,
    has_more: false,
  };
}

function setup(initial: AuthContextValue = authValue(signedIn())) {
  let auth = initial;
  function Providers({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={["/landmarks/abc"]}>
        <WithAuth value={auth}>{children}</WithAuth>
      </MemoryRouter>
    );
  }
  const view = render(<ReviewsSection landmarkId={L} />, { wrapper: Providers });
  return {
    ...view,
    setAuth(next: AuthContextValue) {
      auth = next;
      view.rerender(<ReviewsSection landmarkId={L} />);
    },
  };
}

/** Signed in with an existing review shown in the "Your review" panel. */
async function withOwnReview(existing = review(), auth?: AuthContextValue) {
  list.mockResolvedValue(page([existing]));
  lookup.mockResolvedValue(existing);
  const view = setup(auth);
  await screen.findByRole("button", { name: "Edit your review" });
  return view;
}

const textarea = () => screen.getByRole("textbox", { name: "Review (optional)" });
const saveButton = () => screen.getByRole("button", { name: /^(Save changes|Saving…)$/ });

afterEach(() => {
  vi.clearAllMocks();
});

describe("edit", () => {
  it("opens prefilled with the review's rating and text, focuses the form heading, and Cancel changes nothing", async () => {
    await withOwnReview();
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    const heading = screen.getByRole("heading", { name: "Edit your review" });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("radio", { name: "3 stars" })).toBeChecked();
    expect(textarea()).toHaveValue("Original text");

    await userEvent.type(textarea(), " — changed");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit your review" })).toHaveFocus();
    expect(update).not.toHaveBeenCalled();
    expect(
      within(screen.getByRole("heading", { name: "Your review" }).parentElement!).getByText(
        "Original text",
      ),
    ).toBeInTheDocument();
  });

  it("a rating-only change sends { rating } and OMITS body; success is announced only after the server confirms", async () => {
    await withOwnReview();
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    await userEvent.click(screen.getByRole("radio", { name: "5 stars" }));

    const pending = deferred<Review>();
    update.mockReturnValueOnce(pending.promise);
    await userEvent.click(saveButton());
    expect(update).toHaveBeenCalledWith(OWN_ID, { rating: 5 });
    expect(Object.prototype.hasOwnProperty.call(update.mock.calls[0]![1], "body")).toBe(false);
    expect(saveButton()).toHaveTextContent("Saving…");
    expect(saveButton()).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(panel.UPDATED_ANNOUNCEMENT)).not.toBeInTheDocument();
    await userEvent.click(saveButton());
    expect(update).toHaveBeenCalledTimes(1);

    const updated = review({ rating: 5, updated_at: "2026-11-22T09:00:00.000Z" });
    lookup.mockResolvedValue(updated);
    list.mockResolvedValue(page([updated]));
    await act(async () => pending.resolve(updated));

    expect(await screen.findByText(panel.UPDATED_ANNOUNCEMENT)).toHaveAttribute("role", "status");
    const heading = await screen.findByRole("heading", { level: 4, name: "Your review" });
    await waitFor(() => expect(heading).toHaveFocus());
    await waitFor(() => expect(heading.parentElement!).toHaveTextContent("Rated 5 out of 5"));
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["emptying the text sends body: null (an explicit clear)", "", { body: null }],
    ["whitespace-only text also clears", "   \n ", { body: null }],
    ["changed text sends only body", "Better text", { body: "Better text" }],
  ])("%s", async (_l, text, expected) => {
    await withOwnReview();
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    await userEvent.clear(textarea());
    if (text !== "") await userEvent.type(textarea(), text);
    update.mockResolvedValueOnce(review());
    await userEvent.click(saveButton());
    expect(update).toHaveBeenCalledWith(OWN_ID, expected);
  });

  it("changing both sends both", async () => {
    await withOwnReview();
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    await userEvent.click(screen.getByRole("radio", { name: "1 star" }));
    await userEvent.clear(textarea());
    await userEvent.type(textarea(), "Changed my mind");
    update.mockResolvedValueOnce(review());
    await userEvent.click(saveButton());
    expect(update).toHaveBeenCalledWith(OWN_ID, { rating: 1, body: "Changed my mind" });
  });

  it("saving with nothing changed sends nothing and says so", async () => {
    await withOwnReview(review({ body: null }));
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    await userEvent.type(textarea(), "   ");
    await userEvent.click(saveButton());
    expect(screen.getByRole("alert")).toHaveTextContent(REVIEW_MESSAGES.nothingToUpdate);
    expect(update).not.toHaveBeenCalled();
  });

  it("invalid text is refused before sending, with a focused error summary", async () => {
    await withOwnReview();
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    await userEvent.clear(textarea());
    textarea().focus();
    await userEvent.paste("x".repeat(2001));
    await userEvent.click(saveButton());
    const summary = screen.getByRole("alert");
    expect(summary).toHaveFocus();
    expect(summary).toHaveTextContent(REVIEW_MESSAGES.bodyTooLong);
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    [
      "400",
      new ApiError(400, "INVALID_REQUEST", "Provide rating, body, or both."),
      "Provide rating, body, or both.",
    ],
    [
      "429 with Retry-After",
      new ApiError(429, "RATE_LIMITED", "x", 12),
      "Too many requests. Please try again in 12 seconds.",
    ],
    ["500", new ApiError(500, "INTERNAL_ERROR", "secret"), panel.SAVE_FAILED_MESSAGE],
    ["a network failure", new ApiError(0, "NETWORK_ERROR", "x"), panel.SAVE_FAILED_MESSAGE],
    ["a malformed response", new ApiError(200, "INVALID_RESPONSE", "x"), panel.SAVE_FAILED_MESSAGE],
    ["an unexpected error", new Error("boom"), panel.SAVE_FAILED_MESSAGE],
  ])("%s: one alert, still editing, and the edit draft is kept", async (_l, error, text) => {
    await withOwnReview();
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    await userEvent.clear(textarea());
    await userEvent.type(textarea(), "My edit");
    update.mockRejectedValueOnce(error);
    await userEvent.click(saveButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(text);
    expect(alert).not.toHaveTextContent("secret");
    expect(textarea()).toHaveValue("My edit");
    expect(screen.queryByText(panel.UPDATED_ANNOUNCEMENT)).not.toBeInTheDocument();

    update.mockResolvedValueOnce(review({ body: "My edit" }));
    await userEvent.click(saveButton());
    expect(update).toHaveBeenCalledTimes(2);
    expect(await screen.findByText(panel.UPDATED_ANNOUNCEMENT)).toBeInTheDocument();
  });

  it("401: re-checks the session and keeps the edit; signed out, the unsaved text stays visible; back in, editing resumes", async () => {
    const refreshed = deferred<void>();
    const value = authValue(signedIn(), { refresh: vi.fn(() => refreshed.promise) });
    const { setAuth } = await withOwnReview(review(), value);
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    await userEvent.clear(textarea());
    await userEvent.type(textarea(), "Unsaved words");
    update.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "Authentication required."));
    await userEvent.click(saveButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(panel.SESSION_ENDED_EDIT_MESSAGE);
    expect(value.refresh).toHaveBeenCalledTimes(1);

    setAuth(authValue({ status: "anonymous" }));
    await act(async () => refreshed.resolve());
    expect(screen.getByRole("link", { name: "Sign in to write a review" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Your unsaved changes" })).toHaveValue(
      "Unsaved words",
    );

    setAuth(authValue(signedIn()));
    await waitFor(() => expect(textarea()).toHaveValue("Unsaved words"));
    expect(screen.getByRole("heading", { name: "Edit your review" })).toBeInTheDocument();
  });

  it("404 (missing, not the user's, or the landmark is gone): a neutral notice; the edit's text becomes a new-review draft", async () => {
    await withOwnReview();
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    await userEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    await userEvent.clear(textarea());
    await userEvent.type(textarea(), "Keep this");
    update.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    lookup.mockResolvedValue(null);
    list.mockResolvedValue(page([]));
    await userEvent.click(saveButton());

    expect(await screen.findByText(panel.REVIEW_GONE_MESSAGE)).toHaveAttribute("role", "alert");
    await screen.findByRole("heading", { name: "Write a review" });
    expect(textarea()).toHaveValue("Keep this");
    expect(screen.getByRole("radio", { name: "4 stars" })).toBeChecked();
    expect(list).toHaveBeenCalledTimes(2);
  });
});

describe("409 recovery into edit mode", () => {
  it("the unsent text can be deliberately used in an edit; saving it clears the conflict", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValueOnce(null);
    setup();
    await screen.findByRole("heading", { name: "Write a review" });
    await userEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    await userEvent.type(textarea(), "Second attempt text");

    const existing = review({ rating: 2, body: "First attempt" });
    create.mockRejectedValueOnce(new ApiError(409, "REVIEW_ALREADY_EXISTS", "x"));
    lookup.mockResolvedValue(existing);
    list.mockResolvedValue(page([existing]));
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));
    await screen.findByText(panel.CONFLICT_MESSAGE);

    // The user chooses: Edit (the stored review) or use the unsent text.
    await userEvent.click(
      screen.getByRole("button", { name: "Edit using the text you hadn't posted" }),
    );
    expect(screen.getByRole("radio", { name: "5 stars" })).toBeChecked();
    expect(textarea()).toHaveValue("Second attempt text");

    update.mockResolvedValueOnce(review({ rating: 5, body: "Second attempt text" }));
    lookup.mockResolvedValue(review({ rating: 5, body: "Second attempt text" }));
    await userEvent.click(saveButton());
    expect(update).toHaveBeenCalledWith(OWN_ID, { rating: 5, body: "Second attempt text" });
    await screen.findByText(panel.UPDATED_ANNOUNCEMENT);
    expect(screen.queryByText(panel.CONFLICT_MESSAGE)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: "Text you hadn't posted" }),
    ).not.toBeInTheDocument();
  });

  it("choosing plain Edit after a conflict prefills from the stored review, keeping the unsent text for later", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValueOnce(null);
    setup();
    await screen.findByRole("heading", { name: "Write a review" });
    await userEvent.click(screen.getByRole("radio", { name: "1 star" }));
    await userEvent.type(textarea(), "Unsent");
    const existing = review({ rating: 4, body: "Stored" });
    create.mockRejectedValueOnce(new ApiError(409, "REVIEW_ALREADY_EXISTS", "x"));
    lookup.mockResolvedValue(existing);
    list.mockResolvedValue(page([existing]));
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));
    await screen.findByText(panel.CONFLICT_MESSAGE);

    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    expect(textarea()).toHaveValue("Stored");
    expect(screen.getByRole("radio", { name: "4 stars" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("textbox", { name: "Text you hadn't posted" })).toHaveValue("Unsent");
  });
});

describe("delete", () => {
  it("Delete opens an inline confirmation that takes focus; Cancel returns focus to Delete and sends nothing", async () => {
    await withOwnReview();
    await userEvent.click(screen.getByRole("button", { name: "Delete your review" }));
    const group = screen.getByRole("group", { name: panel.DELETE_CONFIRM_PROMPT });
    expect(screen.getByText(panel.DELETE_CONFIRM_PROMPT)).toHaveFocus();
    expect(within(group).getByRole("button", { name: "Delete review" })).toBeInTheDocument();
    expect(within(group).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();

    await userEvent.click(within(group).getByRole("button", { name: "Cancel" }));
    expect(
      screen.queryByRole("group", { name: panel.DELETE_CONFIRM_PROMPT }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete your review" })).toHaveFocus();
    expect(remove).not.toHaveBeenCalled();
  });

  it("confirming deletes; nothing is removed until the server confirms; then focus goes to Reviews and it is announced", async () => {
    await withOwnReview();
    await userEvent.click(screen.getByRole("button", { name: "Delete your review" }));
    const pending = deferred<void>();
    remove.mockReturnValueOnce(pending.promise);
    await userEvent.click(screen.getByRole("button", { name: "Delete review" }));
    expect(remove).toHaveBeenCalledWith(OWN_ID);
    const busy = screen.getByRole("button", { name: "Deleting…" });
    expect(busy).toHaveAttribute("aria-busy", "true");
    // Not optimistic: the review is still shown in the panel and the list.
    expect(screen.getByRole("heading", { name: "Your review" })).toBeInTheDocument();
    expect(within(screen.getByRole("list")).getByText("Original text")).toBeInTheDocument();
    await userEvent.click(busy);
    expect(remove).toHaveBeenCalledTimes(1);

    lookup.mockResolvedValue(null);
    list.mockResolvedValue(page([]));
    await act(async () => pending.resolve());

    expect(screen.getByRole("heading", { level: 3, name: "Reviews" })).toHaveFocus();
    expect(screen.getByText(panel.DELETED_ANNOUNCEMENT)).toHaveAttribute("role", "status");
    expect(await screen.findByRole("heading", { name: "Write a review" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("No reviews yet")).toBeInTheDocument());
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("a 404 (already deleted / no longer the user's) is a neutral notice; everything is refreshed", async () => {
    await withOwnReview();
    await userEvent.click(screen.getByRole("button", { name: "Delete your review" }));
    remove.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    lookup.mockResolvedValue(null);
    list.mockResolvedValue(page([]));
    await userEvent.click(screen.getByRole("button", { name: "Delete review" }));
    expect(await screen.findByText(panel.ALREADY_DELETED_MESSAGE)).toHaveAttribute("role", "alert");
    expect(screen.getByRole("heading", { level: 3, name: "Reviews" })).toHaveFocus();
    expect(screen.queryByText(panel.DELETED_ANNOUNCEMENT)).not.toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["401", new ApiError(401, "UNAUTHENTICATED", "x"), panel.SESSION_ENDED_DELETE_MESSAGE],
    [
      "429 with Retry-After",
      new ApiError(429, "RATE_LIMITED", "x", 1),
      "Too many requests. Please try again in 1 second.",
    ],
    ["500", new ApiError(500, "INTERNAL_ERROR", "secret"), panel.DELETE_FAILED_MESSAGE],
    ["a network failure", new ApiError(0, "NETWORK_ERROR", "x"), panel.DELETE_FAILED_MESSAGE],
    [
      "a malformed response",
      new ApiError(200, "INVALID_RESPONSE", "x"),
      panel.DELETE_FAILED_MESSAGE,
    ],
  ])(
    "%s: an alert in the confirmation, the review kept, and a retry possible",
    async (_l, error, text) => {
      const value = authValue(signedIn());
      await withOwnReview(review(), value);
      await userEvent.click(screen.getByRole("button", { name: "Delete your review" }));
      remove.mockRejectedValueOnce(error);
      await userEvent.click(screen.getByRole("button", { name: "Delete review" }));
      const group = screen.getByRole("group", { name: panel.DELETE_CONFIRM_PROMPT });
      expect(await within(group).findByRole("alert")).toHaveTextContent(text);
      expect(within(group).queryByText("secret")).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Your review" })).toBeInTheDocument();
      if (error.status === 401) expect(value.refresh).toHaveBeenCalledTimes(1);

      remove.mockResolvedValueOnce(undefined);
      lookup.mockResolvedValue(null);
      await userEvent.click(within(group).getByRole("button", { name: "Delete review" }));
      expect(await screen.findByText(panel.DELETED_ANNOUNCEMENT)).toBeInTheDocument();
    },
  );

  it("is operable from the keyboard: open, cancel, reopen, confirm", async () => {
    await withOwnReview();
    screen.getByRole("button", { name: "Delete your review" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByText(panel.DELETE_CONFIRM_PROMPT)).toHaveFocus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "Delete review" })).toHaveFocus();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}"); // Cancel
    expect(screen.getByRole("button", { name: "Delete your review" })).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    await userEvent.tab();
    remove.mockResolvedValueOnce(undefined);
    lookup.mockResolvedValue(null);
    await userEvent.keyboard("{Enter}");
    expect(remove).toHaveBeenCalledWith(OWN_ID);
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 3, name: "Reviews" })).toHaveFocus(),
    );
  });
});

describe("account switches", () => {
  it("switching accounts during an edit discards the edit draft and mode", async () => {
    const { setAuth } = await withOwnReview(review(), authValue(signedIn(TEST_USER)));
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    await userEvent.clear(textarea());
    await userEvent.type(textarea(), "Private edit");
    lookup.mockResolvedValue(
      review({ id: "00000000-0000-4000-8000-0000000000cc", body: "Other person's" }),
    );
    setAuth(authValue(signedIn(OTHER_USER)));
    await screen.findByRole("button", { name: "Edit your review" });
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Private edit")).not.toBeInTheDocument();
  });

  it("an edit or delete that completes after an account switch announces nothing", async () => {
    const { setAuth } = await withOwnReview(review(), authValue(signedIn(TEST_USER)));
    await userEvent.click(screen.getByRole("button", { name: "Delete your review" }));
    const pending = deferred<void>();
    remove.mockReturnValueOnce(pending.promise);
    await userEvent.click(screen.getByRole("button", { name: "Delete review" }));
    lookup.mockResolvedValue(null);
    setAuth(authValue(signedIn(OTHER_USER)));
    await act(async () => pending.resolve());
    expect(screen.queryByText(panel.DELETED_ANNOUNCEMENT)).not.toBeInTheDocument();
    expect(screen.queryByText(panel.ALREADY_DELETED_MESSAGE)).not.toBeInTheDocument();
  });

  it("signing out removes every ownership control at once", async () => {
    const { setAuth } = await withOwnReview();
    setAuth(authValue({ status: "anonymous" }));
    expect(screen.queryByRole("button", { name: /edit|delete/i })).not.toBeInTheDocument();
    expect(screen.queryByText("Your review")).not.toBeInTheDocument();
  });

  // Increment 6: a success announcement never outlives the account it described.
  it("signing out clears a previous success announcement", async () => {
    const { setAuth } = await withOwnReview();
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    await userEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    update.mockResolvedValueOnce(review({ rating: 5 }));
    lookup.mockResolvedValue(review({ rating: 5 }));
    await userEvent.click(saveButton());
    expect(await screen.findByText(panel.UPDATED_ANNOUNCEMENT)).toHaveAttribute("role", "status");

    setAuth(authValue({ status: "anonymous" }));
    await waitFor(() =>
      expect(screen.queryByText(panel.UPDATED_ANNOUNCEMENT)).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("link", { name: "Sign in to write a review" })).toBeInTheDocument();

    // Signing back in as the same person does not bring it back.
    setAuth(authValue(signedIn()));
    await screen.findByRole("button", { name: "Edit your review" });
    expect(screen.queryByText(panel.UPDATED_ANNOUNCEMENT)).not.toBeInTheDocument();
  });

  it("switching to another account clears a previous success announcement", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValueOnce(null);
    const { setAuth } = setup(authValue(signedIn(TEST_USER)));
    await screen.findByRole("heading", { name: "Write a review" });
    await userEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    create.mockResolvedValueOnce(review({ rating: 4 }));
    lookup.mockResolvedValue(review({ rating: 4 }));
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));
    expect(await screen.findByText(panel.POSTED_ANNOUNCEMENT)).toBeInTheDocument();

    lookup.mockResolvedValue(null);
    setAuth(authValue(signedIn(OTHER_USER)));
    await screen.findByRole("heading", { name: "Write a review" });
    expect(screen.queryByText(panel.POSTED_ANNOUNCEMENT)).not.toBeInTheDocument();
  });

  it("a session that ends keeps the unsent draft and its session message (draft policy unchanged)", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValueOnce(null);
    const { setAuth } = setup();
    await screen.findByRole("heading", { name: "Write a review" });
    await userEvent.click(screen.getByRole("radio", { name: "2 stars" }));
    await userEvent.type(textarea(), "Draft before expiry");
    create.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "x"));
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(panel.SESSION_ENDED_MESSAGE);

    setAuth(authValue({ status: "anonymous" }));
    await screen.findByRole("link", { name: "Sign in to write a review" });
    expect(textarea()).toHaveValue("Draft before expiry");
    expect(screen.getByRole("radio", { name: "2 stars" })).toBeChecked();
    expect(screen.getByRole("alert")).toHaveTextContent(panel.SESSION_ENDED_MESSAGE);
  });
});

describe("keyboard edit", () => {
  it("the whole edit flow works from the keyboard", async () => {
    await withOwnReview();
    screen.getByRole("button", { name: "Edit your review" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(screen.getByRole("heading", { name: "Edit your review" })).toHaveFocus();
    screen.getByRole("radio", { name: "3 stars" }).focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("radio", { name: "4 stars" })).toBeChecked();
    await userEvent.tab();
    await userEvent.tab();
    expect(saveButton()).toHaveFocus();
    update.mockResolvedValueOnce(review({ rating: 4 }));
    lookup.mockResolvedValue(review({ rating: 4 }));
    await userEvent.keyboard("{Enter}");
    expect(update).toHaveBeenCalledWith(OWN_ID, { rating: 4 });
    await waitFor(() =>
      expect(screen.getByRole("heading", { level: 4, name: "Your review" })).toHaveFocus(),
    );
  });
});
