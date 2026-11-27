import { afterEach, describe, expect, it, vi } from "vitest";
import { openOfflineDataDatabase, openOfflineStateDatabase, type OpenResult } from "./db";
import type { OfflineDataSchema } from "./db";
import { confirmIdentity, releaseLocalBlock } from "./lifecycle";
import { AUTH_LOCK, createLockCoordinator, SECURITY_LOCK, type LockManagerLike } from "./locks";
import {
  beginRecoveryRequest,
  completeRecovery,
  observeForRecovery,
  recoverLocalFailure,
  type RecoveryObservation,
  type RecoveryOutcome,
  type RecoveryRequest,
} from "./recovery";
import { SAFETY_LOCK_KEY } from "./safetyLock";
import { OwnershipError, runAuthOperation, type AuthTicket } from "./securityState";
import { beginSignOut } from "./signOutIntent";
import {
  createOfflineTestTab,
  createOfflineTestWorld,
  flush,
  ignoreClears,
  injectTransactionFailures,
  staleGet,
  type OfflineTestWorld,
} from "./testSupport";

/**
 * M06-T03 Increment 3b-iii-c2 — local failure-record recovery (AC-40, isolated
 * clauses). fake-indexeddb, FakeLockManager, an in-memory D22 store, and an
 * in-memory channel hub are stand-ins; `authorizeDiscard` is an isolated input,
 * not evidence of user consent. Tests marked NON-COOPERATING model a writer
 * that bypasses the security lock: defense-in-depth evidence only, not a
 * reachable protocol race. Every asynchronous operation is settled.
 */

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const LIFECYCLE_1 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LIFECYCLE_2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";
const ITEM = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T0 = "2026-11-25T09:00:00.000Z";

const failure = { key: "failure", schema_version: 1, kind: "cleanup", recorded_at: T0 };
const intent = { key: "signout_intent", schema_version: 1, pending: true, created_at: T0 };
const marker = (account = ACCOUNT_A, lifecycle = LIFECYCLE_1) => ({
  key: "marker",
  schema_version: 1,
  account_id: account,
  lifecycle_id: lifecycle,
  verified_at: T0,
});
const landmark = (lifecycle = LIFECYCLE_2) => ({
  schema_version: 1,
  account_id: ACCOUNT_A,
  lifecycle_id: lifecycle,
  revision: 1,
  landmark_id: ITEM,
  status: "unavailable",
  saved_at: T0,
  unavailable_recorded_at: T0,
});

type Db = {
  put(store: string, value: unknown): Promise<unknown>;
  get(store: string, key: unknown): Promise<unknown>;
  count(store: string): Promise<number>;
};
async function withData<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const opened = await openOfflineDataDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  try {
    return await fn(opened.db as unknown as Db);
  } finally {
    opened.db.close();
  }
}
const putData = (store: string, value: unknown) => withData((db) => db.put(store, value));
const dataCount = () =>
  withData(async (db) => {
    let total = 0;
    for (const s of ["meta", "landmarks", "trips", "invalidations", "deletions"]) {
      total += await db.count(s);
    }
    return total;
  });
async function withState<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const opened = await openOfflineStateDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  try {
    return await fn(opened.db as unknown as Db);
  } finally {
    opened.db.close();
  }
}
const putState = (value: unknown) => withState((db) => db.put("state", value));
const getState = (key: string) => withState((db) => db.get("state", key));

/** An opener that runs `before` on its Nth call (then opens normally). */
function onNthOpen<T>(open: () => Promise<T>, n: number, before: () => Promise<void> | void) {
  let calls = 0;
  return async () => {
    calls += 1;
    if (calls === n) await before();
    return open();
  };
}

let world: OfflineTestWorld;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("successful local recovery", () => {
  it("valid failure record, empty data: removed and verified; tab stays blocked; no auth lock; no network", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const names: string[] = [];
    const recording: LockManagerLike = {
      request: (name, options, callback) => {
        names.push(name);
        return world.locks.request(name, options, callback);
      },
    };
    const other = createOfflineTestTab(world);
    const tab = createOfflineTestTab(world, {
      coordinator: createLockCoordinator(() => recording),
    });
    const pending = recoverLocalFailure(tab);
    expect(tab.generation.isBlocked()).toBe(true); // synchronous
    const result = await pending;
    expect(result).toEqual({
      kind: "recovered",
      blockToken: 1,
      recordState: "removed-verified",
      cleanup: "not-needed",
      final: "none",
      cleanAtFinalInspection: true,
    });
    expect(await getState("failure")).toBeUndefined();
    expect(tab.generation.isBlocked()).toBe(true); // never released by recovery
    expect(names.every((n) => n === SECURITY_LOCK)).toBe(true);
    expect(names).not.toContain(AUTH_LOCK);
    expect(fetchSpy).not.toHaveBeenCalled();
    await flush();
    expect(other.received).toEqual(["lifecycle-ended", "failure-changed"]);
    expect(await withData((db) => db.get("meta", "marker"))).toBeUndefined(); // no lifecycle created
  });

  it("a malformed failure record is recovered under the same contract, without disclosing it", async () => {
    world = createOfflineTestWorld();
    await putState({ key: "failure", schema_version: 1, kind: "other", detail: "synthetic" });
    const result = await recoverLocalFailure(createOfflineTestTab(world));
    expect(result).toMatchObject({ kind: "recovered", recordState: "removed-verified" });
    expect(JSON.stringify(result).includes("synthetic")).toBe(false);
    expect(await getState("failure")).toBeUndefined();
  });

  it("known disposable metadata only: cleaned without authorization (metadata-only)", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    await putData("invalidations", {
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: LIFECYCLE_2,
      landmark_id: ITEM,
      seq: 1,
      recorded_at: T0,
    });
    await putData("meta", {
      key: "sequence",
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: LIFECYCLE_2,
      value: 3,
    });
    expect(await recoverLocalFailure(createOfflineTestTab(world))).toMatchObject({
      kind: "recovered",
      cleanup: "metadata-only",
    });
    expect(await dataCount()).toBe(0);
  });

  it("joined obligations: the recorded kind is ignored; empty data resolves them", async () => {
    world = createOfflineTestWorld();
    await putState({ ...failure, kind: "invalidation" });
    await putData("landmarks", landmark());
    expect(
      await recoverLocalFailure(createOfflineTestTab(world), { authorizeDiscard: true }),
    ).toMatchObject({ kind: "recovered", cleanup: "saved-copies-discarded", final: "none" });
  });

  it("Q29 recovery: the surviving account-A marker requires authorization; afterwards B gets a new lifecycle only after release and confirmation", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker(ACCOUNT_A));
    await putState(failure);
    const tab = createOfflineTestTab(world);
    expect(await recoverLocalFailure(tab)).toMatchObject({
      kind: "refused",
      reason: "authorization-required",
      recordState: "retained",
    });
    expect(await withData((db) => db.get("meta", "marker"))).toEqual(marker(ACCOUNT_A));
    const result = await recoverLocalFailure(tab, { authorizeDiscard: true });
    expect(result).toMatchObject({ kind: "recovered", final: "none" });
    // No automatic unblocking or lifecycle creation: both remain separate steps.
    const blocked = await runAuthOperation(tab, (t) => confirmIdentity(t, ACCOUNT_B, tab));
    expect(blocked).toEqual({ kind: "done", value: { kind: "refused", reason: "stale" } });
    expect(await releaseLocalBlock(result.blockToken, tab)).toEqual({ kind: "released" });
    const created = await runAuthOperation(tab, (t) => confirmIdentity(t, ACCOUNT_B, tab));
    expect(created).toMatchObject({ kind: "done", value: { kind: "created" } });
  });
});

describe("discard authorization", () => {
  const needsAuthorization: [string, () => Promise<unknown>][] = [
    ["a valid current lifecycle", () => putData("meta", marker())],
    ["a malformed lifecycle marker", () => putData("meta", { ...marker(), verified_at: "x" })],
    ["a residual saved landmark of a terminated lifecycle", () => putData("landmarks", landmark())],
    [
      "an unavailable snapshot marker of the current owner",
      () => putData("landmarks", landmark(LIFECYCLE_1)),
    ],
    [
      "a malformed saved trip",
      () => putData("trips", { ...landmark(), trip_id: ITEM, status: "odd" }),
    ],
    ["unknown metadata", () => putData("meta", { key: "unrecognized" })],
  ];
  for (const [label, arrange] of needsAuthorization) {
    it(`${label}: refused without authorization, nothing removed; removed with it`, async () => {
      world = createOfflineTestWorld();
      await putState(failure);
      await arrange();
      const before = await dataCount();
      expect(await recoverLocalFailure(createOfflineTestTab(world))).toMatchObject({
        kind: "refused",
        reason: "authorization-required",
        recordState: "retained",
      });
      expect(await dataCount()).toBe(before);
      expect(await getState("failure")).toEqual(failure);
      expect(
        await recoverLocalFailure(createOfflineTestTab(world), { authorizeDiscard: true }),
      ).toMatchObject({ kind: "recovered", recordState: "removed-verified" });
      expect(await dataCount()).toBe(0);
    });
  }

  it("authorization never overrides unreadable data storage", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    const tab = createOfflineTestTab(world, {
      openData: () => Promise.resolve({ kind: "unavailable" }),
    });
    expect(await recoverLocalFailure(tab, { authorizeDiscard: true })).toMatchObject({
      kind: "refused",
      reason: "data-unreadable",
      recordState: "retained",
    });
    expect(await getState("failure")).toEqual(failure);
  });
});

describe("refusals without durable modification", () => {
  const cases: [string, () => Promise<unknown> | void, string, string][] = [
    ["no failure record", () => undefined, "no-failure-record", "absent"],
    ["a pending intent", () => putState(intent), "intent-pending", "retained"],
    [
      "a malformed intent",
      () => putState({ ...intent, created_at: "x" }),
      "intent-malformed",
      "retained",
    ],
    [
      "D22 present",
      () => {
        world.storage.setItem(SAFETY_LOCK_KEY, "true");
      },
      "safety-lock-present",
      "retained",
    ],
    [
      "D22 unreadable",
      () => {
        world.storage.failGet = true;
      },
      "safety-lock-unreadable",
      "retained",
    ],
  ];
  for (const [label, arrange, reason, recordState] of cases) {
    it(`${label}: refused even with authorization; saved data, record, intent, and D22 untouched`, async () => {
      world = createOfflineTestWorld();
      if (reason !== "no-failure-record") await putState(failure);
      await putData("landmarks", landmark());
      await arrange();
      const tab = createOfflineTestTab(world);
      expect(await recoverLocalFailure(tab, { authorizeDiscard: true })).toEqual({
        kind: "refused",
        blockToken: 1,
        reason,
        recordState,
      });
      world.storage.failGet = false;
      expect(await dataCount()).toBe(1);
      expect(tab.generation.isBlocked()).toBe(true);
    });
  }

  it("an unreadable state database: refused with the record state unknown", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world, {
      openState: () => Promise.resolve({ kind: "unavailable" }),
    });
    expect(await recoverLocalFailure(tab, { authorizeDiscard: true })).toMatchObject({
      kind: "refused",
      reason: "state-unreadable",
      recordState: "unknown",
    });
  });

  it("an unusable security lock: unavailable, nothing inspected, the tab stays blocked", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    const tab = createOfflineTestTab(world, {
      coordinator: createLockCoordinator(() => undefined),
    });
    expect(await recoverLocalFailure(tab)).toEqual({
      kind: "unavailable",
      blockToken: 1,
      recordState: "unknown",
    });
    expect(tab.generation.isBlocked()).toBe(true);
    expect(await getState("failure")).toEqual(failure);
  });

  it("concurrent recoveries: one recovers, the other finds no record", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    const results = await Promise.all([
      recoverLocalFailure(createOfflineTestTab(world)),
      recoverLocalFailure(createOfflineTestTab(world)),
    ]);
    expect(results.map((r) => r.kind).sort()).toEqual(["recovered", "refused"]);
    expect(results.find((r) => r.kind === "refused")).toMatchObject({
      reason: "no-failure-record",
      recordState: "absent",
    });
  });
});

describe("emergency D22 interleavings (no IndexedDB/localStorage atomicity is assumed)", () => {
  it("D22 set after cleanup, before the removal gate: data emptied, failure record retained", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    await putData("landmarks", landmark());
    // Data opens: 1 initial, 2–4 full cleanup, 5 independent verification (D22 set here), 6 final.
    const tab = createOfflineTestTab(world, {
      openData: onNthOpen(openOfflineDataDatabase, 5, () => {
        world.storage.setItem(SAFETY_LOCK_KEY, "true");
      }),
    });
    expect(await recoverLocalFailure(tab, { authorizeDiscard: true })).toEqual({
      kind: "local-resolved-record-retained",
      blockToken: 1,
      recordState: "retained",
      reason: "safety-lock-present",
      cleanup: "saved-copies-discarded",
    });
    expect(await dataCount()).toBe(0);
    expect(await getState("failure")).toEqual(failure);
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
  });

  it("D22 set during the removal transaction: record removed, D22 preserved, overall state not clean", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    const state = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      (call) => {
        if (call.mode === "readwrite") world.storage.setItem(SAFETY_LOCK_KEY, "true");
        return false;
      },
    );
    const result = await recoverLocalFailure(
      createOfflineTestTab(world, { openState: state.opener }),
    );
    expect(result).toMatchObject({
      kind: "recovered",
      recordState: "removed-verified",
      final: "safety-lock",
      cleanAtFinalInspection: false,
    });
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true"); // never cleared by c2
  });

  it("D22 becoming unreadable before the gate fails closed: record retained", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    // Data opens: 1 initial, 2 independent verification (D22 becomes unreadable here).
    const tab = createOfflineTestTab(world, {
      openData: onNthOpen(openOfflineDataDatabase, 2, () => {
        world.storage.failGet = true;
      }),
    });
    expect(await recoverLocalFailure(tab)).toMatchObject({
      kind: "local-resolved-record-retained",
      reason: "safety-lock-unreadable",
      recordState: "retained",
    });
    world.storage.failGet = false;
    expect(await getState("failure")).toEqual(failure);
  });
});

describe("failures and result accuracy", () => {
  it("a cleanup failure keeps (joins) the record and reports the failure", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    await putData("landmarks", landmark());
    const data = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    expect(
      await recoverLocalFailure(createOfflineTestTab(world, { openData: data.opener }), {
        authorizeDiscard: true,
      }),
    ).toMatchObject({
      kind: "failed",
      stage: "cleanup",
      recordState: "retained",
      escalation: { failureRecord: "joined", safetyLock: null },
    });
    expect(await getState("failure")).toEqual(failure);
    expect(await dataCount()).toBe(1);
  });

  it("a failed emptiness verification (a store ignoring clear()) keeps the record", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    await putData("landmarks", landmark());
    const tab = createOfflineTestTab(world, {
      openData: ignoreClears(() => openOfflineDataDatabase()),
    });
    expect(await recoverLocalFailure(tab, { authorizeDiscard: true })).toMatchObject({
      kind: "failed",
      stage: "verification",
      recordState: "retained",
    });
    expect(await getState("failure")).toEqual(failure);
  });

  it("a removal transaction that cannot start keeps the record (retained)", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    const state = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      (call) => call.mode === "readwrite",
    );
    expect(
      await recoverLocalFailure(createOfflineTestTab(world, { openState: state.opener })),
    ).toMatchObject({ kind: "failed", stage: "record-removal", recordState: "retained" });
    expect(await getState("failure")).toEqual(failure);
  });

  it("a committed removal with a failed read-back is reported as unknown, never retained or removed", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    const tab = createOfflineTestTab(world, {
      openState: staleGet(() => openOfflineStateDatabase(), "state", "failure", failure),
    });
    expect(await recoverLocalFailure(tab)).toMatchObject({
      kind: "failed",
      stage: "record-verification",
      recordState: "unknown",
    });
    expect(await getState("failure")).toBeUndefined(); // it had in fact committed
  });

  it("a verified removal followed by a failed final inspection is reported separately", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    // Data opens: 1 initial, 2 independent verification, 3 final inspection (fails).
    let calls = 0;
    const openData = (): Promise<OpenResult<OfflineDataSchema>> => {
      calls += 1;
      return calls === 3 ? Promise.resolve({ kind: "unavailable" }) : openOfflineDataDatabase();
    };
    expect(await recoverLocalFailure(createOfflineTestTab(world, { openData }))).toMatchObject({
      kind: "recovered",
      recordState: "removed-verified",
      final: "unreadable",
      cleanAtFinalInspection: false,
    });
  });
});

describe("defense in depth (NON-COOPERATING writers that bypass the security lock)", () => {
  it("data appearing after cleanup is caught by the independent emptiness verification", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    // Data opens: 1 initial (empty), 2 independent verification — a raw write lands first.
    const tab = createOfflineTestTab(world, {
      openData: onNthOpen(openOfflineDataDatabase, 2, () =>
        putData("landmarks", landmark()).then(() => undefined),
      ),
    });
    expect(await recoverLocalFailure(tab)).toMatchObject({
      kind: "failed",
      stage: "verification",
      recordState: "retained",
    });
    expect(await getState("failure")).toEqual(failure);
  });

  it("an intent appearing before removal is caught by the transactional re-check", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    // State opens: 1 initial, 2 independent verification, 3 removal — a raw write lands first.
    const tab = createOfflineTestTab(world, {
      openState: onNthOpen(openOfflineStateDatabase, 3, () =>
        putState(intent).then(() => undefined),
      ),
    });
    expect(await recoverLocalFailure(tab)).toMatchObject({
      kind: "refused",
      reason: "intent-pending",
      recordState: "retained",
    });
    expect(await getState("failure")).toEqual(failure);
    expect(await getState("signout_intent")).toEqual(intent);
  });
});

// ---------------------------------------------------------------------------
// 3b-iii-c3a — restricted: ownership capabilities and safe partial recovery
// ---------------------------------------------------------------------------
// Outcomes are SYNTHETIC inputs. Nothing here simulates A2 as established: no
// test treats a `signed-out`/`no-session` input as discharging a server
// obligation, and every test asserts that intents and D22 are retained.

async function recoverWith(
  tab: ReturnType<typeof createOfflineTestTab>,
  outcome: RecoveryOutcome,
  options: { authorizeDiscard?: boolean } = {},
  between?: () => Promise<void>,
) {
  const result = await runAuthOperation(tab, async (ticket) => {
    const observed = await observeForRecovery(ticket, tab);
    if (observed.status !== "observed") throw new Error(observed.status);
    const request = beginRecoveryRequest(observed.observation);
    await between?.(); // where 3c's network request would be (no security lock held)
    return completeRecovery(request, outcome, tab, options);
  });
  if (result.kind !== "done") throw new Error(result.kind);
  return result.value;
}

describe("c3a — recovery ownership capabilities", () => {
  it("observation requires a live ticket, blocks synchronously, and reads under a shared lock nested in tnle-auth", async () => {
    world = createOfflineTestWorld();
    const requests: string[] = [];
    const recording: LockManagerLike = {
      request: (name, options, callback) => {
        requests.push(`${name}:${options.mode}`);
        return world.locks.request(name, options, callback);
      },
    };
    const tab = createOfflineTestTab(world, {
      coordinator: createLockCoordinator(() => recording),
    });
    let expired: AuthTicket | undefined;
    await runAuthOperation(tab, async (ticket) => {
      expired = ticket;
      const pending = observeForRecovery(ticket, tab);
      expect(tab.generation.isBlocked()).toBe(true);
      expect((await pending).status).toBe("observed");
    });
    expect(requests).toEqual([`${AUTH_LOCK}:exclusive`, `${SECURITY_LOCK}:shared`]);
    await expect(observeForRecovery(expired!, tab)).rejects.toMatchObject({
      reason: "requires-auth",
    });
    const forged = { scope: { held: new Set([AUTH_LOCK]) }, snapshot: tab.generation.snapshot() };
    await expect(observeForRecovery(forged as AuthTicket, tab)).rejects.toMatchObject({
      reason: "requires-auth",
    });
  });

  it("request capability: forged, reused, second-per-ticket, and expired-ticket requests are refused", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    let kept: RecoveryObservation | undefined;
    await runAuthOperation(tab, async (ticket) => {
      const first = await observeForRecovery(ticket, tab);
      const second = await observeForRecovery(ticket, tab);
      if (first.status !== "observed" || second.status !== "observed") throw new Error("lock");
      const forged = { ...first.observation } as RecoveryObservation;
      expect(() => beginRecoveryRequest(forged)).toThrow(OwnershipError);
      beginRecoveryRequest(first.observation);
      expect(() => beginRecoveryRequest(first.observation)).toThrow(OwnershipError); // reused
      expect(() => beginRecoveryRequest(second.observation)).toThrow(OwnershipError); // one per ticket
      kept = (await observeForRecovery(ticket, tab)) as unknown as RecoveryObservation;
    });
    const late = (kept as unknown as { observation: RecoveryObservation }).observation;
    expect(() => beginRecoveryRequest(late)).toThrow(OwnershipError);
  });

  it("completion: forged, replayed (also after not-confirmed), and expired-ticket requests are refused and change nothing", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    const tab = createOfflineTestTab(world);
    let kept: RecoveryRequest | undefined;
    await runAuthOperation(tab, async (ticket) => {
      const observed = await observeForRecovery(ticket, tab);
      if (observed.status !== "observed") throw new Error(observed.status);
      const request = beginRecoveryRequest(observed.observation);
      const forged = { observation: observed.observation } as RecoveryRequest;
      await expect(completeRecovery(forged, "signed-out", tab)).rejects.toMatchObject({
        reason: "handle-invalid",
      });
      expect(await completeRecovery(request, "not-confirmed", tab)).toEqual({
        kind: "not-confirmed",
        blockToken: 1,
        changes: "none",
      });
      // The unsuccessful completion consumed the request: it cannot authorize a later transition.
      await expect(completeRecovery(request, "signed-out", tab)).rejects.toMatchObject({
        reason: "handle-invalid",
      });
    });
    expect(await getState("failure")).toEqual(failure);
    await runAuthOperation(tab, async (ticket) => {
      const observed = await observeForRecovery(ticket, tab);
      if (observed.status !== "observed") throw new Error(observed.status);
      kept = beginRecoveryRequest(observed.observation);
    });
    await expect(completeRecovery(kept!, "signed-out", tab)).rejects.toMatchObject({
      reason: "requires-auth",
    });
    await expect(completeRecovery(kept!, "signed-out", tab)).rejects.toMatchObject({
      reason: "handle-invalid", // consumed by the expired-ticket attempt
    });
    expect(await getState("failure")).toEqual(failure);
  });

  it("not-confirmed changes nothing: intent, marker, saved copies, failure record, and D22 stay", async () => {
    world = createOfflineTestWorld();
    await putState(intent);
    await putState(failure);
    await putData("meta", marker());
    await putData("landmarks", landmark());
    world.storage.setItem(SAFETY_LOCK_KEY, "true");
    const before = await dataCount();
    expect(await recoverWith(createOfflineTestTab(world), "not-confirmed")).toMatchObject({
      kind: "not-confirmed",
      changes: "none",
    });
    expect(await dataCount()).toBe(before);
    expect(await getState("signout_intent")).toEqual(intent);
    expect(await getState("failure")).toEqual(failure);
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
  });
});

describe("c3a — safe partial recovery (no intent removal, no D22 clearing)", () => {
  it("the sole durable server evidence (an intent) is retained; only the terminated lifecycle's marker is invalidated", async () => {
    world = createOfflineTestWorld();
    await putState(intent);
    await putData("meta", marker());
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const tab = createOfflineTestTab(world);
    const result = await recoverWith(tab, "signed-out");
    expect(await getState("signout_intent")).toEqual(intent); // retained: A2 is unapproved
    expect(await withData((db) => db.get("meta", "marker"))).toBeUndefined();
    expect(result).toMatchObject({
      kind: "partial",
      serverOutcome: "signed-out",
      confirmationFreshness: "unestablished",
      marker: "removed",
      intent: "retained",
      failureRecord: "absent",
      d22: "absent",
      remainingObligations: ["sign-out-intent"],
    });
    expect(tab.generation.isBlocked()).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("without discard authorization: marker invalidated, saved copies and the failure record kept (partial)", async () => {
    world = createOfflineTestWorld();
    await putState(intent);
    await putState(failure);
    await putData("meta", marker());
    await putData("landmarks", landmark());
    const result = await recoverWith(createOfflineTestTab(world), "no-session");
    expect(result).toMatchObject({
      kind: "partial",
      marker: "removed",
      cleanup: "awaiting-authorization",
      failureRecord: "retained",
      intent: "retained",
      remainingObligations: [
        "sign-out-intent",
        "failure-record",
        "saved-copies-awaiting-authorization",
      ],
    });
    expect(await withData((db) => db.count("landmarks"))).toBe(1);
    expect(await getState("failure")).toEqual(failure);
  });

  it("with authorization: data emptied and verified, failure record removed and verified, intent still retained", async () => {
    world = createOfflineTestWorld();
    await putState(intent);
    await putState(failure);
    await putData("meta", marker());
    await putData("landmarks", landmark());
    const other = createOfflineTestTab(world);
    const result = await recoverWith(createOfflineTestTab(world), "signed-out", {
      authorizeDiscard: true,
    });
    expect(await getState("signout_intent")).toEqual(intent);
    expect(await getState("failure")).toBeUndefined();
    expect(await dataCount()).toBe(0);
    expect(result).toMatchObject({
      kind: "partial",
      failureRecord: "removed-verified",
      cleanup: "saved-copies-discarded",
      intent: "retained",
      remainingObligations: ["sign-out-intent"],
      final: "intent-pending",
      cleanAtFinalInspection: false,
    });
    await flush();
    expect(other.received).toContain("failure-changed");
  });

  it("D22 is never cleared: the failure record is resolved locally while D22 remains", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    world.storage.setItem(SAFETY_LOCK_KEY, "true");
    const result = await recoverWith(createOfflineTestTab(world), "no-session");
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
    expect(result).toMatchObject({
      kind: "partial",
      failureRecord: "removed-verified",
      d22: "retained",
      remainingObligations: ["safety-lock"],
      final: "safety-lock",
    });
  });

  it("a malformed intent is retained unchanged while the failure record is resolved", async () => {
    world = createOfflineTestWorld();
    const malformed = { ...intent, created_at: "x" };
    await putState(malformed);
    await putState(failure);
    const result = await recoverWith(createOfflineTestTab(world), "signed-out");
    expect(await getState("signout_intent")).toEqual(malformed);
    expect(result).toMatchObject({ failureRecord: "removed-verified", intent: "retained" });
  });

  it("a newer intent created after the observation is preserved", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    const result = await recoverWith(createOfflineTestTab(world), "signed-out", {}, async () => {
      await beginSignOut(createOfflineTestTab(world)); // another tab signs out mid-recovery
    });
    expect(await getState("signout_intent")).toBeDefined();
    expect(result).toMatchObject({ intent: "retained", remainingObligations: ["sign-out-intent"] });
  });

  it("no remaining obligations: completed; the tab stays blocked and no lifecycle is created", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    const tab = createOfflineTestTab(world);
    const result = await recoverWith(tab, "no-session");
    expect(result).toMatchObject({
      kind: "completed",
      failureRecord: "removed-verified",
      final: "none",
      cleanAtFinalInspection: true,
      remainingObligations: [],
    });
    expect(tab.generation.isBlocked()).toBe(true);
    expect(await withData((db) => db.get("meta", "marker"))).toBeUndefined();
  });

  it("a valid marker without an intent is not invalidated without authorization (no independent justification)", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    await putData("meta", marker());
    const result = await recoverWith(createOfflineTestTab(world), "signed-out");
    expect(await withData((db) => db.get("meta", "marker"))).toEqual(marker());
    expect(result).toMatchObject({
      marker: "not-applicable",
      cleanup: "awaiting-authorization",
      failureRecord: "retained",
    });
  });

  const refusals: [
    string,
    Partial<Parameters<typeof createOfflineTestTab>[1]>,
    () => void,
    string,
  ][] = [
    [
      "unreadable state",
      { openState: () => Promise.resolve({ kind: "unavailable" }) },
      () => undefined,
      "state-unreadable",
    ],
    [
      "unreadable data",
      { openData: () => Promise.resolve({ kind: "unavailable" }) },
      () => undefined,
      "data-unreadable",
    ],
    [
      "unreadable D22",
      {},
      () => {
        world.storage.failGet = true;
      },
      "safety-lock-unreadable",
    ],
  ];
  for (const [label, overrides, arrange, reason] of refusals) {
    it(`${label}: refused at completion with nothing changed`, async () => {
      world = createOfflineTestWorld();
      await putState(failure);
      const tab = createOfflineTestTab(world, overrides);
      const result = await runAuthOperation(tab, async (ticket) => {
        const observed = await observeForRecovery(ticket, tab);
        if (observed.status !== "observed") throw new Error(observed.status);
        const request = beginRecoveryRequest(observed.observation);
        arrange();
        return completeRecovery(request, "signed-out", tab, { authorizeDiscard: true });
      });
      world.storage.failGet = false;
      expect(result).toEqual({
        kind: "done",
        value: { kind: "refused", blockToken: 1, reason, changes: "none" },
      });
      expect(await getState("failure")).toEqual(failure);
    });
  }

  it("a cleanup failure keeps the record (joined); a removal that cannot start keeps it; a failed read-back is unknown", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    await putData("landmarks", landmark());
    const data = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (c) => c.mode === "readwrite",
    );
    expect(
      await recoverWith(createOfflineTestTab(world, { openData: data.opener }), "signed-out", {
        authorizeDiscard: true,
      }),
    ).toMatchObject({ kind: "failed", stage: "cleanup", recordState: "retained" });

    world = createOfflineTestWorld();
    await putState(failure);
    const state = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      (c) => c.mode === "readwrite",
    );
    expect(
      await recoverWith(createOfflineTestTab(world, { openState: state.opener }), "signed-out"),
    ).toMatchObject({ kind: "failed", stage: "record-removal", recordState: "retained" });
    expect(await getState("failure")).toEqual(failure);

    world = createOfflineTestWorld();
    await putState(failure);
    const stale = staleGet(() => openOfflineStateDatabase(), "state", "failure", failure);
    expect(
      await recoverWith(createOfflineTestTab(world, { openState: stale }), "signed-out"),
    ).toMatchObject({ kind: "failed", stage: "record-verification", recordState: "unknown" });
    expect(await getState("failure")).toBeUndefined(); // it had in fact committed
  });

  it("concurrent recoveries serialize through tnle-auth; the second finds the record absent", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    const results = await Promise.all([
      recoverWith(createOfflineTestTab(world), "signed-out"),
      recoverWith(createOfflineTestTab(world), "signed-out"),
    ]);
    expect(results.map((r) => ("failureRecord" in r ? r.failureRecord : r.kind)).sort()).toEqual([
      "absent",
      "removed-verified",
    ]);
  });

  it("defense in depth (NON-COOPERATING writer): data appearing before the record removal keeps the record", async () => {
    world = createOfflineTestWorld();
    await putState(failure);
    // Data opens: 1 observation, 2 initial, 3 current, 4 independent verification (raw write first).
    const tab = createOfflineTestTab(world, {
      openData: onNthOpen(openOfflineDataDatabase, 4, () =>
        putData("landmarks", landmark()).then(() => undefined),
      ),
    });
    expect(await recoverWith(tab, "signed-out")).toMatchObject({
      kind: "failed",
      stage: "verification",
      recordState: "retained",
    });
    expect(await getState("failure")).toEqual(failure);
  });
});
