import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CAPABILITY_PROBE_NAME,
  detectPresence,
  probeBroadcastChannel,
  probeLocalStorageRead,
  probeWebLocks,
  type CapabilityEnvironment,
} from "./capabilities";
import { AUTH_LOCK, SECURITY_LOCK } from "./locks";
import { SAFETY_LOCK_KEY } from "./safetyLock";
import { createBroadcastHub, FakeLockManager } from "./testSupport";

/**
 * M06-T03 Increment 3b-i — capability classification with injected
 * environments (stand-ins, not a real browser).
 */

const denied = () => {
  throw new DOMException("denied", "SecurityError");
};

function memoryStorage(entries: Record<string, string> = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn(),
    removeItem: vi.fn(),
    clear: vi.fn(),
    key: vi.fn(),
    length: map.size,
  } as unknown as Storage & {
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };
}

function env(overrides: Partial<CapabilityEnvironment>): CapabilityEnvironment {
  return {
    locks: () => undefined,
    broadcastChannel: () => undefined,
    indexedDB: () => undefined,
    localStorage: () => memoryStorage(),
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("presence detection (no API use)", () => {
  it("distinguishes absent, present, and denied without calling any API", () => {
    const request = vi.fn();
    const ctor = vi.fn();
    const open = vi.fn();
    expect(
      detectPresence(
        env({
          locks: () => ({ request }),
          broadcastChannel: () => ctor,
          indexedDB: () => ({ open }),
        }),
      ),
    ).toEqual({
      webLocks: "present",
      broadcastChannel: "present",
      indexedDB: "present",
      localStorage: "present",
    });
    expect(request).not.toHaveBeenCalled();
    expect(ctor).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
    expect(detectPresence(env({ localStorage: denied as () => Storage }))).toEqual({
      webLocks: "absent",
      broadcastChannel: "absent",
      indexedDB: "absent",
      localStorage: "denied",
    });
    expect(
      detectPresence(env({ locks: denied, broadcastChannel: denied, indexedDB: denied })),
    ).toMatchObject({ webLocks: "denied", broadcastChannel: "denied", indexedDB: "denied" });
  });
});

describe("Web Locks probe", () => {
  it("is operational after one ifAvailable request on the private probe name, holding nothing afterwards", async () => {
    const manager = new FakeLockManager();
    const request = vi.spyOn(manager, "request");
    expect(await probeWebLocks(env({ locks: () => manager }))).toBe("operational");
    expect(request).toHaveBeenCalledTimes(1);
    const [name, options] = request.mock.calls[0] ?? [];
    expect(name).toBe(CAPABILITY_PROBE_NAME);
    expect([AUTH_LOCK, SECURITY_LOCK]).not.toContain(name);
    expect(options).toEqual({ mode: "exclusive", ifAvailable: true });
    expect(manager.snapshot()).toEqual({ held: [], pending: [] });
  });

  it("is operational when another context holds the probe name (null grant), without queueing", async () => {
    const manager = new FakeLockManager();
    let release!: () => void;
    void manager.request(CAPABILITY_PROBE_NAME, { mode: "exclusive" }, () => {
      return new Promise<void>((resolve) => (release = resolve));
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await probeWebLocks(env({ locks: () => manager }))).toBe("operational");
    expect(manager.snapshot().pending).toEqual([]);
    release();
  });

  it("distinguishes absent, denied, and use failure", async () => {
    expect(await probeWebLocks(env({}))).toBe("absent");
    expect(await probeWebLocks(env({ locks: denied }))).toBe("denied");
    expect(await probeWebLocks(env({ locks: () => ({}) }))).toBe("use-failed");
    expect(
      await probeWebLocks(
        env({ locks: () => ({ request: () => Promise.reject(new DOMException("x", "Error")) }) }),
      ),
    ).toBe("use-failed");
    expect(
      await probeWebLocks(
        env({
          locks: () => ({
            request: () => {
              throw new TypeError("synthetic");
            },
          }),
        }),
      ),
    ).toBe("use-failed");
    // Resolves without ever invoking the callback: use is not established.
    expect(await probeWebLocks(env({ locks: () => ({ request: () => Promise.resolve() }) }))).toBe(
      "use-failed",
    );
  });
});

describe("BroadcastChannel probe", () => {
  it("constructs and immediately closes one probe channel, sending nothing", () => {
    const hub = createBroadcastHub();
    expect(probeBroadcastChannel(env({ broadcastChannel: () => hub.Channel }))).toBe("operational");
    expect(hub.created()).toBe(1);
    expect(hub.openCount()).toBe(0);
  });

  it("distinguishes absent, denied, and use failure", () => {
    expect(probeBroadcastChannel(env({}))).toBe("absent");
    expect(probeBroadcastChannel(env({ broadcastChannel: denied }))).toBe("denied");
    expect(probeBroadcastChannel(env({ broadcastChannel: () => ({}) }))).toBe("use-failed");
    expect(
      probeBroadcastChannel(
        env({
          broadcastChannel: () =>
            function Throwing() {
              throw new DOMException("synthetic", "SecurityError");
            },
        }),
      ),
    ).toBe("use-failed");
  });
});

describe("localStorage read probe", () => {
  it("reads only, never writes or removes, and reports readable storage as operational", () => {
    for (const storage of [memoryStorage(), memoryStorage({ [SAFETY_LOCK_KEY]: "true" })]) {
      expect(probeLocalStorageRead(env({ localStorage: () => storage }))).toBe("operational");
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.removeItem).not.toHaveBeenCalled();
    }
  });

  it("reports denied or unreadable storage as denied, never as an absent lock", () => {
    expect(probeLocalStorageRead(env({ localStorage: denied as () => Storage }))).toBe("denied");
    const throwing = memoryStorage();
    (throwing.getItem as ReturnType<typeof vi.fn>).mockImplementation(denied);
    expect(probeLocalStorageRead(env({ localStorage: () => throwing }))).toBe("denied");
  });
});

describe("module import", () => {
  it("creates no database, lock, channel, or storage entry when the 3b-i modules are imported", async () => {
    const factory = new IDBFactory();
    const open = vi.spyOn(factory, "open");
    const request = vi.fn();
    const channel = vi.fn();
    vi.stubGlobal("indexedDB", factory);
    vi.stubGlobal("navigator", { locks: { request } });
    vi.stubGlobal("BroadcastChannel", channel);
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    vi.resetModules();
    await import("./capabilities");
    await import("./locks");
    await import("./notices");
    await import("./securityGeneration");
    expect(open).not.toHaveBeenCalled();
    expect(await factory.databases()).toEqual([]);
    expect(request).not.toHaveBeenCalled();
    expect(channel).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });
});
