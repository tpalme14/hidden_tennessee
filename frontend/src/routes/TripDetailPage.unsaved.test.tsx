import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { getTrip, renameTrip, type OwnerTrip } from "../api/trips";
import { AuthContext, type AuthContextValue } from "../auth/session";
import { TEST_USER } from "../auth/testFixtures";
import { updateSafety } from "../pwa/updateSafety";
import { TripDetailPage } from "./TripDetailPage";

/**
 * M06-T02 Increment 4b-ii — the trip page's rename draft registered as
 * protected information while it differs from the current name. Presence
 * only; rename behavior is unchanged (trips API mocked).
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  getTrip: vi.fn(),
  renameTrip: vi.fn(),
}));

const get = vi.mocked(getTrip);
const rename = vi.mocked(renameTrip);
const TRIP_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TIME = "2026-11-23T16:00:00.000Z";

function tripOf(name = "Weekend Waterfalls", version = 3): OwnerTrip {
  return {
    id: TRIP_A,
    name,
    version,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops: [],
    distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
  };
}

async function renderReady() {
  get.mockResolvedValue(tripOf());
  const auth: AuthContextValue = {
    session: { status: "authenticated", user: TEST_USER },
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  const view = render(
    <MemoryRouter initialEntries={[`/trips/${TRIP_A}`]}>
      <AuthContext.Provider value={auth}>
        <Routes>
          <Route path="/trips/:tripId" element={<TripDetailPage />} />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  await screen.findByRole("list", { name: "Stops" }).catch(() => undefined);
  await screen.findByRole("button", { name: "Rename" });
  return view;
}

const categories = () => updateSafety.getSnapshot().protectedCategories;
const revision = () => updateSafety.getSnapshot().protectedRevision;
const nameField = () => screen.getByRole("textbox", { name: "Trip name" });

beforeEach(() => {
  get.mockReset();
  rename.mockReset();
});
afterEach(() => {
  cleanup();
  expect(categories()).toEqual([]);
});

describe("TripDetailPage — rename draft", () => {
  it("opening (prefilled) is not protected; a change is; further edits are new revisions; reverting removes it", async () => {
    await renderReady();
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    expect(nameField()).toHaveValue("Weekend Waterfalls");
    expect(categories()).toEqual([]);
    fireEvent.change(nameField(), { target: { value: "Fall Loop" } });
    expect(categories()).toEqual(["trip-rename"]);
    const r = revision();
    fireEvent.change(nameField(), { target: { value: "Fall Loops" } });
    expect(revision()).toBeGreaterThan(r);
    fireEvent.change(nameField(), { target: { value: "Weekend Waterfalls" } });
    expect(categories()).toEqual([]);
    fireEvent.change(nameField(), { target: { value: "" } }); // cleared: differs from the name
    expect(categories()).toEqual(["trip-rename"]);
  });

  it("a failed save keeps the draft protected; Cancel removes it", async () => {
    await renderReady();
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(nameField(), { target: { value: "Fall Loop" } });
    rename.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "x"));
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(nameField()).toHaveValue("Fall Loop");
    expect(categories()).toEqual(["trip-rename"]);
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(categories()).toEqual([]);
  });

  it("a successful save removes protection; unmount mid-draft leaves none", async () => {
    const view = await renderReady();
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(nameField(), { target: { value: "Fall Loop" } });
    rename.mockResolvedValueOnce(tripOf("Fall Loop", 4));
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(await screen.findByRole("button", { name: "Rename" })).toBeInTheDocument();
    expect(categories()).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(nameField(), { target: { value: "Synthetic secret name" } });
    expect(JSON.stringify(updateSafety.getSnapshot())).not.toContain("Synthetic secret");
    act(() => view.unmount());
    expect(categories()).toEqual([]);
  });
});
