import type { AuthUser, SessionResponse } from "../api/auth";

/** Synthetic session data for the M03-T03 component tests (no real account). */
export const TEST_USER: AuthUser = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "",
  email: "hiker@example.test",
  emailVerified: false,
  image: null,
  createdAt: "2026-11-18T12:00:00.000Z",
  updatedAt: "2026-11-18T12:00:00.000Z",
};

export const TEST_SESSION: SessionResponse = {
  session: {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    userId: TEST_USER.id,
    expiresAt: "2026-12-18T12:00:00.000Z",
    createdAt: "2026-11-18T12:00:00.000Z",
    updatedAt: "2026-11-18T12:00:00.000Z",
  },
  user: TEST_USER,
};

/** A promise whose settlement the test controls, for observing in-flight states. */
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
