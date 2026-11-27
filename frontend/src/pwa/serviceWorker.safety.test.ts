import { describe, expect, it } from "vitest";
import { ACTIVATION_OBSERVATION_MS } from "./serviceWorker";
import { controllerHarness, FakeWorker, skipWaitingSent } from "./serviceWorker.fakes";

/**
 * M06-T02 Increment 4b-iii — the lifecycle controller integrated with the REAL
 * update-safety store (only browser primitives are faked). Final acceptance is
 * synchronous: action → worker token → protected revision → pending requests
 * → holds → gate → lifecycle re-check → dispatch. Each attempt owns its gate,
 * which is released only once no automatic reload remains possible.
 */

describe("acceptUpdate — synchronous final acceptance", () => {
  it("dispatches SKIP_WAITING only AFTER the gate is held, exactly once", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    const gateAtDispatch: boolean[] = [];
    w.onPost = () => gateAtDispatch.push(t.safety.getSnapshot().gateHeld);
    expect(t.sw.acceptUpdate(t.current())).toBe("activating");
    expect(gateAtDispatch).toEqual([true]);
    expect(skipWaitingSent(w)).toBe(1);
    expect(t.safety.getSnapshot().gateHeld).toBe(true);
  });

  it("refuses while a mutation request is pending: nothing sent, no gate, and nothing happens when it ends", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    const end = t.safety.beginMutationRequest()!;
    expect(t.sw.acceptUpdate(t.current())).toBe("busy");
    expect(skipWaitingSent(w)).toBe(0);
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
    expect(t.sw.getState().update).toBe("waiting");
    end(); // pending work reaches zero
    expect(skipWaitingSent(w)).toBe(0); // never auto-activated
    expect(t.timers).toHaveLength(0);
    expect(t.sw.getState().update).toBe("waiting");
    expect(t.sw.acceptUpdate(t.current())).toBe("activating"); // a NEW user action is needed
  });

  it("refuses while an operation hold is active, and never auto-activates when it ends", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    const hold = t.safety.acquireHold()!;
    expect(t.sw.acceptUpdate(t.current())).toBe("busy");
    hold.release();
    expect(skipWaitingSent(w)).toBe(0);
    expect(t.sw.getState().update).toBe("waiting");
  });

  it("while the attempt holds the gate, new mutation requests and holds are refused", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    t.sw.acceptUpdate(t.current());
    expect(t.safety.beginMutationRequest()).toBeNull();
    expect(t.safety.acquireHold()).toBeNull();
  });

  it("a confirmation for a different (replaced) waiting worker is stale: nothing sent", () => {
    const w1 = new FakeWorker("w1");
    const t = controllerHarness({ waiting: w1 });
    const confirmed = t.current();
    const w2 = new FakeWorker("w2");
    t.registration.waiting = w2;
    w1.become("redundant"); // w2 is now the one shown
    expect(t.sw.getState().waitingToken).not.toBe(confirmed.waitingToken);
    expect(t.sw.acceptUpdate(confirmed)).toBe("stale");
    expect(skipWaitingSent(w1) + skipWaitingSent(w2)).toBe(0);
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
  });

  it("the same worker keeps the same token (postponing changes nothing)", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    const before = t.sw.getState().waitingToken;
    t.sw.postpone();
    expect(t.sw.getState().waitingToken).toBe(before);
    expect(t.sw.acceptUpdate(t.current())).toBe("activating");
  });

  it("a protected-information change after confirmation is stale — even when the categories are the same", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    const draft = t.safety.protect("review-draft");
    const confirmed = t.current();
    draft.touch(); // same category, newer revision
    expect(t.safety.getSnapshot().protectedCategories).toEqual(["review-draft"]);
    expect(t.sw.acceptUpdate(confirmed)).toBe("stale");
    expect(skipWaitingSent(w)).toBe(0);
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
    expect(t.sw.acceptUpdate(t.current())).toBe("activating");
  });

  it("checks in order: token before revision before pending work", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    const end = t.safety.beginMutationRequest()!;
    const current = t.current();
    expect(t.sw.acceptUpdate({ ...current, waitingToken: current.waitingToken + 1 })).toBe("stale");
    expect(
      t.sw.acceptUpdate({ ...current, protectedRevision: current.protectedRevision + 1 }),
    ).toBe("stale");
    expect(t.sw.acceptUpdate(current)).toBe("busy");
    end();
  });

  it("another transition holding the gate refuses acceptance", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    const other = t.safety.tryAcquireGate();
    expect(t.sw.acceptUpdate(t.current())).toBe("busy");
    expect(skipWaitingSent(w)).toBe(0);
    if (other.kind === "acquired") other.gate.release();
  });

  it("a worker replaced before dispatch: the gate is released, nothing sent", () => {
    const w1 = new FakeWorker("w1");
    const t = controllerHarness({ waiting: w1 });
    const confirmed = t.current();
    t.registration.waiting = new FakeWorker("w2"); // not yet reported
    expect(t.sw.acceptUpdate(confirmed)).toBe("failed");
    expect(skipWaitingSent(w1)).toBe(0);
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
  });

  it("postMessage throwing is a confirmed pre-dispatch failure: the gate is released", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    w.onPost = () => {
      throw new Error("cannot post");
    };
    expect(t.sw.acceptUpdate(t.current())).toBe("failed");
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
    expect(t.timers).toHaveLength(0);
    w.become("activated");
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("after a failure, Check again shows the waiting worker; acceptance is a new action", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    w.onPost = () => {
      throw new Error("cannot post");
    };
    t.sw.acceptUpdate(t.current());
    w.onPost = () => {};
    t.sw.reconsider();
    expect(t.sw.getState().update).toBe("waiting");
    expect(skipWaitingSent(w)).toBe(0);
  });
});

describe("the attempt's gate — released only when no automatic reload remains possible", () => {
  it("activation: the authorized reload runs once and the gate is KEPT through unloading", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    t.sw.acceptUpdate(t.current());
    w.become("activated");
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.safety.getSnapshot().gateHeld).toBe(true);
    expect(t.sw.getState().update).toBe("reloading");
  });

  it("the document stays active after the reload: the watchdog releases the gate → reload-required (no second reload)", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    t.sw.acceptUpdate(t.current());
    w.become("activated");
    expect(t.activeTimers().map((x) => x.ms)).toEqual([ACTIVATION_OBSERVATION_MS]);
    t.fireTimers();
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
    expect(t.sw.getState().update).toBe("reload-required");
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it("reload() throwing: the gate is released and an explicit Reload is offered", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    t.reload.mockImplementationOnce(() => {
      throw new Error("reload blocked");
    });
    t.sw.acceptUpdate(t.current());
    w.become("activated");
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
    expect(t.sw.getState().update).toBe("reload-required");
    expect(t.activeTimers()).toHaveLength(0);
  });

  it("timeout: reload authorization is revoked BEFORE the gate is released", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    t.sw.acceptUpdate(t.current());
    const order: string[] = [];
    // The instant the gate is released, the worker activates (the ambiguous race).
    const unsubscribe = t.safety.subscribe(() => {
      if (!t.safety.getSnapshot().gateHeld && order.length === 0) {
        order.push("gate released");
        w.become("activated");
      }
    });
    t.fireTimers();
    unsubscribe();
    expect(order).toEqual(["gate released"]);
    expect(t.reload).not.toHaveBeenCalled(); // revocation had already happened
    expect(t.sw.getState().update).toBe("reload-required");
  });

  it("timeout then late activation: never an automatic reload; the gate stays released", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    t.sw.acceptUpdate(t.current());
    t.fireTimers();
    expect(t.sw.getState().update).toBe("unresolved");
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
    w.become("activated");
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.sw.getState().update).toBe("reload-required");
  });

  it("redundant accepted worker: the gate is released → unavailable", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    t.sw.acceptUpdate(t.current());
    w.become("redundant");
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
    expect(t.sw.getState().update).toBe("unavailable");
  });

  it("a stale lifecycle event never releases a newer gate", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    t.sw.acceptUpdate(t.current());
    t.fireTimers(); // attempt's gate released
    const newer = t.safety.tryAcquireGate();
    expect(newer.kind).toBe("acquired");
    w.become("redundant"); // the old attempt's late outcome
    t.fireTimers();
    expect(t.safety.getSnapshot().gateHeld).toBe(true);
    if (newer.kind === "acquired") newer.gate.release();
  });

  it("a late worker event during a reload changes nothing and releases nothing", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    t.sw.acceptUpdate(t.current());
    w.become("activated");
    w.become("redundant");
    expect(t.sw.getState().update).toBe("reloading");
    expect(t.safety.getSnapshot().gateHeld).toBe(true);
  });

  it("no automatic retry: nothing is re-sent after unresolved, unavailable, or failed", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    t.sw.acceptUpdate(t.current());
    t.fireTimers();
    t.fireTimers();
    expect(skipWaitingSent(w)).toBe(1);
  });
});

describe("reloadPage — explicit Reload after an observed activation", () => {
  function activatedElsewhere() {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    w.become("activated"); // not accepted here
    expect(t.sw.getState().update).toBe("activated-elsewhere");
    return t;
  }

  it("is never automatic, even when pending work reaches zero", () => {
    const t = activatedElsewhere();
    const end = t.safety.beginMutationRequest()!;
    end();
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("reloads on request, holding the gate", () => {
    const t = activatedElsewhere();
    expect(t.sw.reloadPage({ protectedRevision: t.current().protectedRevision })).toBe("reloading");
    expect(t.reload).toHaveBeenCalledTimes(1);
    expect(t.safety.getSnapshot().gateHeld).toBe(true);
  });

  it("is refused while a request is pending or a hold is active", () => {
    const t = activatedElsewhere();
    const end = t.safety.beginMutationRequest()!;
    expect(t.sw.reloadPage({ protectedRevision: t.current().protectedRevision })).toBe("busy");
    end();
    const hold = t.safety.acquireHold()!;
    expect(t.sw.reloadPage({ protectedRevision: t.current().protectedRevision })).toBe("busy");
    hold.release();
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("validates the protected revision", () => {
    const t = activatedElsewhere();
    const p = t.safety.protect("trip-name");
    const confirmed = t.current().protectedRevision;
    p.touch();
    expect(t.sw.reloadPage({ protectedRevision: confirmed })).toBe("stale");
    expect(t.reload).not.toHaveBeenCalled();
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
  });

  it("is not available without an observed activation", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    expect(t.sw.reloadPage({ protectedRevision: t.current().protectedRevision })).toBe(
      "not-available",
    );
    expect(t.reload).not.toHaveBeenCalled();
  });

  it("reload() throwing: protection released, phase restored, failure reported", () => {
    const t = activatedElsewhere();
    t.reload.mockImplementationOnce(() => {
      throw new Error("blocked");
    });
    expect(t.sw.reloadPage({ protectedRevision: t.current().protectedRevision })).toBe("failed");
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
    expect(t.sw.getState().update).toBe("activated-elsewhere");
  });

  it("the document stays active: the watchdog releases the gate and restores the phase", () => {
    const t = activatedElsewhere();
    t.sw.reloadPage({ protectedRevision: t.current().protectedRevision });
    t.fireTimers();
    expect(t.safety.getSnapshot().gateHeld).toBe(false);
    expect(t.sw.getState().update).toBe("activated-elsewhere");
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it("after an unresolved attempt activates late, Reload is offered and works", () => {
    const w = new FakeWorker("w");
    const t = controllerHarness({ waiting: w });
    t.sw.acceptUpdate(t.current());
    t.fireTimers();
    w.become("activated");
    expect(t.sw.getState().update).toBe("reload-required");
    expect(t.sw.reloadPage({ protectedRevision: t.current().protectedRevision })).toBe("reloading");
    expect(t.reload).toHaveBeenCalledTimes(1);
  });
});
