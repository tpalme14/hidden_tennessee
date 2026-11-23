import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { LandmarkReviewsPage, Review } from "../api/reviews";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { WithAuth, authValue } from "./testAuth";

vi.mock("../api/reviews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/reviews")>()),
  listLandmarkReviews: vi.fn(),
}));

const { listLandmarkReviews } = await import("../api/reviews");
const { ReviewsSection, REVIEWS_DISCLAIMER, REVIEWS_UNAVAILABLE_TEXT } =
  await import("./ReviewsSection");
const { formatReviewDate } = await import("./ReviewItem");
const list = vi.mocked(listLandmarkReviews);

/**
 * M04-T03 Increment 2 — the read-only reviews section: every display state,
 * Show more (paging, dedupe, focus, failure), inert and direction-isolated
 * text, and attribution. The API module is mocked; the real hook runs.
 */

const L = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";

function review(n: number, overrides: Partial<Review> = {}): Review {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    rating: 4,
    body: `Review number ${n}`,
    created_at: "2026-11-21T16:31:04.123Z",
    updated_at: "2026-11-21T16:31:04.123Z",
    author_label: "Community Member",
    ...overrides,
  };
}

function page(
  reviews: Review[],
  options: { page?: number; hasMore?: boolean; count?: number; average?: number } = {},
): LandmarkReviewsPage {
  const count = options.count ?? reviews.length;
  return {
    reviews,
    aggregate: { average_rating: count === 0 ? null : (options.average ?? 4), rating_count: count },
    page: options.page ?? 1,
    limit: 20,
    has_more: options.hasMore ?? false,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.clearAllMocks();
});

/**
 * Increment 3: the section now includes the own-review panel, which needs the
 * router and the session context. These read-only tests run signed out, so the
 * panel shows only its sign-in link (and its empty announcement region).
 */
function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter>
      <WithAuth value={authValue({ status: "anonymous" })}>{children}</WithAuth>
    </MemoryRouter>
  );
}

/** The list's own status line (loading or count) — the panel has a separate announcement region. */
function listStatus() {
  return screen.getByText(/^(Showing|Loading reviews)/);
}

async function renderLoaded(first: LandmarkReviewsPage) {
  list.mockResolvedValueOnce(first);
  const view = render(<ReviewsSection landmarkId={L} />, { wrapper: Providers });
  await screen.findByText(REVIEWS_DISCLAIMER);
  return view;
}

describe("ReviewsSection — states", () => {
  it("is a labelled region with a 'Reviews' heading and an accessible loading status", async () => {
    const pending = deferred<LandmarkReviewsPage>();
    list.mockReturnValueOnce(pending.promise);
    render(<ReviewsSection landmarkId={L} />, { wrapper: Providers });
    expect(screen.getByRole("region", { name: "Reviews" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Reviews" })).toBeInTheDocument();
    expect(listStatus()).toHaveTextContent("Loading reviews…");
    expect(list).toHaveBeenCalledWith(L);
    await act(async () => pending.resolve(page([])));
  });

  it("empty: 'No reviews yet' (never a zero-star rating), the disclaimer, no list and no Show more", async () => {
    await renderLoaded(page([], { count: 0 }));
    expect(screen.getByText("No reviews yet")).toBeInTheDocument();
    expect(screen.getByText(REVIEWS_DISCLAIMER)).toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show more/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.0|out of 5/)).not.toBeInTheDocument();
  });

  it("populated: one-decimal average and count, then the reviews newest first", async () => {
    await renderLoaded(page([review(2), review(1)], { count: 2, average: 4.05 }));
    expect(screen.getByText("4.1 out of 5 · 2 reviews")).toBeInTheDocument();
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent("Review number 2");
    expect(items[1]).toHaveTextContent("Review number 1");
    expect(listStatus()).toHaveTextContent("Showing all 2 reviews.");
  });

  it("singular count wording", async () => {
    await renderLoaded(page([review(1)], { count: 1, average: 5 }));
    expect(screen.getByText("5.0 out of 5 · 1 review")).toBeInTheDocument();
    expect(listStatus()).toHaveTextContent("Showing all 1 review.");
  });

  it("unavailable (404): a neutral message, with no review, aggregate, or landmark data", async () => {
    list.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    render(<ReviewsSection landmarkId={L} />, { wrapper: Providers });
    expect(await screen.findByText(REVIEWS_UNAVAILABLE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText(REVIEWS_DISCLAIMER)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("error: an alert with a fixed message (never the server's detail) and Try again, which reloads", async () => {
    list.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "secret internal detail"));
    render(<ReviewsSection landmarkId={L} />, { wrapper: Providers });
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Reviews couldn't be loaded. Please try again.");
    expect(alert).not.toHaveTextContent("secret");

    list.mockResolvedValueOnce(page([review(1)]));
    await userEvent.click(within(alert).getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Review number 1")).toBeInTheDocument();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("a malformed response is shown as an error, never as reviews", async () => {
    list.mockRejectedValueOnce(
      new ApiError(200, "INVALID_RESPONSE", "The server returned an unexpected response."),
    );
    render(<ReviewsSection landmarkId={L} />, { wrapper: Providers });
    expect(await screen.findByRole("alert")).toHaveTextContent("Reviews couldn't be loaded.");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });
});

describe("ReviewsSection — a review", () => {
  it("shows the rating (stars hidden from assistive tech), Community Member, and the creation date", async () => {
    await renderLoaded(page([review(1, { rating: 3 })]));
    const item = within(screen.getByRole("list")).getByRole("listitem");
    expect(item).toHaveTextContent("Rated 3 out of 5");
    expect(within(item).getByText("★★★☆☆")).toHaveAttribute("aria-hidden", "true");
    expect(item).toHaveTextContent("Community Member");
    const time = item.querySelector("time")!;
    expect(time).toHaveAttribute("dateTime", "2026-11-21T16:31:04.123Z");
    expect(time).toHaveTextContent(formatReviewDate("2026-11-21T16:31:04.123Z"));
    expect(item).not.toHaveTextContent("Edited");
  });

  it("shows 'Edited' only when updated_at differs from created_at", async () => {
    await renderLoaded(
      page([review(1, { updated_at: "2026-11-22T08:00:00.000Z" }), review(2)], { count: 2 }),
    );
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Edited");
    expect(items[1]).not.toHaveTextContent("Edited");
  });

  it("a rating-only review has no body paragraph", async () => {
    await renderLoaded(page([review(1, { body: null })]));
    const item = within(screen.getByRole("list")).getByRole("listitem");
    expect(item.querySelector("[dir]")).toBeNull();
  });

  it("renders markup in a review as inert text: no elements are created and nothing executes", async () => {
    const hostile =
      '<img src=x onerror="window.__xss=1"><script>window.__xss=2</script><b>bold</b><a href="javascript:alert(1)">x</a>';
    await renderLoaded(page([review(1, { body: hostile })]));
    const body = within(screen.getByRole("list")).getByText(hostile);
    expect(body.textContent).toBe(hostile);
    expect(body.children).toHaveLength(0);
    expect(body.querySelector("img, script, b, a")).toBeNull();
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it("isolates the body's direction (dir=auto), so bidi controls cannot reorder surrounding text", async () => {
    const bidi = "safe ‮evil‬ text שלום";
    await renderLoaded(page([review(1, { body: bidi })]));
    const body = within(screen.getByRole("list")).getByText(bidi);
    expect(body.tagName).toBe("P");
    expect(body).toHaveAttribute("dir", "auto");
    // The attribution and date are outside the isolated element.
    const item = body.closest("li")!;
    expect(item.querySelector("[dir='auto']")).toBe(body);
    expect(within(item).getByText(/Community Member/)).not.toHaveAttribute("dir");
  });

  it("keeps line breaks and spacing in the text exactly (pre-wrap styling applied)", async () => {
    const text = "First line\n\n  Indented second line\r\nThird";
    await renderLoaded(page([review(1, { body: text })]));
    const body = within(screen.getByRole("list")).getByText(
      (_content, element) => element?.textContent === text && element.tagName === "P",
    );
    expect(body.textContent).toBe(text);
    expect(body.className).toMatch(/body/);
  });

  it("never shows anything but the Community Member label as the author", async () => {
    await renderLoaded(page([review(1), review(2)], { count: 2 }));
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    for (const item of items) expect(item).toHaveTextContent("Community Member");
    expect(screen.queryByText(/@|user_id|You|Your review/)).not.toBeInTheDocument();
  });
});

describe("ReviewsSection — Show more", () => {
  it("after the last page, never claims 'all' when a review added meanwhile is not shown (Increment 5 fix)", async () => {
    await renderLoaded(page([review(3), review(2)], { hasMore: true, count: 3 }));
    // A new review was added at the top meanwhile: page 2 now repeats review(2) and ends.
    list.mockResolvedValueOnce(page([review(2), review(1)], { page: 2, hasMore: false, count: 4 }));
    await userEvent.click(screen.getByRole("button", { name: "Show more reviews" }));
    await screen.findByText("Review number 1");
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(3);
    expect(listStatus()).toHaveTextContent("Showing 3 of 4 reviews.");
    expect(screen.queryByRole("button", { name: /show more/i })).not.toBeInTheDocument();
  });

  it("appends the next page, updates the count, and moves focus to the first new review", async () => {
    await renderLoaded(page([review(3), review(2)], { hasMore: true, count: 3, average: 4 }));
    expect(listStatus()).toHaveTextContent("Showing 2 of 3 reviews.");

    const next = deferred<LandmarkReviewsPage>();
    list.mockReturnValueOnce(next.promise);
    const button = screen.getByRole("button", { name: "Show more reviews" });
    await userEvent.click(button);
    expect(list).toHaveBeenLastCalledWith(L, { page: 2 });
    expect(button).toHaveTextContent("Loading more reviews…");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");

    // Pressing again while loading sends nothing.
    await userEvent.click(button);
    expect(list).toHaveBeenCalledTimes(2);

    await act(async () => next.resolve(page([review(1)], { page: 2, count: 3, average: 4 })));
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("Review number 3"),
      expect.stringContaining("Review number 2"),
      expect.stringContaining("Review number 1"),
    ]);
    expect(items[2]).toHaveFocus();
    expect(screen.queryByRole("button", { name: /show more/i })).not.toBeInTheDocument();
    expect(listStatus()).toHaveTextContent("Showing all 3 reviews.");
  });

  it("skips duplicates; when nothing new is added focus moves to the count line, never lost", async () => {
    await renderLoaded(page([review(2), review(1)], { hasMore: true, count: 2 }));
    list.mockResolvedValueOnce(page([review(1)], { page: 2, count: 2 }));
    await userEvent.click(screen.getByRole("button", { name: "Show more reviews" }));
    await screen.findByText("Showing all 2 reviews.");
    expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(2);
    expect(listStatus()).toHaveFocus();
  });

  it("a failed Show more keeps the reviews and the button (with focus), announces once, and retries", async () => {
    await renderLoaded(page([review(2)], { hasMore: true, count: 2 }));
    list.mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "x"));
    const button = screen.getByRole("button", { name: "Show more reviews" });
    await userEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "More reviews couldn't be loaded. Please try again.",
    );
    expect(screen.getByText("Review number 2")).toBeInTheDocument();
    expect(button).toHaveFocus();

    list.mockResolvedValueOnce(page([review(1)], { page: 2, count: 2 }));
    await userEvent.click(button);
    expect(await screen.findByText("Review number 1")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a 404 during Show more replaces everything with the neutral unavailable message", async () => {
    await renderLoaded(page([review(2)], { hasMore: true, count: 2 }));
    list.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    await userEvent.click(screen.getByRole("button", { name: "Show more reviews" }));
    expect(await screen.findByText(REVIEWS_UNAVAILABLE_TEXT)).toBeInTheDocument();
    expect(screen.queryByText("Review number 2")).not.toBeInTheDocument();
  });

  it("is operable from the keyboard", async () => {
    await renderLoaded(page([review(2)], { hasMore: true, count: 2 }));
    list.mockResolvedValueOnce(page([review(1)], { page: 2, count: 2 }));
    screen.getByRole("button", { name: "Show more reviews" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("Review number 1")).toBeInTheDocument();
  });
});

describe("ReviewsSection — landmark changes", () => {
  it("never shows the previous landmark's reviews after the landmark changes", async () => {
    const other = "4a3c9d2f-0b5e-4f70-9c8b-2d3e4f5a6b7c";
    list.mockResolvedValueOnce(page([review(1)]));
    const { rerender } = render(<ReviewsSection landmarkId={L} />, { wrapper: Providers });
    await screen.findByText("Review number 1");

    const pending = deferred<LandmarkReviewsPage>();
    list.mockReturnValueOnce(pending.promise);
    rerender(<ReviewsSection landmarkId={other} />);
    expect(screen.queryByText("Review number 1")).not.toBeInTheDocument();
    expect(listStatus()).toHaveTextContent("Loading reviews…");
    await act(async () => pending.resolve(page([review(7)])));
    expect(screen.getByText("Review number 7")).toBeInTheDocument();
  });
});
