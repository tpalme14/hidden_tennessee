import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { NewTripForm } from "./NewTripForm";

/**
 * M06-T02 Increment 3b-ii — the picker's "Create trip and add" as an
 * online-only action (OFF-UX-5). The form's own submit path is guarded; the
 * typed name is kept; the existing `disabled` (landmark unavailable) and
 * `busy` (another action) conditions still refuse, including after recovery.
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

function renderForm({ disabled = false, busy = false } = {}) {
  const onCreate = vi.fn(() => Promise.resolve({}));
  render(
    <NewTripForm landmarkName="Alpha Falls" disabled={disabled} busy={busy} onCreate={onCreate} />,
  );
  return onCreate;
}
const input = () => screen.getByRole("textbox", { name: "New trip name" });
const submit = () => screen.getByRole("button", { name: "Create trip and add Alpha Falls" });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("NewTripForm — creating and adding needs the server", () => {
  it.each(STATES)("submits normally with %s", async (_label, apply) => {
    const onCreate = renderForm();
    apply();
    await userEvent.type(input(), "Weekend");
    await userEvent.click(submit());
    expect(onCreate).toHaveBeenCalledWith("Weekend");
  });

  it("while unreachable, click, Enter, and direct submission send nothing; the name is kept", async () => {
    const onCreate = renderForm();
    evidence("network-failure");
    await userEvent.type(input(), "Weekend");
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    expect(submit()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    // The button keeps its accessible name.
    expect(submit()).toHaveAccessibleName("Create trip and add Alpha Falls");
    await userEvent.click(submit());
    await userEvent.type(input(), "{Enter}");
    const form = input().closest("form")!;
    fireEvent.submit(form);
    act(() => form.requestSubmit());
    expect(onCreate).not.toHaveBeenCalled();
    expect(input()).toHaveValue("Weekend");
  });

  it("recovery keeps the name and sends nothing until asked", async () => {
    const onCreate = renderForm();
    await userEvent.type(input(), "Smokies Loop");
    evidence("network-failure");
    browserEvent("online");
    expect(input()).toHaveValue("Smokies Loop");
    expect(onCreate).not.toHaveBeenCalled();
    await userEvent.click(submit());
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["busy (another action)", { busy: true }],
    ["disabled (landmark unavailable)", { disabled: true }],
  ])("the existing %s condition still refuses after loss and recovery", async (_label, props) => {
    const onCreate = renderForm(props);
    await userEvent.type(input(), "Weekend");
    evidence("network-failure");
    evidence("response");
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(submit());
    act(() => input().closest("form")!.requestSubmit());
    expect(onCreate).not.toHaveBeenCalled();
  });
});

describe("NewTripForm — data-pending (D2)", () => {
  it("not marked for the landmark-unavailable restriction or connectivity", () => {
    renderForm({ disabled: true });
    expect(submit()).toHaveAttribute("aria-disabled", "true");
    expect(submit()).not.toHaveAttribute("data-pending");
    evidence("network-failure");
    expect(submit()).not.toHaveAttribute("data-pending");
  });

  it("marked while busy", () => {
    renderForm({ busy: true });
    expect(submit()).toHaveAttribute("data-pending", "true");
  });
});
