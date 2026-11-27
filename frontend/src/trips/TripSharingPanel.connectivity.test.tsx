import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { TripSharingPanel } from "./TripSharingPanel";

/**
 * M06-T02 Increment 3b-ii — creating, replacing, and turning off a share link
 * as online-only actions (OFF-UX-5). Copying a link already shown is local and
 * stays available; a connectivity change never clears the link or asks the
 * page for anything. The link here is a synthetic placeholder, not a token.
 */

const LINK = "http://localhost:3000/shared/example-placeholder";

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

function renderPanel({
  isShared,
  link = null,
  busy = false,
}: {
  isShared: boolean;
  link?: string | null;
  busy?: boolean;
}) {
  const onCreate = vi.fn();
  const onRevoke = vi.fn();
  const onCopy = vi.fn();
  const view = (b: boolean) => (
    <TripSharingPanel
      isShared={isShared}
      link={link}
      busy={b}
      headingRef={createRef()}
      fieldRef={createRef()}
      copyRef={createRef()}
      createRef={createRef()}
      revokeRef={createRef()}
      onCreate={onCreate}
      onRevoke={onRevoke}
      onCopy={onCopy}
    />
  );
  const result = render(view(busy));
  return { onCreate, onRevoke, onCopy, rerender: (b: boolean) => result.rerender(view(b)) };
}

const button = (name: string) => screen.getByRole("button", { name });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("TripSharingPanel — sharing changes need the server", () => {
  it.each(STATES)("creates a link normally with %s", async (_label, apply) => {
    const { onCreate } = renderPanel({ isShared: false });
    apply();
    await userEvent.click(button("Create share link"));
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it.each(STATES)("replaces and turns off normally with %s", async (_label, apply) => {
    const { onCreate, onRevoke } = renderPanel({ isShared: true, link: LINK });
    apply();
    await userEvent.click(button("Create new link"));
    await userEvent.click(button("Turn off sharing"));
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  it("not shared, unreachable: Create share link sends nothing, with the reason", async () => {
    const { onCreate } = renderPanel({ isShared: false });
    evidence("network-failure");
    expect(button("Create share link")).toHaveAttribute("aria-disabled", "true");
    expect(button("Create share link")).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    await userEvent.click(button("Create share link"));
    button("Create share link").focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onCreate).not.toHaveBeenCalled();
    expect(button("Create share link")).toHaveFocus();
  });

  it("shared with a link, unreachable: replace and turn off send nothing; the link stays and can still be copied", async () => {
    const { onCreate, onRevoke, onCopy } = renderPanel({ isShared: true, link: LINK });
    const field = () => screen.getByRole("textbox", { name: "Share link" });
    evidence("network-failure");
    browserEvent("offline");

    for (const name of ["Create new link", "Turn off sharing"]) {
      expect(button(name)).toHaveAttribute("aria-disabled", "true");
      expect(button(name)).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
      await userEvent.click(button(name));
    }
    expect(onCreate).not.toHaveBeenCalled();
    expect(onRevoke).not.toHaveBeenCalled();

    expect(field()).toHaveValue(LINK);
    expect(button("Copy link")).not.toHaveAttribute("aria-disabled");
    expect(button("Copy link")).not.toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    await userEvent.click(button("Copy link"));
    expect(onCopy).toHaveBeenCalledTimes(1);

    browserEvent("online"); // unreachable → unknown
    expect(field()).toHaveValue(LINK);
    expect(screen.getByText(/Sharing is on\. Anyone who has this link/)).toBeInTheDocument();
    expect(onCreate).not.toHaveBeenCalled();
    expect(onRevoke).not.toHaveBeenCalled();
    await userEvent.click(button("Turn off sharing"));
    expect(onRevoke).toHaveBeenCalledTimes(1);
  });

  it("shared without a link held: both changes are refused while unreachable; one reason serves the section", async () => {
    const { onCreate, onRevoke } = renderPanel({ isShared: true, link: null });
    evidence("network-failure");
    await userEvent.click(button("Create new link"));
    await userEvent.click(button("Turn off sharing"));
    expect(onCreate).not.toHaveBeenCalled();
    expect(onRevoke).not.toHaveBeenCalled();
    expect(screen.getAllByText(ONLINE_ONLY_REASON)).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });

  it("an existing sharing lock is kept through loss and recovery", () => {
    const { rerender } = renderPanel({ isShared: true, link: LINK, busy: true });
    evidence("network-failure");
    evidence("response");
    rerender(true);
    expect(button("Create new link")).toHaveAttribute("aria-disabled", "true");
    expect(button("Turn off sharing")).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("textbox", { name: "Share link" })).toHaveValue(LINK);
  });
});

describe("TripSharingPanel — data-pending (D2)", () => {
  it("the shared lock marks the changes; Copy link never; connectivity alone never", () => {
    const { rerender } = renderPanel({ isShared: true, link: LINK });
    evidence("network-failure");
    for (const name of ["Create new link", "Turn off sharing"]) {
      expect(button(name)).not.toHaveAttribute("data-pending");
    }
    rerender(true);
    for (const name of ["Create new link", "Turn off sharing"]) {
      expect(button(name)).toHaveAttribute("data-pending", "true");
    }
    expect(button("Copy link")).not.toHaveAttribute("data-pending");
    evidence("response");
    expect(button("Turn off sharing")).toHaveAttribute("data-pending", "true");
    rerender(false);
    expect(button("Turn off sharing")).not.toHaveAttribute("data-pending");
  });
});
