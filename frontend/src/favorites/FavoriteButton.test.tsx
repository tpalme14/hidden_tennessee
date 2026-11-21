import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { addFavorite, listFavorites, removeFavorite, type FavoritesPage } from "../api/favorites";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { FavoriteButton } from "./FavoriteButton";
import { FavoritesProvider, MEMBERSHIP_MAX_PAGES } from "./FavoritesProvider";

/**
 * M03-T06 Increment 3 — the favorite control, driven by the REAL provider
 * (API module mocked, auth context supplied): every status, every outcome,
 * keyboard use, accessible names and states, focus, and the sign-in link.
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

const LANDMARK = "3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b";
const NAME = "Public Arch";

function pageOf(ids: string[], hasMore = false, page = 1): FavoritesPage {
  return {
    favorites: ids.map((landmark_id) => ({ landmark_id, availability: "unavailable" as const })),
    page,
    limit: 100,
    has_more: hasMore,
  };
}

function renderButton(
  session: SessionState = { status: "authenticated", user: TEST_USER },
  path = "/landmarks/x?from=search#top",
) {
  const refresh = vi.fn(() => Promise.resolve());
  const auth: AuthContextValue = {
    session,
    checking: false,
    refresh,
    signOut: vi.fn(() => Promise.resolve()),
  };
  render(
    <AuthContext.Provider value={auth}>
      <FavoritesProvider>
        <MemoryRouter initialEntries={[path]}>
          <FavoriteButton landmarkId={LANDMARK} displayName={NAME} />
        </MemoryRouter>
      </FavoritesProvider>
    </AuthContext.Provider>,
  );
  return { refresh };
}

const toggle = () => screen.getByRole("button", { name: `Favorite ${NAME}` });
const saveOnly = () => screen.getByRole("button", { name: `Save ${NAME} to favorites` });
const status = () => screen.getByRole("status");

async function renderReady(saved: boolean) {
  list.mockResolvedValueOnce(pageOf(saved ? [LANDMARK] : []));
  const harness = renderButton();
  await waitFor(() => expect(toggle()).toHaveAttribute("aria-pressed", String(saved)));
  return harness;
}

beforeEach(() => {
  list.mockReset();
  add.mockReset();
  del.mockReset();
});

describe("FavoriteButton — states", () => {
  it("checking (session loading): busy, inactive, no aria-pressed; presses send nothing", async () => {
    renderButton({ status: "loading" });
    const button = toggle();
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).not.toHaveAttribute("aria-pressed");
    await userEvent.click(button);
    expect(add).not.toHaveBeenCalled();
  });

  it("checking (membership loading): same busy, inactive control", async () => {
    const d = deferred<FavoritesPage>();
    list.mockReturnValueOnce(d.promise);
    renderButton();
    expect(toggle()).toHaveAttribute("aria-disabled", "true");
    expect(toggle()).not.toHaveAttribute("aria-pressed");
    // Pressing while membership is unknown-yet sends nothing (L4).
    await userEvent.click(toggle());
    toggle().focus();
    await userEvent.keyboard("{Enter}");
    expect(add).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    await act(async () => d.resolve(pageOf([])));
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
    expect(toggle()).not.toHaveAttribute("aria-disabled");
  });

  it("unsaved and saved: a native toggle with a stable accessible name", async () => {
    await renderReady(false);
    expect(toggle().tagName).toBe("BUTTON");
    expect(toggle()).toHaveAttribute("type", "button");
    expect(toggle()).toHaveTextContent("Favorite");
    expect(status()).toHaveTextContent("");
  });

  it("unknown (partial membership): save-only with an explanation, no aria-pressed", async () => {
    for (let p = 1; p <= MEMBERSHIP_MAX_PAGES; p += 1) {
      list.mockResolvedValueOnce(pageOf([`0000000${p}-0000-4000-8000-000000000000`], true, p));
    }
    renderButton();
    const button = await screen.findByRole("button", { name: `Save ${NAME} to favorites` });
    expect(button).not.toHaveAttribute("aria-pressed");
    expect(button).toHaveTextContent("Save to favorites");
    expect(button).toHaveAccessibleDescription(
      "We couldn't confirm whether this is already saved.",
    );
  });

  it("signed out: a native sign-in link whose returnTo is the current path and query", () => {
    renderButton({ status: "anonymous" });
    const link = screen.getByRole("link", { name: `Sign in to save ${NAME}` });
    expect(link).toHaveTextContent("Sign in to save");
    expect(link).toHaveAttribute(
      "href",
      `/sign-in?returnTo=${encodeURIComponent("/landmarks/x?from=search")}`,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("an unverified, unavailable session with no user shows the sign-in link too", () => {
    renderButton({ status: "unavailable", retry: () => Promise.resolve() });
    expect(screen.getByRole("link", { name: `Sign in to save ${NAME}` })).toBeInTheDocument();
  });
});

describe("FavoriteButton — confirmed outcomes", () => {
  it("save (201): pending while in flight, then pressed and a polite 'Saved' announcement", async () => {
    await renderReady(false);
    const d = deferred<{ landmarkId: string; created: boolean }>();
    add.mockReturnValueOnce(d.promise);
    const button = toggle();

    await userEvent.click(button);
    expect(add).toHaveBeenCalledWith(LANDMARK);
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-pressed", "false"); // not optimistic
    expect(button).toHaveFocus();
    expect(status()).toHaveTextContent("");

    await act(async () => d.resolve({ landmarkId: LANDMARK, created: true }));
    expect(toggle()).toBe(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(button).not.toHaveAttribute("aria-busy");
    expect(button).toHaveFocus();
    expect(status()).toHaveTextContent("Saved to favorites.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("save (200): announced as already saved", async () => {
    await renderReady(false);
    add.mockResolvedValueOnce({ landmarkId: LANDMARK, created: false });
    await userEvent.click(toggle());
    await waitFor(() => expect(status()).toHaveTextContent("Already in your favorites."));
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });

  it("remove: unpressed and a polite 'Removed' announcement; the name never changes", async () => {
    await renderReady(true);
    del.mockResolvedValueOnce({ landmarkId: LANDMARK });
    await userEvent.click(toggle());
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-pressed", "false"));
    expect(del).toHaveBeenCalledWith(LANDMARK);
    expect(add).not.toHaveBeenCalled();
    expect(status()).toHaveTextContent("Removed from favorites.");
  });

  it("unknown → save: becomes the pressed toggle on the SAME focused button", async () => {
    for (let p = 1; p <= MEMBERSHIP_MAX_PAGES; p += 1) {
      list.mockResolvedValueOnce(pageOf([], true, p));
    }
    renderButton();
    const button = await screen.findByRole("button", { name: `Save ${NAME} to favorites` });
    add.mockResolvedValueOnce({ landmarkId: LANDMARK, created: false });
    button.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-pressed", "true"));
    expect(toggle()).toBe(button);
    expect(button).toHaveFocus();
    expect(status()).toHaveTextContent("Already in your favorites.");
    expect(del).not.toHaveBeenCalled();
  });

  it("nothing is announced before any action", async () => {
    await renderReady(true);
    expect(status()).toBeEmptyDOMElement();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("FavoriteButton — keyboard and duplicate presses", () => {
  it("Space and Enter both activate it", async () => {
    await renderReady(false);
    add.mockResolvedValueOnce({ landmarkId: LANDMARK, created: true });
    del.mockResolvedValueOnce({ landmarkId: LANDMARK });

    await userEvent.tab();
    expect(toggle()).toHaveFocus();
    await userEvent.keyboard(" ");
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-pressed", "true"));
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(toggle()).toHaveAttribute("aria-pressed", "false"));
    expect(add).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledTimes(1);
  });

  it("repeated presses while pending send exactly one request; the control stays focusable", async () => {
    await renderReady(false);
    const d = deferred<{ landmarkId: string; created: boolean }>();
    add.mockReturnValueOnce(d.promise);
    await userEvent.click(toggle());
    await userEvent.click(toggle());
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(add).toHaveBeenCalledTimes(1);
    expect(toggle()).toHaveFocus();
    expect(toggle()).not.toBeDisabled(); // aria-disabled, not the disabled attribute
    await act(async () => d.resolve({ landmarkId: LANDMARK, created: true }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved to favorites.");
  });
});

describe("FavoriteButton — failures never imply success", () => {
  it("404: an alert, no success announcement; the control becomes save-only (unknown)", async () => {
    await renderReady(false);
    add.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "Resource not found."));
    await userEvent.click(toggle());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "This landmark can't be saved right now.",
    );
    expect(status()).toHaveTextContent("");
    expect(saveOnly()).not.toHaveAttribute("aria-pressed");
  });

  it.each([
    [30, "Too many requests. Please try again in 30 seconds."],
    [1, "Too many requests. Please try again in 1 second."],
    [undefined, "Too many requests. Please wait a moment and try again."],
  ])("429 (Retry-After %s): one alert; state unchanged", async (seconds, text) => {
    await renderReady(true);
    del.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "Too many requests.", seconds));
    await userEvent.click(toggle());
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(status()).toHaveTextContent("");
    expect(toggle()).toHaveAttribute("aria-pressed", "true");
  });

  it("401: an alert and an auth re-check; still treated as signed in until verified otherwise", async () => {
    const { refresh } = await renderReady(false);
    add.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "Authentication required."));
    await userEvent.click(toggle());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't update favorites because your session may have ended.",
    );
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("other failures: a generic alert", async () => {
    await renderReady(false);
    add.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "Something went wrong."));
    await userEvent.click(toggle());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Couldn't update favorites. Please try again.",
    );
    expect(toggle()).toHaveAttribute("aria-pressed", "false");
  });

  it("a new action clears the previous alert; a later success is announced without a stale error", async () => {
    await renderReady(false);
    add
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x"))
      .mockResolvedValueOnce({ landmarkId: LANDMARK, created: true });
    await userEvent.click(toggle());
    await screen.findByRole("alert");
    await userEvent.click(toggle());
    await waitFor(() => expect(status()).toHaveTextContent("Saved to favorites."));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
