import { afterEach, describe, expect, it, vi } from "vitest";
import {
  openOfflineDataDatabase,
  openOfflineStateDatabase,
  probeOfflineDataDatabase,
  probeOfflineStateDatabase,
  type OfflineDataSchema,
  type OfflineStateSchema,
  type ProbeResult,
} from "./db";
import { AUTH_LOCK, createLockScope, SECURITY_LOCK } from "./locks";
import { createSafetyLock, SAFETY_LOCK_KEY, SAFETY_LOCK_VALUE } from "./safetyLock";
import {
  assertLiveTicket,
  inspectSecurityState,
  inspectStateEvidence,
  inspectWithoutCreating,
  type NonCreatingInspectionDeps,
  OwnershipError,
  readSecurityState,
  runAuthOperation,
  type AuthTicket,
  type SecurityState,
} from "./securityState";
import {
  createOfflineTestTab,
  createOfflineTestWorld,
  deferred,
  flush,
  injectTransactionFailures,
  type OfflineTestWorld,
} from "./testSupport";

/**
 * M06-T03 Increment 3b-ii — security-state inspection and auth tickets.
 * fake-indexeddb, FakeLockManager, and an in-memory D22 store are stand-ins:
 * nothing here is evidence of real browser storage or cross-tab behavior.
 */

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LIFECYCLE_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LIFECYCLE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const LANDMARK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T0 = "2026-11-25T09:00:00.000Z";

const marker = (lifecycle = LIFECYCLE_1) => ({
  key: "marker",
  schema_version: 1,
  account_id: ACCOUNT_A,
  lifecycle_id: lifecycle,
  verified_at: T0,
});
const intent = { key: "signout_intent", schema_version: 1, pending: true, created_at: T0 };
const failure = { key: "failure", schema_version: 1, kind: "cleanup", recorded_at: T0 };
const landmark = (lifecycle: string) => ({
  schema_version: 1,
  account_id: ACCOUNT_A,
  lifecycle_id: lifecycle,
  revision: 1,
  landmark_id: LANDMARK,
  status: "unavailable",
  saved_at: T0,
  unavailable_recorded_at: T0,
});

async function putData(store: string, value: unknown) {
  const opened = await openOfflineDataDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  await (opened.db as unknown as { put(s: string, v: unknown): Promise<unknown> }).put(
    store,
    value,
  );
  opened.db.close();
}
async function putState(value: unknown) {
  const opened = await openOfflineStateDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  await opened.db.put("state", value);
  opened.db.close();
}

let world: OfflineTestWorld;

async function inspect(overrides = {}): Promise<SecurityState> {
  const tab = createOfflineTestTab(world, overrides);
  const result = await readSecurityState(tab);
  if (result.kind !== "done") throw new Error(result.kind);
  return result.value;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("classification", () => {
  it("empty storage is none, with every piece of evidence absent", async () => {
    world = createOfflineTestWorld();
    expect(await inspect()).toEqual({
      primary: "none",
      evidence: {
        safetyLock: "absent",
        intent: { kind: "absent" },
        failure: { kind: "absent" },
        marker: { kind: "absent" },
        residual: "none",
        metadata: "valid",
        dataEmpty: true,
        savedCopies: "none",
      },
    });
  });

  it("a valid marker whose records all belong to it is the current lifecycle", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    await putData("landmarks", landmark(LIFECYCLE_1));
    await putData("meta", {
      key: "sequence",
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: LIFECYCLE_1,
      value: 3,
    });
    const state = await inspect();
    expect(state.primary).toBe("lifecycle");
    expect(state.evidence.residual).toBe("none");
  });

  it("follows the priority order without erasing lower-priority evidence", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    await putData("landmarks", landmark(LIFECYCLE_2));
    await putState(intent);
    expect((await inspect()).primary).toBe("intent-pending");
    await putState(failure);
    const withFailure = await inspect();
    expect(withFailure.primary).toBe("failure");
    expect(withFailure.evidence.intent).toEqual({ kind: "pending", token: T0 });
    expect(withFailure.evidence.residual).toBe("present");
    expect(withFailure.evidence.marker.kind).toBe("valid");
    world.storage.setItem(SAFETY_LOCK_KEY, "true");
    const withLock = await inspect();
    expect(withLock.primary).toBe("safety-lock");
    expect(withLock.evidence.failure).toEqual({ kind: "present", failure: "cleanup" });
    world.storage.failGet = true;
    expect((await inspect()).primary).toBe("unreadable");
  });

  it("residual records: another lifecycle's records, any record without a marker, or a foreign sequence", async () => {
    world = createOfflineTestWorld();
    await putData("trips", {
      ...landmark(LIFECYCLE_2),
      trip_id: LANDMARK,
    });
    expect((await inspect()).primary).toBe("residual");

    world = createOfflineTestWorld();
    await putData("meta", marker());
    await putData("deletions", {
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: LIFECYCLE_2,
      kind: "trip",
      item_id: LANDMARK,
      seq: 1,
    });
    expect((await inspect()).primary).toBe("residual");

    world = createOfflineTestWorld();
    await putData("meta", marker());
    await putData("meta", {
      key: "sequence",
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: LIFECYCLE_2,
      value: 1,
    });
    expect((await inspect()).primary).toBe("residual");

    world = createOfflineTestWorld();
    await putData("meta", {
      key: "sequence",
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: LIFECYCLE_2,
      value: -1,
    });
    // An invalid sequence with NO marker belongs to no current lifecycle: residual.
    expect((await inspect()).primary).toBe("residual");
  });

  it("3b-iii-b: an unknown meta key is unreadable (never assumed disposable), with or without a marker", async () => {
    for (const withMarker of [false, true]) {
      world = createOfflineTestWorld();
      if (withMarker) await putData("meta", marker());
      await putData("meta", { key: "unexpected" });
      const state = await inspect();
      expect(state.primary).toBe("unreadable");
      expect(state.evidence.metadata).toBe("invalid");
    }
  });

  it("3b-iii-b: an invalid sequence beside a valid marker is unreadable, not residual", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    await putData("meta", {
      key: "sequence",
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: LIFECYCLE_1,
      value: -1,
    });
    const state = await inspect();
    expect(state.primary).toBe("unreadable");
    expect(state.evidence.metadata).toBe("invalid");
    expect(state.evidence.marker.kind).toBe("valid");
  });

  it("3b-iii-b: dataEmpty is true only for a readable, record-free data database", async () => {
    world = createOfflineTestWorld();
    expect((await inspect()).evidence.dataEmpty).toBe(true);
    await putState(intent); // the state database does not count
    expect((await inspect()).evidence.dataEmpty).toBe(true);
    await putData("meta", marker());
    const withMarker = await inspect();
    expect(withMarker.evidence.dataEmpty).toBe(false);
    const unreadable = await inspect({ openData: () => Promise.resolve({ kind: "unavailable" }) });
    expect(unreadable.evidence.dataEmpty).toBe(false);
    expect(unreadable.evidence.metadata).toBe("unreadable");
  });

  it("3b-iii-b: state-only inspection reads D22 and the state database without opening the data database", async () => {
    world = createOfflineTestWorld();
    await putState(intent);
    const openData = vi.fn(() => openOfflineDataDatabase());
    const tab = createOfflineTestTab(world, { openData });
    const result = await tab.coordinator.withLock(
      createLockScope(),
      SECURITY_LOCK,
      "shared",
      ({ scope }) => inspectStateEvidence(scope, tab),
    );
    expect(result).toEqual({
      kind: "done",
      value: {
        safetyLock: "absent",
        intent: { kind: "pending", token: T0 },
        failure: { kind: "absent" },
      },
    });
    expect(openData).not.toHaveBeenCalled();
  });
});

describe("3b-iii-c2: savedCopies evidence (counted, never validated)", () => {
  const trip = (lifecycle: string) => ({ ...landmark(lifecycle), trip_id: LANDMARK });

  it("is none for empty storage and for metadata-only storage", async () => {
    world = createOfflineTestWorld();
    expect((await inspect()).evidence.savedCopies).toBe("none");
    await putData("invalidations", {
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: LIFECYCLE_2,
      landmark_id: LANDMARK,
      seq: 1,
      recorded_at: T0,
    });
    await putData("deletions", {
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: LIFECYCLE_2,
      kind: "trip",
      item_id: LANDMARK,
      seq: 2,
    });
    await putData("meta", marker());
    const state = await inspect();
    expect(state.evidence.savedCopies).toBe("none");
    expect(state.evidence.dataEmpty).toBe(false);
  });

  const savedCases: [string, string, () => object][] = [
    ["an unavailable landmark marker", "landmarks", () => landmark(LIFECYCLE_1)],
    ["a residual landmark of a terminated lifecycle", "landmarks", () => landmark(LIFECYCLE_2)],
    [
      "a malformed landmark record",
      "landmarks",
      () => ({ ...landmark(LIFECYCLE_2), saved_at: "x" }),
    ],
    ["a trip record", "trips", () => trip(LIFECYCLE_1)],
    ["a malformed trip record", "trips", () => ({ ...trip(LIFECYCLE_2), status: "odd" })],
  ];
  for (const [label, store, make] of savedCases) {
    it(`is present for ${label}, without requiring validation`, async () => {
      world = createOfflineTestWorld();
      await putData(store, make());
      expect((await inspect()).evidence.savedCopies).toBe("present");
    });
  }

  it("is unknown — never none — when the data stores cannot be counted", async () => {
    world = createOfflineTestWorld();
    expect(
      (await inspect({ openData: () => Promise.resolve({ kind: "unavailable" }) })).evidence
        .savedCopies,
    ).toBe("unknown");
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      () => true,
    );
    expect((await inspect({ openData: failing.opener })).evidence.savedCopies).toBe("unknown");
  });
});

describe("malformed records and storage errors are never absent", () => {
  it("a malformed intent, failure record, or marker is unreadable", async () => {
    for (const [put, value, field] of [
      [putState, { ...intent, extra: 1 }, "intent"],
      [putState, { ...failure, kind: "other" }, "failure"],
      [putData.bind(null, "meta"), { ...marker(), verified_at: "yesterday" }, "marker"],
    ] as const) {
      world = createOfflineTestWorld();
      await put(value);
      const state = await inspect();
      expect(state.primary).toBe("unreadable");
      expect((state.evidence[field] as { kind: string }).kind).toBe("invalid");
    }
  });

  it("an unavailable database or a failing transaction is unreadable, not empty", async () => {
    world = createOfflineTestWorld();
    const unavailable = await inspect({
      openState: () => Promise.resolve({ kind: "unavailable" }),
    });
    expect(unavailable.primary).toBe("unreadable");
    expect(unavailable.evidence.intent).toEqual({ kind: "unreadable" });
    const thrown = await inspect({
      openData: () => Promise.reject(new DOMException("synthetic", "UnknownError")),
    });
    expect(thrown.evidence.marker).toEqual({ kind: "unreadable" });
    expect(thrown.evidence.residual).toBe("unreadable");
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      () => true,
    );
    expect((await inspect({ openData: failing.opener })).primary).toBe("unreadable");
  });

  it("inspection writes nothing", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    await putState(intent);
    const data = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      () => false,
    );
    const state = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      () => false,
    );
    await inspect({ openData: data.opener, openState: state.opener });
    expect([...data.log, ...state.log].every((call) => call.mode === "readonly")).toBe(true);
    expect(world.storage.length).toBe(0);
  });
});

describe("lock boundaries and ticket ownership", () => {
  it("inspection outside a security-lock callback is refused", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    await expect(inspectSecurityState(createLockScope(), tab)).rejects.toMatchObject({
      name: "OwnershipError",
      reason: "requires-security-lock",
    });
  });

  it("reads under a shared security lock, nested under tnle-auth when a ticket is given", async () => {
    world = createOfflineTestWorld();
    const gate = deferred();
    const tab = createOfflineTestTab(world, {
      openData: async () => {
        await gate.promise;
        return openOfflineDataDatabase();
      },
    });
    const done = runAuthOperation(tab, (ticket) => readSecurityState(tab, ticket));
    await flush();
    await flush();
    expect(world.locks.snapshot().held).toEqual([
      { name: AUTH_LOCK, mode: "exclusive" },
      { name: SECURITY_LOCK, mode: "shared" },
    ]);
    gate.resolve();
    const result = await done;
    expect(result.kind).toBe("done");
    expect(world.locks.snapshot()).toEqual({ held: [], pending: [] });
  });

  it("a ticket is live only inside its tnle-auth hold; a forged ticket is never accepted", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    let captured: AuthTicket | undefined;
    await runAuthOperation(tab, (ticket) => {
      captured = ticket;
      expect(() => assertLiveTicket(ticket)).not.toThrow();
      expect([...ticket.scope.held]).toEqual([AUTH_LOCK]);
    });
    expect(() => assertLiveTicket(captured!)).toThrow(OwnershipError);
    const forged = {
      scope: { held: new Set([AUTH_LOCK]) },
      snapshot: tab.generation.snapshot(),
    } as AuthTicket;
    expect(() => assertLiveTicket(forged)).toThrow(OwnershipError);
    await expect(readSecurityState(tab, forged)).rejects.toMatchObject({ reason: "requires-auth" });
  });

  it("authentication operations are exclusive", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    const work = deferred();
    const order: string[] = [];
    const first = runAuthOperation(tab, async () => {
      order.push("first");
      await work.promise;
      order.push("first-end");
    });
    const second = runAuthOperation(createOfflineTestTab(world), () => order.push("second"));
    await flush();
    expect(order).toEqual(["first"]);
    work.resolve();
    await Promise.all([first, second]);
    expect(order).toEqual(["first", "first-end", "second"]);
  });
});

describe("module import", () => {
  it("the 3b-ii modules create no database, lock, channel, or storage entry when imported", async () => {
    world = createOfflineTestWorld();
    const open = vi.spyOn(world.factory, "open");
    const request = vi.fn();
    const channel = vi.fn();
    vi.stubGlobal("navigator", { locks: { request } });
    vi.stubGlobal("BroadcastChannel", channel);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    vi.resetModules();
    await import("./securityState");
    await import("./lifecycle");
    await import("./signOutIntent");
    expect(open).not.toHaveBeenCalled();
    expect(await world.factory.databases()).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    expect(channel).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// 3b-iii-d (DR-1) — non-creating, lock-free inspection
// ---------------------------------------------------------------------------

describe("3b-iii-d non-creating inspection (DR-1)", () => {
  const PLANTED = "planted-synthetic-value-5f1d";

  function inspectionDeps(overrides: Partial<NonCreatingInspectionDeps> = {}) {
    return {
      safetyLock: createSafetyLock(() => world.storage),
      probeData: probeOfflineDataDatabase,
      probeState: probeOfflineStateDatabase,
      ...overrides,
    };
  }

  /** Every raw record and version in both databases, plus D22 (only for databases that exist). */
  async function snapshot() {
    const listed = await world.factory.databases();
    const contents: Record<string, unknown> = {
      listed,
      d22: world.storage.map.get(SAFETY_LOCK_KEY),
    };
    for (const { name } of listed) {
      contents[name!] = await new Promise((resolve, reject) => {
        const request = world.factory.open(name!);
        request.onsuccess = () => {
          const db = request.result;
          const names = [...db.objectStoreNames];
          const tx = db.transaction(names, "readonly");
          const out: Record<string, unknown> = { version: db.version };
          for (const store of names) {
            const all = tx.objectStore(store).getAll();
            all.onsuccess = () => (out[store] = all.result);
          }
          tx.oncomplete = () => {
            db.close();
            resolve(out);
          };
        };
        request.onerror = () => reject(request.error);
      });
    }
    return contents;
  }

  function deleteOutcome(name: string) {
    return new Promise<string>((resolve) => {
      const request = world.factory.deleteDatabase(name);
      request.onsuccess = () => resolve("deleted");
      request.onblocked = () => resolve("blocked");
      request.onerror = () => resolve("error");
    });
  }

  it("absent storage: no conflicting state, and inspecting creates nothing and writes no D22", async () => {
    world = createOfflineTestWorld();
    expect(await inspectWithoutCreating(inspectionDeps())).toEqual({
      kind: "no-conflicting-state",
      conflicts: [],
      notEstablished: [],
    });
    expect(await world.factory.databases()).toEqual([]);
    expect(world.storage.map.size).toBe(0);
    expect(await inspectWithoutCreating(inspectionDeps())).toMatchObject({
      kind: "no-conflicting-state",
    });
    expect(await world.factory.databases()).toEqual([]);
  });

  it("existing, empty databases: no conflicting state; versions and contents unchanged; connections closed", async () => {
    world = createOfflineTestWorld();
    const data = await openOfflineDataDatabase();
    if (data.kind !== "open") throw new Error(data.kind);
    data.db.close();
    await putState({ key: "failure", schema_version: 1, kind: "cleanup", recorded_at: T0 });
    const state = await openOfflineStateDatabase();
    if (state.kind !== "open") throw new Error(state.kind);
    await state.db.delete("state", "failure");
    state.db.close();
    const before = await snapshot();
    expect(await inspectWithoutCreating(inspectionDeps())).toMatchObject({
      kind: "no-conflicting-state",
    });
    expect(await snapshot()).toEqual(before);
    expect(await deleteOutcome("tnle-offline-data")).toBe("deleted");
    expect(await deleteOutcome("tnle-offline-state")).toBe("deleted");
  });

  const malformed = { key: "signout_intent", schema_version: 1, pending: "yes", note: PLANTED };
  const cases: [string, () => Promise<void>, string[]][] = [
    [
      "D22 present",
      async () => world.storage.setItem(SAFETY_LOCK_KEY, SAFETY_LOCK_VALUE),
      ["safety-lock"],
    ],
    ["a valid sign-out intent", () => putState(intent), ["sign-out-intent"]],
    ["a malformed sign-out intent", () => putState(malformed), ["sign-out-intent"]],
    ["a valid failure record", () => putState(failure), ["failure-record"]],
    [
      "a malformed failure record",
      () => putState({ key: "failure", schema_version: 1, kind: PLANTED, recorded_at: T0 }),
      ["failure-record"],
    ],
    [
      "an unrecognized state key",
      () => putState({ key: PLANTED, value: 1 }),
      ["unrecognized-state"],
    ],
    ["a valid account marker", () => putData("meta", marker()), ["account-marker"]],
    [
      "a malformed account marker",
      () => putData("meta", { ...marker(), account_id: PLANTED }),
      ["account-marker"],
    ],
    [
      "a saved copy of a terminated lifecycle without any marker",
      () => putData("landmarks", landmark(LIFECYCLE_2)),
      ["saved-or-residual-records"],
    ],
    [
      "an invalidation record without any marker",
      () =>
        putData("invalidations", {
          account_id: ACCOUNT_A,
          lifecycle_id: LIFECYCLE_2,
          landmark_id: LANDMARK,
          junk: PLANTED,
        }),
      ["saved-or-residual-records"],
    ],
    [
      "a malformed sequence without any marker",
      () => putData("meta", { key: "sequence", value: PLANTED }),
      ["saved-or-residual-records"],
    ],
    [
      "unknown lifecycle metadata",
      () => putData("meta", { key: PLANTED, value: 1 }),
      ["lifecycle-metadata", "saved-or-residual-records"],
    ],
    [
      "a marker beside another lifecycle's saved copy",
      async () => {
        await putData("meta", marker(LIFECYCLE_1));
        await putData("landmarks", landmark(LIFECYCLE_2));
      },
      ["account-marker", "saved-or-residual-records"],
    ],
  ];

  it.each(cases)(
    "%s is conflicting state, reported by classification only and left unchanged",
    async (_label, seed, expected) => {
      world = createOfflineTestWorld();
      await seed();
      const before = await snapshot();
      const result = await inspectWithoutCreating(inspectionDeps());
      expect(result).toEqual({
        kind: "conflicting-state",
        conflicts: expected,
        notEstablished: [],
      });
      expect(await snapshot()).toEqual(before);
      const text = JSON.stringify(result);
      for (const secret of [PLANTED, ACCOUNT_A, LIFECYCLE_1, LIFECYCLE_2, T0]) {
        expect(text.includes(secret)).toBe(false);
      }
    },
  );

  it("D22 unreadable is not established (never absent)", async () => {
    world = createOfflineTestWorld();
    world.storage.failGet = true;
    expect(await inspectWithoutCreating(inspectionDeps())).toEqual({
      kind: "not-established",
      conflicts: [],
      notEstablished: ["safety-lock-unreadable"],
    });
  });

  it("every probe outcome other than absent or open is not established, for each database; a throwing probe is failed", async () => {
    world = createOfflineTestWorld();
    const outcomes = [
      { kind: "unavailable" },
      { kind: "failed" },
      { kind: "unsupported-version", version: 2 },
      { kind: "unexpected-schema" },
      { kind: "indeterminate" },
    ] as const;
    for (const outcome of outcomes) {
      const probe = async () => outcome;
      expect(
        await inspectWithoutCreating(
          inspectionDeps({
            probeData: probe as () => Promise<ProbeResult<OfflineDataSchema>>,
            probeState: probe as () => Promise<ProbeResult<OfflineStateSchema>>,
          }),
        ),
      ).toEqual({
        kind: "not-established",
        conflicts: [],
        notEstablished: [`state-${outcome.kind}`, `data-${outcome.kind}`],
      });
    }
    const throwing = async (): Promise<ProbeResult<OfflineDataSchema>> => {
      throw new DOMException("synthetic", "UnknownError");
    };
    expect(await inspectWithoutCreating(inspectionDeps({ probeData: throwing }))).toMatchObject({
      kind: "not-established",
      notEstablished: ["data-failed"],
    });
  });

  it("existing databases that cannot be read are not established, and their connections are still closed", async () => {
    world = createOfflineTestWorld();
    await putState(intent);
    await putData("meta", marker());
    const failing = <S extends OfflineDataSchema | OfflineStateSchema>(
      probe: () => Promise<ProbeResult<S>>,
    ) =>
      injectTransactionFailures(
        async () => {
          const result = await probe();
          if (result.kind !== "open") throw new Error(result.kind);
          return result;
        },
        () => true,
      ).opener as unknown as () => Promise<ProbeResult<S>>;
    expect(
      await inspectWithoutCreating(
        inspectionDeps({
          probeData: failing(probeOfflineDataDatabase),
          probeState: failing(probeOfflineStateDatabase),
        }),
      ),
    ).toEqual({
      kind: "not-established",
      conflicts: [],
      notEstablished: ["state-unreadable", "data-unreadable"],
    });
    expect(await deleteOutcome("tnle-offline-data")).toBe("deleted");
    expect(await deleteOutcome("tnle-offline-state")).toBe("deleted");
  });

  it("conflicts and unestablished evidence are both reported; conflicting state takes precedence; everything is left in place", async () => {
    world = createOfflineTestWorld();
    world.storage.setItem(SAFETY_LOCK_KEY, SAFETY_LOCK_VALUE);
    await putState(intent);
    await putState(failure);
    await putData("meta", marker());
    await putData("landmarks", landmark(LIFECYCLE_1));
    const before = await snapshot();
    const result = await inspectWithoutCreating(
      inspectionDeps({ probeData: async () => ({ kind: "indeterminate" }) }),
    );
    expect(result).toEqual({
      kind: "conflicting-state",
      conflicts: ["safety-lock", "sign-out-intent", "failure-record"],
      notEstablished: ["data-indeterminate"],
    });
    expect(await snapshot()).toEqual(before);
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe(SAFETY_LOCK_VALUE);
  });

  it("takes no lock and posts nothing (it is lock-free and authorizes nothing)", async () => {
    world = createOfflineTestWorld();
    const request = vi.spyOn(world.locks, "request");
    await putData("meta", marker());
    await inspectWithoutCreating(inspectionDeps());
    expect(request).not.toHaveBeenCalled();
  });
});
