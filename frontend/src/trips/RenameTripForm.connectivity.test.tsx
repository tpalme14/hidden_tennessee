import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { RenameTripForm } from "./RenameTripForm";

/**
 * M06-T02 Increment 3b-ii — saving a trip name as an online-only action
 * (OFF-UX-5). The form's own submit path is guarded (click, Enter, and direct
 * submission); typing and Cancel stay available, and the draft (held by the
 * page) survives every connectivity change.
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

function Host({
  onSubmit,
  onCancel = vi.fn(),
  busy = false,
}: {
  onSubmit: () => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const [value, setValue] = useState("Weekend");
  return (
    <RenameTripForm
      value={value}
      error={null}
      note={null}
      busy={busy}
      inputRef={createRef()}
      saveRef={createRef()}
      onChange={setValue}
      onSubmit={onSubmit}
      onCancel={onCancel}
    />
  );
}

const input = () => screen.getByRole("textbox", { name: "Trip name" });
const save = () => screen.getByRole("button", { name: "Save name" });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("RenameTripForm — saving the name needs the server", () => {
  it.each(STATES)("submits normally with %s", async (_label, apply) => {
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);
    apply();
    await userEvent.click(save());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("while unreachable, click, Enter, and direct submission send nothing; typing and Cancel still work", async () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(<Host onSubmit={onSubmit} onCancel={onCancel} />);
    evidence("network-failure");
    await userEvent.clear(input());
    await userEvent.type(input(), "Long weekend");
    expect(save()).toHaveAttribute("aria-disabled", "true");
    expect(save()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);

    await userEvent.click(save());
    await userEvent.type(input(), "{Enter}");
    const form = input().closest("form")!;
    fireEvent.submit(form);
    act(() => form.requestSubmit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(input()).toHaveValue("Long weekend");
    expect(input()).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("keeps the typed name across loss and recovery, never submits by itself, and submits when asked", async () => {
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} />);
    await userEvent.clear(input());
    await userEvent.type(input(), "Fall colors");
    evidence("network-failure");
    browserEvent("offline");
    expect(input()).toHaveValue("Fall colors");
    browserEvent("online"); // unreachable → unknown
    evidence("response");
    expect(input()).toHaveValue("Fall colors");
    expect(save()).not.toHaveAttribute("aria-disabled");
    expect(onSubmit).not.toHaveBeenCalled();
    await userEvent.click(save());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("the page's pending state is kept through loss and recovery", () => {
    const onSubmit = vi.fn();
    render(<Host onSubmit={onSubmit} busy />);
    evidence("network-failure");
    evidence("response");
    expect(save()).toHaveAttribute("aria-disabled", "true");
    expect(save()).not.toHaveAccessibleDescription(ONLINE_ONLY_REASON);
  });
});

describe("RenameTripForm — data-pending (D2)", () => {
  it("marked while the page's change is pending, not while only unreachable", () => {
    const onSubmit = vi.fn();
    const { rerender } = render(<Host onSubmit={onSubmit} />);
    evidence("network-failure");
    expect(save()).not.toHaveAttribute("data-pending");
    rerender(<Host onSubmit={onSubmit} busy />);
    expect(save()).toHaveAttribute("data-pending", "true");
  });
});
