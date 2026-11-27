import { registerSW, type RegisterSWOptions } from "virtual:pwa-register";
import { updateSafety, type TransitionGate, type UpdateSafety } from "./updateSafety";

/**
 * Application-owned service-worker registration and update lifecycle
 * (M06-T02 Increment 2, extended in Increments 4a and 4b-iii; Specification 6
 * v1.1 §12.10, OFF-SW-1). Wraps `virtual:pwa-register` from vite-plugin-pwa
 * 2.0.0, whose automatic HTML injection stays disabled (`injectRegister: false`).
 *
 * Safeguards, from the installed helper's source (M06-T02 Increment 1b and
 * Increment 4 planning records):
 * - In `prompt` mode the helper adds a `controlling` listener per prompt that
 *   calls `onNeedReload()` — or, when none is supplied, `location.reload()` —
 *   whenever workbox-window's `isUpdate` is true. That flag only means "a
 *   worker controlled this page when it registered"; it says nothing about
 *   which tab accepted an update. This wrapper therefore ALWAYS supplies
 *   `onNeedReload`, never reloads from it, and never uses it (or `isUpdate`)
 *   to decide ownership.
 * - The helper's `updateServiceWorker` is never called. Activation is owned
 *   here, per waiting worker (below).
 *
 * Update lifecycle. The `update` phase:
 *
 *   none ──waiting worker W observed──▶ waiting      (W postponed earlier: ▶ postponed)
 *   waiting ──postpone()──▶ postponed                 (only for W, this page session)
 *   waiting|postponed ──acceptUpdate(expected)──▶ activating   (gate held; SKIP_WAITING posted to W)
 *                     └─ stale or busy: no change; confirmed before dispatch ─▶ failed (gate released)
 *   activating ──W "activated"──▶ reloading           (the ONE authorized reload; gate kept)
 *   activating ──10 s observation ends, W not settled──▶ unresolved
 *                 (automatic reload authorization revoked FIRST, then the gate released)
 *   unresolved ──W "activated"──▶ reload-required     (never reloads by itself)
 *   activating|unresolved ──W "redundant"──▶ unavailable (gate released)
 *   any phase without an attempt ──another worker took control, or the observed
 *                     W activated without being accepted here──▶ activated-elsewhere
 *   activated-elsewhere|reload-required ──reloadPage(expected)──▶ reloading (gate kept)
 *   reloading ──the page is still here 10 s later──▶ reload-required (gate released)
 *   waiting|postponed ──W "redundant"──▶ none (a newer waiting worker is observed afresh)
 *
 * Update-safety integration (Increment 4b-iii): `acceptUpdate` and
 * `reloadPage` validate the requested action, the waiting-worker token, and
 * the protected-information revision the user confirmed, then acquire the
 * update-safety transition gate — refused while any mutation request or
 * operation hold is active — all in ONE synchronous call, and re-check the
 * worker before dispatching. Each attempt owns its gate: only that attempt can
 * release it, and it is released only when no automatic reload remains
 * possible. Nothing is ever activated or reloaded automatically outside an
 * accepted attempt, and nothing is retried.
 *
 * Registration happens only in a production build, in a secure context, where
 * the browser supports service workers, and at most once. Failures never
 * affect ordinary use of the application.
 */

export type RegistrationStatus =
  | "not-started"
  | "skipped" // not a production build
  | "unsupported" // no service-worker API or not a secure context
  | "registering"
  | "registered"
  | "failed";

export type UpdatePhase =
  | "none"
  | "waiting"
  | "postponed"
  | "activating"
  | "reloading"
  | "failed"
  | "unavailable"
  | "unresolved"
  | "reload-required"
  | "activated-elsewhere";

export interface ServiceWorkerState {
  registration: RegistrationStatus;
  /** The first installation completed: the application shell is precached. */
  offlineReady: boolean;
  /** A newer worker is installed and waiting (shown or postponed); it is never accepted automatically. */
  updateWaiting: boolean;
  /** A newer worker took control because of another tab or agent; this tab did not reload. */
  updateActivatedElsewhere: boolean;
  /** The update lifecycle phase (see the model above). */
  update: UpdatePhase;
  /**
   * An opaque number identifying the waiting worker this page knows about
   * (waiting or postponed), or null. A different worker gets a different
   * number; the worker itself is never exposed.
   */
  waitingToken: number | null;
}

export interface ServiceWorkerEnvironment {
  isProduction: boolean;
  isSecureContext: boolean;
  hasServiceWorker: boolean;
}

/** The parts of a `ServiceWorker` the lifecycle uses. */
export interface WorkerLike {
  readonly state: string;
  postMessage(message: unknown): void;
  addEventListener(type: "statechange", listener: () => void): void;
  removeEventListener(type: "statechange", listener: () => void): void;
}

/** The parts of a `ServiceWorkerRegistration` the lifecycle uses. */
export interface RegistrationLike {
  readonly waiting: WorkerLike | null;
}

/** The parts of `navigator.serviceWorker` the lifecycle uses. */
export interface ContainerLike {
  readonly controller: unknown;
  addEventListener(type: "controllerchange", listener: () => void): void;
  removeEventListener(type: "controllerchange", listener: () => void): void;
}

export interface ServiceWorkerRuntime {
  container(): ContainerLike | null;
  setTimer(callback: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  reload(): void;
}

export type RegisterFunction = (options: RegisterSWOptions) => unknown;

/** What the user confirmed: the waiting worker shown, and the protected-information revision. */
export interface UpdateRequest {
  waitingToken: number;
  protectedRevision: number;
}

export type AcceptResult =
  | "activating" // gate held; SKIP_WAITING posted to the accepted worker
  | "already-activating" // an attempt is in progress; nothing new was sent
  | "not-waiting" // there is no update to accept in this phase
  | "stale" // the worker or the protected information changed since it was confirmed
  | "busy" // a mutation request or operation hold is active (or another transition)
  | "failed"; // confirmed before dispatch: nothing was sent

export type ReloadResult =
  | "reloading" // gate held; the reload was started
  | "not-available" // no observed activation calls for a reload in this phase
  | "stale" // the protected information changed since it was confirmed
  | "busy" // a mutation request or operation hold is active (or another transition)
  | "failed"; // the reload could not be started; protection released

export interface ServiceWorkerController {
  /** Starts registration once; later calls return the current state unchanged. */
  register(): ServiceWorkerState;
  getState(): ServiceWorkerState;
  /** Calls `listener` after every state change; returns the unsubscribe function. */
  subscribe(listener: (state: ServiceWorkerState) => void): () => void;
  /** Later: hides the notice for the currently observed waiting worker, for this page session. */
  postpone(): void;
  /**
   * Accepts the waiting worker the user confirmed. Synchronously checks the
   * worker token, the protected-information revision, and pending work, and
   * acquires the transition gate, before anything is sent.
   */
  acceptUpdate(expected: UpdateRequest): AcceptResult;
  /**
   * The explicit Reload after an activation was observed (elsewhere, or late).
   * Same synchronous checks and gate; never automatic.
   */
  reloadPage(expected: { protectedRevision: number }): ReloadResult;
  /** After a failed attempt: re-reads the waiting worker (a new acceptance is a new user action). */
  reconsider(): void;
  /** Removes every listener and timer (tests; the application never disposes). */
  dispose(): void;
}

/** The bounded observation period after SKIP_WAITING is posted, or after a reload starts (U3). */
export const ACTIVATION_OBSERVATION_MS = 10_000;
export const SKIP_WAITING_MESSAGE = { type: "SKIP_WAITING" } as const;

const INITIAL_STATE: ServiceWorkerState = {
  registration: "not-started",
  offlineReady: false,
  updateWaiting: false,
  updateActivatedElsewhere: false,
  update: "none",
  waitingToken: null,
};

export function currentEnvironment(): ServiceWorkerEnvironment {
  return {
    isProduction: import.meta.env.PROD,
    isSecureContext: typeof window !== "undefined" && window.isSecureContext === true,
    hasServiceWorker: typeof navigator !== "undefined" && "serviceWorker" in navigator,
  };
}

export const browserRuntime: ServiceWorkerRuntime = {
  container: () =>
    typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker
      : null,
  setTimer: (callback, ms) => window.setTimeout(callback, ms),
  clearTimer: (handle) => window.clearTimeout(handle as number),
  reload: () => window.location.reload(),
};

interface Attempt {
  worker: WorkerLike;
  /** Cleared when the observation period ends unsettled; never restored. */
  reloadAuthorized: boolean;
  timer: unknown;
  /** The transition gate this attempt owns. */
  gate: TransitionGate;
}

interface ReloadWatch {
  gate: TransitionGate;
  timer: unknown;
}

/** Builds a controller; the application uses the single instance below, tests build their own. */
export function createServiceWorkerController(
  environment: () => ServiceWorkerEnvironment = currentEnvironment,
  register: RegisterFunction = registerSW,
  runtime: ServiceWorkerRuntime = browserRuntime,
  safety: UpdateSafety = updateSafety,
): ServiceWorkerController {
  let state = INITIAL_STATE;
  let started = false;
  const listeners = new Set<(state: ServiceWorkerState) => void>();

  let registration: RegistrationLike | null = null;
  let container: ContainerLike | null = null;
  let lastController: unknown = null;
  /** The waiting worker this page currently knows about (null when unknown). */
  let observed: WorkerLike | null = null;
  /** The worker the user postponed in this page session. */
  let postponed: WorkerLike | null = null;
  let postponedUnknown = false;
  let attempt: Attempt | null = null;
  let reloadInvoked = false;
  let reloadWatch: ReloadWatch | null = null;
  let refreshSignalled = false;
  const tokens = new WeakMap<WorkerLike, number>();
  let nextToken = 1;

  function tokenFor(worker: WorkerLike | null): number | null {
    if (!worker) return null;
    let token = tokens.get(worker);
    if (token === undefined) {
      token = nextToken++;
      tokens.set(worker, token);
    }
    return token;
  }

  function update(patch: Partial<ServiceWorkerState>) {
    const next = { ...state, ...patch };
    if (
      next.registration === state.registration &&
      next.offlineReady === state.offlineReady &&
      next.updateWaiting === state.updateWaiting &&
      next.updateActivatedElsewhere === state.updateActivatedElsewhere &&
      next.update === state.update &&
      next.waitingToken === state.waitingToken
    ) {
      return;
    }
    state = next;
    for (const listener of listeners) listener(state);
  }

  function setPhase(phase: UpdatePhase) {
    const waiting = phase === "waiting" || phase === "postponed";
    update({
      update: phase,
      updateWaiting: waiting,
      updateActivatedElsewhere:
        phase === "activated-elsewhere" ? true : state.updateActivatedElsewhere,
      waitingToken: waiting ? tokenFor(observed) : null,
    });
  }

  const onWorkerStateChange = () => evaluateWorker();

  function watch(worker: WorkerLike | null) {
    if (worker === observed) return;
    if (observed && observed !== attempt?.worker) {
      observed.removeEventListener("statechange", onWorkerStateChange);
    }
    observed = worker;
    if (worker) worker.addEventListener("statechange", onWorkerStateChange);
  }

  /** Starts the page reload once, keeping `gate`; if the page is still here after the observation period, releases it. */
  function startReload(gate: TransitionGate, phaseIfStalled: UpdatePhase): boolean {
    reloadInvoked = true;
    setPhase("reloading");
    const watchEntry: ReloadWatch = { gate, timer: null };
    reloadWatch = watchEntry;
    try {
      runtime.reload();
    } catch {
      // The reload did not start: nothing will reload automatically, so the gate is released.
      reloadWatch = null;
      reloadInvoked = false;
      setPhase(phaseIfStalled);
      gate.release();
      return false;
    }
    watchEntry.timer = runtime.setTimer(() => {
      if (reloadWatch !== watchEntry) return;
      // The document is still active: treat the reload as not having happened.
      reloadWatch = null;
      reloadInvoked = false;
      setPhase(phaseIfStalled);
      watchEntry.gate.release();
    }, ACTIVATION_OBSERVATION_MS);
    return true;
  }

  /** Reacts to the observed (or accepted) worker's CURRENT state — so a change before or during listener registration is never missed. */
  function evaluateWorker() {
    // While a reload is in progress, a late worker event changes nothing (and releases nothing).
    if (reloadInvoked) return;
    const worker = attempt?.worker ?? observed;
    if (!worker) return;
    if (worker.state === "activated") {
      if (attempt && attempt.worker === worker) {
        const current = attempt;
        clearAttemptTimer();
        if (current.reloadAuthorized && !reloadInvoked) {
          // The accepted attempt's single authorized reload, consumed here; its gate is kept through unloading.
          current.reloadAuthorized = false;
          startReload(current.gate, "reload-required");
        } else if (!reloadInvoked) {
          setPhase("reload-required");
        }
        return;
      }
      // Activated without being accepted here.
      watch(null);
      setPhase("activated-elsewhere");
      return;
    }
    if (worker.state === "redundant") {
      if (attempt && attempt.worker === worker) {
        const current = attempt;
        clearAttemptTimer();
        attempt = null;
        worker.removeEventListener("statechange", onWorkerStateChange);
        if (observed === worker) observed = null;
        // Redundant without activating: no automatic reload can follow.
        current.reloadAuthorized = false;
        setPhase("unavailable");
        current.gate.release();
        return;
      }
      watch(null);
      if (state.update === "waiting" || state.update === "postponed") setPhase("none");
      observeWaiting(); // a newer waiting worker, if any, is evaluated afresh
    }
  }

  function clearAttemptTimer() {
    if (attempt && attempt.timer !== null) {
      runtime.clearTimer(attempt.timer);
      attempt.timer = null;
    }
  }

  /** Reads the registration's current waiting worker and shows (or keeps postponed) the notice. */
  function observeWaiting() {
    if (attempt || reloadInvoked) return; // an attempt owns the lifecycle until it settles
    if (state.update === "activated-elsewhere" || state.update === "reload-required") return;
    if (!registration) {
      if (refreshSignalled) setPhase(postponedUnknown ? "postponed" : "waiting");
      return;
    }
    const waiting = registration.waiting;
    if (!waiting) {
      if (refreshSignalled && !observed) setPhase(postponedUnknown ? "postponed" : "waiting");
      return;
    }
    watch(waiting);
    if (waiting.state === "activated" || waiting.state === "redundant") {
      evaluateWorker();
      return;
    }
    setPhase(waiting === postponed ? "postponed" : "waiting");
  }

  const onControllerChange = () => {
    const next = container?.controller ?? null;
    const previous = lastController;
    lastController = next;
    // An attempt is settled only by its own worker's state, never by a controller change.
    if (attempt || reloadInvoked) return;
    if (previous !== null && next !== null && next !== previous) {
      watch(null);
      setPhase("activated-elsewhere");
    }
  };

  function capture(candidate: unknown) {
    if (registration || !candidate || typeof candidate !== "object") return;
    registration = candidate as RegistrationLike;
    // A notice postponed before the worker was known belongs to the worker waiting now.
    if (postponedUnknown && registration.waiting) postponed = registration.waiting;
    if (registration.waiting) observeWaiting();
    else if (refreshSignalled) observeWaiting();
  }

  return {
    register() {
      if (started) return state;
      started = true;
      const env = environment();
      if (!env.isProduction) {
        update({ registration: "skipped" });
        return state;
      }
      if (!env.hasServiceWorker || !env.isSecureContext) {
        update({ registration: "unsupported" });
        return state;
      }
      update({ registration: "registering" });
      try {
        container = runtime.container();
        lastController = container?.controller ?? null;
        container?.addEventListener("controllerchange", onControllerChange);
        // The returned updateServiceWorker function is deliberately discarded:
        // activation is owned by acceptUpdate() below, per waiting worker.
        register({
          immediate: false,
          onRegisteredSW: (_url, reg) => {
            update({ registration: "registered" });
            capture(reg);
          },
          onRegisterError: () => update({ registration: "failed" }),
          onOfflineReady: () => update({ offlineReady: true }),
          onNeedRefresh: () => {
            refreshSignalled = true;
            observeWaiting();
          },
          // Always supplied, so the helper never falls back to reloading the page.
          // It is evidence of a controller change only, never of ownership.
          onNeedReload: () => {
            if (attempt || reloadInvoked) return;
            watch(null);
            setPhase("activated-elsewhere");
          },
        });
      } catch {
        update({ registration: "failed" });
      }
      return state;
    },
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    postpone() {
      if (state.update !== "waiting") return;
      if (observed) postponed = observed;
      else postponedUnknown = true;
      setPhase("postponed");
    },
    acceptUpdate(expected) {
      // 1. The requested action.
      if (attempt || reloadInvoked) return "already-activating";
      if (state.update !== "waiting" && state.update !== "postponed") return "not-waiting";
      // 2. The worker the user confirmed. 3. The protected information they saw.
      if (state.waitingToken === null || expected.waitingToken !== state.waitingToken) {
        return "stale";
      }
      if (expected.protectedRevision !== safety.getSnapshot().protectedRevision) return "stale";
      // 4–6. Pending requests and holds are checked, and the gate acquired, in one step.
      const acquired = safety.tryAcquireGate();
      if (acquired.kind !== "acquired") return "busy";
      const gate = acquired.gate;
      // 7. The lifecycle target is re-checked before anything is dispatched.
      const worker = observed;
      if (
        !registration ||
        !worker ||
        registration.waiting !== worker ||
        worker.state !== "installed"
      ) {
        setPhase("failed");
        gate.release(); // confirmed before dispatch: nothing was sent
        return "failed";
      }
      const current: Attempt = { worker, reloadAuthorized: true, timer: null, gate };
      attempt = current;
      try {
        worker.postMessage(SKIP_WAITING_MESSAGE);
      } catch {
        // postMessage threw synchronously: the message was not dispatched.
        attempt = null;
        setPhase("failed");
        gate.release();
        return "failed";
      }
      // Dispatched: from here on the gate is released only by this attempt's own outcome.
      setPhase("activating");
      current.timer = runtime.setTimer(() => {
        current.timer = null;
        if (attempt !== current) return;
        if (current.worker.state === "activated" || current.worker.state === "redundant") {
          evaluateWorker();
          return;
        }
        // Not settled: the message may still take effect. Revoke the automatic
        // reload for good FIRST; only then can the gate be released safely.
        current.reloadAuthorized = false;
        setPhase("unresolved");
        current.gate.release();
      }, ACTIVATION_OBSERVATION_MS);
      // The worker may already have moved on before or during this call.
      evaluateWorker();
      return "activating";
    },
    reloadPage(expected) {
      if (reloadInvoked || attempt?.reloadAuthorized) return "not-available";
      if (state.update !== "activated-elsewhere" && state.update !== "reload-required") {
        return "not-available";
      }
      if (expected.protectedRevision !== safety.getSnapshot().protectedRevision) return "stale";
      const acquired = safety.tryAcquireGate();
      if (acquired.kind !== "acquired") return "busy";
      return startReload(acquired.gate, state.update) ? "reloading" : "failed";
    },
    reconsider() {
      if (state.update !== "failed") return;
      setPhase("none");
      observeWaiting();
    },
    dispose() {
      container?.removeEventListener("controllerchange", onControllerChange);
      if (observed) observed.removeEventListener("statechange", onWorkerStateChange);
      if (attempt) {
        attempt.worker.removeEventListener("statechange", onWorkerStateChange);
        clearAttemptTimer();
      }
      if (reloadWatch && reloadWatch.timer !== null) runtime.clearTimer(reloadWatch.timer);
      listeners.clear();
    },
  };
}

/** The application's controller, started from `main.tsx`. */
export const serviceWorker = createServiceWorkerController();
