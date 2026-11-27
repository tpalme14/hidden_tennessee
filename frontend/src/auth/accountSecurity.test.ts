import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser, SessionResponse } from "../api/auth";
import { ApiError } from "../api/client";
import {
  openOfflineDataDatabase,
  openOfflineStateDatabase,
  probeOfflineDataDatabase,
  probeOfflineStateDatabase,
} from "../offline/db";
import { SAFETY_LOCK_KEY } from "../offline/safetyLock";
import type { SecurityDeps } from "../offline/securityState";
import {
  createOfflineTestTab,
  createOfflineTestWorld,
  deferred,
  flush,
  injectTransactionFailures,
  openBlockingConnection,
  type OfflineTestWorld,
} from "../offline/testSupport";
import type { ProbeOutcome } from "../offline/capabilities";
import { createUpdateSafety, type UpdateSafety } from "../pwa/updateSafety";
import {
  createAccountSecurity,
  type AccountSecurity,
  type AuthApi,
  type SignInResult,
} from "./accountSecurity";

/**
 * M06-T03 Increment 3c-1a — the coordinated authentication operations.
 *
 * SYNTHETIC verification: a shared fake "browser profile" (fake-indexeddb,
 * the in-memory Web Locks manager, a Storage stand-in for D22, an in-memory
 * BroadcastChannel) and a stubbed authentication API whose single session
 * stands in for the shared cookie. These tests establish logic and ordering
 * only; real Web Locks, notice timing, and storage behavior across real tabs
 * are verified in 3c-1b.
 */

const USER_A: AuthUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "",
  email: "a@example.test",
  emailVerified: false,
  image: null,
  createdAt: "2026-11-18T12:00:00.000Z",
  updatedAt: "2026-11-18T12:00:00.000Z",
};
const USER_B: AuthUser = {
  ...USER_A,
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2",
  email: "b@x.test",
};
const OLD_LIFECYCLE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const LANDMARK = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const T0 = "2026-11-25T09:00:00.000Z";
const marker = (account = USER_A.id) => ({
  key: "marker",
  schema_version: 1,
  account_id: account,
  lifecycle_id: OLD_LIFECYCLE,
  verified_at: T0,
});
const residual = (account = USER_A.id) => ({
  schema_version: 1,
  account_id: account,
  lifecycle_id: OLD_LIFECYCLE,
  revision: 1,
  landmark_id: LANDMARK,
  status: "unavailable",
  saved_at: T0,
  unavailable_recorded_at: T0,
});
const intent = (createdAt = T0) => ({
  key: "signout_intent",
  schema_version: 1,
  pending: true,
  created_at: createdAt,
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
  await opened.db.put("state", value as never);
  opened.db.close();
}
async function readMarker(): Promise<Record<string, unknown> | undefined> {
  const opened = await openOfflineDataDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  const value = (await opened.db.get("meta", "marker")) as Record<string, unknown> | undefined;
  opened.db.close();
  return value;
}
async function readIntent(): Promise<unknown> {
  const opened = await openOfflineStateDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  const value: unknown = await opened.db.get("state", "signout_intent");
  opened.db.close();
  return value;
}
async function countLandmarks(): Promise<number> {
  const opened = await openOfflineDataDatabase();
  if (opened.kind !== "open") throw new Error(opened.kind);
  const count = await opened.db.count("landmarks");
  opened.db.close();
  return count;
}

/** The server's single session (the shared cookie) and a request log. */
interface Server {
  session: AuthUser | null;
  log: string[];
  api: { [K in keyof AuthApi]: ReturnType<typeof vi.fn<AuthApi[K]>> };
}
function createServer(): Server {
  const server: Server = {
    session: null,
    log: [],
    api: {
      getSession: vi.fn<AuthApi["getSession"]>(),
      signIn: vi.fn<AuthApi["signIn"]>(),
      signOut: vi.fn<AuthApi["signOut"]>(),
    },
  };
  server.api.getSession.mockImplementation(() => {
    server.log.push("get-session");
    const user = server.session;
    return Promise.resolve(
      user === null
        ? null
        : ({
            session: {
              id: "s",
              userId: user.id,
              expiresAt: T0,
              createdAt: T0,
              updatedAt: T0,
            },
            user,
          } satisfies SessionResponse),
    );
  });
  server.api.signIn.mockImplementation(() => {
    server.log.push("sign-in");
    server.session = USER_A;
    return Promise.resolve(USER_A);
  });
  server.api.signOut.mockImplementation(() => {
    server.log.push("sign-out");
    server.session = null;
    return Promise.resolve();
  });
  return server;
}

const networkError = () => new ApiError(0, "NETWORK_ERROR", "offline");
const malformed = () => new ApiError(200, "INVALID_RESPONSE", "Unexpected response.");

let world: OfflineTestWorld;
let server: Server;
let safety: UpdateSafety;

interface Tab {
  security: AccountSecurity;
  deps: SecurityDeps & { received: string[] };
}

function createTab(options: { locks?: ProbeOutcome; overrides?: Partial<SecurityDeps> } = {}): Tab {
  const deps = createOfflineTestTab(world, options.overrides);
  const security = createAccountSecurity({
    deps,
    channel: { open: () => "open", close: () => {} },
    inspection: {
      safetyLock: deps.safetyLock,
      probeData: () => probeOfflineDataDatabase(),
      probeState: () => probeOfflineStateDatabase(),
    },
    api: server.api,
    safety,
    probeLocks: () => Promise.resolve(options.locks ?? "operational"),
  });
  return { security, deps };
}

async function signedIn(result: Promise<SignInResult>) {
  const value = await result;
  if (value.kind !== "signed-in") throw new Error(JSON.stringify(value));
  return value;
}

beforeEach(() => {
  world = createOfflineTestWorld();
  server = createServer();
  safety = createUpdateSafety();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("startup and session checks", () => {
  it("an anonymous startup with nothing stored creates no offline database", async () => {
    const { security } = createTab();
    expect(await security.checkSession()).toEqual({
      kind: "done",
      state: { session: { status: "anonymous" }, restriction: null, offline: "none" },
      followUp: false,
    });
    expect(await world.factory.databases()).toEqual([]);
  });

  it("a signed-in startup creates the lifecycle; rechecks keep it (only verified_at changes)", async () => {
    server.session = USER_A;
    const { security } = createTab();
    const first = await security.checkSession();
    expect(first).toMatchObject({
      state: { session: { status: "authenticated", user: USER_A }, offline: "eligible" },
    });
    const created = await readMarker();
    expect(created).toMatchObject({ account_id: USER_A.id });
    // A "reload" is a new tab instance on the same profile.
    await createTab().security.checkSession();
    await security.checkSession();
    const after = await readMarker();
    expect(after?.lifecycle_id).toBe(created?.lifecycle_id);
    expect(after?.verified_at).not.toBe(created?.verified_at);
  });

  it("a validated no-session response invalidates the lifecycle and cleans its records (OFF-OUT-8)", async () => {
    await putData("meta", marker());
    await putData("landmarks", residual());
    const { security, deps } = createTab();
    expect(await security.checkSession()).toMatchObject({
      state: { session: { status: "anonymous" }, restriction: null },
    });
    expect(await readMarker()).toBeUndefined();
    expect(await countLandmarks()).toBe(0);
    expect(deps.generation.isBlocked()).toBe(true);
    expect(server.api.signOut).not.toHaveBeenCalled(); // no new server sign-out obligation
  });

  it.each([
    ["a network failure", networkError],
    ["a malformed body", malformed],
    ["a 5xx response", () => new ApiError(503, "SERVICE_UNAVAILABLE", "down")],
  ])("a failed check (%s) changes nothing", async (_label, error) => {
    await putData("meta", marker());
    server.api.getSession.mockRejectedValueOnce(error());
    const { security, deps } = createTab();
    expect(await security.checkSession()).toMatchObject({
      state: { session: { status: "unavailable" } },
    });
    expect(await readMarker()).toEqual(marker());
    expect(deps.generation.isBlocked()).toBe(false);
  });

  it("an account switch cleans the previous lifecycle first, then a follow-up check creates the new one", async () => {
    await putData("meta", marker(USER_A.id));
    await putData("landmarks", residual(USER_A.id));
    server.session = USER_B;
    const { security } = createTab();
    expect(await security.checkSession()).toMatchObject({
      state: { session: { status: "authenticated", user: USER_B }, offline: "locked" },
      followUp: true,
    });
    expect(await readMarker()).toBeUndefined();
    expect(await countLandmarks()).toBe(0);
    expect(await security.checkSession()).toMatchObject({ state: { offline: "eligible" } });
    expect(await readMarker()).toMatchObject({ account_id: USER_B.id });
  });

  it("a locally blocked tab (notice) is released only by a verified identity on a clean state", async () => {
    server.session = USER_A;
    const { security, deps } = createTab();
    await security.checkSession();
    security.blockLocally();
    expect(await security.checkSession()).toMatchObject({ state: { offline: "eligible" } });
    expect(deps.generation.isBlocked()).toBe(false);
  });

  it("a block that happens while a check is in flight is not released by that check's result", async () => {
    server.session = USER_A;
    const { security, deps } = createTab();
    await security.checkSession();
    const gate = deferred();
    server.api.getSession.mockImplementationOnce(async () => {
      await gate.promise;
      return {
        session: { id: "s", userId: USER_A.id, expiresAt: T0, createdAt: T0, updatedAt: T0 },
        user: USER_A,
      };
    });
    const pending = security.checkSession();
    await vi.waitFor(() => expect(server.api.getSession).toHaveBeenCalledTimes(2));
    security.blockLocally(); // a newer block (another tab's notice)
    gate.resolve();
    expect(await pending).toMatchObject({
      state: { session: { status: "authenticated" }, offline: "locked" },
    });
    expect(deps.generation.isBlocked()).toBe(true);
  });
});

describe("restrictions (U4) and non-restoration", () => {
  it("a pending intent keeps an authenticated response from restoring anything (AC-7)", async () => {
    await putData("meta", marker());
    await putState(intent());
    server.session = USER_A; // a still-valid cookie
    const { security } = createTab();
    expect(await security.checkSession()).toEqual({
      kind: "done",
      state: { session: { status: "anonymous" }, restriction: "sign-out-pending", offline: "none" },
      followUp: false,
    });
    expect(await readIntent()).toEqual(intent());
    expect(await readMarker()).toEqual(marker()); // not recreated or touched
  });

  it.each([
    ["D22 present", () => world.storage.setItem(SAFETY_LOCK_KEY, "true"), "safety-lock"],
    [
      "D22 unreadable",
      () => {
        world.storage.failGet = true;
      },
      "safety-lock-unreadable",
    ],
    [
      "an unreadable (malformed) intent",
      () => putState({ ...intent(), pending: "x" }),
      "state-unreadable",
    ],
  ])(
    "%s: an authenticated response is not restored (AC-33, U4)",
    async (_label, arrange, reason) => {
      await arrange();
      server.session = USER_A;
      const { security } = createTab();
      expect(await security.checkSession()).toMatchObject({
        state: { session: { status: "anonymous" }, restriction: reason, offline: "none" },
      });
      world.storage.failGet = false;
      expect(await readMarker()).toBeUndefined();
    },
  );

  it("an unavailable state database is never treated as an absent intent (U4)", async () => {
    server.session = USER_A;
    const { security } = createTab({
      overrides: { openState: () => Promise.resolve({ kind: "unavailable" }) },
    });
    // The non-creating probe finds nothing; the authoritative check then refuses.
    expect(await security.checkSession()).toMatchObject({
      state: { session: { status: "anonymous" }, restriction: "state-unreadable" },
    });
    expect(await security.signIn("a@example.test", "pw", false)).toMatchObject({
      kind: "refused",
      reason: "state-unreadable",
    });
    expect(server.api.signIn).not.toHaveBeenCalled();
  });

  const libraryOnly: [string, () => Promise<void> | void, () => Partial<SecurityDeps>][] = [
    [
      "a durable failure record",
      () => putState({ key: "failure", schema_version: 1, kind: "cleanup", recorded_at: T0 }),
      () => ({}),
    ],
    ["residual records", () => putData("landmarks", residual(USER_B.id)), () => ({})],
    [
      "an unwritable data database",
      () => undefined,
      () => ({
        openData: injectTransactionFailures(
          () => openOfflineDataDatabase(),
          (call) => call.mode === "readwrite",
        ).opener,
      }),
    ],
  ];
  it.each(libraryOnly)(
    "%s locks only the offline library: online access remains (U4)",
    async (_label, arrange, overrides) => {
      await arrange();
      server.session = USER_A;
      const { security } = createTab({ overrides: overrides() });
      expect(await security.checkSession()).toMatchObject({
        state: {
          session: { status: "authenticated", user: USER_A },
          restriction: null,
          offline: "locked",
        },
      });
    },
  );

  it("without usable Web Locks nothing is requested, probed, created, or changed (AC-36, U2)", async () => {
    await putState(intent());
    world.storage.setItem(SAFETY_LOCK_KEY, "true");
    server.session = USER_A;
    for (const locks of ["absent", "use-failed", "denied"] as const) {
      const { security } = createTab({ locks });
      expect(await security.checkSession()).toMatchObject({
        state: { session: { status: "anonymous" }, restriction: "coordination-unavailable" },
      });
      expect(await security.signIn("a@example.test", "pw", false)).toMatchObject({
        kind: "refused",
        reason: "coordination-unavailable",
      });
      expect(security.startSignOut()).toEqual({
        kind: "refused",
        reason: "coordination-unavailable",
      });
      expect(await security.finishSigningOut()).toEqual({
        kind: "refused",
        reason: "coordination-unavailable",
      });
    }
    expect(server.log).toEqual([]);
    expect(world.locks.requestCount).toBe(0);
    expect((await world.factory.databases()).map((d) => d.name)).toEqual(["tnle-offline-state"]);
    expect(await readIntent()).toEqual(intent());
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
  });
});

describe("U7 — confirmation by a coordinated session check", () => {
  it("a validated no-session response resolves the pending intent and the lifecycle's records", async () => {
    await putData("meta", marker());
    await putData("landmarks", residual());
    await putState(intent());
    const { security } = createTab();
    expect(await security.checkSession()).toMatchObject({
      state: { session: { status: "anonymous" }, restriction: null },
    });
    expect(await readIntent()).toBeUndefined();
    expect(await readMarker()).toBeUndefined();
    expect(await countLandmarks()).toBe(0);
  });

  it.each([
    ["a network failure", networkError],
    ["a malformed response", malformed],
  ])("%s is not confirmation: the intent stays pending (A3)", async (_label, error) => {
    await putState(intent());
    server.api.getSession.mockRejectedValueOnce(error());
    const { security } = createTab();
    expect(await security.checkSession()).toMatchObject({
      state: { session: { status: "anonymous" }, restriction: "sign-out-pending" },
    });
    expect(await readIntent()).toEqual(intent());
  });

  it("a newer intent recorded while the check was in flight is preserved (matching-intent check)", async () => {
    await putState(intent());
    server.api.getSession.mockImplementationOnce(async () => {
      await putState(intent("2026-11-26T12:00:00.000Z")); // resolved and re-recorded elsewhere
      return null;
    });
    const { security } = createTab();
    expect(await security.checkSession()).toMatchObject({
      state: { restriction: "sign-out-pending" },
    });
    expect(await readIntent()).toEqual(intent("2026-11-26T12:00:00.000Z"));
  });

  it("D22 is never cleared by a confirmation", async () => {
    await putState(intent());
    world.storage.setItem(SAFETY_LOCK_KEY, "true");
    const { security, deps } = createTab();
    const clear = vi.spyOn(deps.safetyLock, "clearAfterVerifiedRecovery");
    expect(await security.checkSession()).toMatchObject({ state: { restriction: "safety-lock" } });
    expect(await readIntent()).toBeUndefined(); // the intent itself was confirmed (U7)
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
    expect(clear).not.toHaveBeenCalled();
  });
});

describe("sign-in and Sign in again", () => {
  it("ordinary sign-in verifies the identity from the session response and creates the lifecycle", async () => {
    const { security } = createTab();
    const result = await signedIn(security.signIn("a@example.test", "pw", false));
    expect(result.state).toEqual({
      session: { status: "authenticated", user: USER_A },
      restriction: null,
      offline: "eligible",
    });
    expect(server.log).toEqual(["sign-in", "get-session"]);
    expect(await readMarker()).toMatchObject({ account_id: USER_A.id });
  });

  it("a rejected sign-in is reported as failed and creates nothing", async () => {
    const error = new ApiError(401, "INVALID_EMAIL_OR_PASSWORD", "nope");
    server.api.signIn.mockRejectedValueOnce(error);
    const { security } = createTab();
    expect(await security.signIn("a@example.test", "pw", false)).toEqual({ kind: "failed", error });
    expect(await readMarker()).toBeUndefined();
  });

  it.each([
    ["D22 present", () => world.storage.setItem(SAFETY_LOCK_KEY, "true"), "safety-lock"],
    [
      "D22 unreadable",
      () => {
        world.storage.failGet = true;
      },
      "safety-lock-unreadable",
    ],
    ["an unreadable intent", () => putState({ ...intent(), pending: "x" }), "state-unreadable"],
  ])(
    "%s: no credentials are sent, ordinary or Sign in again (U3, AC-35)",
    async (_label, arrange, reason) => {
      await arrange();
      const { security } = createTab();
      for (const again of [false, true]) {
        expect(await security.signIn("a@example.test", "pw", again)).toMatchObject({
          kind: "refused",
          reason,
        });
      }
      expect(server.log).toEqual([]);
    },
  );

  it("D22 set after the authoritative read but before sending: no credentials are sent", async () => {
    const { security, deps } = createTab();
    const read = deps.safetyLock.read.bind(deps.safetyLock);
    let calls = 0;
    vi.spyOn(deps.safetyLock, "read").mockImplementation(() => {
      calls += 1;
      if (calls === 2) world.storage.setItem(SAFETY_LOCK_KEY, "true");
      return read();
    });
    expect(await security.signIn("a@example.test", "pw", false)).toMatchObject({
      kind: "refused",
      reason: "safety-lock",
    });
    expect(server.log).toEqual([]);
  });

  it("a pending intent refuses ordinary sign-in: only Sign in again may proceed", async () => {
    await putState(intent());
    const { security } = createTab();
    expect(await security.signIn("a@example.test", "pw", false)).toMatchObject({
      kind: "refused",
      reason: "sign-out-pending",
    });
    expect(server.log).toEqual([]);
  });

  it.each([
    ["a network failure", networkError],
    ["a malformed sign-out response", malformed],
  ])(
    "Sign in again: %s sends no credentials and keeps the intent (AC-35, A3)",
    async (_label, error) => {
      await putState(intent());
      server.api.signOut.mockRejectedValueOnce(error());
      const { security } = createTab();
      expect(await security.signIn("a@example.test", "pw", true)).toMatchObject({
        kind: "refused",
        reason: "sign-out-not-confirmed",
        state: { restriction: "sign-out-pending" },
      });
      expect(server.api.signIn).not.toHaveBeenCalled();
      expect(await readIntent()).toEqual(intent());
    },
  );

  it("Sign in again confirms the sign-out first, then signs in and creates a NEW lifecycle (AC-8)", async () => {
    await putData("meta", marker());
    await putData("landmarks", residual());
    await putState(intent());
    server.session = USER_A;
    const { security } = createTab();
    const result = await signedIn(security.signIn("a@example.test", "pw", true));
    expect(server.log).toEqual(["sign-out", "sign-in", "get-session"]);
    expect(result.state.offline).toBe("eligible");
    expect(await readIntent()).toBeUndefined();
    expect((await readMarker())?.lifecycle_id).not.toBe(OLD_LIFECYCLE);
  });

  it("an application update holding the gate refuses sign-in before anything is sent", async () => {
    const gate = safety.tryAcquireGate();
    const { security } = createTab();
    expect(await security.signIn("a@example.test", "pw", false)).toEqual({
      kind: "refused",
      reason: "updating",
      state: null,
    });
    expect(server.log).toEqual([]);
    if (gate.kind === "acquired") gate.gate.release();
  });
});

describe("sign-out, Finish signing out, and update safety", () => {
  async function signedInTab() {
    server.session = USER_A;
    const tab = createTab();
    await tab.security.checkSession();
    return tab;
  }

  it("blocks synchronously, records the intent and cleans up before the server request, then confirms (OFF-OUT-1)", async () => {
    const { security, deps } = await signedInTab();
    await putData("landmarks", residual(String((await readMarker())?.account_id)));
    server.api.signOut.mockImplementationOnce(async () => {
      // At the server step: the intent is durable and the marker gone.
      expect(await readIntent()).toMatchObject({ pending: true });
      expect(await readMarker()).toBeUndefined();
      server.log.push("sign-out");
      server.session = null;
    });
    const started = security.startSignOut();
    expect(deps.generation.isBlocked()).toBe(true); // before any await
    if (started.kind !== "started") throw new Error(started.kind);
    expect(await started.done).toEqual({
      outcome: {
        server: "confirmed",
        intent: "resolved",
        cleanup: "completed",
        protection: "intent",
      },
      state: { session: { status: "anonymous" }, restriction: null, offline: "none" },
    });
    expect(await readIntent()).toBeUndefined();
    expect(server.log).toEqual(["get-session", "sign-out"]);
  });

  it.each([
    ["the server is unreachable", networkError],
    ["the response is malformed", malformed],
  ])(
    "when %s: signed out on this device, server not confirmed, intent pending, no automatic retry (AC-6, A3)",
    async (_label, error) => {
      const { security } = await signedInTab();
      server.api.signOut.mockRejectedValueOnce(error());
      const started = security.startSignOut();
      if (started.kind !== "started") throw new Error(started.kind);
      expect(await started.done).toEqual({
        outcome: {
          server: "not-confirmed",
          intent: "pending",
          cleanup: "completed",
          protection: "intent",
        },
        state: {
          session: { status: "anonymous" },
          restriction: "sign-out-pending",
          offline: "none",
        },
      });
      await flush();
      expect(server.api.signOut).toHaveBeenCalledTimes(1);
      // A "reload" with the cookie still valid restores nothing (AC-6, AC-7).
      expect(await createTab().security.checkSession()).toMatchObject({
        state: { session: { status: "anonymous" }, restriction: "sign-out-pending" },
      });
    },
  );

  it("Finish signing out clears the intent only after a validated confirmation (AC-8)", async () => {
    await putState(intent());
    server.session = USER_A;
    const { security } = createTab();
    server.api.signOut.mockRejectedValueOnce(networkError());
    expect(await security.finishSigningOut()).toMatchObject({
      outcome: { server: "not-confirmed", intent: "pending" },
      state: { restriction: "sign-out-pending" },
    });
    expect(await readIntent()).toEqual(intent());
    expect(await security.finishSigningOut()).toMatchObject({
      outcome: { server: "confirmed", intent: "resolved" },
      state: { restriction: null },
    });
    expect(await readIntent()).toBeUndefined();
  });

  it("Finish signing out with D22 sends the server sign-out but never clears D22 (U1)", async () => {
    world.storage.setItem(SAFETY_LOCK_KEY, "true");
    const { security, deps } = createTab();
    const clear = vi.spyOn(deps.safetyLock, "clearAfterVerifiedRecovery");
    expect(await security.finishSigningOut()).toMatchObject({
      outcome: { server: "confirmed", intent: "none" },
      state: { restriction: "safety-lock" },
    });
    expect(server.log).toEqual(["sign-out"]);
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
    expect(clear).not.toHaveBeenCalled();
  });

  it("DR-4: while an update holds the gate, sign-out is refused and nothing is initiated", async () => {
    const { security, deps } = await signedInTab();
    const gate = safety.tryAcquireGate();
    expect(gate.kind).toBe("acquired");
    expect(security.startSignOut()).toEqual({ kind: "refused", reason: "updating" });
    expect(deps.generation.isBlocked()).toBe(false);
    expect(await readIntent()).toBeUndefined();
    expect(await readMarker()).toBeDefined();
    expect(server.api.signOut).not.toHaveBeenCalled();
    if (gate.kind === "acquired") gate.gate.release();
  });

  it("DR-5: the operation hold covers sign-out, session checks, and sign-in through their durable steps", async () => {
    const { security } = await signedInTab();
    const gate = deferred();
    server.api.signOut.mockImplementationOnce(async () => {
      expect(safety.tryAcquireGate()).toEqual({ kind: "busy" });
      await gate.promise;
      server.session = null;
    });
    const started = security.startSignOut();
    if (started.kind !== "started") throw new Error(started.kind);
    await vi.waitFor(() => expect(server.api.signOut).toHaveBeenCalled());
    gate.resolve();
    await started.done;
    expect(safety.getSnapshot().operationHolds).toBe(0);

    server.api.getSession.mockImplementationOnce(() => {
      expect(safety.tryAcquireGate()).toEqual({ kind: "busy" });
      return Promise.resolve(null);
    });
    await security.checkSession();
    server.api.signIn.mockImplementationOnce(() => {
      expect(safety.tryAcquireGate()).toEqual({ kind: "busy" });
      return Promise.resolve(USER_A);
    });
    await security.signIn("a@example.test", "pw", false);
    expect(safety.getSnapshot().operationHolds).toBe(0);
    // A gate held before a check starts means the check is not started at all.
    const held = safety.tryAcquireGate();
    expect(await security.checkSession()).toEqual({ kind: "not-started" });
    if (held.kind === "acquired") held.gate.release();
  });

  it("AC-9: a sign-in in another tab waits until the in-flight sign-out has completed", async () => {
    const a = await signedInTab();
    const b = createTab();
    const release = deferred();
    server.api.signOut.mockImplementationOnce(async () => {
      server.log.push("sign-out");
      await release.promise;
      server.session = null;
    });
    const started = a.security.startSignOut();
    if (started.kind !== "started") throw new Error(started.kind);
    await vi.waitFor(() => expect(server.api.signOut).toHaveBeenCalled());
    const signingIn = b.security.signIn("a@example.test", "pw", false);
    await flush();
    expect(server.api.signIn).not.toHaveBeenCalled(); // serialized behind tnle-auth
    release.resolve();
    expect((await started.done).outcome.server).toBe("confirmed");
    const result = await signedIn(signingIn);
    expect(server.log.slice(-3)).toEqual(["sign-out", "sign-in", "get-session"]);
    // The delayed sign-out result did not alter the newer session.
    expect(result.state).toMatchObject({
      session: { status: "authenticated" },
      offline: "eligible",
    });
    expect(server.session).toEqual(USER_A);
  });
});

describe("3c-2 — storage status and recovery operations", () => {
  const failure = { key: "failure", schema_version: 1, kind: "cleanup", recorded_at: T0 };
  const savedCopy = (account = USER_A.id, lifecycle = OLD_LIFECYCLE) => ({
    schema_version: 1,
    account_id: account,
    lifecycle_id: lifecycle,
    revision: 1,
    landmark_id: LANDMARK,
    status: "unavailable",
    saved_at: T0,
    unavailable_recorded_at: T0,
  });
  async function readFailure(): Promise<unknown> {
    const opened = await openOfflineStateDatabase();
    if (opened.kind !== "open") throw new Error(opened.kind);
    const value: unknown = await opened.db.get("state", "failure");
    opened.db.close();
    return value;
  }

  const storageCases: [string, () => Promise<void> | undefined, string][] = [
    ["nothing stored", () => undefined, "clean"],
    [
      "residual records of an ended lifecycle",
      () => putData("landmarks", residual()),
      "cleanup-required",
    ],
    ["a durable failure record", () => putState(failure), "failure-recorded"],
    ["a malformed marker", () => putData("meta", { ...marker(), lifecycle_id: "x" }), "unreadable"],
    ["a current valid lifecycle", () => putData("meta", marker()), "clean"],
  ];
  it.each(storageCases)("inspectStorage: %s → %s", async (_label, arrange, expected) => {
    await arrange();
    expect(await createTab().security.inspectStorage()).toBe(expected);
  });

  it("inspectStorage creates no database for a visitor and reports unknown without Web Locks", async () => {
    expect(await createTab().security.inspectStorage()).toBe("clean");
    expect(await world.factory.databases()).toEqual([]);
    expect(await createTab({ locks: "absent" }).security.inspectStorage()).toBe("unknown");
  });

  it("Retry cleanup removes an ended lifecycle's records without any consent (mandatory)", async () => {
    await putData("landmarks", residual());
    expect(await createTab().security.retryCleanup()).toEqual({ kind: "cleaned" });
    expect(await countLandmarks()).toBe(0);
  });

  it("Retry cleanup while a sign-out is pending cleans the ended lifecycle and keeps the intent", async () => {
    await putData("landmarks", residual());
    await putState(intent());
    expect(await createTab().security.retryCleanup()).toEqual({ kind: "cleaned" });
    expect(await countLandmarks()).toBe(0);
    expect(await readIntent()).toEqual(intent());
  });

  it("a failed Retry cleanup is reported and leaves durable failure evidence", async () => {
    await putData("landmarks", residual());
    const failing = injectTransactionFailures(
      () => openOfflineDataDatabase(),
      (call) => call.mode === "readwrite",
    );
    const { security } = createTab({ overrides: { openData: failing.opener } });
    expect(await security.retryCleanup()).toEqual({ kind: "failed" });
    expect(await readFailure()).toMatchObject({ kind: "cleanup" });
  });

  it("Recover asks for consent before discarding saved copies; declining removes nothing (AC-40)", async () => {
    await putState(failure);
    await putData("landmarks", savedCopy(USER_B.id));
    const { security } = createTab();
    expect(await security.recoverStorage(false)).toEqual({ kind: "authorization-required" });
    expect(await countLandmarks()).toBe(1);
    expect(await readFailure()).toEqual(failure);
    // Explicit consent: everything removed and verified, then the record.
    expect(await security.recoverStorage(true)).toEqual({ kind: "recovered" });
    expect(await countLandmarks()).toBe(0);
    expect(await readFailure()).toBeUndefined();
  });

  const recoverRefusals: [string, () => Promise<void> | void, string][] = [
    ["a pending sign-out intent", () => putState(intent()), "intent-pending"],
    ["D22 present", () => world.storage.setItem(SAFETY_LOCK_KEY, "true"), "safety-lock-present"],
  ];
  it.each(recoverRefusals)(
    "Recover is refused with %s and changes nothing",
    async (_label, arrange, reason) => {
      await putState(failure);
      await arrange();
      expect(await createTab().security.recoverStorage(true)).toEqual({
        kind: "not-possible",
        reason,
      });
      expect(await readFailure()).toEqual(failure);
      expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe(
        reason === "safety-lock-present" ? "true" : null,
      );
    },
  );

  it("Delete all deletes saved copies and preserves the sign-out intent and D22 (AC-34)", async () => {
    await putData("landmarks", savedCopy());
    await putState(intent());
    world.storage.setItem(SAFETY_LOCK_KEY, "true");
    const { security, deps } = createTab();
    const clear = vi.spyOn(deps.safetyLock, "clearAfterVerifiedRecovery");
    expect(await security.deleteAllData()).toEqual({ kind: "deleted", failureRecord: "none" });
    expect(await countLandmarks()).toBe(0);
    expect(await readIntent()).toEqual(intent());
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
    expect(clear).not.toHaveBeenCalled();
  });

  it("R2: after Delete all, the failure record is recovered only after fresh verification", async () => {
    await putData("landmarks", savedCopy());
    await putState(failure);
    expect(await createTab().security.deleteAllData()).toEqual({
      kind: "deleted",
      failureRecord: "recovered",
    });
    expect(await readFailure()).toBeUndefined();
  });

  it.each(recoverRefusals)(
    "R2: with %s the failure record is kept and the reason reported",
    async (_label, arrange, reason) => {
      await putData("landmarks", savedCopy());
      await putState(failure);
      await arrange();
      expect(await createTab().security.deleteAllData()).toEqual({
        kind: "deleted",
        failureRecord: "retained",
        retainedReason: reason,
      });
      expect(await readFailure()).toEqual(failure);
    },
  );

  it("a deletion blocked by another open connection is reported as blocked, never complete, then completes (AC-4)", async () => {
    await putData("landmarks", savedCopy());
    const blocker = await openBlockingConnection(world.factory, "tnle-offline-data");
    const progress: string[] = [];
    let settled = false;
    const pending = createTab()
      .security.deleteAllData((step) => progress.push(step))
      .then((result) => {
        settled = true;
        return result;
      });
    await vi.waitFor(() => expect(progress).toContain("blocked"));
    await flush();
    expect(settled).toBe(false);
    blocker.close();
    expect(await pending).toEqual({ kind: "deleted", failureRecord: "none" });
    expect(progress).toEqual(["requested", "pending", "blocked"]);
  });

  it("an unreadable security state makes Delete all set D22 first; D22 is never cleared", async () => {
    await putData("landmarks", savedCopy());
    const { security } = createTab({
      overrides: { openState: () => Promise.resolve({ kind: "unavailable" }) },
    });
    expect(await security.deleteAllData()).toMatchObject({ kind: "deleted" });
    expect(await countLandmarks()).toBe(0);
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBe("true");
  });

  it("a malformed but readable intent is preserved by Delete all (its database is never deleted)", async () => {
    const malformed = { ...intent(), pending: "x" };
    await putState(malformed);
    await putData("landmarks", savedCopy());
    expect((await createTab().security.deleteAllData()).kind).toBe("deleted");
    expect(await readIntent()).toEqual(malformed);
    expect(world.storage.getItem(SAFETY_LOCK_KEY)).toBeNull();
  });

  it("recovery operations are refused while an update holds the gate, or without Web Locks", async () => {
    await putData("landmarks", residual());
    const held = safety.tryAcquireGate();
    const { security } = createTab();
    expect(await security.retryCleanup()).toEqual({ kind: "refused", reason: "updating" });
    expect(await security.recoverStorage(true)).toEqual({ kind: "refused", reason: "updating" });
    expect(await security.deleteAllData()).toEqual({ kind: "refused", reason: "updating" });
    if (held.kind === "acquired") held.gate.release();
    const noLocks = createTab({ locks: "absent" }).security;
    expect(await noLocks.deleteAllData()).toEqual({
      kind: "refused",
      reason: "coordination-unavailable",
    });
    expect(await countLandmarks()).toBe(1);
  });

  it("DR-5: a recovery operation holds the update gate off until it has finished", async () => {
    await putData("landmarks", residual());
    const reached = deferred();
    const { security } = createTab();
    const deleting = security.deleteAllData((step) => {
      if (step === "pending") reached.resolve();
    });
    await reached.promise;
    expect(safety.tryAcquireGate()).toEqual({ kind: "busy" });
    await deleting;
    expect(safety.getSnapshot().operationHolds).toBe(0);
  });

  const protections: [string, boolean, string][] = [
    ["the intent cannot be stored but D22 can", false, "safety-lock"],
    ["neither the intent nor D22 can be stored", true, "memory-only"],
  ];
  it.each(protections)(
    "sign-out discloses its actual durable protection when %s (AC-32)",
    async (_label, storageFails, expected) => {
      server.session = USER_A;
      const failingState = injectTransactionFailures(
        () => openOfflineStateDatabase(),
        (call) => call.mode === "readwrite",
      );
      const { security } = createTab({ overrides: { openState: failingState.opener } });
      await security.checkSession();
      if (storageFails) world.storage.failSet = true;
      const started = security.startSignOut();
      if (started.kind !== "started") throw new Error(started.kind);
      expect((await started.done).outcome.protection).toBe(expected);
    },
  );
});

describe("3d — snapshot integration (verified lifecycle, view clearing, 401)", () => {
  const L1 = "11111111-1111-4111-8111-111111111111";
  const profileBody = {
    id: L1,
    display_name: "Falls",
    category: "falls",
    latitude: 36.1,
    longitude: -84.1,
    source_description: null,
    source_access_label: null,
    source_url: null,
  };
  function snapTab() {
    const network = {
      fetchLandmark: vi.fn(() =>
        Promise.resolve({ kind: "available" as const, body: profileBody }),
      ),
      fetchTrip: vi.fn(),
    };
    const deps = createOfflineTestTab(world);
    const security = createAccountSecurity({
      deps,
      channel: { open: () => "open", close: () => {} },
      inspection: {
        safetyLock: deps.safetyLock,
        probeData: () => probeOfflineDataDatabase(),
        probeState: () => probeOfflineStateDatabase(),
      },
      api: server.api,
      safety,
      probeLocks: () => Promise.resolve("operational"),
      network,
      persist: () => Promise.resolve(true),
    });
    return { security, deps, network };
  }

  it("snapshot operations are available only for the tab's verified lifecycle", async () => {
    const { security } = snapTab();
    expect(await security.snapshots.saveLandmark(L1)).toEqual({
      kind: "not-eligible",
      reason: "no-identity",
    });
    server.session = USER_A;
    await security.checkSession();
    expect((await security.snapshots.saveLandmark(L1)).kind).toBe("saved");
  });

  it("a local block or a sign-out ends eligibility and withdraws published content at once", async () => {
    const { security } = snapTab();
    server.session = USER_A;
    await security.checkSession();
    await security.snapshots.saveLandmark(L1);
    expect(security.snapshots.view.getSnapshot().landmarks.size).toBe(1);
    security.blockLocally();
    expect(security.snapshots.view.getSnapshot().landmarks.size).toBe(0);
    expect(await security.snapshots.listLandmarks()).toEqual({
      kind: "not-eligible",
      reason: "no-identity",
    });
    await security.checkSession(); // the identity-bound release restores eligibility
    expect((await security.snapshots.listLandmarks()).kind).toBe("ok");
    const started = security.startSignOut();
    if (started.kind !== "started") throw new Error(started.kind);
    expect(security.snapshots.view.getSnapshot().landmarks.size).toBe(0); // synchronously
    await started.done;
    expect((await security.snapshots.listLandmarks()).kind).toBe("not-eligible");
  });

  it("a 401 notifies the session-check listener (AC-37)", async () => {
    const { security, network } = snapTab();
    server.session = USER_A;
    await security.checkSession();
    await security.snapshots.saveLandmark(L1);
    network.fetchLandmark.mockResolvedValueOnce({ kind: "auth" } as never);
    const listener = vi.fn();
    security.onSessionCheckRequired(listener);
    expect(await security.snapshots.refreshLandmark(L1)).toEqual({
      kind: "session-check-required",
    });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("3e — offline-read authorization (§4.2, §9.1)", () => {
  const L1 = "11111111-1111-4111-8111-111111111111";
  const profileBody = {
    id: L1,
    display_name: "Falls",
    category: "falls",
    latitude: 36.1,
    longitude: -84.1,
    source_description: null,
    source_access_label: null,
    source_url: null,
  };
  function tab3e() {
    const network = {
      fetchLandmark: vi.fn(() =>
        Promise.resolve({ kind: "available" as const, body: profileBody }),
      ),
      fetchTrip: vi.fn(),
    };
    const deps = createOfflineTestTab(world);
    const security = createAccountSecurity({
      deps,
      channel: { open: () => "open", close: () => {} },
      inspection: {
        safetyLock: deps.safetyLock,
        probeData: () => probeOfflineDataDatabase(),
        probeState: () => probeOfflineStateDatabase(),
      },
      api: server.api,
      safety,
      probeLocks: () => Promise.resolve("operational"),
      network,
      persist: () => Promise.resolve(true),
    });
    return { security, deps, network };
  }
  async function savedOnline() {
    server.session = USER_A;
    const online = tab3e();
    await online.security.checkSession();
    expect((await online.security.snapshots.saveLandmark(L1)).kind).toBe("saved");
  }

  it("a server that can't be reached grants READ-only access to the last verified account's copies", async () => {
    await savedOnline();
    server.api.getSession.mockRejectedValueOnce(networkError());
    const offline = tab3e();
    const result = await offline.security.checkSession();
    expect(result).toMatchObject({
      state: { session: { status: "unavailable" }, restriction: null, offline: "offline-read" },
    });
    const listed = await offline.security.snapshots.listLandmarks();
    expect(listed.kind).toBe("ok");
    // Never saving, refreshing, or a session.
    expect(await offline.security.snapshots.refreshLandmark(L1)).toEqual({
      kind: "not-eligible",
      reason: "no-identity",
    });
    expect(offline.network.fetchLandmark).not.toHaveBeenCalled();
    // E2: local removal works.
    expect(await offline.security.snapshots.removeLandmark(L1)).toEqual({ kind: "removed" });
  });

  it.each([
    ["a malformed session response", () => malformed()],
    ["a 401", () => new ApiError(401, "UNAUTHENTICATED", "x")],
  ])("%s never grants offline reads", async (_label, error) => {
    await savedOnline();
    server.api.getSession.mockRejectedValueOnce(error());
    const tab = tab3e();
    expect(await tab.security.checkSession()).toMatchObject({ state: { offline: "none" } });
    expect(await tab.security.snapshots.listLandmarks()).toEqual({
      kind: "not-eligible",
      reason: "no-identity",
    });
  });

  it("a server-confirmed absent session never grants offline reads (and ends the lifecycle)", async () => {
    await savedOnline();
    server.session = null;
    const tab = tab3e();
    expect(await tab.security.checkSession()).toMatchObject({
      state: { session: { status: "anonymous" }, offline: "none" },
    });
    expect((await tab.security.snapshots.listLandmarks()).kind).toBe("not-eligible");
  });

  it.each([
    ["a pending sign-out intent", () => putState(intent())],
    ["D22", () => world.storage.setItem(SAFETY_LOCK_KEY, "true")],
  ])("%s keeps offline reads refused", async (_label, arrange) => {
    await savedOnline();
    await arrange();
    server.api.getSession.mockRejectedValueOnce(networkError());
    const tab = tab3e();
    expect(await tab.security.checkSession()).toMatchObject({ state: { offline: "none" } });
    expect((await tab.security.snapshots.listLandmarks()).kind).toBe("not-eligible");
  });

  it("restored connectivity does not promote by itself; only a coordinated check does", async () => {
    await savedOnline();
    server.api.getSession.mockRejectedValueOnce(networkError());
    const tab = tab3e();
    await tab.security.checkSession();
    // The server is reachable again, but nothing has re-checked: still read-only.
    expect(await tab.security.snapshots.refreshLandmark(L1)).toMatchObject({
      kind: "not-eligible",
    });
    expect(await tab.security.checkSession()).toMatchObject({ state: { offline: "eligible" } });
    expect((await tab.security.snapshots.refreshLandmark(L1)).kind).toBe("refreshed");
  });

  it("a block withdraws offline reads and the published content at once", async () => {
    await savedOnline();
    server.api.getSession.mockRejectedValueOnce(networkError());
    const tab = tab3e();
    await tab.security.checkSession();
    await tab.security.snapshots.listLandmarks();
    expect(tab.security.snapshots.view.getSnapshot().landmarks.size).toBe(1);
    tab.security.blockLocally();
    expect(tab.security.snapshots.view.getSnapshot().landmarks.size).toBe(0);
    expect((await tab.security.snapshots.listLandmarks()).kind).toBe("not-eligible");
  });
});
