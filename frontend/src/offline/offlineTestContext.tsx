import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { vi } from "vitest";
import {
  AccountSecurityContext,
  createInertSnapshots,
  type AccountSecurityContextValue,
} from "../auth/accountSecurity";
import { AuthContext, type AuthContextValue } from "../auth/session";
import { TEST_USER } from "../auth/testFixtures";
import type { LandmarkEntry, SnapshotOperations, TripEntry } from "./snapshots";
import { createSnapshotView } from "./snapshots";

/**
 * TEST-ONLY (M06-T03 Increment 3e): a stubbed account context with a REAL view
 * store, so component tests drive publication exactly as the operations do.
 */

export const LM = "11111111-1111-4111-8111-111111111111";
export const TRIP = "22222222-2222-4222-8222-22222222222a";
export const T = "2026-11-20T10:00:00.000Z";
const owner = {
  schema_version: 1 as const,
  account_id: TEST_USER.id,
  lifecycle_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
};

export const availableLandmark = (id = LM): LandmarkEntry => ({
  status: "ok",
  lastSyncedAt: T,
  record: {
    ...owner,
    revision: 1,
    landmark_id: id,
    status: "available",
    display_name: "Saved Falls",
    category: "falls",
    latitude: 36.123456,
    longitude: -84.654321,
    saved_at: T,
    source_description: "A waterfall on the creek.",
    source_access_label: null,
    source_url: null,
  },
});
export const landmarkMarker = (id = LM): LandmarkEntry => ({
  status: "ok",
  lastSyncedAt: null,
  record: {
    ...owner,
    revision: 2,
    landmark_id: id,
    status: "unavailable",
    saved_at: T,
    unavailable_recorded_at: T,
  },
});

export function savedTrip(options: { invalidated?: boolean } = {}): TripEntry {
  const stops = [
    {
      stop_id: "33333333-3333-4333-8333-000000000000",
      position: 0,
      is_available: true as const,
      distance_from_previous_miles: null,
      landmark: {
        id: LM,
        display_name: "First Stop",
        category: "peak",
        latitude: 36,
        longitude: -84,
      },
    },
    options.invalidated
      ? {
          stop_id: "33333333-3333-4333-8333-000000000001",
          position: 1,
          is_available: false as const,
          distance_from_previous_miles: null,
          landmark: { id: "11111111-1111-4111-8111-111111111112", is_available: false as const },
        }
      : {
          stop_id: "33333333-3333-4333-8333-000000000001",
          position: 1,
          is_available: true as const,
          distance_from_previous_miles: 2.5,
          landmark: {
            id: "11111111-1111-4111-8111-111111111112",
            display_name: "Second Stop",
            category: "lake",
            latitude: 36.1,
            longitude: -84.1,
          },
        },
  ];
  return {
    status: "ok",
    lastSyncedAt: T,
    record: {
      ...owner,
      revision: 1,
      trip_id: TRIP,
      status: "available",
      name: "Weekend trip",
      stops,
      distance_summary: options.invalidated
        ? null
        : { total_miles: 2.5, measured_legs: 1, total_legs: 1 },
      distance_summary_state: options.invalidated ? "invalidated" : "server",
      saved_at: T,
      ...(options.invalidated ? { partially_invalidated_at: T } : {}),
    },
  };
}

export function fakeAccount(
  account: Partial<AccountSecurityContextValue> = {},
  ops: Partial<SnapshotOperations> = {},
): {
  value: AccountSecurityContextValue;
  view: ReturnType<typeof createSnapshotView>;
  snapshots: SnapshotOperations;
} {
  const view = createSnapshotView();
  const snapshots: SnapshotOperations = {
    ...createInertSnapshots(),
    view,
    clearView: () => view.clear(),
    getLandmark: vi.fn(() => Promise.resolve({ kind: "ok" as const, entry: null })),
    getTrip: vi.fn(() => Promise.resolve({ kind: "ok" as const, entry: null })),
    listLandmarks: vi.fn(() => Promise.resolve({ kind: "ok" as const, entries: [] })),
    listTrips: vi.fn(() => Promise.resolve({ kind: "ok" as const, entries: [] })),
    ...ops,
  };
  const value: AccountSecurityContextValue = {
    restriction: null,
    offline: "eligible",
    lastSignOut: null,
    signOutRefusal: null,
    signIn: vi.fn(),
    finishSigningOut: vi.fn(),
    storage: "clean",
    retryCleanup: vi.fn(),
    recoverStorage: vi.fn(),
    deleteAllData: vi.fn(),
    ...account,
    snapshots,
  };
  return { value, view, snapshots };
}

export function renderWithAccount(
  ui: ReactNode,
  value: AccountSecurityContextValue,
  options: { path?: string; route?: string; signedIn?: boolean } = {},
) {
  const auth: AuthContextValue = {
    session:
      options.signedIn === false
        ? { status: "anonymous" }
        : { status: "authenticated", user: TEST_USER },
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  return (
    <MemoryRouter initialEntries={[options.path ?? "/"]}>
      <AuthContext.Provider value={auth}>
        <AccountSecurityContext.Provider value={value}>
          <Routes>
            <Route path={options.route ?? "/"} element={ui} />
          </Routes>
        </AccountSecurityContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  );
}
