import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ErrorState } from "../components/ErrorState";
import { ConnectivityBanner } from "./ConnectivityBanner";
import { createConnectivityStore, type BrowserEnvironment } from "./connectivity";
import type { HealthCheckOutcome } from "./useConnectivity";

/**
 * M06-T02 Increment 3a — the connectivity banner and its explicit
 * "Check connection" action, against an isolated store and a fake check.
 */

function setup(online = true) {
  const listeners: Record<"online" | "offline", Set<() => void>> = {
    online: new Set(),
    offline: new Set(),
  };
  let isOnline = online;
  const browser: BrowserEnvironment = {
    isOnline: () => isOnline,
    addEventListener: (type, l) => listeners[type].add(l),
    removeEventListener: (type, l) => listeners[type].delete(l),
  };
  const store = createConnectivityStore(browser);
  return {
    store,
    listeners,
    report(evidence: "response" | "server-problem" | "network-failure") {
      act(() => store.reportOutcome(store.beginRequest(), evidence));
    },
    goOffline() {
      isOnline = false;
      act(() => listeners.offline.forEach((l) => l()));
    },
    goOnline() {
      isOnline = true;
      act(() => listeners.online.forEach((l) => l()));
    },
  };
}

function liveRegion(container: HTMLElement) {
  const region = container.querySelector("[aria-live='polite']");
  expect(region).not.toBeNull();
  return region as HTMLElement;
}

const checkButton = () => screen.queryByRole("button", { name: /check(ing)? connection/i });

describe("ConnectivityBanner wording", () => {
  it("adds nothing — not even a live region — while there is no evidence of a problem", () => {
    const { store } = setup();
    const { container } = render(<ConnectivityBanner store={store} check={vi.fn()} />);
    expect(container.querySelector("[aria-live]")).toBeNull();
    expect(container.textContent).toBe("");
    expect(checkButton()).toBeNull();
    expect(screen.queryByRole("status")).toBeNull(); // never competes with feature status regions
  });

  it("creates the live region empty and fills it on the next commit, so the first message is announced; then keeps it", () => {
    const t = setup(true);
    const { container } = render(<ConnectivityBanner store={t.store} check={vi.fn()} />);
    const observer = new MutationObserver(() => {});
    observer.observe(container, { childList: true, characterData: true, subtree: true });
    t.report("network-failure");
    const records = observer.takeRecords();
    observer.disconnect();
    const region = container.querySelector("[aria-live='polite']");
    expect(region).toHaveTextContent(/^The app can't reach the server/);
    // The region was inserted by one mutation and its text by a LATER one
    // (had it been inserted already filled, no later mutation would target it).
    const inserted = records.findIndex((r) => [...r.addedNodes].includes(region!));
    const filled = records.findIndex((r, i) => i > inserted && r.target === region);
    expect(inserted).toBeGreaterThanOrEqual(0);
    expect(filled).toBeGreaterThan(inserted);
    // Once created, the region stays (empty) after the problem clears.
    t.report("response");
    expect(liveRegion(container)).toHaveTextContent("");
  });

  it("offline browser hint with unknown reachability: a hint, not a claim about the server", () => {
    const t = setup(false);
    const { container } = render(<ConnectivityBanner store={t.store} check={vi.fn()} />);
    expect(liveRegion(container)).toHaveTextContent(
      "Your device reports that it is offline. Pages and actions that need the server may not work.",
    );
    expect(checkButton()).not.toBeNull();
  });

  it("unreachable while the browser reports offline", () => {
    const t = setup(false);
    const { container } = render(<ConnectivityBanner store={t.store} check={vi.fn()} />);
    t.report("network-failure");
    expect(liveRegion(container)).toHaveTextContent(/^You appear to be offline\./);
  });

  it("unreachable while the browser reports online", () => {
    const t = setup(true);
    const { container } = render(<ConnectivityBanner store={t.store} check={vi.fn()} />);
    t.report("network-failure");
    expect(liveRegion(container)).toHaveTextContent(
      "The app can't reach the server right now, although your device reports a network connection.",
    );
  });

  it("a server problem from an ordinary request is left to the feature (no banner)", () => {
    const t = setup(true);
    const { container } = render(<ConnectivityBanner store={t.store} check={vi.fn()} />);
    t.report("server-problem");
    expect(container.textContent).toBe("");
    expect(checkButton()).toBeNull();
  });

  it("never claims saved data is available offline", () => {
    const t = setup(false);
    const { container } = render(<ConnectivityBanner store={t.store} check={vi.fn()} />);
    t.report("network-failure");
    expect(container.textContent).not.toMatch(/saved|available offline|works offline/i);
  });

  it("returning online is not presented as recovery", () => {
    const t = setup(false);
    const { container } = render(<ConnectivityBanner store={t.store} check={vi.fn()} />);
    t.report("network-failure");
    t.goOnline();
    expect(liveRegion(container)).toHaveTextContent("");
    expect(container.textContent).not.toMatch(/connected|restored|back online/i);
  });

  it("does not re-announce identical evidence (the live text is unchanged)", () => {
    const t = setup(true);
    const { container } = render(<ConnectivityBanner store={t.store} check={vi.fn()} />);
    t.report("network-failure");
    const region = liveRegion(container);
    const before = region.textContent;
    const observed: MutationRecord[] = [];
    const observer = new MutationObserver((records) => observed.push(...records));
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    t.report("network-failure");
    t.report("network-failure");
    observer.disconnect();
    expect(observed).toEqual([]);
    expect(region.textContent).toBe(before);
  });

  it("does not move focus when it appears", () => {
    const t = setup(true);
    render(
      <>
        <button type="button">Elsewhere</button>
        <ConnectivityBanner store={t.store} check={vi.fn()} />
      </>,
    );
    screen.getByRole("button", { name: "Elsewhere" }).focus();
    t.report("network-failure");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Elsewhere" }));
  });

  it("leaves a feature's own error and retry in place", () => {
    const t = setup(true);
    const onRetry = vi.fn();
    render(
      <>
        <ConnectivityBanner store={t.store} check={vi.fn()} />
        <ErrorState
          message="Unable to reach the server. Check your connection and try again."
          onRetry={onRetry}
        />
      </>,
    );
    t.report("network-failure");
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(
      screen.getByText("Unable to reach the server. Check your connection and try again."),
    ).toBeInTheDocument();
  });
});

describe("ConnectivityBanner explicit check", () => {
  function controlledCheck() {
    let resolve!: (outcome: HealthCheckOutcome) => void;
    const check = vi.fn(
      () =>
        new Promise<HealthCheckOutcome>((r) => {
          resolve = r;
        }),
    );
    return { check, finish: (outcome: HealthCheckOutcome) => resolve(outcome) };
  }

  it("runs one check per press, shows a pending state, and ignores repeated presses while pending", async () => {
    const t = setup(true);
    const { check, finish } = controlledCheck();
    const user = userEvent.setup();
    const { container } = render(<ConnectivityBanner store={t.store} check={check} />);
    t.report("network-failure");
    await user.click(checkButton()!);
    expect(checkButton()).toHaveTextContent("Checking connection…");
    expect(checkButton()).toHaveAttribute("aria-disabled", "true");
    expect(liveRegion(container)).toHaveTextContent(/Checking the connection…/);
    await user.click(checkButton()!);
    await user.click(checkButton()!);
    expect(check).toHaveBeenCalledTimes(1);
    await act(async () => finish("unreachable"));
  });

  it("a healthy server: the banner goes away and recovery is announced", async () => {
    const t = setup(true);
    const user = userEvent.setup();
    const check = vi.fn(async () => {
      // The real check reports its evidence through the client first.
      t.store.reportOutcome(t.store.beginRequest(), "response");
      return "healthy" as const;
    });
    const { container } = render(<ConnectivityBanner store={t.store} check={check} />);
    t.report("network-failure");
    await user.click(checkButton()!);
    expect(checkButton()).toBeNull();
    expect(liveRegion(container)).toHaveTextContent("Connected to the server.");
  });

  it("an unhealthy server (503): reachable, but not presented as recovery", async () => {
    const t = setup(true);
    const user = userEvent.setup();
    const check = vi.fn(async () => {
      t.store.reportOutcome(t.store.beginRequest(), "server-problem");
      return "unhealthy" as const;
    });
    const { container } = render(<ConnectivityBanner store={t.store} check={check} />);
    t.report("network-failure");
    await user.click(checkButton()!);
    expect(liveRegion(container)).toHaveTextContent(
      "The server responded but isn't working normally. Some pages and actions may not work.",
    );
    expect(container.textContent).not.toMatch(/Connected to the server/);
  });

  it("a failed check keeps the unreachable message and says so", async () => {
    const t = setup(true);
    const user = userEvent.setup();
    const check = vi.fn(async () => {
      t.store.reportOutcome(t.store.beginRequest(), "network-failure");
      return "unreachable" as const;
    });
    const { container } = render(<ConnectivityBanner store={t.store} check={check} />);
    t.report("network-failure");
    await user.click(checkButton()!);
    expect(liveRegion(container)).toHaveTextContent(/The server still can't be reached\./);
    expect(container.textContent).not.toMatch(/Connected to the server/);
  });

  it("is keyboard operable", async () => {
    const t = setup(true);
    const user = userEvent.setup();
    const check = vi.fn(async () => "unreachable" as const);
    render(<ConnectivityBanner store={t.store} check={check} />);
    t.report("network-failure");
    await user.tab();
    expect(checkButton()).toHaveFocus();
    await user.keyboard("{Enter}");
    expect(check).toHaveBeenCalledTimes(1);
  });

  it("never checks on its own: not on mount, on browser events, or on new evidence", () => {
    const t = setup(false);
    const check = vi.fn();
    render(<ConnectivityBanner store={t.store} check={check} />);
    t.report("network-failure");
    t.goOnline();
    t.goOffline();
    t.report("response");
    expect(check).not.toHaveBeenCalled();
  });

  it("unsubscribes from the store and the browser on unmount", () => {
    const t = setup(true);
    const { unmount } = render(<ConnectivityBanner store={t.store} check={vi.fn()} />);
    expect(t.listeners.online.size).toBe(1);
    unmount();
    expect(t.listeners.online.size).toBe(0);
    expect(t.listeners.offline.size).toBe(0);
  });
});
