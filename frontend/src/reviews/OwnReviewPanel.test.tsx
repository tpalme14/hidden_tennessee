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
}));

const api = await import("../api/reviews");
const { ReviewsSection } = await import("./ReviewsSection");
const {
  POSTED_ANNOUNCEMENT,
  SESSION_ENDED_MESSAGE,
  CONFLICT_MESSAGE,
  LANDMARK_GONE_MESSAGE,
  POST_FAILED_MESSAGE,
  SESSION_UNKNOWN_MESSAGE,
} = await import("./OwnReviewPanel");
const { REVIEW_MESSAGES } = await import("./validation");
const list = vi.mocked(api.listLandmarkReviews);
const lookup = vi.mocked(api.getOwnReview);
const create = vi.mocked(api.createReview);

/**
 * M04-T03 Increment 3 — the own-review panel and the create flow, exercised
 * through the full ReviewsSection with the API module mocked: session states,
 * the form (fieldset radios, textarea, code-point counter, error summary),
 * posting, every failure path with draft preservation, 401 and 409 recovery,
 * account switches, and "Your review" identification.
 */

const L = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const OWN_ID = "00000000-0000-4000-8000-0000000000aa";
const OTHER_ID = "00000000-0000-4000-8000-0000000000bb";

function review(id: string, overrides: Partial<Review> = {}): Review {
  return {
    id,
    rating: 4,
    body: `Body of ${id.slice(-2)}`,
    created_at: "2026-11-21T16:31:04.123Z",
    updated_at: "2026-11-21T16:31:04.123Z",
    author_label: "Community Member",
    ...overrides,
  };
}

function page(reviews: Review[]): LandmarkReviewsPage {
  return {
    reviews,
    aggregate: {
      average_rating: reviews.length === 0 ? null : 4,
      rating_count: reviews.length,
    },
    page: 1,
    limit: 20,
    has_more: false,
  };
}

/** Renders the section under a router at a profile URL and a replaceable session context. */
function setup(initial: AuthContextValue) {
  let auth = initial;
  function Providers({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={["/landmarks/abc?from=discover"]}>
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

async function chooseRating(stars: number) {
  await userEvent.click(
    screen.getByRole("radio", { name: `${stars} ${stars === 1 ? "star" : "stars"}` }),
  );
}

const textarea = () => screen.getByRole("textbox", { name: "Review (optional)" });
const postButton = () => screen.getByRole("button", { name: /^(Post review|Posting…)$/ });

afterEach(() => {
  vi.clearAllMocks();
});

describe("session states", () => {
  it("signed out: a sign-in link back to this page (returnTo), no form, no lookup", async () => {
    list.mockResolvedValue(page([]));
    setup(authValue({ status: "anonymous" }));
    const link = await screen.findByRole("link", { name: "Sign in to write a review" });
    expect(link).toHaveAttribute(
      "href",
      `/sign-in?returnTo=${encodeURIComponent("/landmarks/abc?from=discover")}`,
    );
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(lookup).not.toHaveBeenCalled();
  });

  it("session still loading: an accessible 'checking' status and no form", async () => {
    list.mockResolvedValue(page([]));
    setup(authValue({ status: "loading" }));
    expect(screen.getByText("Checking for your review…")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  });

  it("session unavailable: says so, and Try again re-checks the session", async () => {
    list.mockResolvedValue(page([]));
    const retry = vi.fn(() => Promise.resolve());
    setup(authValue({ status: "unavailable", retry }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(SESSION_UNKNOWN_MESSAGE);
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(lookup).not.toHaveBeenCalled();
  });

  it("an own-review lookup failure shows an alert with Try again", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "x"));
    setup(authValue(signedIn()));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your review couldn't be loaded. Please try again.");
    lookup.mockResolvedValueOnce(null);
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Write a review" })).toBeInTheDocument();
  });
});

describe("the form", () => {
  it("signed in without a review: a labelled form with a rating fieldset, a textarea, and a counter", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValue(null);
    setup(authValue(signedIn()));
    const form = await screen.findByRole("form", { name: "Write a review" });
    const group = within(form).getByRole("group", { name: "Rating (required)" });
    expect(within(group).getAllByRole("radio")).toHaveLength(5);
    expect(within(group).getByRole("radio", { name: "1 star" })).toBeInTheDocument();
    expect(within(group).getByRole("radio", { name: "5 stars" })).toBeInTheDocument();
    const text = textarea();
    expect(text).not.toHaveAttribute("maxLength");
    expect(text).toHaveAccessibleDescription("0 of 2,000 characters");
    expect(postButton()).toHaveTextContent("Post review");
  });

  it("the counter counts code points (a non-BMP character is one) and flags going over at once", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValue(null);
    setup(authValue(signedIn()));
    await screen.findByRole("form");
    await userEvent.type(textarea(), "🌲 ab");
    expect(textarea()).toHaveAccessibleDescription("4 of 2,000 characters");

    // Paste a long body rather than typing 2,001 characters.
    textarea().focus();
    await userEvent.clear(textarea());
    await userEvent.paste("x".repeat(2001));
    expect(textarea()).toHaveAccessibleDescription("2,001 of 2,000 characters — 1 over the limit");
    expect(textarea()).toHaveAttribute("aria-invalid", "true");
  });

  it("submitting without a rating shows a focused error summary with a link to the field; nothing is sent", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValue(null);
    setup(authValue(signedIn()));
    await screen.findByRole("form");
    await userEvent.type(textarea(), "Nice");
    await userEvent.click(postButton());

    const summary = screen.getByRole("alert");
    expect(summary).toHaveFocus();
    expect(summary).toHaveTextContent("There's a problem with your review:");
    const link = within(summary).getByRole("link", { name: REVIEW_MESSAGES.ratingRequired });
    expect(screen.getByRole("group", { name: "Rating (required)" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(create).not.toHaveBeenCalled();

    await userEvent.click(link);
    expect(screen.getByRole("radio", { name: "1 star" })).toHaveFocus();
    expect(textarea()).toHaveValue("Nice");
  });

  it("text over the limit and text with a NUL are refused before sending, with both problems listed", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValue(null);
    setup(authValue(signedIn()));
    await screen.findByRole("form");
    textarea().focus();
    await userEvent.paste("x".repeat(2001));
    await userEvent.click(postButton());
    const summary = screen.getByRole("alert");
    expect(
      within(summary)
        .getAllByRole("link")
        .map((l) => l.textContent),
    ).toEqual([REVIEW_MESSAGES.ratingRequired, REVIEW_MESSAGES.bodyTooLong]);

    await chooseRating(3);
    await userEvent.clear(textarea());
    await userEvent.paste("a\u0000b");
    await userEvent.click(postButton());
    expect(screen.getByRole("alert")).toHaveTextContent(REVIEW_MESSAGES.bodyCharacters);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("posting", () => {
  it("sends only validated data; announces and moves focus only after the server confirms; refreshes both lists", async () => {
    list.mockResolvedValueOnce(page([review(OTHER_ID)]));
    lookup.mockResolvedValueOnce(null);
    setup(authValue(signedIn()));
    await screen.findByRole("form");

    await chooseRating(5);
    await userEvent.type(textarea(), "  Great view{Enter}{Enter}Worth it  ");
    const pending = deferred<Review>();
    create.mockReturnValueOnce(pending.promise);
    await userEvent.click(postButton());

    expect(create).toHaveBeenCalledWith(L, { rating: 5, body: "Great view\n\nWorth it" });
    expect(postButton()).toHaveTextContent("Posting…");
    expect(postButton()).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText(POSTED_ANNOUNCEMENT)).not.toBeInTheDocument();

    // A second press while posting sends nothing.
    await userEvent.click(postButton());
    expect(create).toHaveBeenCalledTimes(1);

    const mine = review(OWN_ID, { rating: 5, body: "Great view\n\nWorth it" });
    lookup.mockResolvedValueOnce(mine);
    list.mockResolvedValueOnce(page([mine, review(OTHER_ID)]));
    await act(async () => pending.resolve(mine));

    const heading = await screen.findByRole("heading", { level: 4, name: "Your review" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText(POSTED_ANNOUNCEMENT)).toHaveAttribute("role", "status");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(2);

    // The public list labels the user's own entry "Your review", by ID only.
    const items = await waitFor(() => {
      const found = within(screen.getByRole("list")).getAllByRole("listitem");
      expect(found).toHaveLength(2);
      return found;
    });
    expect(items[0]).toHaveTextContent("Your review");
    expect(items[0]).not.toHaveTextContent("Community Member");
    expect(items[1]).toHaveTextContent("Community Member");
    expect(within(screen.getByRole("list")).queryByRole("button")).not.toBeInTheDocument();
  });

  it.each([
    [
      "400 (the server's fixed message)",
      new ApiError(400, "INVALID_REQUEST", "rating must be a whole number from 1 through 5."),
      "rating must be a whole number from 1 through 5.",
    ],
    [
      "429 with Retry-After",
      new ApiError(429, "RATE_LIMITED", "x", 30),
      "Too many requests. Please try again in 30 seconds.",
    ],
    [
      "429 without Retry-After",
      new ApiError(429, "RATE_LIMITED", "x"),
      "Too many requests. Please wait a moment and try again.",
    ],
    ["500", new ApiError(500, "INTERNAL_ERROR", "secret detail"), POST_FAILED_MESSAGE],
    ["503", new ApiError(503, "SERVICE_UNAVAILABLE", "x"), POST_FAILED_MESSAGE],
    ["a network failure", new ApiError(0, "NETWORK_ERROR", "x"), POST_FAILED_MESSAGE],
    ["a malformed response", new ApiError(201, "INVALID_RESPONSE", "x"), POST_FAILED_MESSAGE],
    ["403 INVALID_ORIGIN", new ApiError(403, "INVALID_ORIGIN", "x"), POST_FAILED_MESSAGE],
    ["an unexpected error", new Error("boom"), POST_FAILED_MESSAGE],
  ])(
    "%s: one alert, no success, and the draft is kept for another try",
    async (_l, error, text) => {
      list.mockResolvedValue(page([]));
      lookup.mockResolvedValue(null);
      setup(authValue(signedIn()));
      await screen.findByRole("form");
      await chooseRating(2);
      await userEvent.type(textarea(), "Keep me");
      create.mockRejectedValueOnce(error);
      await userEvent.click(postButton());

      expect(await screen.findByRole("alert")).toHaveTextContent(text);
      expect(screen.getByRole("alert")).not.toHaveTextContent("secret");
      expect(screen.queryByText(POSTED_ANNOUNCEMENT)).not.toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "2 stars" })).toBeChecked();
      expect(textarea()).toHaveValue("Keep me");
      expect(postButton()).toHaveTextContent("Post review");

      create.mockResolvedValueOnce(review(OWN_ID));
      lookup.mockResolvedValueOnce(review(OWN_ID));
      await userEvent.click(postButton());
      expect(create).toHaveBeenCalledTimes(2);
      expect(await screen.findByRole("heading", { name: "Your review" })).toBeInTheDocument();
    },
  );

  it("404: the landmark can no longer be reviewed; the draft is kept and the public list is refreshed", async () => {
    list.mockResolvedValueOnce(page([]));
    lookup.mockResolvedValue(null);
    setup(authValue(signedIn()));
    await screen.findByRole("form");
    await chooseRating(4);
    create.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    list.mockResolvedValueOnce(page([]));
    await userEvent.click(postButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(LANDMARK_GONE_MESSAGE);
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("radio", { name: "4 stars" })).toBeChecked();
  });

  it("401: re-checks the session, keeps the draft, and — once signed out — shows the sign-in link with the draft", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValue(null);
    const refreshed = deferred<void>();
    const value = authValue(signedIn(), { refresh: vi.fn(() => refreshed.promise) });
    const { setAuth } = setup(value);
    await screen.findByRole("form");
    await chooseRating(3);
    await userEvent.type(textarea(), "Written before my session ended");
    create.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "Authentication required."));
    await userEvent.click(postButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(SESSION_ENDED_MESSAGE);
    expect(value.refresh).toHaveBeenCalledTimes(1);
    expect(textarea()).toHaveValue("Written before my session ended");

    // The session check answers: signed out.
    setAuth(authValue({ status: "anonymous" }));
    await act(async () => refreshed.resolve());
    expect(screen.getByRole("link", { name: "Sign in to write a review" })).toBeInTheDocument();
    expect(textarea()).toHaveValue("Written before my session ended");
    expect(screen.getByRole("radio", { name: "3 stars" })).toBeChecked();
  });

  it("409 REVIEW_ALREADY_EXISTS: shows the existing review as 'Your review' and keeps the unsent text", async () => {
    list.mockResolvedValueOnce(page([]));
    lookup.mockResolvedValueOnce(null);
    setup(authValue(signedIn()));
    await screen.findByRole("form");
    await chooseRating(1);
    await userEvent.type(textarea(), "My second attempt");

    const existing = review(OWN_ID, { rating: 5, body: "Posted from another tab" });
    create.mockRejectedValueOnce(
      new ApiError(409, "REVIEW_ALREADY_EXISTS", "You have already reviewed this landmark."),
    );
    lookup.mockResolvedValueOnce(existing);
    list.mockResolvedValueOnce(page([existing]));
    await userEvent.click(postButton());

    expect(await screen.findByRole("heading", { name: "Your review" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent(CONFLICT_MESSAGE);
    const unsent = screen.getByRole("textbox", { name: "Text you hadn't posted" });
    expect(unsent).toHaveValue("My second attempt");
    expect(unsent).toHaveAttribute("readOnly");
    expect(screen.getAllByText("Posted from another tab").length).toBeGreaterThan(0);
    expect(lookup).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(POSTED_ANNOUNCEMENT)).not.toBeInTheDocument();
  });
});

describe("the user's own review", () => {
  it("is shown in a 'Your review' panel labelled 'You', with no form; Edit and Delete appear only there (Increment 4)", async () => {
    const mine = review(OWN_ID, { rating: 3, body: "Mine" });
    list.mockResolvedValue(page([mine, review(OTHER_ID)]));
    lookup.mockResolvedValue(mine);
    setup(authValue(signedIn()));
    const heading = await screen.findByRole("heading", { level: 4, name: "Your review" });
    const panel = heading.parentElement!;
    expect(panel).toHaveTextContent("Rated 3 out of 5");
    expect(panel).toHaveTextContent("You ·");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    // Exactly one Edit and one Delete, both in the panel; none in the public list.
    const edit = screen.getByRole("button", { name: "Edit your review" });
    const del = screen.getByRole("button", { name: "Delete your review" });
    expect(panel).toContainElement(edit);
    expect(panel).toContainElement(del);
    expect(screen.getAllByRole("button", { name: /edit|delete/i })).toHaveLength(2);
    expect(within(screen.getByRole("list")).queryByRole("button")).not.toBeInTheDocument();
  });

  it("is identified in the list by its ID only — another review with the same content is not 'yours'", async () => {
    const mine = review(OWN_ID, { body: "Same words" });
    const theirs = review(OTHER_ID, { body: "Same words" });
    list.mockResolvedValue(page([theirs, mine]));
    lookup.mockResolvedValue(mine);
    setup(authValue(signedIn()));
    await screen.findByRole("heading", { name: "Your review" });
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Community Member");
    expect(items[0]).not.toHaveTextContent("Your review");
    expect(items[1]).toHaveTextContent("Your review");
  });

  it("nothing is labelled 'yours' while signed out, even if a lookup was underway", async () => {
    const mine = review(OWN_ID);
    list.mockResolvedValue(page([mine]));
    lookup.mockResolvedValue(mine);
    const { setAuth } = setup(authValue(signedIn()));
    await screen.findByRole("heading", { name: "Your review" });
    setAuth(authValue({ status: "anonymous" }));
    expect(screen.queryByText("Your review")).not.toBeInTheDocument();
    expect(within(screen.getByRole("list")).getByRole("listitem")).toHaveTextContent(
      "Community Member",
    );
  });
});

describe("account switches", () => {
  it("a different account signing in on this page clears the previous person's draft", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValue(null);
    const { setAuth } = setup(authValue(signedIn(TEST_USER)));
    await screen.findByRole("form");
    await chooseRating(5);
    await userEvent.type(textarea(), "Private draft");

    setAuth(authValue(signedIn(OTHER_USER)));
    await screen.findByRole("form");
    expect(textarea()).toHaveValue("");
    expect(screen.getByRole("radio", { name: "5 stars" })).not.toBeChecked();
  });

  it("a post that completes after an account switch announces nothing to the new account", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValue(null);
    const { setAuth } = setup(authValue(signedIn(TEST_USER)));
    await screen.findByRole("form");
    await chooseRating(4);
    const pending = deferred<Review>();
    create.mockReturnValueOnce(pending.promise);
    await userEvent.click(postButton());

    setAuth(authValue(signedIn(OTHER_USER)));
    await act(async () => pending.resolve(review(OWN_ID)));
    expect(screen.queryByText(POSTED_ANNOUNCEMENT)).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Your review" })).not.toBeInTheDocument();
  });
});

describe("keyboard", () => {
  it("the whole create flow works from the keyboard", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValueOnce(null);
    setup(authValue(signedIn()));
    await screen.findByRole("form");

    screen.getByRole("radio", { name: "1 star" }).focus();
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}"); // native radio group → 4 stars
    expect(screen.getByRole("radio", { name: "4 stars" })).toBeChecked();
    await userEvent.tab();
    expect(textarea()).toHaveFocus();
    await userEvent.keyboard("By keyboard");
    await userEvent.tab();
    expect(postButton()).toHaveFocus();

    create.mockResolvedValueOnce(review(OWN_ID, { body: "By keyboard" }));
    lookup.mockResolvedValueOnce(review(OWN_ID, { body: "By keyboard" }));
    await userEvent.keyboard("{Enter}");
    expect(create).toHaveBeenCalledWith(L, { rating: 4, body: "By keyboard" });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Your review" })).toHaveFocus());
  });
});
