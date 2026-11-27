import { describe, expect, it, vi } from "vitest";
import { createConnectivityStore, type BrowserEnvironment } from "./connectivity";

/**
 * M06-T02 Increment 3a — the connectivity store: evidence, ordering, and
 * browser hints. A fake browser environment records listeners; no timers.
 */

function fakeBrowser(online = true) {
  const listeners: Record<"online" | "offline", Set<() => void>> = {
    online: new Set(),
    offline: new Set(),
  };
  let isOnline = online;
  const env: BrowserEnvironment = {
    isOnline: () => isOnline,
    addEventListener: vi.fn((type: "online" | "offline", listener: () => void) => {
      listeners[type].add(listener);
    }),
    removeEventListener: vi.fn((type: "online" | "offline", listener: () => void) => {
      listeners[type].delete(listener);
    }),
  };
  return {
    env,
    listeners,
    goOffline() {
      isOnline = false;
      for (const l of [...listeners.offline]) l();
    },
    goOnline() {
      isOnline = true;
      for (const l of [...listeners.online]) l();
    },
  };
}

describe("connectivity evidence", () => {
  it("starts with unknown reachability and the browser's hint", () => {
    expect(createConnectivityStore(fakeBrowser(true).env).getState()).toEqual({
      browser: "online",
      reachability: "unknown",
    });
    expect(createConnectivityStore(fakeBrowser(false).env).getState()).toEqual({
      browser: "offline",
      reachability: "unknown",
    });
  });

  it("maps each kind of request outcome", () => {
    const store = createConnectivityStore(fakeBrowser().env);
    store.reportOutcome(store.beginRequest(), "response");
    expect(store.getState().reachability).toBe("reachable");
    store.reportOutcome(store.beginRequest(), "server-problem");
    expect(store.getState().reachability).toBe("server-problem");
    store.reportOutcome(store.beginRequest(), "network-failure");
    expect(store.getState().reachability).toBe("unreachable");
    store.reportOutcome(store.beginRequest(), "response");
    expect(store.getState().reachability).toBe("reachable");
  });

  it("a cancelled request is no evidence", () => {
    const store = createConnectivityStore(fakeBrowser().env);
    store.reportOutcome(store.beginRequest(), "network-failure");
    store.reportOutcome(store.beginRequest(), "cancelled");
    expect(store.getState().reachability).toBe("unreachable");
  });

  it("starting a request is not evidence", () => {
    const store = createConnectivityStore(fakeBrowser().env);
    store.reportOutcome(store.beginRequest(), "network-failure");
    store.beginRequest();
    store.beginRequest();
    expect(store.getState().reachability).toBe("unreachable");
  });
});

describe("request ordering", () => {
  it("an older failure completing after a newer success is ignored", () => {
    const store = createConnectivityStore(fakeBrowser().env);
    const older = store.beginRequest();
    const newer = store.beginRequest();
    store.reportOutcome(newer, "response");
    store.reportOutcome(older, "network-failure");
    expect(store.getState().reachability).toBe("reachable");
  });

  it("an older success completing after a newer failure is ignored", () => {
    const store = createConnectivityStore(fakeBrowser().env);
    const older = store.beginRequest();
    const newer = store.beginRequest();
    store.reportOutcome(newer, "network-failure");
    store.reportOutcome(older, "response");
    expect(store.getState().reachability).toBe("unreachable");
  });

  it("a newer request that is still pending does not suppress an older request's evidence", () => {
    const store = createConnectivityStore(fakeBrowser().env);
    const older = store.beginRequest();
    store.beginRequest(); // never completes
    store.reportOutcome(older, "network-failure");
    expect(store.getState().reachability).toBe("unreachable");
  });

  it("a newer request that is cancelled does not suppress an older request's evidence", () => {
    const store = createConnectivityStore(fakeBrowser().env);
    const older = store.beginRequest();
    const newer = store.beginRequest();
    store.reportOutcome(newer, "cancelled");
    store.reportOutcome(older, "response");
    expect(store.getState().reachability).toBe("reachable");
  });
});

describe("browser hints", () => {
  it("offline changes only the hint, never the reachability evidence", () => {
    const browser = fakeBrowser();
    const store = createConnectivityStore(browser.env);
    const unsubscribe = store.subscribe(() => {});
    store.reportOutcome(store.beginRequest(), "response");
    browser.goOffline();
    expect(store.getState()).toEqual({ browser: "offline", reachability: "reachable" });
    unsubscribe();
  });

  it("online resets unreachable to unknown (not recovered), and a request started before the reset cannot restore stale evidence", () => {
    const browser = fakeBrowser(false);
    const store = createConnectivityStore(browser.env);
    const unsubscribe = store.subscribe(() => {});
    const failing = store.beginRequest();
    const startedBeforeReset = store.beginRequest();
    store.reportOutcome(failing, "network-failure");
    expect(store.getState()).toEqual({ browser: "offline", reachability: "unreachable" });

    browser.goOnline();
    expect(store.getState()).toEqual({ browser: "online", reachability: "unknown" });

    // Evidence from before the reset, in either direction, is stale.
    store.reportOutcome(startedBeforeReset, "network-failure");
    expect(store.getState().reachability).toBe("unknown");

    // New evidence after the reset applies.
    store.reportOutcome(store.beginRequest(), "response");
    expect(store.getState().reachability).toBe("reachable");
    unsubscribe();
  });

  it("online leaves other reachability states unchanged", () => {
    const browser = fakeBrowser(false);
    const store = createConnectivityStore(browser.env);
    const unsubscribe = store.subscribe(() => {});
    store.reportOutcome(store.beginRequest(), "server-problem");
    browser.goOnline();
    expect(store.getState()).toEqual({ browser: "online", reachability: "server-problem" });
    unsubscribe();
  });

  it("adds browser listeners once for many subscribers and removes them with the last one", () => {
    const browser = fakeBrowser();
    const store = createConnectivityStore(browser.env);
    const a = store.subscribe(() => {});
    const b = store.subscribe(() => {});
    const c = store.subscribe(() => {});
    expect(browser.env.addEventListener).toHaveBeenCalledTimes(2); // online + offline
    expect(browser.listeners.online.size).toBe(1);
    expect(browser.listeners.offline.size).toBe(1);
    a();
    b();
    expect(browser.listeners.online.size).toBe(1);
    c();
    expect(browser.listeners.online.size).toBe(0);
    expect(browser.listeners.offline.size).toBe(0);
  });

  it("notifies subscribers once per actual change and not for identical evidence", () => {
    const store = createConnectivityStore(fakeBrowser().env);
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.reportOutcome(store.beginRequest(), "network-failure");
    store.reportOutcome(store.beginRequest(), "network-failure");
    store.reportOutcome(store.beginRequest(), "network-failure");
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("works without a browser environment (no listeners, online hint)", () => {
    const store = createConnectivityStore(null);
    const unsubscribe = store.subscribe(() => {});
    expect(store.getState()).toEqual({ browser: "online", reachability: "unknown" });
    unsubscribe();
  });
});
