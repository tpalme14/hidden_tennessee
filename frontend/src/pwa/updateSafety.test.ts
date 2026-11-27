import { describe, expect, it, vi } from "vitest";
import { createUpdateSafety, isMutationMethod } from "./updateSafety";

/**
 * M06-T02 Increment 4b-i — the update-safety module: mutation-request
 * accounting, operation holds, and the synchronous, attempt-owned transition
 * gate, with mutual exclusion in both directions.
 */

describe("isMutationMethod", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE", "post", "Patch", "OPTIONS"])("%s is a mutation", (m) =>
    expect(isMutationMethod(m)).toBe(true),
  );
  it.each([undefined, "GET", "get", "HEAD", "head"])("%s is not", (m) =>
    expect(isMutationMethod(m)).toBe(false),
  );
});

describe("updateSafety", () => {
  it("starts idle with a stable snapshot object", () => {
    const s = createUpdateSafety();
    expect(s.getSnapshot()).toEqual({
      pendingRequests: 0,
      operationHolds: 0,
      gateHeld: false,
      protectedCategories: [],
      protectedRevision: 0,
    });
    expect(s.getSnapshot()).toBe(s.getSnapshot());
  });

  it("counts concurrent requests independently; each release is idempotent and releases only its own", () => {
    const s = createUpdateSafety();
    const a = s.beginMutationRequest()!;
    const b = s.beginMutationRequest()!;
    expect(s.getSnapshot().pendingRequests).toBe(2);
    a();
    a();
    a();
    expect(s.getSnapshot().pendingRequests).toBe(1);
    b();
    expect(s.getSnapshot().pendingRequests).toBe(0);
  });

  it("counts concurrent holds independently; each release is idempotent and releases only its own", () => {
    const s = createUpdateSafety();
    const a = s.acquireHold()!;
    const b = s.acquireHold()!;
    expect(s.getSnapshot().operationHolds).toBe(2);
    a.release();
    a.release();
    expect(s.getSnapshot().operationHolds).toBe(1);
    b.release();
    expect(s.getSnapshot().operationHolds).toBe(0);
  });

  it("refuses the gate while a request is active, then acquires it synchronously once idle", () => {
    const s = createUpdateSafety();
    const release = s.beginMutationRequest()!;
    expect(s.tryAcquireGate()).toEqual({ kind: "busy" });
    expect(s.getSnapshot().gateHeld).toBe(false);
    release();
    const result = s.tryAcquireGate();
    expect(result.kind).toBe("acquired");
    // Acquired within the same call: no await, no later tick.
    expect(s.getSnapshot().gateHeld).toBe(true);
  });

  it("refuses the gate while an operation hold is active", () => {
    const s = createUpdateSafety();
    const hold = s.acquireHold()!;
    expect(s.tryAcquireGate()).toEqual({ kind: "busy" });
    hold.release();
    expect(s.tryAcquireGate().kind).toBe("acquired");
  });

  it("refuses a second acquisition while a transition owns the gate", () => {
    const s = createUpdateSafety();
    expect(s.tryAcquireGate().kind).toBe("acquired");
    expect(s.tryAcquireGate()).toEqual({ kind: "in-transition" });
  });

  it("while the gate is held, new requests and holds are refused and nothing is counted", () => {
    const s = createUpdateSafety();
    s.tryAcquireGate();
    expect(s.beginMutationRequest()).toBeNull();
    expect(s.acquireHold()).toBeNull();
    expect(s.getSnapshot()).toEqual({
      pendingRequests: 0,
      operationHolds: 0,
      gateHeld: true,
      protectedCategories: [],
      protectedRevision: 0,
    });
  });

  it("releasing the gate allows requests and holds again", () => {
    const s = createUpdateSafety();
    const result = s.tryAcquireGate();
    if (result.kind !== "acquired") throw new Error("expected the gate");
    result.gate.release();
    expect(s.getSnapshot().gateHeld).toBe(false);
    expect(s.beginMutationRequest()).not.toBeNull();
    expect(s.acquireHold()).not.toBeNull();
  });

  it("a stale or repeated gate release cannot release a newer gate", () => {
    const s = createUpdateSafety();
    const first = s.tryAcquireGate();
    if (first.kind !== "acquired") throw new Error("expected the gate");
    first.gate.release();
    const second = s.tryAcquireGate();
    if (second.kind !== "acquired") throw new Error("expected the gate");
    first.gate.release(); // stale
    first.gate.release(); // repeated
    expect(s.getSnapshot().gateHeld).toBe(true);
    expect(s.beginMutationRequest()).toBeNull();
    second.gate.release();
    expect(s.getSnapshot().gateHeld).toBe(false);
  });

  it("finishing pending work never acquires the gate or does anything by itself", () => {
    const s = createUpdateSafety();
    const release = s.beginMutationRequest()!;
    const hold = s.acquireHold()!;
    expect(s.tryAcquireGate()).toEqual({ kind: "busy" });
    release();
    hold.release();
    expect(s.getSnapshot().gateHeld).toBe(false);
  });

  it("notifies subscribers once per actual change, and stops after unsubscribing", () => {
    const s = createUpdateSafety();
    const listener = vi.fn();
    const unsubscribe = s.subscribe(listener);
    const release = s.beginMutationRequest()!;
    release();
    release(); // no change
    expect(listener).toHaveBeenCalledTimes(2);
    expect(s.tryAcquireGate()).toMatchObject({ kind: "acquired" });
    expect(s.tryAcquireGate()).toEqual({ kind: "in-transition" }); // no change
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    s.beginMutationRequest();
    expect(listener).toHaveBeenCalledTimes(3);
  });
});

describe("updateSafety — protected-information registry (4b-ii)", () => {
  it("an empty registry: no categories, revision 0", () => {
    const s = createUpdateSafety();
    expect(s.getSnapshot()).toMatchObject({ protectedCategories: [], protectedRevision: 0 });
  });

  it("independent registrations, including several of the same category, each owned by its handle", () => {
    const s = createUpdateSafety();
    const a = s.protect("trip-name");
    const b = s.protect("trip-name");
    const c = s.protect("sign-in");
    expect(s.getSnapshot().protectedCategories).toEqual(["trip-name", "trip-name", "sign-in"]);
    a.release();
    expect(s.getSnapshot().protectedCategories).toEqual(["trip-name", "sign-in"]);
    b.release();
    c.release();
    expect(s.getSnapshot().protectedCategories).toEqual([]);
  });

  it("the revision changes on activation, on each edit (touch), and on deactivation — and nowhere else", () => {
    const s = createUpdateSafety();
    const revisions: number[] = [];
    const record = () => revisions.push(s.getSnapshot().protectedRevision);
    record();
    const p = s.protect("review-draft");
    record();
    p.touch();
    record();
    p.touch();
    record();
    s.beginMutationRequest()?.(); // unrelated activity
    record();
    p.release();
    record();
    expect(revisions).toEqual([0, 1, 2, 3, 3, 4]);
  });

  it("release is idempotent; a stale handle cannot remove or touch a newer registration", () => {
    const s = createUpdateSafety();
    const older = s.protect("share-link");
    older.release();
    const newer = s.protect("share-link");
    const revision = s.getSnapshot().protectedRevision;
    older.release();
    older.release();
    older.touch();
    expect(s.getSnapshot().protectedCategories).toEqual(["share-link"]);
    expect(s.getSnapshot().protectedRevision).toBe(revision);
    newer.release();
    expect(s.getSnapshot().protectedCategories).toEqual([]);
  });

  it("the snapshot is stable when nothing changes and replaced when the registry changes", () => {
    const s = createUpdateSafety();
    const before = s.getSnapshot();
    expect(s.getSnapshot()).toBe(before);
    const p = s.protect("registration");
    const during = s.getSnapshot();
    expect(during).not.toBe(before);
    expect(s.getSnapshot()).toBe(during);
    expect(s.getSnapshot().protectedCategories).toBe(during.protectedCategories);
    p.release();
  });

  it("subscribers are notified once per registry change; unsubscribing stops it", () => {
    const s = createUpdateSafety();
    const listener = vi.fn();
    const unsubscribe = s.subscribe(listener);
    const p = s.protect("new-password");
    p.touch();
    p.release();
    p.release(); // no change
    expect(listener).toHaveBeenCalledTimes(3);
    unsubscribe();
    s.protect("sign-in");
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("registrations never block the gate (4b-iii asks for confirmation instead)", () => {
    const s = createUpdateSafety();
    s.protect("review-draft");
    expect(s.tryAcquireGate().kind).toBe("acquired");
  });

  it("the snapshot holds categories and a number only — no values", () => {
    const s = createUpdateSafety();
    s.protect("share-link");
    s.protect("reset-link");
    const snapshot = s.getSnapshot();
    expect(Object.keys(snapshot).sort()).toEqual([
      "gateHeld",
      "operationHolds",
      "pendingRequests",
      "protectedCategories",
      "protectedRevision",
    ]);
    for (const category of snapshot.protectedCategories) {
      expect(typeof category).toBe("string");
      expect(category).toMatch(/^[a-z-]+$/);
    }
  });
});
