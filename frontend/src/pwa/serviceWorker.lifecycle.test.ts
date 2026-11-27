import { describe, expect, it, vi } from "vitest";
import type { RegisterSWOptions } from "virtual:pwa-register";
import {
  ACTIVATION_OBSERVATION_MS,
  SKIP_WAITING_MESSAGE,
  createServiceWorkerController,
  type ContainerLike,
  type ServiceWorkerEnvironment,
  type ServiceWorkerRuntime,
  type WorkerLike,
} from "./serviceWorker";
import { createUpdateSafety } from "./updateSafety";

/**
 * M06-T02 Increment 4a — the update lifecycle of the application-owned
 * controller, with controlled fakes for the helper, the registration, the
 * workers, `navigator.serviceWorker`, timers, and the page reload. Real
 * multi-tab behavior with real workers is Increment 4c's browser test; these
 * tests establish the controller's own decisions only. Since Increment 4b-iii
 * every controller gets its own real update-safety store, and `accept()`
 * confirms the CURRENT waiting-worker token and protected revision (the
 * safety integration itself is covered in serviceWorker.safety.test.ts).
 */

const SUPPORTED: ServiceWorkerEnvironment = {
  isProduction: true,
  isSecureContext: true,
  hasServiceWorker: true,
};

class FakeWorker implements WorkerLike {
  state: string;
  readonly messages: unknown[] = [];
  readonly listeners = new Set<() => void>();
  throwOnPost = false;
  constructor(
    public readonly name: string,
    state = "installed",
  ) {
    this.state = state;
  }
  postMessage(message: unknown) {
    if (this.throwOnPost) throw new Error("postMessage failed");
    this.messages.push(message);
  }
  addEventListener(_type: "statechange", listener: () => void) {
    this.listeners.add(listener);
  }
  removeEventListener(_type: "statechange", listener: () => void) {
    this.listeners.delete(listener);
  }
  /** Moves to `state` and fires `statechange` (as a browser would). */
  become(state: string) {
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

class FakeContainer implements ContainerLike {
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

function setup({
  waiting = null as FakeWorker | null,
  controller = new FakeWorker("old", "activated") as unknown,
  captureRegistration = true,
} = {}) {
  const registration = { waiting: waiting as WorkerLike | null };
  const container = new FakeContainer(controller);
  const timers: { callback: () => void; ms: number; cleared: boolean }[] = [];
  const reload = vi.fn();
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
  const updateServiceWorker = vi.fn(async () => {});
  const register = vi.fn((options: RegisterSWOptions) => {
    calls.push(options);
    return updateServiceWorker;
  });
  const safety = createUpdateSafety();
  const sw = createServiceWorkerController(() => SUPPORTED, register, runtime, safety);
  sw.register();
  const options = calls[0]!;
  if (captureRegistration) {
    options.onRegisteredSW?.("/sw.js", registration as unknown as ServiceWorkerRegistration);
  }
  return {
    sw,
    options,
    registration,
    container,
    timers,
    reload,
    updateServiceWorker,
    safety,
    /** Update now, confirming what is current (the worker shown and the protected revision). */
    accept() {
      return sw.acceptUpdate({
        waitingToken: sw.getState().waitingToken ?? -1,
        protectedRevision: safety.getSnapshot().protectedRevision,
      });
    },
    /** A new worker starts waiting, and the helper reports it (as on `waiting`). */
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

const skipWaitingSent = (worker: FakeWorker) =>
  worker.messages.filter((m) => JSON.stringify(m) === JSON.stringify(SKIP_WAITING_MESSAGE)).length;

describe("update lifecycle — detecting waiting workers", () => {
  it("a worker already waiting at startup is shown, without being accepted", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    expect(t.sw.getState()).toMatchObject({ update: "waiting", updateWaiting: true });
    expect(skipWaitingSent(w)).toBe(0);
    expect(t.updateServiceWorker).not.toHaveBeenCalled();
  });

  it("the helper's startup notification may come before the registration is captured", () => {
    const w = new FakeWorker("w");
    const t = setup({ captureRegistration: false });
    t.registration.waiting = w;
    t.options.onNeedRefresh?.();
    expect(t.sw.getState().update).toBe("waiting");
    t.options.onRegisteredSW?.("/sw.js", t.registration as unknown as ServiceWorkerRegistration);
    expect(t.sw.getState().update).toBe("waiting");
    expect(w.listeners.size).toBe(1);
  });

  it("a newly waiting worker is shown; repeated notifications change nothing and add no listeners", () => {
    const t = setup();
    expect(t.sw.getState().update).toBe("none");
    const w = new FakeWorker("w");
    const seen: string[] = [];
    t.sw.subscribe((s) => seen.push(s.update));
    t.startWaiting(w);
    t.options.onNeedRefresh?.();
    t.options.onNeedRefresh?.();
    expect(seen).toEqual(["waiting"]);
    expect(w.listeners.size).toBe(1);
    expect(skipWaitingSent(w)).toBe(0);
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("never activates automatically, whatever happens while waiting", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    t.options.onNeedRefresh?.();
    t.fireTimers();
    expect(t.timers).toHaveLength(0); // no timer exists without an acceptance
    expect(skipWaitingSent(w)).toBe(0);
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("a waiting worker that becomes redundant (replaced) clears the notice; the newer one is shown", () => {
    const w1 = new FakeWorker("w1");
    const t = setup({ waiting: w1 });
    const w2 = new FakeWorker("w2");
    t.registration.waiting = w2;
    w1.become("redundant");
    expect(t.sw.getState().update).toBe("waiting");
    expect(w1.listeners.size).toBe(0);
    expect(w2.listeners.size).toBe(1);
  });
});

describe("update lifecycle — postponement (Later)", () => {
  it("postpones only for this page session, sends nothing, reloads nothing, and keeps the worker waiting", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    t.sw.postpone();
    expect(t.sw.getState()).toMatchObject({ update: "postponed", updateWaiting: true });
    expect(skipWaitingSent(w)).toBe(0);
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.registration.waiting).toBe(w);
  });

  it("repeated notifications for the postponed worker do not reopen the notice", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    t.sw.postpone();
    t.options.onNeedRefresh?.();
    t.options.onNeedRefresh?.();
    expect(t.sw.getState().update).toBe("postponed");
  });

  it("a different waiting worker is shown again", () => {
    const w1 = new FakeWorker("w1");
    const t = setup({ waiting: w1 });
    t.sw.postpone();
    const w2 = new FakeWorker("w2");
    t.registration.waiting = w2;
    w1.become("redundant");
    expect(t.sw.getState().update).toBe("waiting");
  });

  it("a postponement made before the worker was known applies to the worker captured afterwards", () => {
    const w = new FakeWorker("w");
    const t = setup({ captureRegistration: false });
    t.options.onNeedRefresh?.();
    t.sw.postpone();
    t.registration.waiting = w;
    t.options.onRegisteredSW?.("/sw.js", t.registration as unknown as ServiceWorkerRegistration);
    expect(t.sw.getState().update).toBe("postponed");
  });

  it("a fresh controller (a new page session) shows the same worker again", () => {
    const w = new FakeWorker("w");
    const first = setup({ waiting: w });
    first.sw.postpone();
    const second = setup({ waiting: w });
    expect(second.sw.getState().update).toBe("waiting");
  });
});

describe("update lifecycle — worker-specific activation ownership", () => {
  it("acceptance posts SKIP_WAITING once to the captured worker; the authorized reload happens exactly once on its activation", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    expect(t.accept()).toBe("activating");
    expect(t.sw.getState().update).toBe("activating");
    expect(skipWaitingSent(w)).toBe(1);
    expect(t.updateServiceWorker).not.toHaveBeenCalled();
    expect(t.activeTimers()).toHaveLength(1);
    expect(t.activeTimers()[0]!.ms).toBe(ACTIVATION_OBSERVATION_MS);

    // Duplicate acceptance starts nothing.
    expect(t.accept()).toBe("already-activating");
    expect(skipWaitingSent(w)).toBe(1);

    w.become("activating");
    expect(t.reload).not.toHaveBeenCalled();
    t.container.changeControllerTo(w);
    t.options.onNeedReload?.(); // the helper's own signal is not ownership
    expect(t.reload).not.toHaveBeenCalled();
    w.become("activated");
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.sw.getState().update).toBe("reloading");
    // The observation timer is cleared; only the reload's stall watchdog remains (4b-iii).
    expect(t.activeTimers()).toHaveLength(1);
    expect(t.safety.getSnapshot().gateHeld).toBe(true); // protection kept through unloading

    // Repeated lifecycle events never reload again.
    w.become("activated");
    t.container.changeControllerTo(w);
    t.options.onNeedReload?.();
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.accept()).toBe("already-activating");
    t.fireTimers(); // the page did not unload (a test): the watchdog ends the protection
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.sw.getState().update).toBe("reload-required");
    expect(t.accept()).toBe("already-activating");
  });

  it("an initially uncontrolled accepting tab (no controllerchange at all) still reloads once on activation", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w, controller: null });
    t.accept();
    w.become("activated");
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it("an activation that already happened before the listener could fire is still recognized", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    // The browser activates synchronously on the message, without a statechange reaching us.
    w.postMessage = () => {
      w.state = "activated";
    };
    t.accept();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it("an unrelated controller change during an attempt does not consume its reload authorization", () => {
    const w = new FakeWorker("w");
    const other = new FakeWorker("other", "activated");
    const t = setup({ waiting: w });
    t.accept();
    t.container.changeControllerTo(other);
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.sw.getState().update).toBe("activating");
    w.become("activated");
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it("another worker activating during an attempt does not reload; the accepted worker becoming redundant ends the attempt as unavailable", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    t.accept();
    const newer = new FakeWorker("newer", "installed");
    t.registration.waiting = newer;
    t.options.onNeedRefresh?.(); // ignored while the attempt owns the lifecycle
    newer.become("activated");
    expect(t.reload).not.toHaveBeenCalled();
    w.become("redundant");
    expect(t.sw.getState().update).toBe("unavailable");
    expect(t.activeTimers()).toHaveLength(0);
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("a worker replaced before acceptance is not accepted: nothing is sent (pre-dispatch failure)", () => {
    const w1 = new FakeWorker("w1");
    const t = setup({ waiting: w1 });
    t.registration.waiting = new FakeWorker("w2"); // replaced, not yet reported
    expect(t.accept()).toBe("failed");
    expect(skipWaitingSent(w1)).toBe(0);
    expect(t.sw.getState().update).toBe("failed");
    expect(t.timers).toHaveLength(0);
  });

  it("a message that cannot be posted is a confirmed pre-dispatch failure: no timer and no reload, even if the worker activates later", () => {
    const w = new FakeWorker("w");
    w.throwOnPost = true;
    const t = setup({ waiting: w });
    expect(t.accept()).toBe("failed");
    expect(t.sw.getState().update).toBe("failed");
    expect(t.timers).toHaveLength(0);
    w.become("activated");
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("there is nothing to accept without a waiting update", () => {
    const t = setup();
    expect(t.accept()).toBe("not-waiting");
    expect(t.reload).not.toHaveBeenCalled();
  });
});

describe("update lifecycle — activation elsewhere (never reloads)", () => {
  it("the observed worker activating without acceptance here", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    w.become("activated");
    expect(t.sw.getState()).toMatchObject({
      update: "activated-elsewhere",
      updateActivatedElsewhere: true,
      updateWaiting: false,
    });
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("a postponed worker activated elsewhere is reported too", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    t.sw.postpone();
    w.become("activated");
    expect(t.sw.getState().update).toBe("activated-elsewhere");
  });

  it("a controller change from one worker to another", () => {
    const t = setup();
    t.container.changeControllerTo(new FakeWorker("new", "activated"));
    expect(t.sw.getState().update).toBe("activated-elsewhere");
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("a first controller in an uncontrolled tab is not an update elsewhere", () => {
    const t = setup({ controller: null });
    t.container.changeControllerTo(new FakeWorker("first", "activated"));
    expect(t.sw.getState().update).toBe("none");
  });

  it("the helper's signal records activation elsewhere, repeatedly harmless, never reloading", () => {
    const t = setup();
    t.options.onNeedReload?.();
    t.options.onNeedReload?.();
    expect(t.sw.getState().update).toBe("activated-elsewhere");
    expect(t.reload).not.toHaveBeenCalled();
  });
});

describe("update lifecycle — observation timeout and late activation", () => {
  it("an unsettled worker at the timeout: reload authorization revoked, the outcome unresolved", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    t.accept();
    t.fireTimers();
    expect(t.sw.getState().update).toBe("unresolved");
    expect(t.reload).not.toHaveBeenCalled();
    // Order 1: the timeout came first, the activation afterwards → no automatic reload.
    w.become("activated");
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.sw.getState().update).toBe("reload-required");
    expect(t.accept()).toBe("already-activating");
  });

  it("order 2: activation first, then the timer boundary → exactly one reload, the timer already cleared", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    t.accept();
    w.become("activated");
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.timers[0]!.cleared).toBe(true); // the observation timer
    t.fireTimers(); // only the reload's stall watchdog fires
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.sw.getState().update).toBe("reload-required");
  });

  it("activated by the time the timer fires but before its event arrived → the attempt's one reload", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    t.accept();
    w.state = "activated"; // no statechange delivered yet
    t.fireTimers();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it("a late redundant worker after the timeout → unavailable, never a reload", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    t.accept();
    t.fireTimers();
    w.become("redundant");
    expect(t.sw.getState().update).toBe("unavailable");
    expect(t.reload).not.toHaveBeenCalled();
  });
});

describe("update lifecycle — failures and cleanup", () => {
  it("a registration failure shows no update and never reloads", () => {
    const t = setup({ captureRegistration: false });
    t.options.onRegisterError?.(new Error("blocked"));
    expect(t.sw.getState()).toMatchObject({ registration: "failed", update: "none" });
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("unsupported environments register nothing and observe nothing", () => {
    const container = new FakeContainer(null);
    const sw = createServiceWorkerController(
      () => ({ ...SUPPORTED, hasServiceWorker: false }),
      vi.fn(),
      {
        container: () => container,
        setTimer: vi.fn(),
        clearTimer: vi.fn(),
        reload: vi.fn(),
      },
    );
    expect(sw.register().registration).toBe("unsupported");
    expect(container.listeners.size).toBe(0);
    expect(sw.acceptUpdate({ waitingToken: 1, protectedRevision: 0 })).toBe("not-waiting");
  });

  it("dispose removes every listener and timer", () => {
    const w = new FakeWorker("w");
    const t = setup({ waiting: w });
    t.accept();
    expect(t.container.listeners.size).toBe(1);
    expect(w.listeners.size).toBe(1);
    t.sw.dispose();
    expect(t.container.listeners.size).toBe(0);
    expect(w.listeners.size).toBe(0);
    expect(t.activeTimers()).toHaveLength(0);
  });
});
