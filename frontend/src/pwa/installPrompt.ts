/**
 * Installation-prompt state (M06-T02 Increment 4d; Specification 6 v1.1 §3.1;
 * ADR-007 amendment; decisions D3, U12, U13). Event-driven and in memory only:
 *
 * - `beforeinstallprompt` (where the browser provides it — it is NOT universal)
 *   is retained as a deferred prompt, and only then is its default promotion
 *   prevented. An event arriving while the app already runs standalone is not
 *   retained and its default is left alone.
 * - `promptInstall()` must be called synchronously from a user action. It
 *   consumes the retained event BEFORE calling `prompt()` (no `await` first,
 *   so the browser's transient user activation is kept), so a consumed event
 *   can never be prompted twice; while a prompt is pending further calls do
 *   nothing. The outcome (`userChoice`) is recorded truthfully: "accepted"
 *   means the user accepted the browser's prompt, NOT that installation
 *   completed. A later browser-provided event makes installation available
 *   again; a stale completion never clears or replaces a newer event.
 * - `appinstalled` is the browser's report of an installation; it clears any
 *   retained event.
 * - Standalone evidence — `(display-mode: standalone)` and, on iOS Safari,
 *   `navigator.standalone` — is a HINT that this page runs as an installed
 *   app, not proof of installation status on every device (U13).
 *
 * Nothing here is persisted, nothing prompts automatically, and nothing
 * touches the service worker, the update-safety store, or connectivity.
 */

/** The non-standard event Chromium-based browsers dispatch (not in lib.dom). */
export interface BeforeInstallPromptEventLike extends Event {
  prompt(): Promise<unknown> | void;
  readonly userChoice: Promise<{ outcome: string; platform?: string }>;
}

export type InstallOutcome = "accepted" | "dismissed" | "failed";

export interface InstallState {
  /** The browser exposes `onbeforeinstallprompt` (a capability hint only). */
  promptEventSupported: boolean;
  /** A browser-provided prompt is retained and can be shown now. */
  available: boolean;
  /** A prompt was shown and its outcome is not known yet. */
  pending: boolean;
  /** The outcome of the most recent prompt, until a new event arrives. */
  outcome: InstallOutcome | null;
  /** The browser reported `appinstalled` in this page session. */
  installedReported: boolean;
  /** Standalone display-mode evidence for the current page (a hint). */
  standalone: boolean;
}

export type PromptResult = "prompted" | "unavailable" | "pending" | "failed";

interface MediaQueryLike {
  readonly matches: boolean;
  addEventListener?(type: "change", listener: () => void): void;
  removeEventListener?(type: "change", listener: () => void): void;
}

export interface InstallEnvironment {
  supportsPromptEvent(): boolean;
  addEventListener(
    type: "beforeinstallprompt" | "appinstalled",
    listener: (e: Event) => void,
  ): void;
  removeEventListener(
    type: "beforeinstallprompt" | "appinstalled",
    listener: (e: Event) => void,
  ): void;
  /** `matchMedia("(display-mode: standalone)")`, or null where unavailable. */
  standaloneQuery(): MediaQueryLike | null;
  /** iOS Safari's non-standard `navigator.standalone === true`. */
  navigatorStandalone(): boolean;
}

export interface InstallPromptStore {
  /** Attaches the listeners once; later calls do nothing. */
  start(): void;
  getSnapshot(): InstallState;
  subscribe(listener: () => void): () => void;
  /** Shows the retained prompt; call synchronously from a user action only. */
  promptInstall(): PromptResult;
  /** Removes every listener (tests; the application never disposes). */
  dispose(): void;
}

export const STANDALONE_QUERY = "(display-mode: standalone)";

export const browserInstallEnvironment: InstallEnvironment = {
  supportsPromptEvent: () => typeof window !== "undefined" && "onbeforeinstallprompt" in window,
  addEventListener: (type, listener) => window.addEventListener(type, listener),
  removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  standaloneQuery: () =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(STANDALONE_QUERY)
      : null,
  navigatorStandalone: () =>
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { standalone?: boolean }).standalone === true,
};

function isPromptEvent(event: Event): event is BeforeInstallPromptEventLike {
  const candidate = event as Partial<BeforeInstallPromptEventLike>;
  return typeof candidate.prompt === "function";
}

export function createInstallPromptStore(
  environment: InstallEnvironment = browserInstallEnvironment,
): InstallPromptStore {
  let started = false;
  let deferred: BeforeInstallPromptEventLike | null = null;
  /** Increments for every prompt shown; a completion applies only to the current one. */
  let promptGeneration = 0;
  let query: MediaQueryLike | null = null;
  const listeners = new Set<() => void>();
  let state: InstallState = {
    promptEventSupported: false,
    available: false,
    pending: false,
    outcome: null,
    installedReported: false,
    standalone: false,
  };

  function update(patch: Partial<InstallState>) {
    const next = { ...state, ...patch };
    if ((Object.keys(next) as (keyof InstallState)[]).every((k) => next[k] === state[k])) return;
    state = next;
    for (const listener of [...listeners]) listener();
  }

  const readStandalone = () => (query?.matches ?? false) || environment.navigatorStandalone();

  const onBeforeInstallPrompt = (event: Event) => {
    if (!isPromptEvent(event)) return;
    if (readStandalone()) return; // not retained, so the default is left alone
    event.preventDefault(); // the app shows its own Install app action instead
    deferred = event;
    update({ available: true, outcome: null });
  };

  const onAppInstalled = () => {
    deferred = null;
    update({ available: false, installedReported: true });
  };

  const onDisplayModeChange = () => {
    const standalone = readStandalone();
    if (standalone) deferred = null;
    update({ standalone, available: standalone ? false : deferred !== null });
  };

  function settle(generation: number, outcome: InstallOutcome) {
    if (generation !== promptGeneration) return; // a stale completion changes nothing
    update({ pending: false, outcome });
  }

  return {
    start() {
      if (started) return;
      started = true;
      environment.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      environment.addEventListener("appinstalled", onAppInstalled);
      query = environment.standaloneQuery();
      query?.addEventListener?.("change", onDisplayModeChange);
      update({
        promptEventSupported: environment.supportsPromptEvent(),
        standalone: readStandalone(),
      });
    },
    getSnapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    promptInstall() {
      if (state.pending) return "pending";
      const event = deferred;
      if (!event) return "unavailable";
      // Consumed before prompt() is called: it can never be shown twice.
      deferred = null;
      const generation = ++promptGeneration;
      update({ available: false, pending: true, outcome: null });
      let shown: Promise<unknown> | void;
      try {
        shown = event.prompt(); // synchronously, inside the user's action
      } catch {
        settle(generation, "failed");
        return "failed";
      }
      Promise.resolve(shown)
        .then(() => event.userChoice)
        .then(
          (choice) => settle(generation, choice?.outcome === "accepted" ? "accepted" : "dismissed"),
          () => settle(generation, "failed"),
        );
      return "prompted";
    },
    dispose() {
      environment.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      environment.removeEventListener("appinstalled", onAppInstalled);
      query?.removeEventListener?.("change", onDisplayModeChange);
      listeners.clear();
    },
  };
}

/** The application's store, started when this module is first evaluated (with the main bundle). */
export const installPrompt = createInstallPromptStore();
if (typeof window !== "undefined") installPrompt.start();
