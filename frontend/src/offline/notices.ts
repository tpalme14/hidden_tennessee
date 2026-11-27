/**
 * Cross-tab change notices (M06-T03 Increment 3b-i; Specification 6 v1.1
 * §12.6a; accepted 3b architecture).
 *
 * Notices are ADVISORY ONLY: a receiver re-reads durable state under the
 * coordination locks. A notice never authorizes access, never proves recovery,
 * and never permits clearing any state. Missing notices are expected (no
 * BroadcastChannel, a closed tab, a failed send), so correctness never depends
 * on delivery, and no persistence-based substitute is used.
 *
 * A message is exactly a plain object `{ type }` with a known type. It carries
 * no identifier, token, timestamp, data, or failure detail. Anything else is
 * dropped without being echoed or logged.
 *
 * Nothing opens on import: `open` and `close` are explicit.
 */

export const NOTICE_CHANNEL = "tnle-offline-notices";

export const NOTICE_TYPES = [
  "lifecycle-ended",
  "lifecycle-changed",
  "lock-set",
  "failure-changed",
  "recovered",
  "state-changed",
] as const;

export type NoticeType = (typeof NOTICE_TYPES)[number];

export interface Notice {
  readonly type: NoticeType;
}

function isNoticeType(value: unknown): value is NoticeType {
  return typeof value === "string" && (NOTICE_TYPES as readonly string[]).includes(value);
}

/** Runtime validation: exactly one own data property, `type`, with a known value. */
export function isValidNotice(value: unknown): value is Notice {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 1 || keys[0] !== "type") return false;
  const descriptor = Object.getOwnPropertyDescriptor(value, "type");
  if (descriptor === undefined || !("value" in descriptor)) return false;
  return isNoticeType(descriptor.value);
}

export type ChannelLike = {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
};

/** Constructs a channel, or returns `undefined` when BroadcastChannel is not provided. */
export type ChannelFactory = (name: string) => ChannelLike | undefined;

const defaultFactory: ChannelFactory = (name) => {
  const ctor = globalThis.BroadcastChannel;
  if (typeof ctor !== "function") return undefined;
  return new ctor(name) as unknown as ChannelLike;
};

export type OpenOutcome = "open" | "unavailable" | "failed";
export type PostOutcome = "sent" | "not-open" | "invalid" | "failed";

export interface NoticeChannel {
  /** Starts listening. Valid notices reach `onNotice` as their type only. */
  open(onNotice: (type: NoticeType) => void): OpenOutcome;
  /** Sends `{ type }`; never reports delivery, only whether the send was accepted. */
  post(type: NoticeType): PostOutcome;
  /** Stops listening and releases the channel. Safe to call repeatedly. */
  close(): void;
}

export function createNoticeChannel(factory: ChannelFactory = defaultFactory): NoticeChannel {
  let channel: ChannelLike | null = null;

  return {
    open(onNotice) {
      if (channel !== null) return "open";
      let created: ChannelLike | undefined;
      try {
        created = factory(NOTICE_CHANNEL);
      } catch {
        return "failed";
      }
      if (created === undefined) return "unavailable";
      created.onmessage = (event) => {
        const data = event.data;
        if (isValidNotice(data)) onNotice(data.type);
      };
      channel = created;
      return "open";
    },
    post(type) {
      if (channel === null) return "not-open";
      if (!isNoticeType(type)) return "invalid";
      try {
        channel.postMessage({ type });
      } catch {
        return "failed";
      }
      return "sent";
    },
    close() {
      const current = channel;
      channel = null;
      if (current === null) return;
      current.onmessage = null;
      try {
        current.close();
      } catch {
        // Already unusable; nothing further to release.
      }
    },
  };
}
