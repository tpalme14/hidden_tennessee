import { describe, expect, it, vi } from "vitest";
import {
  createInstallPromptStore,
  type BeforeInstallPromptEventLike,
  type InstallEnvironment,
} from "./installPrompt";
import { connectivity } from "../connectivity/connectivity";
import { updateSafety } from "./updateSafety";

/**
 * M06-T02 Increment 4d — the installation-prompt store with controlled
 * browser primitives (window events, display-mode media query,
 * navigator.standalone); the store itself is real.
 */

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakePromptEvent({ promptThrows = false, promptRejects = false } = {}) {
  const choice = deferred<{ outcome: string; platform?: string }>();
  const event = new Event("beforeinstallprompt", {
    cancelable: true,
  }) as BeforeInstallPromptEventLike;
  const prompt = vi.fn(() => {
    if (promptThrows) throw new Error("NotAllowedError");
    return promptRejects ? Promise.reject(new Error("rejected")) : Promise.resolve();
  });
  Object.defineProperty(event, "prompt", { value: prompt });
  Object.defineProperty(event, "userChoice", { value: choice.promise });
  return { event, prompt, choice };
}

function setup({ standalone = false, iosStandalone = false, supported = true, media = true } = {}) {
  const listeners: Record<string, Set<(e: Event) => void>> = {
    beforeinstallprompt: new Set(),
    appinstalled: new Set(),
  };
  const mediaListeners = new Set<() => void>();
  const query = {
    matches: standalone,
    addEventListener: (_t: "change", l: () => void) => mediaListeners.add(l),
    removeEventListener: (_t: "change", l: () => void) => mediaListeners.delete(l),
  };
  const environment: InstallEnvironment = {
    supportsPromptEvent: () => supported,
    addEventListener: (type, l) => listeners[type]!.add(l),
    removeEventListener: (type, l) => listeners[type]!.delete(l),
    standaloneQuery: () => (media ? query : null),
    navigatorStandalone: () => iosStandalone,
  };
  const store = createInstallPromptStore(environment);
  return {
    store,
    listeners,
    mediaListeners,
    dispatch(event: Event) {
      for (const l of [...listeners[event.type]!]) l(event);
    },
    setStandalone(value: boolean) {
      query.matches = value;
      for (const l of [...mediaListeners]) l();
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("installPrompt — initialization and capture", () => {
  it("starts without an available prompt, never prompting by itself", () => {
    const t = setup();
    t.store.start();
    expect(t.store.getSnapshot()).toEqual({
      promptEventSupported: true,
      available: false,
      pending: false,
      outcome: null,
      installedReported: false,
      standalone: false,
    });
  });

  it("records an unsupported prompt event capability (no event ever arrives) and degrades to unavailable", () => {
    const t = setup({ supported: false, media: false });
    t.store.start();
    expect(t.store.getSnapshot()).toMatchObject({
      promptEventSupported: false,
      available: false,
      standalone: false,
    });
    expect(t.store.promptInstall()).toBe("unavailable");
  });

  it("start is idempotent: one listener of each kind", () => {
    const t = setup();
    t.store.start();
    t.store.start();
    expect(t.listeners.beforeinstallprompt!.size).toBe(1);
    expect(t.listeners.appinstalled!.size).toBe(1);
    expect(t.mediaListeners.size).toBe(1);
  });

  it("retains a browser event, prevents its default promotion, and never calls prompt() on arrival", () => {
    const t = setup();
    t.store.start();
    const { event, prompt } = fakePromptEvent();
    t.dispatch(event);
    expect(event.defaultPrevented).toBe(true);
    expect(prompt).not.toHaveBeenCalled();
    expect(t.store.getSnapshot().available).toBe(true);
  });

  it("ignores an event that is not a prompt event", () => {
    const t = setup();
    t.store.start();
    const plain = new Event("beforeinstallprompt", { cancelable: true });
    t.dispatch(plain);
    expect(plain.defaultPrevented).toBe(false);
    expect(t.store.getSnapshot().available).toBe(false);
  });

  it("does not retain (or prevent) an event while running standalone", () => {
    const t = setup({ standalone: true });
    t.store.start();
    const { event } = fakePromptEvent();
    t.dispatch(event);
    expect(event.defaultPrevented).toBe(false);
    expect(t.store.getSnapshot()).toMatchObject({ available: false, standalone: true });
  });

  it("iOS navigator.standalone counts as standalone evidence", () => {
    const t = setup({ iosStandalone: true, media: false });
    t.store.start();
    expect(t.store.getSnapshot().standalone).toBe(true);
  });

  it("snapshots are stable between changes and subscribers hear each change once", () => {
    const t = setup();
    t.store.start();
    const seen: boolean[] = [];
    const unsubscribe = t.store.subscribe(() => seen.push(t.store.getSnapshot().available));
    const before = t.store.getSnapshot();
    expect(t.store.getSnapshot()).toBe(before);
    t.dispatch(fakePromptEvent().event);
    expect(seen).toEqual([true]);
    unsubscribe();
    t.dispatch(new Event("appinstalled"));
    expect(seen).toEqual([true]);
  });
});

describe("installPrompt — explicit prompting", () => {
  it("prompts exactly once, synchronously, consuming the event before prompt() runs", () => {
    const t = setup();
    t.store.start();
    const { event, prompt } = fakePromptEvent();
    let availableDuringPrompt: boolean | null = null;
    prompt.mockImplementationOnce(() => {
      availableDuringPrompt = t.store.getSnapshot().available;
      return Promise.resolve();
    });
    t.dispatch(event);
    expect(t.store.promptInstall()).toBe("prompted");
    expect(prompt).toHaveBeenCalledTimes(1); // no await before prompt()
    expect(availableDuringPrompt).toBe(false);
    expect(t.store.getSnapshot()).toMatchObject({ available: false, pending: true });
  });

  it("duplicate invocation while pending does nothing; a consumed event cannot be reused", async () => {
    const t = setup();
    t.store.start();
    const { event, prompt, choice } = fakePromptEvent();
    t.dispatch(event);
    t.store.promptInstall();
    expect(t.store.promptInstall()).toBe("pending");
    expect(t.store.promptInstall()).toBe("pending");
    choice.resolve({ outcome: "dismissed" });
    await flush();
    expect(t.store.promptInstall()).toBe("unavailable");
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("accepted: recorded as accepted (not as installed), no new prompt", async () => {
    const t = setup();
    t.store.start();
    const { event, choice, prompt } = fakePromptEvent();
    t.dispatch(event);
    t.store.promptInstall();
    choice.resolve({ outcome: "accepted", platform: "web" });
    await flush();
    expect(t.store.getSnapshot()).toMatchObject({
      available: false,
      pending: false,
      outcome: "accepted",
      installedReported: false,
    });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it("dismissed: recorded, and never prompted again automatically", async () => {
    const t = setup();
    t.store.start();
    const { event, choice, prompt } = fakePromptEvent();
    t.dispatch(event);
    t.store.promptInstall();
    choice.resolve({ outcome: "dismissed" });
    await flush();
    await flush();
    expect(t.store.getSnapshot()).toMatchObject({ pending: false, outcome: "dismissed" });
    expect(prompt).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["prompt() throws", { promptThrows: true }],
    ["prompt() rejects", { promptRejects: true }],
  ])("%s: failed, the event cleared, the store usable", async (_label, options) => {
    const t = setup();
    t.store.start();
    const { event } = fakePromptEvent(options);
    t.dispatch(event);
    t.store.promptInstall();
    await flush();
    expect(t.store.getSnapshot()).toMatchObject({
      available: false,
      pending: false,
      outcome: "failed",
    });
    expect(t.store.promptInstall()).toBe("unavailable");
  });

  it("userChoice rejecting is a failure too", async () => {
    const t = setup();
    t.store.start();
    const { event, choice } = fakePromptEvent();
    t.dispatch(event);
    t.store.promptInstall();
    choice.reject(new Error("aborted"));
    await flush();
    expect(t.store.getSnapshot()).toMatchObject({ pending: false, outcome: "failed" });
  });

  it("a later browser event restores availability; the older prompt's completion never clears it", async () => {
    const t = setup();
    t.store.start();
    const first = fakePromptEvent();
    t.dispatch(first.event);
    t.store.promptInstall();
    const second = fakePromptEvent();
    t.dispatch(second.event); // arrives while the first prompt is pending
    expect(t.store.getSnapshot()).toMatchObject({ available: true, pending: true });
    first.choice.resolve({ outcome: "dismissed" });
    await flush();
    expect(t.store.getSnapshot()).toMatchObject({ available: true, pending: false });
    expect(t.store.promptInstall()).toBe("prompted");
    expect(second.prompt).toHaveBeenCalledTimes(1);
    expect(first.prompt).toHaveBeenCalledTimes(1);
  });

  it("without a retained event, nothing is prompted", () => {
    const t = setup();
    t.store.start();
    expect(t.store.promptInstall()).toBe("unavailable");
    expect(t.store.getSnapshot().pending).toBe(false);
  });
});

describe("installPrompt — appinstalled, display mode, cleanup", () => {
  it("appinstalled clears a retained event and is reported", () => {
    const t = setup();
    t.store.start();
    const { prompt, event } = fakePromptEvent();
    t.dispatch(event);
    t.dispatch(new Event("appinstalled"));
    expect(t.store.getSnapshot()).toMatchObject({ available: false, installedReported: true });
    expect(t.store.promptInstall()).toBe("unavailable");
    expect(prompt).not.toHaveBeenCalled();
  });

  it("entering standalone mode clears promotion; leaving it does not invent a prompt", () => {
    const t = setup();
    t.store.start();
    t.dispatch(fakePromptEvent().event);
    t.setStandalone(true);
    expect(t.store.getSnapshot()).toMatchObject({ standalone: true, available: false });
    t.setStandalone(false);
    expect(t.store.getSnapshot()).toMatchObject({ standalone: false, available: false });
  });

  it("dispose removes every listener", () => {
    const t = setup();
    t.store.start();
    t.store.dispose();
    expect(t.listeners.beforeinstallprompt!.size).toBe(0);
    expect(t.listeners.appinstalled!.size).toBe(0);
    expect(t.mediaListeners.size).toBe(0);
  });

  it("never touches the application's update-safety store or connectivity evidence", async () => {
    const before = updateSafety.getSnapshot();
    const evidence = connectivity.getState();
    const t = setup();
    t.store.start();
    const { event, choice } = fakePromptEvent();
    t.dispatch(event);
    t.store.promptInstall();
    choice.resolve({ outcome: "accepted" });
    await flush();
    expect(updateSafety.getSnapshot()).toBe(before);
    expect(connectivity.getState()).toBe(evidence);
  });
});
