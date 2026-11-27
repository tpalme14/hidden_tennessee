import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";
import { connectivity } from "../connectivity/connectivity";
import {
  createInstallPromptStore,
  type BeforeInstallPromptEventLike,
  type InstallEnvironment,
} from "./installPrompt";
import {
  INSTALL_GUIDANCE,
  INSTALL_MESSAGES,
  InstallAffordance,
  OFFLINE_NOTE,
} from "./InstallAffordance";
import { createUpdateSafety, updateSafety } from "./updateSafety";

/**
 * M06-T02 Increment 4d — the installation affordance with a REAL
 * installation store (browser primitives faked) and a real update-safety store.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function promptEvent({ promptThrows = false } = {}) {
  const choice = deferred<{ outcome: string }>();
  const event = new Event("beforeinstallprompt", {
    cancelable: true,
  }) as BeforeInstallPromptEventLike;
  const prompt = vi.fn(() => {
    if (promptThrows) throw new Error("NotAllowedError");
    return Promise.resolve();
  });
  Object.defineProperty(event, "prompt", { value: prompt });
  Object.defineProperty(event, "userChoice", { value: choice.promise });
  return { event, prompt, choice };
}

function setup({ standalone = false, strict = false } = {}) {
  const listeners: Record<string, Set<(e: Event) => void>> = {
    beforeinstallprompt: new Set(),
    appinstalled: new Set(),
  };
  const environment: InstallEnvironment = {
    supportsPromptEvent: () => true,
    addEventListener: (type, l) => listeners[type]!.add(l),
    removeEventListener: (type, l) => listeners[type]!.delete(l),
    standaloneQuery: () => ({ matches: standalone }),
    navigatorStandalone: () => false,
  };
  const store = createInstallPromptStore(environment);
  store.start();
  const safety = createUpdateSafety();
  const ui = (
    <>
      <button type="button">Elsewhere</button>
      <InstallAffordance store={store} safety={safety} />
    </>
  );
  render(strict ? <StrictMode>{ui}</StrictMode> : ui);
  return {
    store,
    safety,
    dispatch: (event: Event) =>
      act(() => {
        for (const l of [...listeners[event.type]!]) l(event);
      }),
  };
}

const liveRegions = () => document.querySelectorAll("[aria-live], [role=status], [role=alert]");
const installButton = () => screen.queryByRole("button", { name: "Install app" });
const settle = (resolve: () => void) =>
  act(async () => {
    resolve();
    await new Promise((r) => setTimeout(r, 0));
  });

describe("InstallAffordance", () => {
  it("without a prompt: collapsed generic guidance (no Install app button, no live region)", async () => {
    setup();
    expect(installButton()).toBeNull();
    expect(liveRegions()).toHaveLength(0);
    const summary = screen.getByText("Install this app");
    expect(summary.tagName).toBe("SUMMARY");
    await userEvent.click(summary);
    expect(screen.getByText(INSTALL_GUIDANCE)).toBeVisible();
    expect(screen.getByText(OFFLINE_NOTE)).toBeVisible();
  });

  it("guidance never promises an option or offline data", () => {
    expect(INSTALL_GUIDANCE).toMatch(/Not every browser offers this/);
    expect(OFFLINE_NOTE).toMatch(/doesn't download landmarks, trips, maps, or your account/);
    for (const message of Object.values(INSTALL_MESSAGES)) {
      expect(message).not.toMatch(/works offline|available offline/i);
    }
    // M06-T03 3e (Q5): the note now points to the explicit "Save for offline"
    // action, and still never says installing makes anything available offline.
    expect(OFFLINE_NOTE).toMatch(/save it with Save for offline while signed in/);
    for (const text of [INSTALL_GUIDANCE, OFFLINE_NOTE, ...Object.values(INSTALL_MESSAGES)]) {
      expect(text).not.toMatch(/works offline|available offline|downloads? (your|the|saved)/i);
    }
    expect(INSTALL_MESSAGES.accepted).not.toMatch(/was installed|is installed/);
  });

  it("an arriving event shows Install app without prompting and without moving focus", () => {
    const t = setup();
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    const { event, prompt } = promptEvent();
    t.dispatch(event);
    expect(installButton()).toBeInTheDocument();
    expect(screen.queryByText("Install this app")).toBeNull();
    expect(prompt).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Elsewhere" })).toHaveFocus();
  });

  it("pointer activation prompts exactly once; repeated clicks while pending do nothing; dismissal clears it", async () => {
    const t = setup();
    const { event, prompt, choice } = promptEvent();
    t.dispatch(event);
    await userEvent.click(installButton()!);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(installButton()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(installButton()!);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(liveRegions()).toHaveLength(1);
    expect(liveRegions()[0]).toHaveTextContent(INSTALL_MESSAGES.pending);

    await settle(() => choice.resolve({ outcome: "dismissed" }));
    expect(installButton()).toBeNull();
    expect(liveRegions()).toHaveLength(1);
    expect(liveRegions()[0]).toHaveTextContent(INSTALL_MESSAGES.dismissed);
    expect(liveRegions()[0]).toHaveFocus(); // the activated control is gone
    expect(screen.getByText("Install this app")).toBeInTheDocument(); // guidance returns
    expect(prompt).toHaveBeenCalledTimes(1); // never again automatically
  });

  it("keyboard activation; acceptance is reported as accepted, not as installed", async () => {
    const t = setup();
    const { event, prompt, choice } = promptEvent();
    t.dispatch(event);
    installButton()!.focus();
    await userEvent.keyboard("{Enter}");
    expect(prompt).toHaveBeenCalledTimes(1);
    await settle(() => choice.resolve({ outcome: "accepted" }));
    expect(liveRegions()[0]).toHaveTextContent(INSTALL_MESSAGES.accepted);
    expect(installButton()).toBeNull();
  });

  it("a prompt failure is reported and the page stays usable", async () => {
    const t = setup();
    const { event } = promptEvent({ promptThrows: true });
    t.dispatch(event);
    await userEvent.click(installButton()!);
    expect(liveRegions()[0]).toHaveTextContent(INSTALL_MESSAGES.failed);
    expect(installButton()).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Elsewhere" }));
  });

  it("a later event offers Install app again", async () => {
    const t = setup();
    const first = promptEvent();
    t.dispatch(first.event);
    await userEvent.click(installButton()!);
    await settle(() => first.choice.resolve({ outcome: "dismissed" }));
    const second = promptEvent();
    t.dispatch(second.event);
    await userEvent.click(installButton()!);
    expect(second.prompt).toHaveBeenCalledTimes(1);
    expect(first.prompt).toHaveBeenCalledTimes(1);
  });

  it("appinstalled: no promotion and no guidance; the browser's report is stated", () => {
    const t = setup();
    t.dispatch(promptEvent().event);
    t.dispatch(new Event("appinstalled"));
    expect(installButton()).toBeNull();
    expect(screen.queryByText("Install this app")).toBeNull();
    expect(liveRegions()[0]).toHaveTextContent(INSTALL_MESSAGES.installed);
  });

  it("standalone display mode: nothing is promoted", () => {
    const t = setup({ standalone: true });
    t.dispatch(promptEvent().event);
    expect(document.querySelector("[data-install-affordance]")).toBeNull();
    expect(installButton()).toBeNull();
  });

  it("while an update holds the transition gate, installation is not offered (the gate is only read)", () => {
    const t = setup();
    t.dispatch(promptEvent().event);
    let release = () => {};
    act(() => {
      const result = t.safety.tryAcquireGate();
      if (result.kind === "acquired") release = () => result.gate.release();
    });
    expect(installButton()).toBeNull();
    act(() => release());
    expect(installButton()).toBeInTheDocument();
  });

  it("StrictMode: one region, one prompt", async () => {
    const t = setup({ strict: true });
    const { event, prompt } = promptEvent();
    t.dispatch(event);
    await userEvent.click(installButton()!);
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(liveRegions()).toHaveLength(1);
  });

  it("prompting touches neither the application's update-safety store nor connectivity evidence", async () => {
    const before = updateSafety.getSnapshot();
    const evidence = connectivity.getState();
    const t = setup();
    const { event, choice } = promptEvent();
    t.dispatch(event);
    await userEvent.click(installButton()!);
    await settle(() => choice.resolve({ outcome: "accepted" }));
    expect(updateSafety.getSnapshot()).toBe(before);
    expect(connectivity.getState()).toBe(evidence);
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
  });
});
