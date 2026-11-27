import { afterEach, describe, expect, it, vi } from "vitest";
import { openOfflineDataDatabase, openOfflineStateDatabase } from "./db";
import {
  confirmIdentity,
  endLifecycleWithoutSession,
  releaseLocalBlock,
  type ConfirmIdentityResult,
} from "./lifecycle";
import { AUTH_LOCK, createLockCoordinator, SECURITY_LOCK, type LockManagerLike } from "./locks";
import { SAFETY_LOCK_KEY } from "./safetyLock";
import { runAuthOperation, type AuthTicket, type SecurityDeps } from "./securityState";
import { beginSignOut } from "./signOutIntent";
import {
  createOfflineTestTab,
  createOfflineTestWorld,
  deferred,
  flush,
  injectTransactionFailures,
  staleGet,
  type OfflineTestWorld,
} from "./testSupport";

/**
 * M06-T03 Increment 3b-ii — lifecycle creation, reuse, account switch, and
 * guarded unblocking through the ISOLATED verified-identity interface. The
 * account IDs are synthetic inputs; no AuthProvider, cookie, or server is
 * involved (3c).
 */

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const OLD_LIFECYCLE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LANDMARK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T0 = "2026-11-25T09:00:00.000Z";

const oldMarker = (account = ACCOUNT_A) => ({
  key: "marker",
  schema_version: 1,
  account_id: account,
  lifecycle_id: OLD_LIFECYCLE,
  verified_at: T0,
});
const intent = { key: "signout_intent", schema_version: 1, pending: true, created_at: T0 };
const residualLandmark = () => ({
  schema_version: 1,
  account_id: ACCOUNT_A,
  lifecycle_id: OLD_LIFECYCLE,
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
async function readMarker(): Promise<Record<string, unknown> | undefined> {
  const opened = await openOfflineDataDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  const value = (await opened.db.get("meta", "marker")) as Record<string, unknown> | undefined;
  opened.db.close();
  return value;
}

/** Runs a synthetic authentication completion: `confirmIdentity` under a live ticket. */
async function confirmAs(tab: SecurityDeps, account: string): Promise<ConfirmIdentityResult> {
  const result = await runAuthOperation(tab, (ticket) => confirmIdentity(ticket, account, tab));
  if (result.kind !== "done") throw new Error(result.kind);
  return result.value;
}

let world: OfflineTestWorld;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("creation and reuse", () => {
  it("creates a lifecycle on the first verified identity and notifies other tabs", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    const other = createOfflineTestTab(world);
    const result = await confirmAs(tab, ACCOUNT_A);
    expect(result).toEqual({
      kind: "created",
      lifecycleId: "eeeeeeee-eeee-4eee-8eee-000000000001",
    });
    expect(await readMarker()).toEqual({
      key: "marker",
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: "eeeeeeee-eeee-4eee-8eee-000000000001",
      verified_at: "2026-11-26T10:00:00.000Z",
    });
    await flush();
    expect(other.received).toEqual(["lifecycle-changed"]);
  });

  it("reuses a matching lifecycle on rechecks: same identity, only verified_at advances", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker());
    const tab = createOfflineTestTab(world);
    for (const expected of ["2026-11-26T10:00:00.000Z", "2026-11-26T10:00:00.001Z"]) {
      expect(await confirmAs(tab, ACCOUNT_A)).toEqual({
        kind: "reused",
        lifecycleId: OLD_LIFECYCLE,
      });
      expect(await readMarker()).toEqual({ ...oldMarker(), verified_at: expected });
    }
  });

  it("two tabs confirming the same identity concurrently produce exactly one lifecycle", async () => {
    world = createOfflineTestWorld();
    const a = createOfflineTestTab(world);
    const b = createOfflineTestTab(world, {
      newLifecycleId: () => "eeeeeeee-eeee-4eee-8eee-0000000000b0",
    });
    const results = await Promise.all([confirmAs(a, ACCOUNT_A), confirmAs(b, ACCOUNT_A)]);
    expect(results.map((r) => r.kind).sort()).toEqual(["created", "reused"]);
    const ids = results.map((r) => ("lifecycleId" in r ? r.lifecycleId : null));
    expect(ids[0]).toBe(ids[1]);
  });
});

describe("account switch", () => {
  it("a different verified account invalidates the previous lifecycle and blocks replacement while residual records remain", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker());
    await putData("landmarks", {
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: OLD_LIFECYCLE,
      revision: 1,
      landmark_id: LANDMARK,
      status: "unavailable",
      saved_at: T0,
      unavailable_recorded_at: T0,
    });
    const tab = createOfflineTestTab(world);
    const other = createOfflineTestTab(world);
    const before = tab.generation.snapshot();
    expect(await confirmAs(tab, ACCOUNT_B)).toEqual({
      kind: "account-switch",
      marker: "removed",
      replacement: "blocked",
    });
    expect(await readMarker()).toBeUndefined();
    expect(tab.generation.isCurrent(before)).toBe(false);
    expect(await confirmAs(tab, ACCOUNT_B)).toEqual({ kind: "refused", reason: "residual" });
    expect(await readMarker()).toBeUndefined();
    await flush();
    expect(other.received).toEqual(["lifecycle-ended"]);
  });

  it("with no residual records, the next verified identity may create the replacement lifecycle", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker());
    const tab = createOfflineTestTab(world);
    expect((await confirmAs(tab, ACCOUNT_B)).kind).toBe("account-switch");
    expect((await confirmAs(tab, ACCOUNT_B)).kind).toBe("created");
    expect((await readMarker())?.account_id).toBe(ACCOUNT_B);
  });
});

describe("blocking conditions prevent creation", () => {
  const cases: [string, () => Promise<void> | void, string][] = [
    ["an unresolved intent", () => putState(intent), "intent-pending"],
    [
      "a durable failure record",
      () => putState({ key: "failure", schema_version: 1, kind: "cleanup", recorded_at: T0 }),
      "failure",
    ],
    ["D22 present", () => world.storage.setItem(SAFETY_LOCK_KEY, "true"), "safety-lock"],
    [
      "D22 unreadable",
      () => {
        world.storage.failGet = true;
      },
      "unreadable",
    ],
    ["a malformed intent", () => putState({ ...intent, token: "x" }), "unreadable"],
  ];
  for (const [label, arrange, reason] of cases) {
    it(`refuses with ${label}, writing no marker`, async () => {
      world = createOfflineTestWorld();
      await arrange();
      const tab = createOfflineTestTab(world);
      expect(await confirmAs(tab, ACCOUNT_A)).toEqual({ kind: "refused", reason });
      world.storage.failGet = false;
      expect(await readMarker()).toBeUndefined();
    });
  }

  it("a remaining marker never overrides an unresolved intent (no reuse, no verified_at update)", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker());
    await putState(intent);
    const tab = createOfflineTestTab(world);
    expect(await confirmAs(tab, ACCOUNT_A)).toEqual({ kind: "refused", reason: "intent-pending" });
    expect(await readMarker()).toEqual(oldMarker());
  });

  it("an unavailable state database is unreadable and creates nothing", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world, {
      openState: () => Promise.resolve({ kind: "unavailable" }),
    });
    expect(await confirmAs(tab, ACCOUNT_A)).toEqual({ kind: "refused", reason: "unreadable" });
    expect(await readMarker()).toBeUndefined();
  });

  it("re-reads D22 immediately before committing", async () => {
    world = createOfflineTestWorld();
    const reached = deferred();
    const gate = deferred();
    const tab = createOfflineTestTab(world, {
      openData: async () => {
        reached.resolve();
        await gate.promise;
        return openOfflineDataDatabase();
      },
    });
    const pending = confirmAs(tab, ACCOUNT_A);
    await reached.promise;
    world.storage.setItem(SAFETY_LOCK_KEY, "true"); // set after D22 was first read
    gate.resolve();
    expect(await pending).toEqual({ kind: "refused", reason: "safety-lock" });
    expect(await readMarker()).toBeUndefined();
  });

  it("refuses an invalid identity input without any lock or write", async () => {
    world = createOfflineTestWorld();
    expect(await confirmAs(createOfflineTestTab(world), "not-a-uuid")).toEqual({
      kind: "refused",
      reason: "invalid-identity",
    });
    expect(await readMarker()).toBeUndefined();
  });
});

describe("staleness, revalidation, and ownership", () => {
  it("a stale generation is refused even when durable state is clear", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    const result = await runAuthOperation(tab, (ticket) => {
      tab.generation.block(); // e.g. an in-memory-only block after every durable write failed
      return confirmIdentity(ticket, ACCOUNT_A, tab);
    });
    expect(result).toEqual({ kind: "done", value: { kind: "refused", reason: "stale" } });
    expect(await readMarker()).toBeUndefined();
  });

  it("revalidates inside the exclusive lock: an intent committed while waiting prevents creation", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    const writer = createOfflineTestTab(world);
    const hold = deferred();
    const held = writer.coordinator.withLock(
      { held: new Set() },
      SECURITY_LOCK,
      "exclusive",
      async () => {
        await hold.promise;
        await putState(intent); // another tab's durable intent, written under the lock
      },
    );
    await flush();
    const pending = confirmAs(tab, ACCOUNT_A);
    await flush();
    hold.resolve();
    await held;
    expect(await pending).toEqual({ kind: "refused", reason: "intent-pending" });
    expect(await readMarker()).toBeUndefined();
  });

  it("a sign-out queued during the identity check is never followed by a lifecycle committed on pre-sign-out state", async () => {
    world = createOfflineTestWorld();
    const reached = deferred();
    const gate = deferred();
    let calls = 0;
    const tab = createOfflineTestTab(world, {
      openData: async () => {
        calls += 1;
        if (calls === 1) {
          reached.resolve();
          await gate.promise;
        }
        return openOfflineDataDatabase();
      },
    });
    const signingOut = createOfflineTestTab(world);
    const pending = confirmAs(tab, ACCOUNT_A);
    await reached.promise; // the identity check is reading security state
    const signOut = beginSignOut(signingOut); // queued for the exclusive security lock
    await flush();
    gate.resolve();
    await Promise.all([pending, signOut]);
    // Whatever the order, no marker may survive alongside the unresolved intent.
    expect(await readMarker()).toBeUndefined();
    const state = await openOfflineStateDatabase();
    if (state.kind !== "open") throw new Error(state.kind);
    expect((await state.db.get("state", "signout_intent")) !== undefined).toBe(true);
    state.db.close();
  });

  it("holds tnle-auth then tnle-offline-security EXCLUSIVE during the transition", async () => {
    world = createOfflineTestWorld();
    const reached = deferred();
    const gate = deferred();
    const tab = createOfflineTestTab(world, {
      openData: async () => {
        reached.resolve();
        await gate.promise;
        return openOfflineDataDatabase();
      },
    });
    const pending = confirmAs(tab, ACCOUNT_A);
    await reached.promise;
    expect(world.locks.snapshot().held).toEqual([
      { name: AUTH_LOCK, mode: "exclusive" },
      { name: SECURITY_LOCK, mode: "exclusive" },
    ]);
    gate.resolve();
    expect((await pending).kind).toBe("created");
    expect(world.locks.snapshot()).toEqual({ held: [], pending: [] });
  });

  it("requires a live auth ticket: forged or expired tickets are rejected before any lock or write", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    let expired: AuthTicket | undefined;
    await runAuthOperation(tab, (ticket) => {
      expired = ticket;
    });
    const forged = {
      scope: { held: new Set([AUTH_LOCK]) },
      snapshot: tab.generation.snapshot(),
    } as AuthTicket;
    for (const ticket of [forged, expired!]) {
      await expect(confirmIdentity(ticket, ACCOUNT_A, tab)).rejects.toMatchObject({
        name: "OwnershipError",
        reason: "requires-auth",
      });
    }
    expect(await readMarker()).toBeUndefined();
  });

  it("a security lock that cannot be used refuses (coordination unavailable)", async () => {
    world = createOfflineTestWorld();
    const manager: LockManagerLike = {
      request: (name, options, callback) =>
        name === SECURITY_LOCK
          ? Promise.reject(new DOMException("synthetic", "InvalidStateError"))
          : world.locks.request(name, options, callback),
    };
    const tab = createOfflineTestTab(world, { coordinator: createLockCoordinator(() => manager) });
    expect(await confirmAs(tab, ACCOUNT_A)).toEqual({
      kind: "refused",
      reason: "coordination-unavailable",
    });
  });
});

describe("guarded local unblocking (Q18)", () => {
  it("the current generation token alone never unblocks while blocking state exists", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    const token = tab.generation.block();
    await putState(intent);
    expect(await releaseLocalBlock(token, tab)).toEqual({
      kind: "blocked",
      reason: "intent-pending",
    });
    expect(tab.generation.isBlocked()).toBe(true);
    world.storage.setItem(SAFETY_LOCK_KEY, "true");
    expect(await releaseLocalBlock(token, tab)).toEqual({ kind: "blocked", reason: "safety-lock" });
    expect(tab.generation.isBlocked()).toBe(true);
  });

  it("unblocks after a fresh durable check finds no blocking state, and only for the current token", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    const stale = tab.generation.block();
    const token = tab.generation.block();
    expect(await releaseLocalBlock(stale, tab)).toEqual({ kind: "stale-token" });
    expect(tab.generation.isBlocked()).toBe(true);
    expect(await releaseLocalBlock(token, tab)).toEqual({ kind: "released" });
    expect(tab.generation.isBlocked()).toBe(false);
  });

  it("residual records keep the block", async () => {
    world = createOfflineTestWorld();
    await putData("trips", {
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: OLD_LIFECYCLE,
      revision: 1,
      trip_id: LANDMARK,
      status: "unavailable",
      saved_at: T0,
      unavailable_recorded_at: T0,
    });
    const tab = createOfflineTestTab(world);
    const token = tab.generation.block();
    expect(await releaseLocalBlock(token, tab)).toEqual({ kind: "blocked", reason: "residual" });
  });
});

describe("Q22 — clean-state-only local unblocking (3b-iii-a)", () => {
  it("an existing valid lifecycle prevents this unblocking path (it is never identity-bound)", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker());
    const tab = createOfflineTestTab(world);
    const token = tab.generation.block();
    expect(await releaseLocalBlock(token, tab)).toEqual({
      kind: "blocked",
      reason: "lifecycle-present",
    });
    expect(tab.generation.isBlocked()).toBe(true);
    expect(await readMarker()).toEqual(oldMarker());
  });

  const refusals: [string, () => Promise<void> | void, string][] = [
    [
      "durable failure evidence",
      () => putState({ key: "failure", schema_version: 1, kind: "cleanup", recorded_at: T0 }),
      "failure",
    ],
    [
      "D22 unreadable",
      () => {
        world.storage.failGet = true;
      },
      "unreadable",
    ],
    ["a malformed marker", () => putData("meta", { ...oldMarker(), extra: true }), "unreadable"],
    ["a malformed intent", () => putState({ ...intent, created_at: "x" }), "unreadable"],
  ];
  for (const [label, arrange, reason] of refusals) {
    it(`refuses with ${label}`, async () => {
      world = createOfflineTestWorld();
      await arrange();
      const tab = createOfflineTestTab(world);
      const token = tab.generation.block();
      expect(await releaseLocalBlock(token, tab)).toEqual({ kind: "blocked", reason });
      expect(tab.generation.isBlocked()).toBe(true);
    });
  }

  it("refuses when the security state cannot be read at all", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world, {
      openData: () => Promise.resolve({ kind: "unavailable" }),
    });
    const token = tab.generation.block();
    expect(await releaseLocalBlock(token, tab)).toEqual({ kind: "blocked", reason: "unreadable" });
    expect(tab.generation.isBlocked()).toBe(true);
  });

  it("revalidates inside the shared lock: an intent committed while the release waits keeps the block", async () => {
    world = createOfflineTestWorld();
    const writer = createOfflineTestTab(world);
    const tab = createOfflineTestTab(world);
    const token = tab.generation.block();
    const hold = deferred();
    const held = writer.coordinator.withLock(
      { held: new Set() },
      SECURITY_LOCK,
      "exclusive",
      async () => {
        await hold.promise;
        await putState(intent);
      },
    );
    await flush();
    const pending = releaseLocalBlock(token, tab);
    await flush();
    expect(world.locks.snapshot().pending).toEqual([{ name: SECURITY_LOCK, mode: "shared" }]);
    hold.resolve();
    await held;
    expect(await pending).toEqual({ kind: "blocked", reason: "intent-pending" });
    expect(tab.generation.isBlocked()).toBe(true);
  });

  it("a completely clean release writes nothing, creates no lifecycle, and leaves D22 untouched", async () => {
    world = createOfflineTestWorld();
    const data = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      () => false,
    );
    const state = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      () => false,
    );
    const tab = createOfflineTestTab(world, { openData: data.opener, openState: state.opener });
    const token = tab.generation.block();
    expect(await releaseLocalBlock(token, tab)).toEqual({ kind: "released" });
    expect([...data.log, ...state.log].every((call) => call.mode === "readonly")).toBe(true);
    expect(await readMarker()).toBeUndefined();
    expect(world.storage.length).toBe(0);
    expect(world.locks.snapshot()).toEqual({ held: [], pending: [] });
  });

  it("no impossible ordering: release on clean state, then the verified identity creates the lifecycle", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    const token = tab.generation.block();
    expect(await confirmAs(tab, ACCOUNT_A)).toEqual({ kind: "refused", reason: "stale" });
    expect(await releaseLocalBlock(token, tab)).toEqual({ kind: "released" });
    expect((await confirmAs(tab, ACCOUNT_A)).kind).toBe("created");
    expect(await readMarker()).toMatchObject({ account_id: ACCOUNT_A });
  });
});

describe("Q29 — a failed account-switch invalidation never leaves the previous lifecycle reusable (3b-iii-c1)", () => {
  const failureRecord = {
    key: "failure",
    schema_version: 1,
    kind: "invalidation",
    recorded_at: T0,
  };

  async function stateFailure(): Promise<unknown> {
    const opened = await openOfflineStateDatabase();
    if (opened.kind !== "open") throw new Error(opened.kind);
    const value: unknown = await opened.db.get("state", "failure");
    opened.db.close();
    return value;
  }

  /** A tab whose data-database writes fail, so account A's marker cannot be removed. */
  function failingSwitchTab(overrides: Partial<SecurityDeps> = {}) {
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    return createOfflineTestTab(world, { openData: failing.opener, ...overrides });
  }

  it("marker-removal failure: durable failure evidence, tab blocked; no context may reuse account A's lifecycle or create B's", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker(ACCOUNT_A));
    const tab = failingSwitchTab();
    const result = await confirmAs(tab, ACCOUNT_B);
    // Durable eligibility first: another cooperating context.
    const other = createOfflineTestTab(world);
    expect(await confirmAs(other, ACCOUNT_A)).toEqual({ kind: "refused", reason: "failure" });
    expect(await readMarker()).toEqual(oldMarker(ACCOUNT_A)); // survives, but is not current
    expect(await stateFailure()).toMatchObject({ key: "failure", kind: "cleanup" });
    // A working context's B identity retries the protective invalidation of A's
    // marker, but still creates no replacement while the failure record remains.
    expect(await confirmAs(other, ACCOUNT_B)).toEqual({
      kind: "account-switch",
      marker: "removed",
      replacement: "blocked",
    });
    expect(await confirmAs(other, ACCOUNT_B)).toEqual({ kind: "refused", reason: "failure" });
    // Local blocking stays; this tab is not unblocked and cannot confirm any identity.
    expect(tab.generation.isBlocked()).toBe(true);
    expect(await confirmAs(tab, ACCOUNT_A)).toEqual({ kind: "refused", reason: "stale" });
    expect(await releaseLocalBlock(1, tab)).toEqual({ kind: "blocked", reason: "failure" });
    // Then the reported outcome.
    expect(result).toEqual({
      kind: "account-switch",
      marker: "remove-failed",
      replacement: "blocked",
      blockToken: 1,
      escalation: { failureRecord: "written", safetyLock: null },
      protection: "failure-record",
    });
  });

  it("marker-verification failure (stale read-back) establishes durable failure evidence", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker(ACCOUNT_A));
    const tab = createOfflineTestTab(world, {
      openData: staleGet(() => openOfflineDataDatabase(), "meta", "marker", oldMarker(ACCOUNT_A)),
    });
    const result = await confirmAs(tab, ACCOUNT_B);
    expect(await confirmAs(createOfflineTestTab(world), ACCOUNT_B)).toEqual({
      kind: "refused",
      reason: "failure",
    });
    expect(result).toMatchObject({
      marker: "remove-failed",
      escalation: { failureRecord: "written", safetyLock: null },
      protection: "failure-record",
    });
  });

  it("an existing valid failure record is joined, never replaced", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker(ACCOUNT_A));
    await putState(failureRecord);
    const result = await confirmAs(failingSwitchTab(), ACCOUNT_B);
    expect(await confirmAs(createOfflineTestTab(world), ACCOUNT_A)).toEqual({
      kind: "refused",
      reason: "failure",
    });
    expect(await stateFailure()).toEqual(failureRecord);
    expect(result).toMatchObject({
      escalation: { failureRecord: "joined", safetyLock: null },
      protection: "failure-record",
    });
  });

  it("an existing malformed failure record is preserved and D22 is escalated", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker(ACCOUNT_A));
    const malformed = { ...failureRecord, kind: "other" };
    await putState(malformed);
    const result = await confirmAs(failingSwitchTab(), ACCOUNT_B);
    expect(await confirmAs(createOfflineTestTab(world), ACCOUNT_A)).toEqual({
      kind: "refused",
      reason: "unreadable",
    });
    expect(await stateFailure()).toEqual(malformed);
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
    expect(result).toMatchObject({
      escalation: { failureRecord: "preserved-malformed", safetyLock: { durable: true } },
      protection: "safety-lock",
    });
  });

  it("a failure-record persistence failure escalates to D22", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker(ACCOUNT_A));
    const state = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      (call) => call.mode === "readwrite",
    );
    const result = await confirmAs(failingSwitchTab({ openState: state.opener }), ACCOUNT_B);
    expect(await confirmAs(createOfflineTestTab(world), ACCOUNT_A)).toEqual({
      kind: "refused",
      reason: "safety-lock",
    });
    expect(result).toMatchObject({
      escalation: { failureRecord: "write-failed", safetyLock: { durable: true } },
      protection: "safety-lock",
    });
  });

  it("when every durable mechanism fails, the outcome is memory-only and the tab stays blocked", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker(ACCOUNT_A));
    world.storage.failSet = true;
    const state = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      (call) => call.mode === "readwrite",
    );
    const tab = failingSwitchTab({ openState: state.opener });
    const result = await confirmAs(tab, ACCOUNT_B);
    expect(result).toMatchObject({
      marker: "remove-failed",
      escalation: { failureRecord: "write-failed", safetyLock: { durable: false } },
      protection: "memory-only", // restart protection cannot be guaranteed
    });
    expect(tab.generation.isBlocked()).toBe(true);
  });

  it("other sufficient durable evidence (a pending intent) is reported as such when every write fails", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker(ACCOUNT_A));
    await putState(intent);
    world.storage.failSet = true;
    const state = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      (call) => call.mode === "readwrite",
    );
    const result = await confirmAs(failingSwitchTab({ openState: state.opener }), ACCOUNT_B);
    expect(result).toMatchObject({ protection: "other-durable-evidence" });
  });

  it("records and metadata of the previous lifecycle are not silently removed", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker(ACCOUNT_A));
    await putData("landmarks", {
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: OLD_LIFECYCLE,
      revision: 1,
      landmark_id: LANDMARK,
      status: "unavailable",
      saved_at: T0,
      unavailable_recorded_at: T0,
    });
    await putData("meta", {
      key: "sequence",
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: OLD_LIFECYCLE,
      value: 1,
    });
    await confirmAs(failingSwitchTab(), ACCOUNT_B);
    const opened = await openOfflineDataDatabase();
    if (opened.kind !== "open") throw new Error(opened.kind);
    expect(await opened.db.count("landmarks")).toBe(1);
    expect(await opened.db.get("meta", "sequence")).toBeDefined();
    opened.db.close();
  });

  it("a same-account identity triggers no invalidation or escalation", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker(ACCOUNT_A));
    const tab = failingSwitchTab(); // writes would fail, but none is attempted beyond reuse
    expect(await confirmAs(tab, ACCOUNT_A)).toEqual({ kind: "refused", reason: "write-failed" });
    expect(await readMarker()).toEqual(oldMarker(ACCOUNT_A));
    expect(await stateFailure()).toBeUndefined();
    expect(world.storage.length).toBe(0);
    expect(tab.generation.isBlocked()).toBe(false);
  });

  it("an obsolete generation is refused before any invalidation attempt", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker(ACCOUNT_A));
    const tab = failingSwitchTab();
    const result = await runAuthOperation(tab, (ticket) => {
      tab.generation.advance();
      return confirmIdentity(ticket, ACCOUNT_B, tab);
    });
    expect(result).toEqual({ kind: "done", value: { kind: "refused", reason: "stale" } });
    expect(await readMarker()).toEqual(oldMarker(ACCOUNT_A));
    expect(await stateFailure()).toBeUndefined();
    expect(world.storage.length).toBe(0);
  });
});

describe("3c-1a (U5) — identity-bound release inside confirmIdentity", () => {
  const RELEASE = { releaseBlock: "identity-bound" } as const;

  /** `confirmIdentity` with the identity-bound release, under a fresh live ticket. */
  async function confirmReleasing(tab: SecurityDeps, account: string) {
    const result = await runAuthOperation(tab, (ticket) =>
      confirmIdentity(ticket, account, tab, RELEASE),
    );
    if (result.kind !== "done") throw new Error(result.kind);
    return result.value;
  }

  it("a blocked tab with a clean state is released and creates the lifecycle", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    tab.generation.block();
    expect((await confirmReleasing(tab, ACCOUNT_A)).kind).toBe("created");
    expect(tab.generation.isBlocked()).toBe(false);
    expect(await readMarker()).toMatchObject({ account_id: ACCOUNT_A });
  });

  it("a blocked tab whose verified identity matches the valid lifecycle is released and reuses it", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker());
    const tab = createOfflineTestTab(world);
    tab.generation.block();
    expect(await confirmReleasing(tab, ACCOUNT_A)).toEqual({
      kind: "reused",
      lifecycleId: OLD_LIFECYCLE,
    });
    expect(tab.generation.isBlocked()).toBe(false);
  });

  it("a different verified account is released only into the account-switch invalidation", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker(ACCOUNT_A));
    const tab = createOfflineTestTab(world);
    tab.generation.block();
    expect(await confirmReleasing(tab, ACCOUNT_B)).toEqual({
      kind: "account-switch",
      marker: "removed",
      replacement: "blocked",
    });
    expect(await readMarker()).toBeUndefined();
  });

  const keepsBlock: [string, () => Promise<void> | void][] = [
    ["residual records", () => putData("landmarks", residualLandmark())],
    ["a pending intent", () => putState(intent)],
    [
      "a durable failure record",
      () => putState({ key: "failure", schema_version: 1, kind: "cleanup", recorded_at: T0 }),
    ],
    ["D22 present", () => world.storage.setItem(SAFETY_LOCK_KEY, "true")],
    [
      "D22 unreadable",
      () => {
        world.storage.failGet = true;
      },
    ],
    ["a malformed marker", () => putData("meta", { ...oldMarker(), lifecycle_id: "x" })],
  ];
  for (const [label, arrange] of keepsBlock) {
    it(`keeps the block with ${label}: stale refusal, no marker written`, async () => {
      world = createOfflineTestWorld();
      await arrange();
      const before = await readMarker();
      const tab = createOfflineTestTab(world);
      tab.generation.block();
      expect(await confirmReleasing(tab, ACCOUNT_A)).toEqual({ kind: "refused", reason: "stale" });
      expect(tab.generation.isBlocked()).toBe(true);
      world.storage.failGet = false;
      expect(await readMarker()).toEqual(before);
    });
  }

  it("a block that occurred during the operation is never released by its (stale) result", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    tab.generation.block();
    const result = await runAuthOperation(tab, (ticket) => {
      tab.generation.block(); // a newer block, after the ticket's snapshot
      return confirmIdentity(ticket, ACCOUNT_A, tab, RELEASE);
    });
    expect(result).toEqual({ kind: "done", value: { kind: "refused", reason: "stale" } });
    expect(tab.generation.isBlocked()).toBe(true);
    expect(await readMarker()).toBeUndefined();
  });

  it("re-reads D22 immediately before releasing: a lock set after the inspection keeps the block", async () => {
    world = createOfflineTestWorld();
    const base = createOfflineTestTab(world);
    let reads = 0;
    const tab = createOfflineTestTab(world, {
      safetyLock: {
        ...base.safetyLock,
        read: () => {
          reads += 1;
          return reads === 1 ? "absent" : "present"; // set by another tab after the inspection
        },
      },
    });
    tab.generation.block();
    expect(await confirmReleasing(tab, ACCOUNT_A)).toEqual({ kind: "refused", reason: "stale" });
    expect(tab.generation.isBlocked()).toBe(true);
    expect(await readMarker()).toBeUndefined();
  });

  it("without the option, a blocked tab is still refused (accepted behavior unchanged)", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    tab.generation.block();
    expect(await confirmAs(tab, ACCOUNT_A)).toEqual({ kind: "refused", reason: "stale" });
    expect(tab.generation.isBlocked()).toBe(true);
  });

  it("an unblocked tab is unaffected by the option", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    expect((await confirmReleasing(tab, ACCOUNT_A)).kind).toBe("created");
    expect(tab.generation.isBlocked()).toBe(false);
  });
});

describe("3c-1a (U5) — endLifecycleWithoutSession (OFF-OUT-8)", () => {
  async function endAs(tab: SecurityDeps) {
    const result = await runAuthOperation(tab, (ticket) => endLifecycleWithoutSession(ticket, tab));
    if (result.kind !== "done") throw new Error(result.kind);
    return result.value;
  }
  async function countLandmarks(): Promise<number> {
    const opened = await openOfflineDataDatabase();
    if (opened.kind !== "open") throw new Error(opened.kind);
    const count = await opened.db.count("landmarks");
    opened.db.close();
    return count;
  }
  async function getStateRecord(key: "signout_intent" | "failure"): Promise<unknown> {
    const opened = await openOfflineStateDatabase();
    if (opened.kind !== "open") throw new Error(opened.kind);
    const value: unknown = await opened.db.get("state", key);
    opened.db.close();
    return value;
  }

  it("blocks synchronously, removes the valid marker, then cleans the invalidated records", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker());
    await putData("landmarks", residualLandmark());
    const tab = createOfflineTestTab(world);
    const other = createOfflineTestTab(world);
    const result = await endAs(tab);
    expect(result).toMatchObject({
      marker: "removed",
      cleanup: { kind: "cleaned", mode: "residual", after: "none" },
    });
    expect(tab.generation.isBlocked()).toBe(true);
    expect(await readMarker()).toBeUndefined();
    expect(await countLandmarks()).toBe(0);
    expect(await getStateRecord("failure")).toBeUndefined();
    await flush();
    expect(other.received[0]).toBe("lifecycle-ended");
  });

  it("with nothing stored, reports an absent marker and changes nothing", async () => {
    world = createOfflineTestWorld();
    const result = await endAs(createOfflineTestTab(world));
    expect(result).toMatchObject({
      marker: "absent",
      cleanup: { kind: "refused", reason: "none" },
    });
    expect(world.storage.length).toBe(0);
  });

  it("a marker-removal failure establishes durable failure evidence and skips cleanup", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker());
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const tab = createOfflineTestTab(world, { openData: failing.opener });
    const result = await endAs(tab);
    expect(result).toMatchObject({
      marker: { kind: "remove-failed", escalation: { failureRecord: "written" } },
      cleanup: "not-attempted",
    });
    expect(await getStateRecord("failure")).toMatchObject({ kind: "cleanup" });
    expect(tab.generation.isBlocked()).toBe(true);
  });

  it("leaves a malformed marker in place (no implicit discard) and skips cleanup", async () => {
    world = createOfflineTestWorld();
    const malformed = { ...oldMarker(), lifecycle_id: "x" };
    await putData("meta", malformed);
    const result = await endAs(createOfflineTestTab(world));
    expect(result).toMatchObject({ marker: "not-removed-unreadable", cleanup: "not-attempted" });
    expect(await readMarker()).toEqual(malformed);
  });

  it("never touches a sign-out intent or D22", async () => {
    world = createOfflineTestWorld();
    await putData("meta", oldMarker());
    await putState(intent);
    world.storage.setItem(SAFETY_LOCK_KEY, "true");
    const result = await endAs(createOfflineTestTab(world));
    expect(result.marker).toBe("removed");
    expect(await getStateRecord("signout_intent")).toEqual(intent);
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
  });

  it("requires a live auth ticket", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    let expired: AuthTicket | undefined;
    await runAuthOperation(tab, (ticket) => {
      expired = ticket;
    });
    await expect(endLifecycleWithoutSession(expired!, tab)).rejects.toMatchObject({
      name: "OwnershipError",
    });
    expect(tab.generation.isBlocked()).toBe(false);
  });
});
