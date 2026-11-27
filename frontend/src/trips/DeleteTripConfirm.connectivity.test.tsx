import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { DeleteTripConfirm } from "./DeleteTripConfirm";

/**
 * M06-T02 Increment 3b-ii — deleting a trip as an online-only action
 * (OFF-UX-5). Only "Delete trip permanently" is refused; the confirmation
 * stays open (its text keeps focus handling) and Cancel stays available.
 */

function evidence(kind: RequestEvidence) {
  act(() => connectivity.reportOutcome(connectivity.beginRequest(), kind));
}
const browserEvent = (type: "online" | "offline") =>
  act(() => {
    window.dispatchEvent(new Event(type));
  });
const STATES: [string, () => void][] = [
  ["reachable", () => evidence("response")],
  [
    "unknown reachability",
    () => {
      evidence("network-failure");
      browserEvent("online");
    },
  ],
  ["a server problem", () => evidence("server-problem")],
  ["the browser's offline hint alone", () => browserEvent("offline")],
];

function renderConfirm({ busy = false } = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const view = (b: boolean) => (
    <DeleteTripConfirm
      tripName="Weekend"
      busy={b}
      textRef={createRef()}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
  const result = render(view(busy));
  return { onConfirm, onCancel, rerender: (b: boolean) => result.rerender(view(b)) };
}

const confirm = () => screen.getByRole("button", { name: "Delete trip permanently" });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("DeleteTripConfirm — the deletion needs the server", () => {
  it.each(STATES)("deletes normally with %s", async (_label, apply) => {
    const { onConfirm } = renderConfirm();
    apply();
    await userEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("while unreachable, mouse and keyboard presses delete nothing; the confirmation stays and Cancel works", async () => {
    const { onConfirm, onCancel } = renderConfirm();
    evidence("network-failure");
    expect(confirm()).toHaveAttribute("aria-disabled", "true");
    expect(confirm()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    await userEvent.click(confirm());
    confirm().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(confirm()).toHaveFocus();
    expect(screen.getByText(/permanently\? This can't be undone/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("recovery restores the button without deleting; an explicit press then deletes", async () => {
    const { onConfirm } = renderConfirm();
    evidence("network-failure");
    evidence("response");
    expect(confirm()).not.toHaveAttribute("aria-disabled");
    expect(onConfirm).not.toHaveBeenCalled();
    await userEvent.click(confirm());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("the page's pending deletion is kept through loss and recovery", () => {
    const { rerender } = renderConfirm({ busy: true });
    evidence("network-failure");
    evidence("response");
    rerender(true);
    expect(confirm()).toHaveAttribute("aria-disabled", "true");
  });
});

describe("DeleteTripConfirm — data-pending (D2)", () => {
  it("marked while the page's change is pending, not while only unreachable", () => {
    const { rerender } = renderConfirm();
    evidence("network-failure");
    expect(confirm()).not.toHaveAttribute("data-pending");
    rerender(true);
    expect(confirm()).toHaveAttribute("data-pending", "true");
    rerender(false);
    expect(confirm()).not.toHaveAttribute("data-pending");
  });
});
