import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { CreateTripForm } from "./CreateTripForm";

/**
 * M06-T02 Increment 3b-ii — creating a trip on My Trips as an online-only
 * action (OFF-UX-5). The form's own submit path is guarded; the typed name is
 * kept; the existing `busy` lock still refuses a second creation, including
 * after recovery.
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

const input = () => screen.getByRole("textbox", { name: "New trip name" });
const submit = () => screen.getByRole("button", { name: "Create trip" });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("CreateTripForm — creating a trip needs the server", () => {
  it.each(STATES)("creates normally with %s", async (_label, apply) => {
    const onCreate = vi.fn(() => Promise.resolve({}));
    render(<CreateTripForm busy={false} onCreate={onCreate} />);
    apply();
    await userEvent.type(input(), "Weekend");
    await userEvent.click(submit());
    expect(onCreate).toHaveBeenCalledWith("Weekend");
  });

  it("while unreachable, click, Enter, and direct submission create nothing; the name is kept and editable", async () => {
    const onCreate = vi.fn(() => Promise.resolve({}));
    render(<CreateTripForm busy={false} onCreate={onCreate} />);
    evidence("network-failure");
    await userEvent.type(input(), "Weekend");
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    expect(submit()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);

    await userEvent.click(submit());
    await userEvent.type(input(), "{Enter}");
    const form = input().closest("form")!;
    fireEvent.submit(form);
    act(() => form.requestSubmit());
    expect(onCreate).not.toHaveBeenCalled();
    expect(input()).toHaveValue("Weekend");
    // No validation error appeared either: the attempt was simply refused.
    expect(input()).not.toHaveAttribute("aria-invalid");
  });

  it("keeps the name across loss and recovery, never creates by itself, and creates when asked", async () => {
    const onCreate = vi.fn(() => Promise.resolve({}));
    render(<CreateTripForm busy={false} onCreate={onCreate} />);
    await userEvent.type(input(), "Fall colors");
    evidence("network-failure");
    browserEvent("offline");
    browserEvent("online");
    evidence("response");
    expect(input()).toHaveValue("Fall colors");
    expect(onCreate).not.toHaveBeenCalled();
    await userEvent.click(submit());
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("an existing creation lock still refuses a second creation after loss and recovery", async () => {
    const onCreate = vi.fn(() => Promise.resolve({}));
    render(<CreateTripForm busy onCreate={onCreate} />);
    await userEvent.type(input(), "Weekend");
    evidence("network-failure");
    evidence("response");
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(submit());
    act(() => input().closest("form")!.requestSubmit());
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("CreateTripForm — data-pending (D2)", () => {
  it("marked only while a creation (or its check) is pending, including while unreachable", () => {
    const onCreate = vi.fn(() => Promise.resolve({}));
    const { rerender } = render(<CreateTripForm busy={false} onCreate={onCreate} />);
    expect(submit()).not.toHaveAttribute("data-pending");
    evidence("network-failure");
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    expect(submit()).not.toHaveAttribute("data-pending");
    rerender(<CreateTripForm busy onCreate={onCreate} />);
    expect(submit()).toHaveAttribute("data-pending", "true");
    evidence("response");
    expect(submit()).toHaveAttribute("data-pending", "true");
    rerender(<CreateTripForm busy={false} onCreate={onCreate} />);
    expect(submit()).not.toHaveAttribute("data-pending");
    expect(submit()).not.toHaveAttribute("aria-disabled");
  });
});
