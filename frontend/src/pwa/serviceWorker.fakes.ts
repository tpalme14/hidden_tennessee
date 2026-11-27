import { vi, type Mock } from "vitest";
import type { RegisterSWOptions } from "virtual:pwa-register";
import {
  createServiceWorkerController,
  SKIP_WAITING_MESSAGE,
  type ContainerLike,
  type ServiceWorkerRuntime,
  type WorkerLike,
} from "./serviceWorker";
import { createUpdateSafety, type UpdateSafety } from "./updateSafety";

/**
 * Test support (M06-T02 Increment 4b-iii): controlled fakes for the browser
 * primitives only — the helper's registration callbacks, the registration,
 * workers, `navigator.serviceWorker`, timers, and the page reload — around a
 * REAL controller and a REAL update-safety store.
 */

export class FakeWorker implements WorkerLike {
  state: string;
  readonly messages: unknown[] = [];
  readonly listeners = new Set<() => void>();
  /** Called on postMessage before the message is recorded (ordering assertions, throwing). */
  onPost: (message: unknown) => void = () => {};
  constructor(
    public readonly name: string,
    state = "installed",
  ) {
    this.state = state;
  }
  postMessage(message: unknown) {
    this.onPost(message);
    this.messages.push(message);
  }
  addEventListener(_type: "statechange", listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "statechange", listener: () => void) {
    this.listeners.delete(listener);
  }
  become(state: string) {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

export class FakeContainer implements ContainerLike {
  readonly listeners = new Set<() => void>();
  constructor(public controller: unknown) {}
  addEventListener(_type: "controllerchange", listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "controllerchange", listener: () => void) {
    this.listeners.delete(listener);
  }
  changeControllerTo(controller: unknown) {
    this.controller = controller;
    for (const listener of [...this.listeners]) listener();
  }
}

export const skipWaitingSent = (worker: FakeWorker) =>
  worker.messages.filter((m) => JSON.stringify(m) === JSON.stringify(SKIP_WAITING_MESSAGE)).length;

export function controllerHarness({
  waiting = null as FakeWorker | null,
  safety = createUpdateSafety() as UpdateSafety,
} = {}) {
  const registration = { waiting: waiting as WorkerLike | null };
  const container = new FakeContainer(new FakeWorker("old", "activated"));
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = [];
  const reload: Mock<() => void> = vi.fn();
  const runtime: ServiceWorkerRuntime = {
    container: () => container,
    setTimer: (callback, ms) => {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (handle) => {
      (handle as { cleared: boolean }).cleared = true;
    },
    reload,
  };
  const calls: RegisterSWOptions[] = [];
  const register = vi.fn((options: RegisterSWOptions) => {
    calls.push(options);
    return vi.fn();
  });
  const sw = createServiceWorkerController(
    () => ({ isProduction: true, isSecureContext: true, hasServiceWorker: true }),
    register,
    runtime,
    safety,
  );
  sw.register();
  const options = calls[0]!;
  options.onRegisteredSW?.("/sw.js", registration as unknown as ServiceWorkerRegistration);
  return {
    sw,
    safety,
    options,
    registration,
    container,
    timers,
    reload,
    /** What a user confirming the notice as it stands right now would send. */
    current() {
      return {
        waitingToken: sw.getState().waitingToken ?? -1,
        protectedRevision: safety.getSnapshot().protectedRevision,
      };
    },
    startWaiting(worker: FakeWorker) {
      registration.waiting = worker;
      options.onNeedRefresh?.();
    },
    fireTimers() {
      for (const t of timers.filter((t) => !t.cleared)) {
        t.cleared = true;
        t.callback();
      }
    },
    activeTimers: () => timers.filter((t) => !t.cleared),
  };
}
