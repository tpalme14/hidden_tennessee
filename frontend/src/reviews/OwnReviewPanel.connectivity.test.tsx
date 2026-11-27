import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LandmarkReviewsPage, Review } from "../api/reviews";
import { deferred } from "../auth/testFixtures";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { WithAuth, authValue, signedIn } from "./testAuth";

/**
 * M06-T02 Increment 3b-i — the own-review panel's server actions while the
 * server cannot be reached (OFF-UX-5): confirming a deletion and saving an
 * edit are refused; opening and cancelling the confirmation, and editing the
 * text, stay available. Reviews API mocked; evidence comes from the test.
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
const update = vi.mocked(api.updateReview);
const remove = vi.mocked(api.deleteReview);

const L = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const OWN: Review = {
  id: "00000000-0000-4000-8000-0000000000aa",
  rating: 3,
  body: "Original text",
  created_at: "2026-11-21T16:31:04.123Z",
  updated_at: "2026-11-21T16:31:04.123Z",
  author_label: "Community Member",
};
const PAGE: LandmarkReviewsPage = {
  reviews: [OWN],
  aggregate: { average_rating: 3, rating_count: 1 },
  page: 1,
  limit: 20,
  has_more: false,
};

function evidence(kind: RequestEvidence) {
  act(() => connectivity.reportOutcome(connectivity.beginRequest(), kind));
}
const browserEvent = (type: "online" | "offline") =>
  act(() => {
    window.dispatchEvent(new Event(type));
  });

async function renderWithOwnReview() {
  list.mockResolvedValue(PAGE);
  lookup.mockResolvedValue(OWN);
  function Providers({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={["/landmarks/abc"]}>
        <WithAuth value={authValue(signedIn())}>{children}</WithAuth>
      </MemoryRouter>
    );
  }
  render(<ReviewsSection landmarkId={L} />, { wrapper: Providers });
  await screen.findByRole("button", { name: "Edit your review" });
}

const deleteButton = () => screen.getByRole("button", { name: "Delete your review" });
const confirmButton = () => screen.getByRole("button", { name: /^(Delete review|Deleting…)$/ });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
  vi.clearAllMocks();
});

describe("deleting your review while the server cannot be reached", () => {
  it("opening and cancelling the confirmation still work; confirming is refused with a reason and sends nothing", async () => {
    await renderWithOwnReview();
    evidence("network-failure");
    await userEvent.click(deleteButton());
    expect(screen.getByText("Delete your review? This can't be undone.")).toHaveFocus();
    expect(confirmButton()).toHaveAttribute("aria-disabled", "true");
    expect(confirmButton()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    await userEvent.click(confirmButton());
    confirmButton().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(remove).not.toHaveBeenCalled();
    expect(confirmButton()).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(deleteButton()).toHaveFocus();
    expect(remove).not.toHaveBeenCalled();
  });

  it("after recovery nothing happens by itself; an explicit confirmation deletes", async () => {
    await renderWithOwnReview();
    remove.mockResolvedValue(undefined);
    evidence("network-failure");
    await userEvent.click(deleteButton());
    evidence("response");
    expect(remove).not.toHaveBeenCalled();
    expect(confirmButton()).not.toHaveAttribute("aria-disabled");
    await userEvent.click(confirmButton());
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("a deletion already in flight keeps its lock when the server becomes unreachable", async () => {
    await renderWithOwnReview();
    const pending = deferred<void>();
    remove.mockReturnValueOnce(pending.promise);
    await userEvent.click(deleteButton());
    await userEvent.click(confirmButton());
    expect(confirmButton()).toHaveTextContent("Deleting…");
    evidence("network-failure");
    expect(confirmButton()).toHaveAttribute("aria-busy", "true");
    await userEvent.click(confirmButton());
    expect(remove).toHaveBeenCalledTimes(1);
    lookup.mockResolvedValue(null);
    await act(async () => pending.resolve());
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
  });
});

describe("editing your review while the server cannot be reached", () => {
  it("keeps the edited text, refuses to save, and saves only when asked after recovery", async () => {
    await renderWithOwnReview();
    update.mockResolvedValue({ ...OWN, body: "Original text, revised" });
    await userEvent.click(screen.getByRole("button", { name: "Edit your review" }));
    const text = screen.getByRole("textbox", { name: "Review (optional)" });
    evidence("network-failure");
    await userEvent.type(text, ", revised");
    const save = screen.getByRole("button", { name: "Save changes" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(save);
    expect(update).not.toHaveBeenCalled();
    expect(text).toHaveValue("Original text, revised");
    evidence("response");
    expect(update).not.toHaveBeenCalled();
    expect(text).toHaveValue("Original text, revised");
    await userEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(OWN.id, { body: "Original text, revised" });
  });
});
