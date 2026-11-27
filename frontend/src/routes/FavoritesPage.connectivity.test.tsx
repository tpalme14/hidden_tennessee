import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listFavorites, removeFavorite, type FavoriteEntry } from "../api/favorites";
import { AuthContext, type AuthContextValue } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON, UPDATING_REASON } from "../connectivity/OnlineOnlyReason";
import { updateSafety } from "../pwa/updateSafety";
import { FavoritesProvider } from "../favorites/FavoritesProvider";
import { FavoritesPage } from "./FavoritesPage";

/**
 * M06-T02 Increment 3b-i — "Remove" on My Favorites as an online-only action
 * (OFF-UX-5). API module mocked; connectivity evidence comes from the test.
 */

vi.mock("../api/favorites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/favorites")>()),
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}));

const list = vi.mocked(listFavorites);
const del = vi.mocked(removeFavorite);
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function available(n: number): FavoriteEntry {
  return {
    landmark_id: uuid(n),
    availability: "available",
    landmark: {
      id: uuid(n),
      display_name: `Falls ${n}`,
      category: "falls",
      latitude: 35.6,
      longitude: -83.5,
    },
  };
}

function evidence(kind: RequestEvidence) {
  act(() => connectivity.reportOutcome(connectivity.beginRequest(), kind));
}
const browserEvent = (type: "online" | "offline") =>
  act(() => {
    window.dispatchEvent(new Event(type));
  });

async function renderPage(entries: FavoriteEntry[]) {
  list.mockImplementation(async (query) => ({
    favorites: query?.limit === 50 ? entries : [],
    page: 1,
    limit: query?.limit ?? 50,
    has_more: false,
  }));
  const auth: AuthContextValue = {
    session: { status: "authenticated", user: TEST_USER },
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  render(
    <AuthContext.Provider value={auth}>
      <FavoritesProvider>
        <MemoryRouter initialEntries={["/favorites"]}>
          <Routes>
            <Route path="/favorites" element={<FavoritesPage />} />
          </Routes>
        </MemoryRouter>
      </FavoritesProvider>
    </AuthContext.Provider>,
  );
  await screen.findByRole("button", { name: "Remove Falls 1 from favorites" });
}

const removeButton = (n: number) =>
  screen.getByRole("button", { name: `Remove Falls ${n} from favorites` });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
  del.mockResolvedValue(undefined as never);
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
  vi.clearAllMocks();
});

describe("My Favorites — Remove while the server cannot be reached", () => {
  it.each<[string, () => void]>([
    [
      "unknown reachability",
      () => {
        evidence("network-failure");
        browserEvent("online");
      },
    ],
    ["a server problem", () => evidence("server-problem")],
    ["the browser's offline hint alone", () => browserEvent("offline")],
  ])("Remove stays available with %s", async (_label, apply) => {
    await renderPage([available(1)]);
    apply();
    expect(removeButton(1)).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(ONLINE_ONLY_REASON)).toBeNull();
  });

  it("while unreachable: one visible reason describes every Remove button; nothing is sent or removed", async () => {
    await renderPage([available(1), available(2)]);
    evidence("network-failure");
    const reasons = screen.getAllByText(ONLINE_ONLY_REASON);
    expect(reasons).toHaveLength(1);
    for (const n of [1, 2]) {
      expect(removeButton(n)).toHaveAttribute("aria-disabled", "true");
      expect(removeButton(n)).toHaveAttribute("aria-describedby", reasons[0]!.id);
      expect(removeButton(n)).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    }
    await userEvent.click(removeButton(1));
    removeButton(2).focus();
    await userEvent.keyboard("{Enter}");
    expect(del).not.toHaveBeenCalled();
    expect(removeButton(1)).toBeInTheDocument();
    expect(removeButton(2)).toHaveFocus();
  });

  it("after recovery, nothing happens by itself; an explicit Remove works as before", async () => {
    await renderPage([available(1), available(2)]);
    evidence("network-failure");
    evidence("response");
    expect(del).not.toHaveBeenCalled();
    expect(screen.queryByText(ONLINE_ONLY_REASON)).toBeNull();
    await userEvent.click(removeButton(1));
    expect(del).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Remove Falls 1 from favorites" })).toBeNull(),
    );
  });

  it("a removal already in flight keeps its pending lock when the server becomes unreachable", async () => {
    await renderPage([available(1), available(2)]);
    const pending = deferred<void>();
    del.mockReturnValueOnce(pending.promise as never);
    await userEvent.click(removeButton(1));
    evidence("network-failure");
    expect(removeButton(1)).toHaveAttribute("aria-busy", "true");
    await userEvent.click(removeButton(1));
    expect(del).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Remove Falls 1 from favorites" })).toBeNull(),
    );
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("marks only a genuinely pending removal (M06-T02 Increment 5): unreachable, recovered while pending, update gate", async () => {
    await renderPage([available(1), available(2)]);
    expect(removeButton(1)).not.toHaveAttribute("data-pending");
    evidence("network-failure");
    expect(removeButton(1)).toHaveAttribute("aria-disabled", "true");
    expect(removeButton(1)).not.toHaveAttribute("data-pending"); // unavailable, nothing pending
    evidence("response");
    const pending = deferred<void>();
    del.mockReturnValueOnce(pending.promise as never);
    await userEvent.click(removeButton(1));
    expect(removeButton(1)).toHaveAttribute("data-pending", "true");
    expect(removeButton(2)).not.toHaveAttribute("data-pending"); // only the pending row
    evidence("network-failure");
    expect(removeButton(1)).toHaveAttribute("data-pending", "true");
    expect(removeButton(2)).not.toHaveAttribute("data-pending");
    evidence("response");
    expect(removeButton(1)).toHaveAttribute("data-pending", "true"); // recovered, still pending
    await act(async () => pending.resolve());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Remove Falls 1 from favorites" })).toBeNull(),
    );
    let release = () => {};
    act(() => {
      const result = updateSafety.tryAcquireGate();
      if (result.kind === "acquired") release = () => result.gate.release();
    });
    try {
      expect(removeButton(2)).toHaveAttribute("aria-disabled", "true");
      expect(removeButton(2)).toHaveAccessibleDescription(UPDATING_REASON);
      expect(removeButton(2)).not.toHaveAttribute("data-pending");
    } finally {
      act(() => release());
    }
    expect(removeButton(2)).not.toHaveAttribute("aria-disabled");
    expect(del).toHaveBeenCalledTimes(1);
  });
});
