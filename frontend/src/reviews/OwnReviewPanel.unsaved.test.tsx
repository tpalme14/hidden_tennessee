import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { LandmarkReviewsPage, Review } from "../api/reviews";
import { updateSafety } from "../pwa/updateSafety";
import { WithAuth, authValue, signedIn } from "./testAuth";

/**
 * M06-T02 Increment 4b-ii — review drafts registered as protected information:
 * a new-review draft with content, and an edit that differs from the saved
 * review. Only their presence is registered; the review API is mocked and
 * the text is synthetic.
 */

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
const list = vi.mocked(api.listLandmarkReviews);
const lookup = vi.mocked(api.getOwnReview);
const create = vi.mocked(api.createReview);

const L = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const OWN: Review = {
  id: "00000000-0000-4000-8000-0000000000aa",
  rating: 3,
  body: "Original text",
  created_at: "2026-11-21T16:31:04.123Z",
  updated_at: "2026-11-21T16:31:04.123Z",
  author_label: "Community Member",
};
const page = (reviews: Review[]): LandmarkReviewsPage => ({
  reviews,
  aggregate: { average_rating: reviews.length ? 3 : null, rating_count: reviews.length },
  page: 1,
  limit: 20,
  has_more: false,
});

function Providers({ children }: { children: ReactNode }) {
  return (
    <MemoryRouter initialEntries={["/landmarks/abc"]}>
      <WithAuth value={authValue(signedIn())}>{children}</WithAuth>
    </MemoryRouter>
  );
}

const categories = () => updateSafety.getSnapshot().protectedCategories;
const revision = () => updateSafety.getSnapshot().protectedRevision;
const text = () => screen.getByRole("textbox", { name: "Review (optional)" });

afterEach(() => {
  cleanup();
  expect(categories()).toEqual([]);
  vi.clearAllMocks();
});

describe("new-review draft", () => {
  it("first input protects it; further edits are new revisions; a failed post keeps it; a successful post clears it", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValue(null);
    render(<ReviewsSection landmarkId={L} />, { wrapper: Providers });
    await screen.findByRole("form", { name: "Write a review" });
    expect(categories()).toEqual([]);

    await userEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    expect(categories()).toEqual(["review-draft"]);
    const first = revision();
    fireEvent.change(text(), { target: { value: "Synthetic text" } });
    expect(revision()).toBeGreaterThan(first);
    expect(categories()).toEqual(["review-draft"]);

    create.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x"));
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(categories()).toEqual(["review-draft"]); // the draft is kept, and protected

    create.mockResolvedValueOnce({ ...OWN, rating: 4, body: "Synthetic text" });
    lookup.mockResolvedValue({ ...OWN, rating: 4, body: "Synthetic text" });
    await userEvent.click(screen.getByRole("button", { name: "Post review" }));
    await screen.findByRole("button", { name: "Edit your review" });
    expect(categories()).toEqual([]);
  });

  it("clearing the draft (no rating, empty text) removes protection; unmount leaves none", async () => {
    list.mockResolvedValue(page([]));
    lookup.mockResolvedValue(null);
    const view = render(<ReviewsSection landmarkId={L} />, { wrapper: Providers });
    await screen.findByRole("form", { name: "Write a review" });
    fireEvent.change(text(), { target: { value: "x" } });
    expect(categories()).toEqual(["review-draft"]);
    fireEvent.change(text(), { target: { value: "   " } });
    expect(categories()).toEqual([]);
    fireEvent.change(text(), { target: { value: "again" } });
    view.unmount();
    expect(categories()).toEqual([]);
  });
});

describe("review edit", () => {
  async function editOpen() {
    list.mockResolvedValue(page([OWN]));
    lookup.mockResolvedValue(OWN);
    const view = render(<ReviewsSection landmarkId={L} />, { wrapper: Providers });
    await userEvent.click(await screen.findByRole("button", { name: "Edit your review" }));
    return view;
  }

  it("is protected only while it differs from the saved review; reverting removes it", async () => {
    await editOpen();
    expect(categories()).toEqual([]); // opened, unchanged
    fireEvent.change(text(), { target: { value: "Original text, revised" } });
    expect(categories()).toEqual(["review-edit"]);
    const r = revision();
    fireEvent.change(text(), { target: { value: "Original text, revised again" } });
    expect(revision()).toBeGreaterThan(r);
    fireEvent.change(text(), { target: { value: "Original text" } }); // back to the saved text
    expect(categories()).toEqual([]);
    await userEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    expect(categories()).toEqual(["review-edit"]); // a different rating is a change too
  });

  it("Cancel removes protection; unmount mid-edit leaves none", async () => {
    const view = await editOpen();
    fireEvent.change(text(), { target: { value: "Changed" } });
    expect(categories()).toEqual(["review-edit"]);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(categories()).toEqual([]);
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    fireEvent.change(text(), { target: { value: "Changed again" } });
    act(() => view.unmount());
    expect(categories()).toEqual([]);
  });

  it("registers no review text", async () => {
    await editOpen();
    fireEvent.change(text(), { target: { value: "Synthetic secret review text" } });
    expect(JSON.stringify(updateSafety.getSnapshot())).not.toContain("Synthetic secret");
  });
});
