import { afterEach, describe, expect, it, vi } from "vitest";
import { openOfflineDataDatabase, openOfflineStateDatabase } from "./db";
import { cleanupAll } from "./cleanup";
import { confirmIdentity, releaseLocalBlock } from "./lifecycle";
import { AUTH_LOCK, createLockCoordinator, SECURITY_LOCK } from "./locks";
import { SAFETY_LOCK_KEY } from "./safetyLock";
import { runAuthOperation, type AuthTicket, type SecurityDeps } from "./securityState";
import {
  beginConfirmingRequest,
  beginSignOut,
  completeServerSignOut,
  planQueuedSignOut,
  readIntentUnderAuth,
  type ConfirmingRequest,
  type ServerOutcome,
} from "./signOutIntent";
import {
  createClock,
  createOfflineTestTab,
  createOfflineTestWorld,
  deferred,
  flush,
  gateOpen,
  injectTransactionFailures,
  staleGet,
  type OfflineTestWorld,
} from "./testSupport";

/**
 * M06-T03 Increment 3b-ii — durable sign-out intent (Option B) and the
 * approved authentication interleavings, exercised through SYNTHETIC
 * authentication operations (tickets from `runAuthOperation`, deferred
 * "server" steps, supplied outcomes). No AuthProvider, cookie, Better Auth
 * session, or network is involved; those interleavings are verified in 3c.
 */

const ACCOUNT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT_B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const LIFECYCLE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LANDMARK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T0 = "2026-11-25T09:00:00.000Z";
const SAME_MS = "2026-11-26T12:00:00.000Z";

const marker = (account = ACCOUNT_A) => ({
  key: "marker",
  schema_version: 1,
  account_id: account,
  lifecycle_id: LIFECYCLE,
  verified_at: T0,
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
async function getState(key: string): Promise<unknown> {
  const opened = await openOfflineStateDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  const value: unknown = await opened.db.get("state", key);
  opened.db.close();
  return value;
}
async function putState(value: unknown) {
  const opened = await openOfflineStateDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  await opened.db.put("state", value);
  opened.db.close();
}
async function readMarker(): Promise<unknown> {
  const opened = await openOfflineDataDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  const value: unknown = await opened.db.get("meta", "marker");
  opened.db.close();
  return value;
}
const intentToken = async () =>
  ((await getState("signout_intent")) as { created_at?: string } | undefined)?.created_at;

let world: OfflineTestWorld;
let serverRequests = 0;

afterEach(() => {
  vi.unstubAllGlobals();
  serverRequests = 0;
});

/**
 * The synthetic server step of a sign-out that recorded or joined `token`:
 * re-read under tnle-auth, suppress duplicates, begin the request BEFORE
 * "sending", hold no security lock while it is in flight, then complete.
 */
async function serverSignOut(
  tab: SecurityDeps,
  token: string,
  options: { outcome?: ServerOutcome; inFlight?: () => Promise<void> } = {},
) {
  const result = await runAuthOperation(tab, async (ticket) => {
    const read = await readIntentUnderAuth(ticket, tab);
    const plan = planQueuedSignOut(token, read);
    if (plan.action !== "send") return { plan: plan.action };
    const request = beginConfirmingRequest(plan.observation);
    serverRequests += 1;
    await options.inFlight?.();
    const completion = await completeServerSignOut(
      request,
      options.outcome ?? "server-confirmed",
      tab,
    );
    return { plan: plan.action, completion: completion.kind };
  });
  if (result.kind !== "done") throw new Error(result.kind);
  return result.value;
}

function tokenOf(result: Awaited<ReturnType<typeof beginSignOut>>): string {
  if (result.intent.status !== "recorded" && result.intent.status !== "joined") {
    throw new Error(result.intent.status);
  }
  return result.intent.token;
}

describe("beginSignOut — ordinary intent-first sequence", () => {
  it("blocks synchronously, records intent, then removes the marker, holding only the exclusive security lock", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    const tab = createOfflineTestTab(world);
    const other = createOfflineTestTab(world);
    const gate = gateOpen(() => openOfflineStateDatabase());
    const signingOut = createOfflineTestTab(world, { openState: gate.opener });
    const pending = beginSignOut(signingOut);
    expect(signingOut.generation.isBlocked()).toBe(true); // before any await
    await gate.reached;
    expect(world.locks.snapshot().held).toEqual([{ name: SECURITY_LOCK, mode: "exclusive" }]);
    expect(await readMarker()).toEqual(marker()); // intent not yet durable: marker untouched
    gate.release();
    const result = await pending;
    expect(result).toEqual({
      blockToken: 1,
      path: "ordinary",
      coordination: "acquired",
      intent: { status: "recorded", token: "2026-11-26T10:00:00.000Z" },
      escalation: null,
      marker: "removed",
      durable: { intent: true, safetyLock: false, markerInvalidated: true },
    });
    expect(await getState("signout_intent")).toEqual({
      key: "signout_intent",
      schema_version: 1,
      pending: true,
      created_at: "2026-11-26T10:00:00.000Z",
    });
    expect(await readMarker()).toBeUndefined();
    expect(world.locks.snapshot()).toEqual({ held: [], pending: [] });
    await flush();
    expect(other.received).toEqual(["lifecycle-ended", "state-changed"]);
    expect(tab.received).toEqual(["lifecycle-ended", "state-changed"]);
    expect(world.storage.length).toBe(0); // no D22 on the ordinary path
  });

  it("Q21: a held security lock does not delay the advisory notice; nothing durable is written or reported while waiting", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    const reader = createOfflineTestTab(world);
    const hold = deferred();
    const held = reader.coordinator.withLock(
      { held: new Set() },
      SECURITY_LOCK,
      "shared",
      () => hold.promise,
    );
    await flush();
    const signingOut = createOfflineTestTab(world);
    let settled = false;
    const pending = beginSignOut(signingOut).then((result) => {
      settled = true;
      return result;
    });
    await flush();
    await flush();
    expect(signingOut.generation.isBlocked()).toBe(true);
    expect(reader.received).toEqual(["lifecycle-ended"]); // delivered while the lock is held
    expect(world.locks.snapshot().pending).toEqual([{ name: SECURITY_LOCK, mode: "exclusive" }]);
    expect(settled).toBe(false); // no intent outcome is reported while waiting
    expect(await getState("signout_intent")).toBeUndefined();
    expect(await readMarker()).toEqual(marker());
    hold.resolve();
    await held;
    const result = await pending;
    expect(result.intent.status).toBe("recorded");
    await flush();
    expect(reader.received).toEqual(["lifecycle-ended", "state-changed"]);
  });

  it("Q21: blocks synchronously, posts the advisory notice, then requests the security lock — in that order, in one turn", async () => {
    world = createOfflineTestWorld();
    const events: string[] = [];
    const base = createOfflineTestTab(world);
    const tab = createOfflineTestTab(world, {
      notices: {
        post: (type) => {
          events.push(`post:${type}:blocked=${String(base.generation.isBlocked())}`);
          return "sent";
        },
      },
      coordinator: createLockCoordinator(() => ({
        request: (name, options, callback) => {
          events.push(`request:${name}:${options.mode}`);
          return world.locks.request(name, options, callback);
        },
      })),
      generation: base.generation,
    });
    const pending = beginSignOut(tab);
    // Synchronously, before any await has resolved:
    const synchronous = [...events];
    await pending; // always settle, so a failure cannot leak into the next test's storage
    expect(synchronous).toEqual([
      "post:lifecycle-ended:blocked=true",
      `request:${SECURITY_LOCK}:exclusive`,
    ]);
    expect(events).toEqual([
      "post:lifecycle-ended:blocked=true",
      `request:${SECURITY_LOCK}:exclusive`,
      "post:state-changed:blocked=true",
    ]);
  });

  it("Q21: a failing or throwing notification never prevents durable protection", async () => {
    for (const post of [
      () => "failed" as const,
      () => {
        throw new Error("synthetic channel failure");
      },
    ]) {
      world = createOfflineTestWorld();
      await putData("meta", marker());
      const result = await beginSignOut(createOfflineTestTab(world, { notices: { post } }));
      expect(result).toMatchObject({
        path: "ordinary",
        intent: { status: "recorded" },
        marker: "removed",
        durable: { intent: true, markerInvalidated: true },
      });
      expect(await getState("signout_intent")).toBeDefined();
    }
  });

  it("Q21: a successful notice is not evidence of durable intent (intent write fails → exceptional path)", async () => {
    world = createOfflineTestWorld();
    const other = createOfflineTestTab(world);
    const failing = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      (call) => call.mode === "readwrite",
    );
    const result = await beginSignOut(createOfflineTestTab(world, { openState: failing.opener }));
    await flush();
    expect(other.received[0]).toBe("lifecycle-ended");
    expect(result.durable.intent).toBe(false);
    expect(await getState("signout_intent")).toBeUndefined();
  });

  it("a second sign-out joins the unresolved intent without replacing its identity", async () => {
    world = createOfflineTestWorld();
    const first = await beginSignOut(createOfflineTestTab(world));
    const second = await beginSignOut(
      createOfflineTestTab(world, { now: createClock("2026-11-26T11:00:00.000Z") }),
    );
    expect(first.intent).toEqual({ status: "recorded", token: "2026-11-26T10:00:00.000Z" });
    expect(second.intent).toEqual({ status: "joined", token: "2026-11-26T10:00:00.000Z" });
    expect(await intentToken()).toBe("2026-11-26T10:00:00.000Z");
  });

  it("concurrent same-millisecond initiations share one intent", async () => {
    world = createOfflineTestWorld();
    const results = await Promise.all([
      beginSignOut(createOfflineTestTab(world, { now: createClock(SAME_MS, 0) })),
      beginSignOut(createOfflineTestTab(world, { now: createClock(SAME_MS, 0) })),
    ]);
    expect(results.map((r) => r.intent.status).sort()).toEqual(["joined", "recorded"]);
    expect(results.map(tokenOf)).toEqual([SAME_MS, SAME_MS]);
    expect(await intentToken()).toBe(SAME_MS);
  });
});

describe("beginSignOut — failures and escalation", () => {
  it("failure between intent persistence and marker removal keeps the intent; the remaining marker never overrides it", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const result = await beginSignOut(createOfflineTestTab(world, { openData: failing.opener }));
    expect(result).toMatchObject({
      path: "ordinary",
      intent: { status: "recorded" },
      escalation: null,
      marker: "remove-failed",
      durable: { intent: true, safetyLock: false, markerInvalidated: false },
    });
    expect(await readMarker()).toEqual(marker());
    const tab = createOfflineTestTab(world);
    const confirmed = await runAuthOperation(tab, (t) => confirmIdentity(t, ACCOUNT_A, tab));
    expect(confirmed).toEqual({
      kind: "done",
      value: { kind: "refused", reason: "intent-pending" },
    });
  });

  it("failed intent persistence escalates to D22 inside the lock, still removes the marker, and never reports durable intent", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    const other = createOfflineTestTab(world);
    const failing = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      (call) => call.mode === "readwrite",
    );
    const result = await beginSignOut(createOfflineTestTab(world, { openState: failing.opener }));
    expect(result).toMatchObject({
      path: "exceptional",
      coordination: "acquired",
      intent: { status: "failed" },
      escalation: { durable: true },
      marker: "removed",
      durable: { intent: false, safetyLock: true, markerInvalidated: true },
    });
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
    expect(await getState("signout_intent")).toBeUndefined();
    await flush();
    expect(other.received).toEqual(["lifecycle-ended", "lock-set", "state-changed"]);
  });

  it("when intent and D22 both fail, the marker outcome is still reported truthfully", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    world.storage.failSet = true;
    const state = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      () => true,
    );
    const removed = await beginSignOut(createOfflineTestTab(world, { openState: state.opener }));
    expect(removed).toMatchObject({
      intent: { status: "failed" },
      escalation: { durable: false, reason: "write-failed" },
      marker: "removed",
      durable: { intent: false, safetyLock: false, markerInvalidated: true },
    });

    world = createOfflineTestWorld();
    await putData("meta", marker());
    world.storage.failSet = true;
    const data = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      () => true,
    );
    const nothing = await beginSignOut(
      createOfflineTestTab(world, {
        openState: () => Promise.resolve({ kind: "unavailable" }),
        openData: data.opener,
      }),
    );
    expect(nothing).toMatchObject({
      intent: { status: "failed" },
      escalation: { durable: false },
      marker: "remove-failed",
      durable: { intent: false, safetyLock: false, markerInvalidated: false },
    });
  });

  it("a malformed stored intent is never overwritten; D22 is escalated", async () => {
    world = createOfflineTestWorld();
    const malformed = { key: "signout_intent", schema_version: 1, pending: true, created_at: "x" };
    await putState(malformed);
    const result = await beginSignOut(createOfflineTestTab(world));
    expect(result).toMatchObject({
      path: "exceptional",
      intent: { status: "unreadable" },
      escalation: { durable: true },
    });
    expect(await getState("signout_intent")).toEqual(malformed);
  });

  it("without a usable security lock: emergency D22 outside the lock, no uncoordinated IndexedDB write", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    const other = createOfflineTestTab(world);
    const tab = createOfflineTestTab(world, {
      coordinator: createLockCoordinator(() => undefined),
    });
    const result = await beginSignOut(tab);
    await flush();
    expect(other.received).toEqual(["lifecycle-ended", "lock-set"]); // advisory notice still sent
    expect(result).toEqual({
      blockToken: 1,
      path: "exceptional",
      coordination: "unavailable",
      intent: { status: "not-attempted" },
      escalation: { durable: true },
      marker: "not-attempted",
      durable: { intent: false, safetyLock: true, markerInvalidated: false },
    });
    expect(tab.generation.isBlocked()).toBe(true);
    expect(await readMarker()).toEqual(marker());
    expect(await getState("signout_intent")).toBeUndefined();
  });
});

describe("server step under tnle-auth (synthetic outcomes)", () => {
  it("clears only the intent on confirmation; D22, failure evidence, and residual records remain; no security lock during the request", async () => {
    world = createOfflineTestWorld();
    await putData("landmarks", {
      schema_version: 1,
      account_id: ACCOUNT_A,
      lifecycle_id: LIFECYCLE,
      revision: 1,
      landmark_id: LANDMARK,
      status: "unavailable",
      saved_at: T0,
      unavailable_recorded_at: T0,
    });
    await putState({ key: "failure", schema_version: 1, kind: "cleanup", recorded_at: T0 });
    world.storage.setItem(SAFETY_LOCK_KEY, "true");
    const tab = createOfflineTestTab(world);
    const token = tokenOf(await beginSignOut(tab));
    let heldDuringRequest: unknown;
    const step = await serverSignOut(tab, token, {
      inFlight: async () => {
        heldDuringRequest = world.locks.snapshot().held;
      },
    });
    expect(heldDuringRequest).toEqual([{ name: AUTH_LOCK, mode: "exclusive" }]);
    expect(step).toEqual({ plan: "send", completion: "cleared" });
    expect(await getState("signout_intent")).toBeUndefined();
    expect(await getState("failure")).toBeDefined();
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
    const residual = await openOfflineDataDatabase();
    if (residual.kind !== "open") throw new Error(residual.kind);
    expect(await residual.db.count("landmarks")).toBe(1);
    residual.db.close();
  });

  it("an unconfirmed server outcome preserves the intent", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    const token = tokenOf(await beginSignOut(tab));
    expect(await serverSignOut(tab, token, { outcome: "not-confirmed" })).toEqual({
      plan: "send",
      completion: "not-confirmed",
    });
    expect(await intentToken()).toBe(token);
  });

  it("reads the intent under a nested SHARED security lock and requires a live ticket", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    await beginSignOut(tab);
    const gate = gateOpen(() => openOfflineStateDatabase());
    const reading = createOfflineTestTab(world, { openState: gate.opener });
    let expired: AuthTicket | undefined;
    const pending = runAuthOperation(reading, (ticket) => {
      expired = ticket;
      return readIntentUnderAuth(ticket, reading);
    });
    await gate.reached;
    expect(world.locks.snapshot().held).toEqual([
      { name: AUTH_LOCK, mode: "exclusive" },
      { name: SECURITY_LOCK, mode: "shared" },
    ]);
    gate.release();
    expect((await pending).kind).toBe("done");
    await expect(readIntentUnderAuth(expired!, tab)).rejects.toMatchObject({
      reason: "requires-auth",
    });
  });

  it("rejects forged, reused, or expired request handles without clearing anything", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    const token = tokenOf(await beginSignOut(tab));
    let kept: ConfirmingRequest | undefined;
    await runAuthOperation(tab, async (ticket) => {
      const read = await readIntentUnderAuth(ticket, tab);
      if (read.status !== "pending") throw new Error(read.status);
      const forged = { observation: read.observation } as ConfirmingRequest;
      await expect(completeServerSignOut(forged, "server-confirmed", tab)).rejects.toMatchObject({
        reason: "handle-invalid",
      });
      kept = beginConfirmingRequest(read.observation);
      expect(() => beginConfirmingRequest(read.observation)).toThrow(); // one request per observation
    });
    await expect(completeServerSignOut(kept!, "server-confirmed", tab)).rejects.toMatchObject({
      reason: "requires-auth",
    });
    expect(await intentToken()).toBe(token);
  });
});

describe("authentication interleavings (synthetic operations)", () => {
  it("Case 1 — a sign-in completing after intent persistence publishes nothing and creates no lifecycle; the queued sign-out then runs", async () => {
    world = createOfflineTestWorld();
    const tabA = createOfflineTestTab(world);
    const tabB = createOfflineTestTab(world);
    const response = deferred();
    const signIn = runAuthOperation(tabA, async (ticket) => {
      await response.promise; // sign-in request in flight under tnle-auth
      return confirmIdentity(ticket, ACCOUNT_A, tabA); // the post-check
    });
    await flush();
    const begun = await beginSignOut(tabB); // does not wait for tnle-auth
    expect(begun.intent.status).toBe("recorded");
    const queued = serverSignOut(tabB, tokenOf(begun));
    await flush();
    expect(serverRequests).toBe(0); // the server sign-out waits behind the sign-in
    response.resolve();
    expect(await signIn).toEqual({
      kind: "done",
      value: { kind: "refused", reason: "intent-pending" },
    });
    expect(await readMarker()).toBeUndefined();
    expect(await queued).toEqual({ plan: "send", completion: "cleared" });
    expect(serverRequests).toBe(1);
  });

  it("Case 2 — a session check begun before the intent cannot publish, and its stale no-session result cannot confirm the intent", async () => {
    world = createOfflineTestWorld();
    const tabA = createOfflineTestTab(world);
    const tabB = createOfflineTestTab(world);
    const response = deferred();
    const check = runAuthOperation(tabA, async (ticket) => {
      const before = await readIntentUnderAuth(ticket, tabA);
      await response.promise; // get-session in flight
      // A no-session response: only an observation made BEFORE sending could confirm.
      const after = await readIntentUnderAuth(ticket, tabA);
      return { before: before.status, after: after.status };
    });
    await flush();
    const begun = await beginSignOut(tabB);
    response.resolve();
    expect(await check).toEqual({ kind: "done", value: { before: "none", after: "pending" } });
    expect(await intentToken()).toBe(tokenOf(begun)); // not confirmed by the stale result
    expect(await serverSignOut(tabB, tokenOf(begun))).toEqual({
      plan: "send",
      completion: "cleared",
    });
  });

  it("Case 3 — a different account while the intent is pending gets no lifecycle, and the intent is kept", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker(ACCOUNT_A));
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const begun = await beginSignOut(createOfflineTestTab(world, { openData: failing.opener }));
    expect(begun.marker).toBe("remove-failed"); // A's marker survived
    const tab = createOfflineTestTab(world);
    const first = await runAuthOperation(tab, (t) => confirmIdentity(t, ACCOUNT_B, tab));
    expect(first).toEqual({
      kind: "done",
      value: { kind: "account-switch", marker: "removed", replacement: "blocked" },
    });
    const second = await runAuthOperation(tab, (t) => confirmIdentity(t, ACCOUNT_B, tab));
    expect(second).toEqual({ kind: "done", value: { kind: "refused", reason: "intent-pending" } });
    expect(await readMarker()).toBeUndefined();
    expect(await intentToken()).toBe(tokenOf(begun));
  });

  it("Case 4 — concurrent sign-outs share one intent and send one server request", async () => {
    world = createOfflineTestWorld();
    const tabA = createOfflineTestTab(world);
    const tabB = createOfflineTestTab(world);
    const [a, b] = await Promise.all([beginSignOut(tabA), beginSignOut(tabB)]);
    expect(tokenOf(a)).toBe(tokenOf(b));
    const results = await Promise.all([
      serverSignOut(tabA, tokenOf(a)),
      serverSignOut(tabB, tokenOf(b)),
    ]);
    expect(results).toEqual([{ plan: "send", completion: "cleared" }, { plan: "resolved" }]);
    expect(serverRequests).toBe(1);
  });

  it("an obsolete sign-out never clears a newer intent", async () => {
    world = createOfflineTestWorld();
    const tabA = createOfflineTestTab(world);
    const tabB = createOfflineTestTab(world);
    const old = tokenOf(await beginSignOut(tabA));
    await beginSignOut(tabB); // joins `old`
    expect(await serverSignOut(tabA, old)).toEqual({ plan: "send", completion: "cleared" });
    const newer = tokenOf(
      await beginSignOut(
        createOfflineTestTab(world, { now: createClock("2026-11-26T11:00:00.000Z") }),
      ),
    );
    expect(newer).not.toBe(old);
    expect(await serverSignOut(tabB, old)).toEqual({ plan: "resolved" });
    expect(await intentToken()).toBe(newer);
    expect(serverRequests).toBe(1);
  });

  it("same-millisecond clear-and-recreate: identity collisions do not let an obsolete completion clear the replacement unserved", async () => {
    world = createOfflineTestWorld();
    const fixed = () => createClock(SAME_MS, 0);
    const tabA = createOfflineTestTab(world, { now: fixed() });
    const tabB = createOfflineTestTab(world, { now: fixed() });
    const tabC = createOfflineTestTab(world, { now: fixed() });
    const first = tokenOf(await beginSignOut(tabA));
    await beginSignOut(tabB); // joins
    let staleRequest: ConfirmingRequest | undefined;
    await runAuthOperation(tabA, async (ticket) => {
      const read = await readIntentUnderAuth(ticket, tabA);
      if (read.status !== "pending") throw new Error(read.status);
      staleRequest = beginConfirmingRequest(read.observation);
      serverRequests += 1;
      expect((await completeServerSignOut(staleRequest, "server-confirmed", tabA)).kind).toBe(
        "cleared",
      );
    });
    const replacement = tokenOf(await beginSignOut(tabC)); // a NEW intent, same millisecond
    expect(replacement).toBe(first);
    // The obsolete completion cannot be replayed against the replacement.
    await expect(completeServerSignOut(staleRequest!, "server-confirmed", tabA)).rejects.toThrow();
    expect(await intentToken()).toBe(replacement);
    // B's equal token makes it SEND: its request starts after the replacement
    // exists, which is exactly what the replacement requires.
    expect(await serverSignOut(tabB, first)).toEqual({ plan: "send", completion: "cleared" });
    expect(await serverSignOut(tabC, replacement)).toEqual({ plan: "resolved" });
    expect(serverRequests).toBe(2);
  });

  it("defense in depth (outside the protocol): a stored intent replaced by a non-cooperating writer is preserved, not cleared", async () => {
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    const token = tokenOf(await beginSignOut(tab));
    const step = await serverSignOut(tab, token, {
      inFlight: () =>
        // Not possible through this module's API: a raw write that bypasses the locks.
        putState({
          key: "signout_intent",
          schema_version: 1,
          pending: true,
          created_at: "2026-11-26T13:00:00.000Z",
        }),
    });
    expect(step).toEqual({ plan: "send", completion: "newer-intent-preserved" });
    expect(await intentToken()).toBe("2026-11-26T13:00:00.000Z");
  });

  it("Case 5 — Sign in again: a sign-out after step 1's clear blocks the credential completion; one before it is satisfied by step 1", async () => {
    world = createOfflineTestWorld();
    const recovering = createOfflineTestTab(world);
    const other = createOfflineTestTab(world, { now: createClock("2026-11-26T11:00:00.000Z") });
    const original = tokenOf(await beginSignOut(createOfflineTestTab(world)));
    const credentials = deferred();
    const step1Done = deferred();
    const signInAgain = runAuthOperation(recovering, async (ticket) => {
      const read = await readIntentUnderAuth(ticket, recovering);
      if (read.status !== "pending") throw new Error(read.status);
      const request = beginConfirmingRequest(read.observation);
      serverRequests += 1;
      const step1 = await completeServerSignOut(request, "server-confirmed", recovering);
      step1Done.resolve();
      await credentials.promise; // step 2: credentials in flight
      return { step1: step1.kind, step2: await confirmIdentity(ticket, ACCOUNT_A, recovering) };
    });
    await step1Done.promise;
    const later = await beginSignOut(other); // after step 1 cleared `original`
    expect(tokenOf(later)).not.toBe(original);
    credentials.resolve();
    expect(await signInAgain).toEqual({
      kind: "done",
      value: { step1: "cleared", step2: { kind: "refused", reason: "intent-pending" } },
    });
    expect(await readMarker()).toBeUndefined();

    // Variant: the other tab joins BEFORE step 1 clears; step 1 satisfies it.
    world = createOfflineTestWorld();
    const tab = createOfflineTestTab(world);
    const joiner = createOfflineTestTab(world);
    const begun = await beginSignOut(tab);
    const joined = await beginSignOut(joiner);
    const result = await runAuthOperation(tab, async (ticket) => {
      const read = await readIntentUnderAuth(ticket, tab);
      if (read.status !== "pending") throw new Error(read.status);
      const request = beginConfirmingRequest(read.observation);
      const step1 = await completeServerSignOut(request, "server-confirmed", tab);
      const release = await releaseLocalBlock(begun.blockToken, tab);
      return { step1: step1.kind, release: release.kind };
    });
    expect(result).toEqual({ kind: "done", value: { step1: "cleared", release: "released" } });
    const recreated = await runAuthOperation(tab, (t) => confirmIdentity(t, ACCOUNT_A, tab));
    expect(recreated).toMatchObject({ kind: "done", value: { kind: "created" } });
    expect(await serverSignOut(joiner, tokenOf(joined))).toEqual({ plan: "resolved" });
  });
});

describe("Q25 — intent completion never leaves a terminated lifecycle reusable (3b-iii-b)", () => {
  /** A sign-out whose marker removal failed: the intent is recorded, the marker survives. */
  async function signOutWithSurvivingMarker(withRecords = false) {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    if (withRecords) {
      await putData("landmarks", {
        schema_version: 1,
        account_id: ACCOUNT_A,
        lifecycle_id: LIFECYCLE,
        revision: 1,
        landmark_id: LANDMARK,
        status: "unavailable",
        saved_at: T0,
        unavailable_recorded_at: T0,
      });
    }
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const begun = await beginSignOut(createOfflineTestTab(world, { openData: failing.opener }));
    expect(begun.marker).toBe("remove-failed");
    expect(await readMarker()).toEqual(marker());
    return tokenOf(begun);
  }

  /** The server step returning the full completion result. */
  async function complete(tab: SecurityDeps, token: string) {
    const result = await runAuthOperation(tab, async (ticket) => {
      const read = await readIntentUnderAuth(ticket, tab);
      const plan = planQueuedSignOut(token, read);
      if (plan.action !== "send") throw new Error(plan.action);
      const request = beginConfirmingRequest(plan.observation);
      return completeServerSignOut(request, "server-confirmed", tab);
    });
    if (result.kind !== "done") throw new Error(result.kind);
    return result.value;
  }

  it("removes and verifies the surviving marker before clearing; another tab gets a NEW lifecycle, never the terminated one", async () => {
    const token = await signOutWithSurvivingMarker();
    const tab = createOfflineTestTab(world);
    const completion = await complete(tab, token);
    // Durable state and lifecycle eligibility first: the terminated lifecycle is never reused.
    const other = createOfflineTestTab(world);
    const confirmed = await runAuthOperation(other, (t) => confirmIdentity(t, ACCOUNT_A, other));
    if (confirmed.kind !== "done") throw new Error(confirmed.kind);
    expect(confirmed.value).not.toEqual({ kind: "reused", lifecycleId: LIFECYCLE });
    expect(confirmed.value.kind).toBe("created");
    expect(await getState("signout_intent")).toBeUndefined();
    // Then the reported outcome.
    expect(completion).toEqual({ kind: "cleared", marker: "removed" });
  });

  it("marker removal and its verification precede intent clearing", async () => {
    const token = await signOutWithSurvivingMarker();
    // State-database opens: 1 = readIntentUnderAuth, 2 = ownership read, 3 = clearing.
    const gate = gateOpen(() => openOfflineStateDatabase(), 3);
    const tab = createOfflineTestTab(world, { openState: gate.opener });
    const pending = complete(tab, token);
    await gate.reached;
    try {
      expect(await readMarker()).toBeUndefined(); // already removed and verified
      expect(await intentToken()).toBe(token); // not yet cleared
    } finally {
      gate.release();
    }
    expect(await pending).toEqual({ kind: "cleared", marker: "removed" });
  });

  it("marker-removal failure during completion retains the intent; the old lifecycle stays unusable", async () => {
    const token = await signOutWithSurvivingMarker();
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const tab = createOfflineTestTab(world, { openData: failing.opener });
    expect(await complete(tab, token)).toEqual({
      kind: "marker-remove-failed",
      serverConfirmed: true,
    });
    expect(await intentToken()).toBe(token);
    expect(await readMarker()).toEqual(marker());
    const other = createOfflineTestTab(world);
    const confirmed = await runAuthOperation(other, (t) => confirmIdentity(t, ACCOUNT_A, other));
    expect(confirmed).toEqual({
      kind: "done",
      value: { kind: "refused", reason: "intent-pending" },
    });
  });

  it("a failed marker-removal verification (stale read-back) retains the intent", async () => {
    const token = await signOutWithSurvivingMarker();
    const tab = createOfflineTestTab(world, {
      openData: staleGet(() => openOfflineDataDatabase(), "meta", "marker", marker()),
    });
    expect((await complete(tab, token)).kind).toBe("marker-remove-failed");
    expect(await intentToken()).toBe(token);
  });

  it("an intent-clearing failure after marker removal reports both truthfully and keeps the intent", async () => {
    const token = await signOutWithSurvivingMarker();
    const failing = injectTransactionFailures(
      () => openOfflineStateDatabase(),
      (call) => call.mode === "readwrite",
    );
    const tab = createOfflineTestTab(world, { openState: failing.opener });
    expect(await complete(tab, token)).toEqual({ kind: "clear-failed", marker: "removed" });
    expect(await readMarker()).toBeUndefined();
    expect(await intentToken()).toBe(token);
  });

  it("residual records keep blocking replacement after completion; explicit cleanup then permits a new lifecycle", async () => {
    const token = await signOutWithSurvivingMarker(true);
    const tab = createOfflineTestTab(world);
    expect((await complete(tab, token)).kind).toBe("cleared");
    const blocked = await runAuthOperation(tab, (t) => confirmIdentity(t, ACCOUNT_A, tab));
    expect(blocked).toEqual({ kind: "done", value: { kind: "refused", reason: "residual" } });
    expect((await cleanupAll(tab)).kind).toBe("cleaned");
    const created = await runAuthOperation(tab, (t) => confirmIdentity(t, ACCOUNT_A, tab));
    expect(created).toMatchObject({ kind: "done", value: { kind: "created" } });
  });

  it("after marker-remove-failed, ordinary cleanup removes the terminated marker and a later completion clears", async () => {
    const token = await signOutWithSurvivingMarker();
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    expect(
      (await complete(createOfflineTestTab(world, { openData: failing.opener }), token)).kind,
    ).toBe("marker-remove-failed");
    const tab = createOfflineTestTab(world);
    expect(await cleanupAll(tab)).toMatchObject({ kind: "cleaned", mode: "ordinary-full" });
    expect(await intentToken()).toBe(token); // cleanup never clears the intent
    expect(await complete(tab, token)).toEqual({ kind: "cleared", marker: "absent" });
  });

  it("an obsolete completion is rejected before touching the data database", async () => {
    const token = await signOutWithSurvivingMarker();
    const openData = vi.fn(() => openOfflineDataDatabase());
    const tab = createOfflineTestTab(world, { openData });
    let kept: ConfirmingRequest | undefined;
    await runAuthOperation(tab, async (ticket) => {
      const read = await readIntentUnderAuth(ticket, tab);
      if (read.status !== "pending") throw new Error(read.status);
      kept = beginConfirmingRequest(read.observation);
    });
    openData.mockClear();
    await expect(completeServerSignOut(kept!, "server-confirmed", tab)).rejects.toMatchObject({
      reason: "requires-auth",
    });
    expect(openData).not.toHaveBeenCalled();
    expect(await readMarker()).toEqual(marker());
    expect(await intentToken()).toBe(token);
  });
});

describe("c2a — establishIntent validation-refusal (transaction-abort) branch", () => {
  // An injected clock returning an invalid timestamp makes the freshly built intent fail
  // its own validator. This is exceptional-path robustness evidence, not an ordinary
  // browser condition.
  const invalidClock = () => "not-a-timestamp";

  it("aborts and settles the transaction, persists no intent, escalates to D22, and still removes the marker", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    const other = createOfflineTestTab(world);
    const tab = createOfflineTestTab(world, { now: invalidClock });
    const result = await beginSignOut(tab);
    expect(result).toMatchObject({
      path: "exceptional",
      coordination: "acquired",
      intent: { status: "failed" },
      escalation: { durable: true },
      marker: "removed",
      durable: { intent: false, safetyLock: true, markerInvalidated: true },
    });
    expect(await getState("signout_intent")).toBeUndefined(); // nothing invalid persisted
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
    expect(await readMarker()).toBeUndefined();
    expect(tab.generation.isBlocked()).toBe(true);
    await flush();
    expect(other.received).toEqual(["lifecycle-ended", "lock-set", "state-changed"]);
    // The aborted transaction settled: the state database accepts a later valid intent.
    const later = await beginSignOut(createOfflineTestTab(world));
    expect(later.intent.status).toBe("recorded");
  });

  it("with D22 also failing, reports only the durable evidence actually established", async () => {
    world = createOfflineTestWorld();
    await putData("meta", marker());
    world.storage.failSet = true;
    const tab = createOfflineTestTab(world, { now: invalidClock });
    const result = await beginSignOut(tab);
    expect(result).toMatchObject({
      path: "exceptional",
      intent: { status: "failed" },
      escalation: { durable: false, reason: "write-failed" },
      marker: "removed",
      durable: { intent: false, safetyLock: false, markerInvalidated: true },
    });
    expect(await getState("signout_intent")).toBeUndefined();
    expect(tab.generation.isBlocked()).toBe(true);
  });
});
