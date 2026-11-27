import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTrip, reorderTripStops, type OwnerTrip, type TripStop } from "../api/trips";
import { AuthContext, type AuthContextValue } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { TripDetailPage } from "./TripDetailPage";

/**
 * M06-T02 Increment 3b-ii-a (D2) — the presentation-only `data-pending`
 * marker on the trip page, with the REAL `useTrip` hook and page (API module
 * mocked). The marker follows the page's existing single-change lock
 * (`pending !== null`) and nothing else: it is absent while the server is
 * merely unreachable, present on every locked control while a change runs,
 * kept through loss and recovery during that change, and removed when it
 * finishes. Availability, descriptions, and native `disabled` are unchanged.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  getTrip: vi.fn(),
  reorderTripStops: vi.fn(),
}));

const get = vi.mocked(getTrip);
const reorder = vi.mocked(reorderTripStops);

const TRIP_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TIME = "2026-11-23T16:00:00.000Z";

function stop(n: number, position: number): TripStop {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    position,
    is_available: true,
    distance_from_previous_miles: null,
    landmark: {
      id: `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`,
      display_name: `Falls ${n}`,
      category: "falls",
      latitude: 35.6 + n / 100,
      longitude: -83.5,
    },
  };
}
function tripOf(version: number, order: number[]): OwnerTrip {
  const stops = order.map((n, i) => stop(n, i));
  return {
    id: TRIP_A,
    name: "Weekend Waterfalls",
    version,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops,
    distance_summary: { total_miles: null, measured_legs: 0, total_legs: stops.length - 1 },
  };
}

function evidence(kind: RequestEvidence) {
  act(() => connectivity.reportOutcome(connectivity.beginRequest(), kind));
}

async function renderReady() {
  get.mockResolvedValue(tripOf(3, [1, 2]));
  const auth: AuthContextValue = {
    session: { status: "authenticated", user: TEST_USER },
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  render(
    <MemoryRouter initialEntries={[`/trips/${TRIP_A}`]}>
      <AuthContext.Provider value={auth}>
        <Routes>
          <Route path="/trips/:tripId" element={<TripDetailPage />} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  await screen.findByRole("list", { name: "Stops" });
}

const button = (name: string) => screen.getByRole("button", { name });
/** Every control the page's single-change lock covers (and that carries the marker). */
const lockedControls = () => [
  button("Move down: Falls 1"),
  button("Move up: Falls 2"),
  button("Remove Falls 1 from the trip"),
  button("Remove Falls 2 from the trip"),
  button("Rename"),
  button("Delete trip"),
  within(screen.getByRole("region", { name: "Sharing" })).getByRole("button", {
    name: "Create share link",
  }),
];

beforeEach(() => {
  get.mockReset();
  reorder.mockReset();
  evidence("response");
});
afterEach(() => {
  evidence("response");
});

describe("TripDetailPage — data-pending marks only a genuinely pending change", () => {
  it("absent while available, and absent while only unreachable (aria-disabled with the reason)", async () => {
    await renderReady();
    for (const control of lockedControls()) expect(control).not.toHaveAttribute("data-pending");

    evidence("network-failure");
    for (const name of ["Move down: Falls 1", "Remove Falls 2 from the trip"]) {
      expect(button(name)).toHaveAttribute("aria-disabled", "true");
      expect(button(name)).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
      expect(button(name)).not.toHaveAttribute("data-pending");
    }
    // The page's own Rename/Delete trip buttons are not online-only: unchanged.
    expect(button("Rename")).not.toHaveAttribute("aria-disabled");
    expect(button("Rename")).not.toHaveAttribute("data-pending");
    // A boundary restriction is not pending either.
    expect(button("Move up: Falls 1")).toBeDisabled();
    expect(button("Move up: Falls 1")).not.toHaveAttribute("data-pending");
  });

  it("present on every locked control during a move; kept through loss and recovery; removed when it finishes", async () => {
    await renderReady();
    const pending = deferred<OwnerTrip>();
    reorder.mockReturnValueOnce(pending.promise);
    await userEvent.click(button("Move down: Falls 1"));

    for (const control of lockedControls()) {
      expect(control).toHaveAttribute("data-pending", "true");
      expect(control).toHaveAttribute("aria-disabled", "true");
    }
    // The boundary-disabled control is locked too (existing behaviour) and keeps native disabled.
    expect(button("Move up: Falls 1")).toBeDisabled();
    expect(button("Move up: Falls 1")).toHaveAttribute("data-pending", "true");

    evidence("network-failure"); // unreachable during the change
    for (const control of lockedControls()) expect(control).toHaveAttribute("data-pending", "true");
    expect(button("Move down: Falls 1")).toHaveAccessibleDescription(ONLINE_ONLY_REASON);

    evidence("response"); // recovered before the change finishes
    for (const control of lockedControls()) expect(control).toHaveAttribute("data-pending", "true");
    // The lock still refuses a second change.
    await userEvent.click(button("Remove Falls 2 from the trip"));
    expect(reorder).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(tripOf(4, [2, 1])));
    await waitFor(() => expect(button("Move down: Falls 2")).not.toHaveAttribute("data-pending"));
    for (const name of [
      "Move down: Falls 2",
      "Remove Falls 1 from the trip",
      "Rename",
      "Delete trip",
    ]) {
      expect(button(name)).not.toHaveAttribute("data-pending");
      expect(button(name)).not.toHaveAttribute("aria-disabled");
    }
    expect(reorder).toHaveBeenCalledTimes(1);
  });
});
