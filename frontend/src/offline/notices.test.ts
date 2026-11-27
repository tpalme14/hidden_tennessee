import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createNoticeChannel,
  isValidNotice,
  NOTICE_CHANNEL,
  NOTICE_TYPES,
  type ChannelLike,
  type NoticeType,
} from "./notices";
import { createBroadcastHub, flush } from "./testSupport";

/**
 * M06-T03 Increment 3b-i — advisory cross-tab notices. Delivery uses an
 * in-memory BroadcastChannel stand-in (testSupport.ts), not a real browser.
 * Assertions never print planted values (non-echoing checks only).
 */

const SECRET = "synthetic-planted-secret-6f1d";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isValidNotice", () => {
  it("accepts exactly { type } for every known type", () => {
    for (const type of NOTICE_TYPES) expect(isValidNotice({ type })).toBe(true);
    expect(isValidNotice(Object.assign(Object.create(null) as object, { type: "lock-set" }))).toBe(
      true,
    );
  });

  it("rejects malformed values, unknown types, and any extra field", () => {
    class Shaped {
      type = "lock-set";
    }
    const symbolKeyed = { type: "lock-set", [Symbol("x")]: 1 };
    const getter = Object.defineProperty({}, "type", { get: () => "lock-set", enumerable: true });
    const rejected: unknown[] = [
      null,
      undefined,
      "lock-set",
      42,
      [],
      ["lock-set"],
      {},
      { type: "unknown" },
      { type: 1 },
      { type: "LOCK-SET" },
      { type: "lock-set", account_id: SECRET },
      { type: "lock-set", token: SECRET },
      { type: "lock-set", at: 1 },
      { type: "lock-set", detail: undefined },
      { kind: "lock-set" },
      new Shaped(),
      symbolKeyed,
      getter,
    ];
    const accepted = rejected.filter((value) => isValidNotice(value));
    expect(accepted.length).toBe(0);
  });
});

describe("notice channel", () => {
  it("opens nothing until open() is called", () => {
    const factory = vi.fn();
    createNoticeChannel(factory);
    expect(factory).not.toHaveBeenCalled();
  });

  it("delivers a sent notice to other tabs as its type only, never to the sender", async () => {
    const hub = createBroadcastHub();
    const factory = (name: string) => new hub.Channel(name);
    const sender = createNoticeChannel(factory);
    const receiver = createNoticeChannel(factory);
    const sent = vi.fn();
    const received = vi.fn();
    expect(sender.open(sent)).toBe("open");
    expect(receiver.open(received)).toBe("open");
    expect(sender.post("lock-set")).toBe("sent");
    await flush();
    expect(received.mock.calls).toEqual([["lock-set"]]);
    expect(sent).not.toHaveBeenCalled();
    sender.close();
    receiver.close();
    expect(hub.openCount()).toBe(0);
  });

  it("sends exactly { type } with no other field", () => {
    const posted: unknown[] = [];
    const channel: ChannelLike = {
      onmessage: null,
      postMessage: (message) => posted.push(message),
      close: () => undefined,
    };
    const notices = createNoticeChannel(() => channel);
    notices.open(() => undefined);
    notices.post("recovered");
    expect(posted.length).toBe(1);
    expect(Reflect.ownKeys(posted[0] as object)).toEqual(["type"]);
    expect(isValidNotice(posted[0])).toBe(true);
  });

  it("drops invalid or sensitive inbound messages without delivering or echoing them", async () => {
    const hub = createBroadcastHub();
    const receiver = createNoticeChannel((name) => new hub.Channel(name));
    const received = vi.fn();
    receiver.open(received);
    const raw = new hub.Channel(NOTICE_CHANNEL);
    raw.postMessage({ type: "lock-set", token: SECRET });
    raw.postMessage({ type: "unknown" });
    raw.postMessage("lock-set");
    raw.postMessage(null);
    await flush();
    expect(received).not.toHaveBeenCalled();
    raw.postMessage({ type: "state-changed" });
    await flush();
    expect(received.mock.calls).toEqual([["state-changed"]]);
    receiver.close();
    raw.close();
  });

  it("refuses to post an unknown type without calling postMessage", () => {
    const postMessage = vi.fn();
    const notices = createNoticeChannel(() => ({ onmessage: null, postMessage, close: vi.fn() }));
    notices.open(() => undefined);
    expect(notices.post("not-a-type" as NoticeType)).toBe("invalid");
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("reports a missing BroadcastChannel as unavailable, and posting then as not-open", () => {
    vi.stubGlobal("BroadcastChannel", undefined);
    const notices = createNoticeChannel();
    expect(notices.open(() => undefined)).toBe("unavailable");
    expect(notices.post("lock-set")).toBe("not-open");
  });

  it("reports a construction failure as failed", () => {
    const notices = createNoticeChannel(() => {
      throw new DOMException("synthetic", "SecurityError");
    });
    expect(notices.open(() => undefined)).toBe("failed");
    expect(notices.post("lock-set")).toBe("not-open");
  });

  it("reports a send failure as failed, never as sent", () => {
    const notices = createNoticeChannel(() => ({
      onmessage: null,
      postMessage: () => {
        throw new DOMException("synthetic", "InvalidStateError");
      },
      close: () => undefined,
    }));
    notices.open(() => undefined);
    expect(notices.post("failure-changed")).toBe("failed");
  });

  it("close is explicit, idempotent, and stops delivery", async () => {
    const hub = createBroadcastHub();
    const factory = (name: string) => new hub.Channel(name);
    const sender = createNoticeChannel(factory);
    const receiver = createNoticeChannel(factory);
    const received = vi.fn();
    sender.open(() => undefined);
    receiver.open(received);
    receiver.close();
    receiver.close();
    expect(sender.post("lifecycle-ended")).toBe("sent");
    await flush();
    expect(received).not.toHaveBeenCalled();
    expect(receiver.post("lifecycle-ended")).toBe("not-open");
    sender.close();
    expect(hub.openCount()).toBe(0);
  });

  it("open is idempotent and creates one channel", () => {
    const hub = createBroadcastHub();
    const notices = createNoticeChannel((name) => new hub.Channel(name));
    expect(notices.open(() => undefined)).toBe("open");
    expect(notices.open(() => undefined)).toBe("open");
    expect(hub.created()).toBe(1);
    notices.close();
  });
});
