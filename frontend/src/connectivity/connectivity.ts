/**
 * Connectivity evidence (M06-T02 Increment 3a; Specification 6 v1.1
 * OFF-NET-1 to OFF-NET-3, AC-26). Application-owned, in memory only, and not
 * tied to any account: nothing here is persisted.
 *
 * Two independent signals:
 * - `browser`: the browser's own hint (`navigator.onLine` and its
 *   `online`/`offline` events). A hint only — never proof that the server can
 *   or cannot be reached.
 * - `reachability`: evidence from the application's own requests, reported by
 *   the central API client (src/api/client.ts):
 *     unknown        — no evidence yet, or reset by an `online` event;
 *     reachable      — an HTTP response was received (any 2xx–4xx status);
 *     server-problem — the server answered with a 5xx (including 503) or a
 *                      body the application could not read;
 *     unreachable    — the request failed without any HTTP response.
 *   An intentionally cancelled request is no evidence at all.
 *
 * Ordering. Every request takes a sequence number when it STARTS
 * (`beginRequest`); starting is not evidence. An outcome is applied only if
 * its sequence number is greater than the "watermark" — the sequence number
 * of the last applied outcome — and then becomes the new watermark. So a
 * slower, older request can never override evidence from a newer one, in
 * either direction, and a cancelled request (which reports nothing) never
 * moves the watermark. An `online` event that resets `unreachable` to
 * `unknown` raises the watermark to the latest started sequence number, so
 * nothing that started before the reset can restore stale evidence. The
 * explicit health check goes through the same client, so the same rules
 * apply to it. No timers, polling, or retries exist anywhere here.
 */

export type BrowserHint = "online" | "offline";
export type Reachability = "unknown" | "reachable" | "server-problem" | "unreachable";
export type RequestEvidence = "response" | "server-problem" | "network-failure" | "cancelled";

export interface ConnectivityState {
  browser: BrowserHint;
  reachability: Reachability;
}

export interface BrowserEnvironment {
  isOnline(): boolean;
  addEventListener(type: "online" | "offline", listener: () => void): void;
  removeEventListener(type: "online" | "offline", listener: () => void): void;
}

export interface ConnectivityStore {
  getState(): ConnectivityState;
  /** React-compatible subscription; browser listeners exist only while someone is subscribed. */
  subscribe(listener: () => void): () => void;
  /** Called by the API client when a request starts; returns its sequence number. */
  beginRequest(): number;
  /** Called by the API client with the outcome of the request started as `sequence`. */
  reportOutcome(sequence: number, evidence: RequestEvidence): void;
}

const EVIDENCE_TO_REACHABILITY: Record<Exclude<RequestEvidence, "cancelled">, Reachability> = {
  response: "reachable",
  "server-problem": "server-problem",
  "network-failure": "unreachable",
};

function defaultBrowser(): BrowserEnvironment | null {
  if (typeof window === "undefined" || typeof navigator === "undefined") return null;
  return {
    isOnline: () => navigator.onLine !== false,
    addEventListener: (type, listener) => window.addEventListener(type, listener),
    removeEventListener: (type, listener) => window.removeEventListener(type, listener),
  };
}

export function createConnectivityStore(
  browser: BrowserEnvironment | null = defaultBrowser(),
): ConnectivityStore {
  let state: ConnectivityState = {
    browser: browser && !browser.isOnline() ? "offline" : "online",
    reachability: "unknown",
  };
  let lastStarted = 0;
  let watermark = 0;
  const listeners = new Set<() => void>();

  function set(next: ConnectivityState) {
    if (next.browser === state.browser && next.reachability === state.reachability) return;
    state = next;
    for (const listener of [...listeners]) listener();
  }

  const onOffline = () => set({ ...state, browser: "offline" });
  const onOnline = () => {
    if (state.reachability === "unreachable") {
      // Not recovery: reachability becomes unknown until new evidence arrives,
      // and nothing started before this point may restore stale evidence.
      watermark = lastStarted;
      set({ browser: "online", reachability: "unknown" });
    } else {
      set({ ...state, browser: "online" });
    }
  };

  return {
    getState: () => state,
    subscribe(listener) {
      if (listeners.size === 0 && browser) {
        browser.addEventListener("offline", onOffline);
        browser.addEventListener("online", onOnline);
        // Re-read the hint: it may have changed while nobody was listening.
        set({ ...state, browser: browser.isOnline() ? "online" : "offline" });
      }
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0 && browser) {
          browser.removeEventListener("offline", onOffline);
          browser.removeEventListener("online", onOnline);
        }
      };
    },
    beginRequest() {
      lastStarted += 1;
      return lastStarted;
    },
    reportOutcome(sequence, evidence) {
      if (evidence === "cancelled" || sequence <= watermark) return;
      watermark = sequence;
      set({ ...state, reachability: EVIDENCE_TO_REACHABILITY[evidence] });
    },
  };
}

/** The application's store, fed by the API client and read by the connectivity banner. */
export const connectivity = createConnectivityStore();
