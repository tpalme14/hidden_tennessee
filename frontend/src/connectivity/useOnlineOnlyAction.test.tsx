import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  createConnectivityStore,
  type BrowserEnvironment,
  type RequestEvidence,
} from "./connectivity";
import { createUpdateSafety, type UpdateSafety } from "../pwa/updateSafety";
import { ONLINE_ONLY_REASON, OnlineOnlyReason, UPDATING_REASON } from "./OnlineOnlyReason";
import { describedByIds, useOnlineOnlyAction } from "./useOnlineOnlyAction";

/**
 * M06-T02 Increment 3b-i — the shared online-only availability rule: an
 * action is unavailable ONLY while reachability is `unreachable`.
 */

function setup() {
  const listeners: Record<"online" | "offline", Set<() => void>> = {
    online: new Set(),
    offline: new Set(),
  };
  const browser: BrowserEnvironment = {
    isOnline: () => true,
    addEventListener: (type, l) => {
      listeners[type].add(l);
    },
    removeEventListener: (type, l) => {
      listeners[type].delete(l);
    },
  };
  const store = createConnectivityStore(browser);
  return {
    store,
    report: (evidence: RequestEvidence) =>
      act(() => store.reportOutcome(store.beginRequest(), evidence)),
    offline: () => act(() => listeners.offline.forEach((l) => l())),
    online: () => act(() => listeners.online.forEach((l) => l())),
  };
}

function Probe({
  store,
  label,
  safety,
}: {
  store: ReturnType<typeof setup>["store"];
  label: string;
  safety?: UpdateSafety;
}) {
  const action = useOnlineOnlyAction(store, safety);
  return (
    <div>
      <button
        type="button"
        aria-describedby={action.describedBy}
        aria-disabled={action.unavailable || undefined}
      >
        {label}
      </button>
      <OnlineOnlyReason action={action} />
    </div>
  );
}

describe("useOnlineOnlyAction", () => {
  it("is available while reachability is unknown (the initial state)", () => {
    const t = setup();
    render(<Probe store={t.store} label="Act" />);
    expect(screen.getByRole("button", { name: "Act" })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(ONLINE_ONLY_REASON)).toBeNull();
  });

  it.each<[string, (t: ReturnType<typeof setup>) => void]>([
    ["reachable", (t) => t.report("response")],
    ["a server problem", (t) => t.report("server-problem")],
    ["a cancelled request", (t) => t.report("cancelled")],
    ["the browser's offline hint alone", (t) => t.offline()],
  ])("stays available for %s", (_label, apply) => {
    const t = setup();
    render(<Probe store={t.store} label="Act" />);
    apply(t);
    expect(screen.getByRole("button", { name: "Act" })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(ONLINE_ONLY_REASON)).toBeNull();
  });

  it("is unavailable while unreachable, with a visible reason associated by aria-describedby", () => {
    const t = setup();
    render(<Probe store={t.store} label="Act" />);
    t.report("network-failure");
    const button = screen.getByRole("button", { name: "Act" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    expect(screen.getByText(ONLINE_ONLY_REASON).tagName).toBe("P");
    // Not a live region: the banner announces the situation once.
    expect(screen.getByText(ONLINE_ONLY_REASON)).not.toHaveAttribute("aria-live");
    expect(screen.getByText(ONLINE_ONLY_REASON)).not.toHaveAttribute("role");
  });

  it("becomes available again on recovery (an online reset or a new response)", () => {
    const t = setup();
    render(<Probe store={t.store} label="Act" />);
    t.report("network-failure");
    t.online(); // unreachable → unknown
    expect(screen.getByRole("button", { name: "Act" })).not.toHaveAttribute("aria-disabled");
    t.report("network-failure");
    t.report("response");
    expect(screen.getByRole("button", { name: "Act" })).not.toHaveAttribute("aria-disabled");
  });

  it("gives every control its own reason id", () => {
    const t = setup();
    render(
      <>
        <Probe store={t.store} label="First" />
        <Probe store={t.store} label="Second" />
      </>,
    );
    t.report("network-failure");
    const first = screen.getByRole("button", { name: "First" }).getAttribute("aria-describedby");
    const second = screen.getByRole("button", { name: "Second" }).getAttribute("aria-describedby");
    expect(first).toBeTruthy();
    expect(second).toBeTruthy();
    expect(first).not.toBe(second);
    expect(document.getElementById(first!)).toHaveTextContent(ONLINE_ONLY_REASON);
    expect(document.getElementById(second!)).toHaveTextContent(ONLINE_ONLY_REASON);
    expect(new Set([...document.querySelectorAll("[id]")].map((e) => e.id)).size).toBe(
      document.querySelectorAll("[id]").length,
    );
  });

  it("describedByIds joins only the ids present", () => {
    expect(describedByIds(undefined, null)).toBeUndefined();
    expect(describedByIds("a", undefined, "b")).toBe("a b");
  });
});

describe("useOnlineOnlyAction — while an application update holds the gate (Increment 4b-iii)", () => {
  function hold(safety: UpdateSafety) {
    let release = () => {};
    act(() => {
      const result = safety.tryAcquireGate();
      if (result.kind !== "acquired") throw new Error("expected the gate");
      release = () => result.gate.release();
    });
    return () => act(() => release());
  }

  it("is unavailable with the update reason (not a connectivity reason)", () => {
    const t = setup();
    const safety = createUpdateSafety();
    render(<Probe store={t.store} label="Act" safety={safety} />);
    const release = hold(safety);
    const button = screen.getByRole("button", { name: "Act" });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAccessibleDescription(UPDATING_REASON);
    expect(screen.queryByText(ONLINE_ONLY_REASON)).toBeNull();
    expect(screen.getByText(UPDATING_REASON)).not.toHaveAttribute("aria-live");
    release();
    expect(screen.getByRole("button", { name: "Act" })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(UPDATING_REASON)).toBeNull();
  });

  it("the update reason takes precedence over unreachable; the connectivity reason returns afterwards", () => {
    const t = setup();
    const safety = createUpdateSafety();
    render(<Probe store={t.store} label="Act" safety={safety} />);
    t.report("network-failure");
    const release = hold(safety);
    expect(screen.getByRole("button", { name: "Act" })).toHaveAccessibleDescription(
      UPDATING_REASON,
    );
    release();
    expect(screen.getByRole("button", { name: "Act" })).toHaveAccessibleDescription(
      ONLINE_ONLY_REASON,
    );
  });

  it("pending work or protected information alone does not make an action unavailable", () => {
    const t = setup();
    const safety = createUpdateSafety();
    render(<Probe store={t.store} label="Act" safety={safety} />);
    act(() => {
      safety.beginMutationRequest();
      safety.acquireHold();
      safety.protect("trip-name");
    });
    expect(screen.getByRole("button", { name: "Act" })).not.toHaveAttribute("aria-disabled");
  });
});
