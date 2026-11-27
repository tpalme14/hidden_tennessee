import { createSafetyLock } from "./safetyLock";

/**
 * Coordination capability classification (M06-T03 Increment 3b-i;
 * Specification 6 v1.1 OFF-OUT-7 and its 2026-11-26 clarification, §12.6a;
 * decision DR-1).
 *
 * Five outcomes are kept distinct and are never collapsed into each other:
 *
 * - `absent` — the API is not provided at all;
 * - `present` — the API object exists (presence alone; nothing was used);
 * - `operational` — an explicit probe used the API successfully;
 * - `use-failed` — the API exists but using it threw or rejected;
 * - `denied` — accessing the API or its storage was refused or unavailable
 *   (for example a `SecurityError`).
 *
 * Presence detection (`detectPresence`) reads property values only.
 * Operational probes run ONLY when explicitly invoked, and each documents its
 * side-effect boundary. No probe creates or opens a database, reads or writes
 * any security record, takes `tnle-auth` or `tnle-offline-security`, or
 * establishes a lifecycle. Nothing runs on import, and nothing here is wired
 * into application startup in 3b-i.
 *
 * Capability results describe THIS context only. Uniform engine capability
 * across contexts sharing the same storage is a documented supported-
 * environment assumption, not a guarantee (OFF-OUT-7 clarification).
 */

export type Presence = "absent" | "present" | "denied";
export type ProbeOutcome = "absent" | "denied" | "operational" | "use-failed";

/** A private, non-security lock and channel name used only by the probes. */
export const CAPABILITY_PROBE_NAME = "tnle-capability-probe";

/** How the module reaches the platform; the default resolves globals at call time. */
export interface CapabilityEnvironment {
  locks(): unknown;
  broadcastChannel(): unknown;
  indexedDB(): unknown;
  localStorage(): Storage;
}

export const browserEnvironment: CapabilityEnvironment = {
  locks: () => (typeof navigator === "undefined" ? undefined : navigator.locks),
  broadcastChannel: () => globalThis.BroadcastChannel,
  indexedDB: () => globalThis.indexedDB,
  localStorage: () => window.localStorage,
};

function presenceOf(read: () => unknown): Presence {
  try {
    const value = read();
    return value === undefined || value === null ? "absent" : "present";
  } catch {
    return "denied";
  }
}

export interface PresenceReport {
  webLocks: Presence;
  broadcastChannel: Presence;
  indexedDB: Presence;
  localStorage: Presence;
}

/** Side-effect boundary: property reads only; no API is called. */
export function detectPresence(env: CapabilityEnvironment = browserEnvironment): PresenceReport {
  return {
    webLocks: presenceOf(env.locks),
    broadcastChannel: presenceOf(env.broadcastChannel),
    indexedDB: presenceOf(env.indexedDB),
    localStorage: presenceOf(env.localStorage),
  };
}

interface LockRequester {
  request(
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: unknown) => unknown,
  ): Promise<unknown>;
}

/**
 * Explicit Web Locks probe. Side-effect boundary: at most ONE `ifAvailable`
 * exclusive request for `CAPABILITY_PROBE_NAME`, whose callback returns
 * immediately, so any lock granted is released at once; the request is never
 * queued. A `null` grant (another context holds the probe name) still proves
 * the API is usable. No security lock is touched and no storage is used.
 */
export async function probeWebLocks(
  env: CapabilityEnvironment = browserEnvironment,
): Promise<ProbeOutcome> {
  let manager: unknown;
  try {
    manager = env.locks();
  } catch {
    return "denied";
  }
  if (manager === undefined || manager === null) return "absent";
  const requester = manager as Partial<LockRequester>;
  if (typeof requester.request !== "function") return "use-failed";
  let callbackRan = false;
  try {
    await requester.request(CAPABILITY_PROBE_NAME, { mode: "exclusive", ifAvailable: true }, () => {
      callbackRan = true;
    });
  } catch {
    return "use-failed";
  }
  return callbackRan ? "operational" : "use-failed";
}

/**
 * Explicit BroadcastChannel probe. Side-effect boundary: constructs one channel
 * named `CAPABILITY_PROBE_NAME` and closes it immediately; no message is sent.
 */
export function probeBroadcastChannel(
  env: CapabilityEnvironment = browserEnvironment,
): ProbeOutcome {
  let ctor: unknown;
  try {
    ctor = env.broadcastChannel();
  } catch {
    return "denied";
  }
  if (ctor === undefined || ctor === null) return "absent";
  if (typeof ctor !== "function") return "use-failed";
  try {
    const channel = new (ctor as typeof BroadcastChannel)(CAPABILITY_PROBE_NAME);
    channel.close();
  } catch {
    return "use-failed";
  }
  return "operational";
}

/**
 * Explicit `localStorage` read probe. Side-effect boundary: one read of the D22
 * safety-lock key through `safetyLock.read()`; nothing is written or removed.
 * An unreadable store is `denied`: it is never reported as an absent lock.
 */
export function probeLocalStorageRead(
  env: CapabilityEnvironment = browserEnvironment,
): ProbeOutcome {
  return createSafetyLock(env.localStorage).read() === "unreadable" ? "denied" : "operational";
}
