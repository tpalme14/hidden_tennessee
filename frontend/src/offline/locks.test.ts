import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AUTH_LOCK,
  createLockCoordinator,
  createLockScope,
  LockOrderError,
  SECURITY_LOCK,
  type LockManagerLike,
  type LockState,
} from "./locks";
import { deferred, FakeLockManager, flush } from "./testSupport";

/**
 * M06-T03 Increment 3b-i — lock coordination against `FakeLockManager`, a
 * stand-in modeling the W3C Web Locks request algorithm (testSupport.ts). It
 * is NOT a real browser: these tests prove this module's use of the contract,
 * not real cross-tab behavior.
 */

function setup() {
  const manager = new FakeLockManager();
  const coordinator = createLockCoordinator(() => manager as unknown as LockManagerLike);
  return { manager, coordinator };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("exclusive and shared semantics", () => {
  it("an exclusive holder excludes a second exclusive request until its protected work completes", async () => {
    const { manager, coordinator } = setup();
    const work = deferred();
    const order: string[] = [];
    const first = coordinator.withLock(createLockScope(), SECURITY_LOCK, "exclusive", async () => {
      order.push("first-start");
      await work.promise;
      order.push("first-end");
    });
    await flush();
    const second = coordinator.withLock(createLockScope(), SECURITY_LOCK, "exclusive", () => {
      order.push("second");
    });
    await flush();
    expect(order).toEqual(["first-start"]);
    expect(manager.snapshot().pending).toEqual([{ name: SECURITY_LOCK, mode: "exclusive" }]);
    work.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second"]);
  });

  it("two shared holders run concurrently", async () => {
    const { manager, coordinator } = setup();
    const work = deferred();
    const entered: string[] = [];
    const run = (label: string) =>
      coordinator.withLock(createLockScope(), SECURITY_LOCK, "shared", async () => {
        entered.push(label);
        await work.promise;
      });
    const a = run("a");
    const b = run("b");
    await flush();
    expect(entered).toEqual(["a", "b"]);
    expect(manager.snapshot().held).toEqual([
      { name: SECURITY_LOCK, mode: "shared" },
      { name: SECURITY_LOCK, mode: "shared" },
    ]);
    work.resolve();
    expect(await a).toEqual({ kind: "done", value: undefined });
    expect(await b).toEqual({ kind: "done", value: undefined });
  });

  it("a shared holder excludes an exclusive transition, and a later shared request waits behind the queued exclusive (modeled queue order)", async () => {
    const { coordinator } = setup();
    const reader = deferred();
    const order: string[] = [];
    const a = coordinator.withLock(createLockScope(), SECURITY_LOCK, "shared", async () => {
      order.push("shared-1");
      await reader.promise;
    });
    await flush();
    const b = coordinator.withLock(createLockScope(), SECURITY_LOCK, "exclusive", () => {
      order.push("exclusive");
    });
    const c = coordinator.withLock(createLockScope(), SECURITY_LOCK, "shared", () => {
      order.push("shared-2");
    });
    await flush();
    expect(order).toEqual(["shared-1"]);
    reader.resolve();
    await Promise.all([a, b, c]);
    expect(order).toEqual(["shared-1", "exclusive", "shared-2"]);
  });

  it("returns the callback value", async () => {
    const { coordinator } = setup();
    expect(await coordinator.withLock(createLockScope(), AUTH_LOCK, "exclusive", () => 42)).toEqual(
      {
        kind: "done",
        value: 42,
      },
    );
  });
});

describe("operation-scoped nesting and order", () => {
  it("allows auth then security within one operation and tracks held locks only while held", async () => {
    const { coordinator } = setup();
    const scope = createLockScope();
    const seen: string[][] = [];
    const result = await coordinator.withLock(scope, AUTH_LOCK, "exclusive", async (outer) => {
      seen.push([...outer.scope.held]);
      const inner = await coordinator.withLock(outer.scope, SECURITY_LOCK, "exclusive", (ctx) => {
        seen.push([...ctx.scope.held]);
        return "inner";
      });
      seen.push([...outer.scope.held]);
      return inner;
    });
    expect(result).toEqual({ kind: "done", value: { kind: "done", value: "inner" } });
    expect(seen).toEqual([[AUTH_LOCK], [AUTH_LOCK, SECURITY_LOCK], [AUTH_LOCK]]);
    expect([...scope.held]).toEqual([]);
  });

  it("rejects re-acquiring a lock the operation already holds, without requesting it", async () => {
    const { manager, coordinator } = setup();
    let caught: unknown;
    await coordinator.withLock(createLockScope(), SECURITY_LOCK, "shared", async (ctx) => {
      const before = manager.requestCount;
      try {
        await coordinator.withLock(ctx.scope, SECURITY_LOCK, "shared", () => undefined);
      } catch (error) {
        caught = error;
      }
      expect(manager.requestCount).toBe(before);
    });
    expect(caught).toBeInstanceOf(LockOrderError);
    expect((caught as LockOrderError).reason).toBe("already-held");
  });

  it("rejects tnle-auth while the operation holds tnle-offline-security (reverse order), without requesting it", async () => {
    const { manager, coordinator } = setup();
    let caught: unknown;
    const ran = vi.fn();
    await coordinator.withLock(createLockScope(), SECURITY_LOCK, "exclusive", async (ctx) => {
      const before = manager.requestCount;
      try {
        await coordinator.withLock(ctx.scope, AUTH_LOCK, "exclusive", ran);
      } catch (error) {
        caught = error;
      }
      expect(manager.requestCount).toBe(before);
    });
    expect(ran).not.toHaveBeenCalled();
    expect(caught).toBeInstanceOf(LockOrderError);
    expect((caught as LockOrderError).reason).toBe("reverse-order");
  });

  it("independent operations are not treated as nested: another operation may take tnle-auth while one holds tnle-offline-security", async () => {
    const { coordinator } = setup();
    const reader = deferred();
    const a = coordinator.withLock(
      createLockScope(),
      SECURITY_LOCK,
      "shared",
      () => reader.promise,
    );
    await flush();
    const b = await coordinator.withLock(createLockScope(), AUTH_LOCK, "exclusive", async (ctx) =>
      coordinator.withLock(ctx.scope, SECURITY_LOCK, "shared", () => "independent"),
    );
    expect(b).toEqual({ kind: "done", value: { kind: "done", value: "independent" } });
    reader.resolve();
    expect(await a).toEqual({ kind: "done", value: undefined });
  });

  it("rejects a shared tnle-auth request and signal combined with ifAvailable", async () => {
    const { manager, coordinator } = setup();
    await expect(
      coordinator.withLock(createLockScope(), AUTH_LOCK, "shared", () => undefined),
    ).rejects.toMatchObject({ name: "LockOrderError", reason: "auth-not-exclusive" });
    await expect(
      coordinator.withLock(createLockScope(), SECURITY_LOCK, "shared", () => undefined, {
        ifAvailable: true,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ reason: "invalid-options" });
    expect(manager.requestCount).toBe(0);
  });
});

describe("release through the browser ownership contract", () => {
  it("releases after a synchronous throw and rethrows the same error after release", async () => {
    const { manager, coordinator } = setup();
    const failure = new Error("synthetic failure");
    const scope = createLockScope();
    await expect(
      coordinator.withLock(scope, SECURITY_LOCK, "exclusive", () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(manager.snapshot()).toEqual({ held: [], pending: [] });
    expect([...scope.held]).toEqual([]);
    expect(await coordinator.withLock(scope, SECURITY_LOCK, "exclusive", () => "next")).toEqual({
      kind: "done",
      value: "next",
    });
  });

  it("releases after an asynchronous rejection, and a waiting request then runs", async () => {
    const { manager, coordinator } = setup();
    const work = deferred();
    const failure = new Error("synthetic rejection");
    const first = coordinator.withLock(createLockScope(), SECURITY_LOCK, "exclusive", async () => {
      await work.promise;
      throw failure;
    });
    await flush();
    const second = coordinator.withLock(createLockScope(), SECURITY_LOCK, "exclusive", () => "ran");
    await flush();
    expect(manager.snapshot().pending).toHaveLength(1);
    work.resolve();
    await expect(first).rejects.toBe(failure);
    expect(await second).toEqual({ kind: "done", value: "ran" });
    expect(manager.snapshot()).toEqual({ held: [], pending: [] });
  });

  it("holds the lock until the protected asynchronous work completes (ownership boundary)", async () => {
    const { manager, coordinator } = setup();
    const work = deferred();
    let completed = false;
    const holder = coordinator.withLock(createLockScope(), SECURITY_LOCK, "exclusive", async () => {
      await work.promise;
      completed = true;
    });
    await flush();
    let observedCompleted: boolean | undefined;
    const next = coordinator.withLock(createLockScope(), SECURITY_LOCK, "exclusive", () => {
      observedCompleted = completed;
    });
    await flush();
    expect(manager.snapshot().held).toEqual([{ name: SECURITY_LOCK, mode: "exclusive" }]);
    expect(observedCompleted).toBeUndefined();
    work.resolve();
    await Promise.all([holder, next]);
    expect(observedCompleted).toBe(true);
  });
});

describe("waiting, cancellation, and failure", () => {
  it("cancellation while waiting removes the request and never runs the callback", async () => {
    const { manager, coordinator } = setup();
    const work = deferred();
    const holder = coordinator.withLock(
      createLockScope(),
      AUTH_LOCK,
      "exclusive",
      () => work.promise,
    );
    await flush();
    const controller = new AbortController();
    const states: LockState[] = [];
    const callback = vi.fn();
    const waiting = coordinator.withLock(createLockScope(), AUTH_LOCK, "exclusive", callback, {
      signal: controller.signal,
      onState: (state) => states.push(state),
    });
    await flush();
    expect(manager.snapshot().pending).toHaveLength(1);
    controller.abort();
    expect(await waiting).toEqual({ kind: "aborted" });
    expect(manager.snapshot().pending).toEqual([]);
    work.resolve();
    await holder;
    await flush();
    expect(callback).not.toHaveBeenCalled();
    expect(states).toEqual(["waiting"]);
  });

  it("an already-aborted signal is reported as aborted without a request", async () => {
    const { manager, coordinator } = setup();
    const controller = new AbortController();
    controller.abort();
    const callback = vi.fn();
    expect(
      await coordinator.withLock(createLockScope(), AUTH_LOCK, "exclusive", callback, {
        signal: controller.signal,
      }),
    ).toEqual({ kind: "aborted" });
    expect(callback).not.toHaveBeenCalled();
    expect(manager.requestCount).toBe(0);
  });

  it("abort after acquisition does not release the lock; the callback sees the signal and the lock is released only when it settles", async () => {
    const { manager, coordinator } = setup();
    const controller = new AbortController();
    const work = deferred();
    let sawAbort = false;
    const holder = coordinator.withLock(
      createLockScope(),
      SECURITY_LOCK,
      "exclusive",
      async (ctx) => {
        await work.promise;
        sawAbort = ctx.signal?.aborted ?? false;
        return "finished";
      },
      { signal: controller.signal },
    );
    await flush();
    controller.abort();
    const next = vi.fn();
    const second = coordinator.withLock(createLockScope(), SECURITY_LOCK, "exclusive", next);
    await flush();
    expect(manager.snapshot().held).toEqual([{ name: SECURITY_LOCK, mode: "exclusive" }]);
    expect(next).not.toHaveBeenCalled();
    work.resolve();
    expect(await holder).toEqual({ kind: "done", value: "finished" });
    expect(sawAbort).toBe(true);
    await second;
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("reports waiting before acquisition, and a long-wait notice neither acquires, releases, nor steals", async () => {
    const { manager, coordinator } = setup();
    const work = deferred();
    const holder = coordinator.withLock(
      createLockScope(),
      AUTH_LOCK,
      "exclusive",
      () => work.promise,
    );
    await flush();
    const states: LockState[] = [];
    const onLongWait = vi.fn();
    const callback = vi.fn();
    const waiter = coordinator.withLock(createLockScope(), AUTH_LOCK, "exclusive", callback, {
      onState: (state) => states.push(state),
      longWaitMs: 5,
      onLongWait,
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(onLongWait).toHaveBeenCalledTimes(1);
    expect(states).toEqual(["waiting"]);
    expect(callback).not.toHaveBeenCalled();
    expect(manager.snapshot()).toEqual({
      held: [{ name: AUTH_LOCK, mode: "exclusive" }],
      pending: [{ name: AUTH_LOCK, mode: "exclusive" }],
    });
    work.resolve();
    await Promise.all([holder, waiter]);
    expect(states).toEqual(["waiting", "acquired", "released"]);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("does not fire the long-wait notice once acquired", async () => {
    const { coordinator } = setup();
    const onLongWait = vi.fn();
    await coordinator.withLock(createLockScope(), AUTH_LOCK, "exclusive", () => undefined, {
      longWaitMs: 5,
      onLongWait,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onLongWait).not.toHaveBeenCalled();
  });

  it("ifAvailable reports not-acquired without queueing or running the callback when the lock is held", async () => {
    const { manager, coordinator } = setup();
    const work = deferred();
    const holder = coordinator.withLock(
      createLockScope(),
      AUTH_LOCK,
      "exclusive",
      () => work.promise,
    );
    await flush();
    const callback = vi.fn();
    expect(
      await coordinator.withLock(createLockScope(), AUTH_LOCK, "exclusive", callback, {
        ifAvailable: true,
      }),
    ).toEqual({ kind: "not-acquired" });
    expect(manager.snapshot().pending).toEqual([]);
    expect(callback).not.toHaveBeenCalled();
    work.resolve();
    await holder;
    expect(
      await coordinator.withLock(createLockScope(), AUTH_LOCK, "exclusive", () => "free", {
        ifAvailable: true,
      }),
    ).toEqual({ kind: "done", value: "free" });
  });

  it("missing Web Locks is unavailable and never runs the callback", async () => {
    const callback = vi.fn();
    for (const provider of [
      () => undefined,
      () => null,
      () => {
        throw new DOMException("denied", "SecurityError");
      },
      () => ({}) as unknown as LockManagerLike,
    ]) {
      const coordinator = createLockCoordinator(provider);
      expect(
        await coordinator.withLock(createLockScope(), AUTH_LOCK, "exclusive", callback),
      ).toEqual({ kind: "unavailable" });
    }
    expect(callback).not.toHaveBeenCalled();
  });

  it("the default provider reads navigator.locks at call time (absent → unavailable)", async () => {
    vi.stubGlobal("navigator", {});
    const callback = vi.fn();
    expect(
      await createLockCoordinator().withLock(createLockScope(), AUTH_LOCK, "exclusive", callback),
    ).toEqual({ kind: "unavailable" });
    expect(callback).not.toHaveBeenCalled();
  });

  it("a request that fails before entry is reported as failed, not done, and runs nothing", async () => {
    const callback = vi.fn();
    const failing: LockManagerLike = {
      request: () => Promise.reject(new DOMException("synthetic", "InvalidStateError")),
    };
    const states: LockState[] = [];
    expect(
      await createLockCoordinator(() => failing).withLock(
        createLockScope(),
        SECURITY_LOCK,
        "exclusive",
        callback,
        { onState: (state) => states.push(state) },
      ),
    ).toEqual({ kind: "failed" });
    expect(callback).not.toHaveBeenCalled();
    expect(states).toEqual(["waiting"]);
  });

  it("a throwing observer does not affect acquisition or the result", async () => {
    const { manager, coordinator } = setup();
    const result = await coordinator.withLock(createLockScope(), AUTH_LOCK, "exclusive", () => 7, {
      onState: () => {
        throw new Error("observer");
      },
    });
    expect(result).toEqual({ kind: "done", value: 7 });
    expect(manager.snapshot()).toEqual({ held: [], pending: [] });
  });
});

describe("module import", () => {
  it("requests no lock when imported", async () => {
    const request = vi.fn();
    vi.stubGlobal("navigator", { locks: { request } });
    vi.resetModules();
    await import("./locks");
    expect(request).not.toHaveBeenCalled();
  });
});
