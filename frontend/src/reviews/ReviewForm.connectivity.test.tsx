import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { EMPTY_DRAFT, ReviewForm, type ReviewDraft } from "./ReviewForm";

/**
 * M06-T02 Increment 3b-i — review submission as an online-only action
 * (OFF-UX-5). The form's SUBMIT path is guarded (click, keyboard, and direct
 * form submission); typing, rating, and Cancel stay available, and the draft
 * (held by the parent) survives every connectivity change.
 */

function evidence(kind: RequestEvidence) {
  act(() => connectivity.reportOutcome(connectivity.beginRequest(), kind));
}
const browserEvent = (type: "online" | "offline") =>
  act(() => {
    window.dispatchEvent(new Event(type));
  });

function Host({
  onSubmit,
  onCancel,
  submitting = false,
}: {
  onSubmit: (value: unknown) => void;
  onCancel?: () => void;
  submitting?: boolean;
}) {
  const [draft, setDraft] = useState<ReviewDraft>(EMPTY_DRAFT);
  return (
    <ReviewForm
      heading="Write a review"
      submitLabel="Post review"
      submittingLabel="Posting…"
      draft={draft}
      onDraftChange={setDraft}
      onSubmit={onSubmit}
      submitting={submitting}
      serverError={null}
      onCancel={onCancel}
    />
  );
}

const submitButton = () => screen.getByRole("button", { name: /^(Post review|Posting…)$/ });
const textarea = () => screen.getByRole("textbox", { name: "Review (optional)" });
const form = () => screen.getByRole("form", { name: "Write a review" });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("ReviewForm — submission needs the server", () => {
  it.each<[string, () => void]>([
    [
      "unknown reachability",
      () => {
        evidence("network-failure");
        browserEvent("online");
      },
    ],
    ["a server problem", () => evidence("server-problem")],
    ["the browser's offline hint alone", () => browserEvent("offline")],
  ])("submits normally with %s", async (_label, apply) => {
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);
    apply();
    await userEvent.click(screen.getByRole("radio", { name: "4 stars" }));
    await userEvent.click(submitButton());
    expect(onSubmit).toHaveBeenCalledWith({ rating: 4, body: null });
  });

  it("while unreachable, editing still works but click, Enter, Space, and direct form submission send nothing", async () => {
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);
    evidence("network-failure");
    // Local editing stays available.
    await userEvent.click(screen.getByRole("radio", { name: "5 stars" }));
    await userEvent.type(textarea(), "Lovely falls");
    expect(screen.getByRole("radio", { name: "5 stars" })).toBeChecked();
    expect(textarea()).toHaveValue("Lovely falls");

    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    expect(submitButton()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    await userEvent.click(submitButton());
    submitButton().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    fireEvent.submit(form());
    act(() => (form() as HTMLFormElement).requestSubmit());
    expect(onSubmit).not.toHaveBeenCalled();
    // No validation summary appeared either: the attempt was simply refused.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(submitButton()).toHaveFocus();
  });

  it("keeps the rating and text across loss and recovery, never submits by itself, and submits when asked", async () => {
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);
    await userEvent.click(screen.getByRole("radio", { name: "3 stars" }));
    await userEvent.type(textarea(), "Worth the hike");
    evidence("network-failure");
    browserEvent("offline");
    expect(textarea()).toHaveValue("Worth the hike");
    expect(screen.getByRole("radio", { name: "3 stars" })).toBeChecked();
    browserEvent("online"); // unreachable → unknown
    evidence("response");
    expect(textarea()).toHaveValue("Worth the hike");
    expect(screen.getByRole("radio", { name: "3 stars" })).toBeChecked();
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(submitButton());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith({ rating: 3, body: "Worth the hike" });
  });

  it("Cancel stays available while unreachable", async () => {
    const onCancel = vi.fn();
    render(<Host onSubmit={vi.fn()} onCancel={onCancel} />);
    evidence("network-failure");
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("an existing submission lock is preserved through connectivity changes", async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Host onSubmit={onSubmit} submitting />);
    expect(submitButton()).toHaveAttribute("aria-busy", "true");
    evidence("network-failure");
    evidence("response");
    rerender(<Host onSubmit={onSubmit} submitting />);
    expect(submitButton()).toHaveAttribute("aria-busy", "true");
    expect(submitButton()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(submitButton());
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
