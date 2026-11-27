import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach } from "vitest";
import { cleanup } from "@testing-library/react";
import { SAFETY_LOCK_KEY } from "../offline/safetyLock";
import { createBroadcastHub, FakeLockManager, installFakeIndexedDb } from "../offline/testSupport";

// vitest.config.ts doesn't set `test.globals: true`, so React Testing
// Library's automatic afterEach cleanup (which relies on detecting a global
// test framework) never registers on its own — without this, DOM nodes from
// an earlier render in the same file accumulate and break later assertions
// in any test file with more than one `render` call.
afterEach(() => {
  cleanup();
});

// M06-T03 Increment 3c-1a: the AuthProvider coordinates every authentication
// operation through Web Locks and the offline security state, which jsdom
// does not provide. Each test gets fresh, isolated TEST-ONLY stand-ins — an
// in-memory Web Locks manager, a fresh fake IndexedDB, and an isolated
// BroadcastChannel — and the D22 key is removed afterwards (only that key;
// nothing else in localStorage is touched). Tests that need different
// conditions (for example no Web Locks) override these in their own setup.
beforeEach(() => {
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: new FakeLockManager(),
  });
  installFakeIndexedDb();
  stubBroadcastChannel();
});

afterEach(() => {
  delete (navigator as { locks?: unknown }).locks;
  try {
    localStorage.removeItem(SAFETY_LOCK_KEY);
  } catch {
    // A test may have replaced or broken storage; nothing else to restore here.
  }
});

function stubBroadcastChannel() {
  Object.defineProperty(globalThis, "BroadcastChannel", {
    configurable: true,
    writable: true,
    value: createBroadcastHub().Channel,
  });
}
