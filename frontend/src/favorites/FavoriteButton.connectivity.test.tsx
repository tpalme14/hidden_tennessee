import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addFavorite, listFavorites, removeFavorite, type FavoritesPage } from "../api/favorites";
import { AuthContext, type AuthContextValue } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON, UPDATING_REASON } from "../connectivity/OnlineOnlyReason";
import { updateSafety } from "../pwa/updateSafety";
import { FavoriteButton } from "./FavoriteButton";
import { FavoritesProvider } from "./FavoritesProvider";

/**
 * M06-T02 Increment 3b-i — the favorite toggle as an online-only action
 * (OFF-UX-5). The favorites API module is mocked, so connectivity evidence
 * comes only from the test (through the application's connectivity store).
 */

vi.mock("../api/favorites", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/favorites")>()),
  listFavorites: vi.fn(),
  addFavorite: vi.fn(),
  removeFavorite: vi.fn(),
}));

const list = vi.mocked(listFavorites);
const add = vi.mocked(addFavorite);
const del = vi.mocked(removeFavorite);

const A = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const B = "4a2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6c";

function pageOf(ids: string[]): FavoritesPage {
  return {
    favorites: ids.map((landmark_id) => ({ landmark_id, availability: "unavailable" as const })),
    page: 1,
    limit: 100,
    has_more: false,
  };
}

function evidence(kind: RequestEvidence) {
  act(() => connectivity.reportOutcome(connectivity.beginRequest(), kind));
}
const browserEvent = (type: "online" | "offline") =>
  act(() => {
    window.dispatchEvent(new Event(type));
  });

function renderButtons(ids: string[] = [A]) {
  const auth: AuthContextValue = {
    session: { status: "authenticated", user: TEST_USER },
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  render(
    <AuthContext.Provider value={auth}>
      <FavoritesProvider>
        <MemoryRouter>
          {ids.map((id, i) => (
            <FavoriteButton key={id} landmarkId={id} displayName={`Place ${i + 1}`} />
          ))}
        </MemoryRouter>
      </FavoritesProvider>
    </AuthContext.Provider>,
  );
}

const toggle = (n = 1) => screen.getByRole("button", { name: `Favorite Place ${n}` });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
  list.mockResolvedValue(pageOf([]));
  add.mockResolvedValue({ created: true } as never);
  del.mockResolvedValue(undefined as never);
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
  vi.clearAllMocks();
});

async function ready() {
  renderButtons();
  await waitFor(() => expect(toggle()).toHaveAttribute("aria-pressed", "false"));
}

describe("FavoriteButton online-only availability", () => {
  it.each<[string, () => void]>([
    [
      "unknown reachability",
      () => {
        evidence("network-failure");
        browserEvent("online"); // unreachable → unknown
      },
    ],
    ["reachable", () => evidence("response")],
    ["a server problem", () => evidence("server-problem")],
    ["the browser's offline hint alone", () => browserEvent("offline")],
  ])("stays available with %s, and saves when pressed", async (_label, apply) => {
    await ready();
    apply();
    expect(toggle()).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(ONLINE_ONLY_REASON)).toBeNull();
    await userEvent.click(toggle());
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("is unavailable while unreachable: reason shown and associated; click, Enter, and Space send nothing and change nothing", async () => {
    await ready();
    evidence("network-failure");
    const button = toggle();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    await userEvent.click(button);
    button.focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(add).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    expect(toggle()).toHaveAttribute("aria-pressed", "false"); // no optimistic change
    expect(toggle()).toHaveFocus(); // focus is not moved
  });

  it("recovers on new evidence without acting by itself; then the user can save", async () => {
    await ready();
    evidence("network-failure");
    evidence("response");
    expect(toggle()).not.toHaveAttribute("aria-disabled");
    expect(add).not.toHaveBeenCalled();
    await userEvent.click(toggle());
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("a save already in flight keeps its lock when connectivity is lost, completes normally, and cannot be repeated", async () => {
    await ready();
    const pending = deferred<{ created: boolean }>();
    add.mockReturnValueOnce(pending.promise as never);
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-busy", "true");
    evidence("network-failure");
    expect(toggle()).toHaveAttribute("aria-busy", "true");
    expect(toggle()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(toggle());
    expect(add).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve({ created: true }));
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-pressed", "true"));
    // Still unreachable: available again only after recovery; nothing retried.
    expect(toggle()).toHaveAttribute("aria-disabled", "true");
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("marks only genuinely pending work (M06-T02 Increment 5): available, pending, unreachable, recovered while pending, update gate", async () => {
    await ready();
    expect(toggle()).not.toHaveAttribute("data-pending"); // available
    // Unavailable without pending work: aria-disabled but never data-pending.
    evidence("network-failure");
    expect(toggle()).toHaveAttribute("aria-disabled", "true");
    expect(toggle()).not.toHaveAttribute("data-pending");
    evidence("response");
    // A save in flight: pending, through connectivity loss and recovery.
    const pending = deferred<{ created: boolean }>();
    add.mockReturnValueOnce(pending.promise as never);
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute("data-pending", "true");
    evidence("network-failure");
    expect(toggle()).toHaveAttribute("data-pending", "true");
    evidence("response");
    expect(toggle()).toHaveAttribute("data-pending", "true"); // recovered, still pending
    await act(async () => pending.resolve({ created: true }));
    await waitFor(() => expect(toggle()).not.toHaveAttribute("data-pending"));
    // An update holding the transition gate: unavailable, not pending.
    let release = () => {};
    act(() => {
      const result = updateSafety.tryAcquireGate();
      if (result.kind === "acquired") release = () => result.gate.release();
    });
    try {
      expect(toggle()).toHaveAttribute("aria-disabled", "true");
      expect(toggle()).toHaveAccessibleDescription(UPDATING_REASON);
      expect(toggle()).not.toHaveAttribute("data-pending");
    } finally {
      act(() => release());
    }
    expect(toggle()).not.toHaveAttribute("aria-disabled");
    expect(toggle()).not.toHaveAttribute("data-pending");
    expect(add).toHaveBeenCalledTimes(1); // nothing retried
  });

  it("several toggles each reference their own reason element", async () => {
    renderButtons([A, B]);
    await waitFor(() => expect(toggle(2)).toHaveAttribute("aria-pressed", "false"));
    evidence("network-failure");
    const first = toggle(1).getAttribute("aria-describedby")!;
    const second = toggle(2).getAttribute("aria-describedby")!;
    expect(first).not.toBe(second);
    expect(document.getElementById(first)).toHaveTextContent(ONLINE_ONLY_REASON);
    expect(document.getElementById(second)).toHaveTextContent(ONLINE_ONLY_REASON);
  });
});
