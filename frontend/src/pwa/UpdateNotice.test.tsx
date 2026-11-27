import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ServiceWorkerController, ServiceWorkerState, UpdatePhase } from "./serviceWorker";
import { UPDATE_MESSAGES, UpdateNotice } from "./UpdateNotice";
import { createUpdateSafety } from "./updateSafety";

/**
 * M06-T02 Increments 4a and 4b-iii — the update notice's presentation per
 * phase, with a stand-in controller. The controls' safety behavior with the
 * REAL controller and update-safety store is in UpdateNotice.integration.test.tsx.
 */

function fakeController(initial: UpdatePhase = "none") {
  const waiting = (u: UpdatePhase) => u === "waiting" || u === "postponed";
  let state: ServiceWorkerState = {
    registration: "registered",
    offlineReady: true,
    updateWaiting: waiting(initial),
    updateActivatedElsewhere: false,
    update: initial,
    waitingToken: waiting(initial) ? 1 : null,
  };
  const listeners = new Set<(s: ServiceWorkerState) => void>();
  const controller: ServiceWorkerController = {
    register: () => state,
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    postpone: vi.fn(() => set("postponed")),
    acceptUpdate: vi.fn(() => "not-waiting" as const),
    reloadPage: vi.fn(() => "not-available" as const),
    reconsider: vi.fn(),
    dispose: vi.fn(),
  };
  function set(update: UpdatePhase) {
    state = {
      ...state,
      update,
      updateWaiting: waiting(update),
      waitingToken: waiting(update) ? 1 : null,
    };
    for (const listener of listeners) listener(state);
  }
  return { controller, set: (update: UpdatePhase) => act(() => set(update)) };
}

const liveRegions = () => document.querySelectorAll("[aria-live], [role=status], [role=alert]");
const buttonNames = () => screen.queryAllByRole("button").map((b) => b.textContent);

describe("UpdateNotice", () => {
  it("renders nothing, and no live region, while there is nothing to say", () => {
    const { controller } = fakeController();
    render(<UpdateNotice controller={controller} safety={createUpdateSafety()} />);
    expect(liveRegions()).toHaveLength(0);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("announces a waiting update through one polite region (mounted empty first), offering Update now and Later", () => {
    const { controller, set } = fakeController();
    render(<UpdateNotice controller={controller} safety={createUpdateSafety()} />);
    set("waiting");
    const regions = liveRegions();
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveAttribute("aria-live", "polite");
    expect(regions[0]).not.toHaveAttribute("role");
    expect(regions[0]).toHaveTextContent(UPDATE_MESSAGES.waiting!);
    expect(buttonNames()).toEqual(["Update now", "Later"]);
    expect(controller.acceptUpdate).not.toHaveBeenCalled(); // never on its own
  });

  it("Later postpones by keyboard, closes the notice, and moves focus to the main content", async () => {
    const { controller, set } = fakeController();
    const onDismissed = vi.fn();
    render(
      <UpdateNotice
        controller={controller}
        safety={createUpdateSafety()}
        onDismissed={onDismissed}
      />,
    );
    set("waiting");
    screen.getByRole("button", { name: "Later" }).focus();
    await userEvent.keyboard("{Enter}");
    expect(controller.postpone).toHaveBeenCalledTimes(1);
    expect(onDismissed).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "Later" })).toBeNull();
    expect(liveRegions()[0]).toHaveTextContent("");
    expect(controller.acceptUpdate).not.toHaveBeenCalled();
  });

  it("by default, Later returns focus to #main-content", async () => {
    const { controller, set } = fakeController();
    render(
      <>
        <UpdateNotice controller={controller} safety={createUpdateSafety()} />
        <main id="main-content" tabIndex={-1}>
          content
        </main>
      </>,
    );
    set("waiting");
    await userEvent.click(screen.getByRole("button", { name: "Later" }));
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it.each<[UpdatePhase, string[]]>([
    ["activated-elsewhere", ["Reload"]],
    ["reload-required", ["Reload"]],
    ["failed", ["Check again"]],
    ["unavailable", []],
    ["unresolved", []],
    ["activating", []],
    ["reloading", []],
  ])("%s: its message, with only %j", (phase, buttons) => {
    const { controller, set } = fakeController();
    render(<UpdateNotice controller={controller} safety={createUpdateSafety()} />);
    set(phase);
    expect(liveRegions()).toHaveLength(1);
    expect(liveRegions()[0]).toHaveTextContent(UPDATE_MESSAGES[phase]!);
    expect(buttonNames()).toEqual(buttons);
  });

  it.each<UpdatePhase>(["none", "postponed"])("%s: nothing is shown", (phase) => {
    const { controller } = fakeController(phase);
    render(<UpdateNotice controller={controller} safety={createUpdateSafety()} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(liveRegions()).toHaveLength(0);
  });

  it("Check again after a failure only re-reads the waiting worker (no acceptance)", async () => {
    const { controller, set } = fakeController();
    render(<UpdateNotice controller={controller} safety={createUpdateSafety()} />);
    set("failed");
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(controller.reconsider).toHaveBeenCalledTimes(1);
    expect(controller.acceptUpdate).not.toHaveBeenCalled();
  });

  it("messages never claim an automatic reload, an installation, or that the version was replaced", () => {
    for (const message of Object.values(UPDATE_MESSAGES)) {
      expect(message).not.toMatch(/will reload|reloading now|install|was updated|is now using/i);
    }
    expect(UPDATE_MESSAGES["activated-elsewhere"]).toMatch(/version it opened with/);
    expect(UPDATE_MESSAGES["reload-required"]).toMatch(/version it opened with/);
  });

  it("focus is never moved by a change of phase", () => {
    const { controller, set } = fakeController();
    render(
      <>
        <button type="button">Elsewhere</button>
        <UpdateNotice controller={controller} safety={createUpdateSafety()} />
      </>,
    );
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    set("waiting");
    set("activated-elsewhere");
    set("failed");
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });
});
