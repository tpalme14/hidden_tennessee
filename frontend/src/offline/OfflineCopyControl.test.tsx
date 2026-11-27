import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectivity } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { OfflineCopyControl } from "./OfflineCopyControl";
import {
  availableLandmark,
  fakeAccount,
  landmarkMarker,
  LM,
  renderWithAccount,
} from "./offlineTestContext";

/**
 * M06-T03 Increment 3e — the "Save for offline" control (OFF-UX-1, OFF-UX-5,
 * §3.3, E2). A stubbed account context with a REAL view store: status comes
 * only from published entries (DR-3).
 */

const control = <OfflineCopyControl kind="landmark" id={LM} name="Saved Falls" />;

afterEach(() => {
  act(() => connectivity.reportOutcome(connectivity.beginRequest(), "response"));
});

describe("OfflineCopyControl", () => {
  it("not saved: Save for offline saves through the operation and announces the result honestly", async () => {
    const user = userEvent.setup();
    const saveLandmark = vi.fn(() =>
      Promise.resolve({ kind: "saved" as const, persistence: "denied" as const }),
    );
    const { value } = fakeAccount({}, { saveLandmark });
    render(renderWithAccount(control, value));
    expect(screen.getByText("Not saved for offline.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save for offline" }));
    expect(saveLandmark).toHaveBeenCalledWith(LM);
    expect(await screen.findByRole("status")).toHaveTextContent(/Saved for offline\./);
    expect(screen.getByRole("status")).toHaveTextContent(/may remove saved copies/);
  });

  it("a published copy shows its freshness with Refresh and Remove; Remove is local", async () => {
    const user = userEvent.setup();
    const removeLandmark = vi.fn(() => Promise.resolve({ kind: "removed" as const }));
    const { value, view } = fakeAccount({}, { removeLandmark });
    render(renderWithAccount(control, value));
    act(() => view.apply({ landmarks: [[LM, availableLandmark()]] }));
    expect(screen.getByText(/Saved for offline\. Last synced about/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Refresh offline copy" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Remove offline copy" }));
    expect(removeLandmark).toHaveBeenCalledWith(LM);
    expect(await screen.findByRole("status")).toHaveTextContent("removed from this device");
  });

  it("a marker says when unavailability was recorded, never that it was refreshed (AC-39)", () => {
    const { value, view } = fakeAccount();
    render(renderWithAccount(control, value));
    act(() => view.apply({ landmarks: [[LM, landmarkMarker()]] }));
    expect(screen.getByText(/No longer available — recorded/)).toBeVisible();
    expect(screen.queryByText(/synced|refreshed/i)).toBeNull();
  });

  it("offline-read: Save and Refresh are disabled with the reason; Remove stays available (E2)", async () => {
    const user = userEvent.setup();
    const saveLandmark = vi.fn();
    const removeLandmark = vi.fn(() => Promise.resolve({ kind: "removed" as const }));
    const { value, view } = fakeAccount(
      { offline: "offline-read" },
      { saveLandmark, removeLandmark },
    );
    render(renderWithAccount(control, value));
    await user.click(screen.getByRole("button", { name: "Save for offline" }));
    expect(screen.getByRole("button", { name: "Save for offline" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(saveLandmark).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Saving and refreshing need you to be signed in with a connection to the server.",
      ),
    ).toBeVisible();
    act(() => view.apply({ landmarks: [[LM, availableLandmark()]] }));
    await user.click(screen.getByRole("button", { name: "Remove offline copy" }));
    expect(removeLandmark).toHaveBeenCalledTimes(1);
  });

  it("while the server can't be reached, Save is disabled with the reason and nothing is queued (OFF-UX-5)", async () => {
    const user = userEvent.setup();
    const saveLandmark = vi.fn();
    const { value } = fakeAccount({}, { saveLandmark });
    render(renderWithAccount(control, value));
    act(() => connectivity.reportOutcome(connectivity.beginRequest(), "network-failure"));
    const save = screen.getByRole("button", { name: "Save for offline" });
    expect(save).toHaveAttribute("aria-disabled", "true");
    expect(save).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    await user.click(save);
    expect(saveLandmark).not.toHaveBeenCalled();
  });

  it.each([
    [
      { kind: "limit-reached" as const, limit: 200 },
      /limit of 200 saved landmarks.*Remove a saved copy/,
    ],
    [{ kind: "quota" as const }, /storage for this site is full/],
    [{ kind: "superseded" as const }, /marked unavailable while the request was in progress/],
  ])("reports %o as an alert", async (result, text) => {
    const user = userEvent.setup();
    const { value } = fakeAccount({}, { saveLandmark: vi.fn(() => Promise.resolve(result)) });
    render(renderWithAccount(control, value));
    await user.click(screen.getByRole("button", { name: "Save for offline" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
  });

  it("signed out: invites sign-in and offers no save action", () => {
    const { value } = fakeAccount({ offline: "none" });
    render(renderWithAccount(control, value, { signedIn: false }));
    expect(screen.getByText("Sign in to save this for offline use.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Save for offline" })).toBeNull();
  });

  it("works from the keyboard alone", async () => {
    const user = userEvent.setup();
    const saveLandmark = vi.fn(() => Promise.resolve({ kind: "saved" as const }));
    const { value } = fakeAccount({}, { saveLandmark });
    render(renderWithAccount(control, value));
    await user.tab();
    expect(screen.getByRole("button", { name: "Save for offline" })).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(saveLandmark).toHaveBeenCalledTimes(1);
  });
});
