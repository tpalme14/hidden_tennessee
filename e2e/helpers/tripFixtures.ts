import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import {
  currentRunTag,
  expect,
  expectServerView,
  test as base,
  testTagFor,
  type FixtureLandmark,
  type TestFixtures,
} from "./favoritesFixtures";

/**
 * Trip journeys' fixtures (M05-T04 Increment 6), layered on the guarded
 * favorites fixtures (`landmarks_test` only; synthetic `ZZ…` landmarks; every
 * statement in a guarded transaction):
 * - the favorites set (`public`, `hidden` → SENSITIVE on request, `retired`)
 *   plus four PUBLIC stop landmarks (`stops[0…3]`; stop 4 shares stop 3's point);
 * - accounts are created through the real API with this run's
 *   `e2e-trip-<run>-…@example.com` addresses and recorded.
 *
 * Teardown order (runs after failures and timeouts too): this fixture's
 * cleanup runs BEFORE the favorites fixture's own (Playwright tears dependent
 * fixtures down first): (1) every trip of the recorded accounts, and any stop
 * of theirs on this test's fixtures; (2) the stop landmarks; then (3) the
 * favorites fixture deletes its three landmarks. Accounts themselves are kept
 * (account deletion is disabled), like the favorites and reviews accounts.
 */

export const ORIGIN = "http://localhost:3000";
export const TRIP_PASSWORD = "e2e trips password";

export interface TripFixtures extends TestFixtures {
  stops: [FixtureLandmark, FixtureLandmark, FixtureLandmark, FixtureLandmark];
  /** Registers and signs in a new recorded account through `request`; returns its email. */
  signUpAndIn(request: APIRequestContext): Promise<string>;
}

export function newTripEmail(): string {
  return `e2e-trip-${currentRunTag()}-${randomUUID().slice(0, 8)}@example.com`;
}

export async function signIn(request: APIRequestContext, email: string): Promise<void> {
  const response = await request.post("/api/auth/sign-in/email", {
    headers: { Origin: ORIGIN },
    data: { email, password: TRIP_PASSWORD },
  });
  expect(response.status()).toBe(200);
}

export const test = base.extend<{ trips: TripFixtures }>({
  trips: async ({ fixtureStore, favoriteFixtures, request }, use, testInfo) => {
    const stops = (await fixtureStore.createStopFixtures(
      testTagFor(testInfo),
    )) as TripFixtures["stops"];
    const emails: string[] = [];
    try {
      for (const stop of stops) await expectServerView(request, stop, "full");
      await use({
        ...favoriteFixtures,
        stops,
        async signUpAndIn(target) {
          const email = newTripEmail();
          emails.push(email);
          const signUp = await target.post("/api/auth/sign-up/email", {
            headers: { Origin: ORIGIN },
            data: { name: "", email, password: TRIP_PASSWORD },
          });
          expect(signUp.status()).toBe(200);
          await signIn(target, email);
          return email;
        },
      });
    } finally {
      const all = [
        favoriteFixtures.public,
        favoriteFixtures.hidden,
        favoriteFixtures.retired,
        ...stops,
      ];
      await fixtureStore.deleteTripData(favoriteFixtures.owner, all, emails);
      await fixtureStore.teardownOwned(favoriteFixtures.owner, stops);
    }
  },
});

export { expect };
