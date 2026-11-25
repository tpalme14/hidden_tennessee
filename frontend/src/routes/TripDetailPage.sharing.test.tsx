import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../api/auth";
import { ApiError } from "../api/client";
import {
  deleteTrip,
  enableTripSharing,
  getTrip,
  removeTripStop,
  renameTrip,
  reorderTripStops,
  revokeTripSharing,
  type OwnerTrip,
  type TripStop,
} from "../api/trips";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { TripDetailPage } from "./TripDetailPage";

/**
 * M05-T06 Increment 4 — the owner Sharing section with the REAL `useTrip`
 * hook (API module and clipboard mocked): visibility, the three states,
 * create/rotate/revoke with the mandatory re-read, the version-based
 * confirmation of a received link, held-link invalidation, unavailable and
 * uncertain outcomes, the clipboard, the shared lock in both directions,
 * session isolation, and token confidentiality.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  getTrip: vi.fn(),
  enableTripSharing: vi.fn(),
  revokeTripSharing: vi.fn(),
  renameTrip: vi.fn(),
  deleteTrip: vi.fn(),
  removeTripStop: vi.fn(),
  reorderTripStops: vi.fn(),
}));

const get = vi.mocked(getTrip);
const enable = vi.mocked(enableTripSharing);
const revoke = vi.mocked(revokeTripSharing);
const rename = vi.mocked(renameTrip);
const del = vi.mocked(deleteTrip);
const remove = vi.mocked(removeTripStop);
const reorder = vi.mocked(reorderTripStops);

const OTHER_USER: AuthUser = { ...TEST_USER, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const TRIP_A = "0f8fad5b-d9cb-469f-a165-70867728950e";
const TIME = "2026-11-23T16:00:00.000Z";
const TOKEN_1 = `${"A".repeat(21)}_${"q".repeat(21)}`;
const TOKEN_2 = `${"B".repeat(21)}-${"z".repeat(21)}`;
const URL_1 = `https://share.example.test/shared/trips/${TOKEN_1}`;
const URL_2 = `https://share.example.test/shared/trips/${TOKEN_2}`;

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
      latitude: 35.6,
      longitude: -83.5 + n / 10,
    },
  };
}

function tripOf(extra: Partial<OwnerTrip> = {}, stopNumbers = [1, 2]): OwnerTrip {
  const stops = stopNumbers.map((n, i) => stop(n, i));
  return {
    id: TRIP_A,
    name: "Weekend Waterfalls",
    version: 3,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops,
    distance_summary: { total_miles: null, measured_legs: 0, total_legs: stops.length - 1 },
    ...extra,
  };
}

function Probe() {
  const location = useLocation();
  return (
    <div data-testid="location" data-state={JSON.stringify(location.state ?? null)}>
      {`${location.pathname}${location.search}${location.hash}`}
    </div>
  );
}

function Harness({ session, refresh }: { session: SessionState; refresh: () => Promise<void> }) {
  const auth: AuthContextValue = {
    session,
    checking: false,
    refresh,
    signOut: vi.fn(() => Promise.resolve()),
  };
  return (
    <AuthContext.Provider value={auth}>
      <Routes>
        <Route path="/trips/:tripId" element={<TripDetailPage />} />
        <Route path="/landmarks/:id" element={<p>Profile page</p>} />
      </Routes>
      <button type="button">Elsewhere</button>
      <Probe />
    </AuthContext.Provider>
  );
}

async function renderReady(initial: OwnerTrip = tripOf()) {
  get.mockResolvedValueOnce(initial);
  const refresh = vi.fn(() => Promise.resolve());
  const path = `/trips/${TRIP_A}`;
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Harness session={{ status: "authenticated", user: TEST_USER }} refresh={refresh} />
    </MemoryRouter>,
  );
  await screen.findByRole("list", { name: "Stops" });
  return {
    refresh,
    view,
    setSession(next: SessionState) {
      view.rerender(
        <MemoryRouter initialEntries={[path]}>
          <Harness session={next} refresh={refresh} />
        </MemoryRouter>,
      );
    },
  };
}

/** Renders a trip that already holds a CONFIRMED link (URL_1) at version 4. */
async function renderWithHeldLink() {
  const view = await renderReady(tripOf({ version: 3 }));
  enable.mockResolvedValueOnce(URL_1);
  get.mockResolvedValueOnce(tripOf({ version: 4, is_shared: true }));
  await userEvent.click(createLinkButton());
  expect(linkField()).toHaveValue(URL_1);
  return view;
}

const sharingSection = () => screen.queryByRole("region", { name: "Sharing" });
const status = () => screen.getByRole("status");
const createLinkButton = () => screen.getByRole("button", { name: "Create share link" });
const newLinkButton = () => screen.getByRole("button", { name: "Create new link" });
const turnOffButton = () => screen.getByRole("button", { name: "Turn off sharing" });
const copyButton = () => screen.getByRole("button", { name: "Copy link" });
const linkField = () => screen.getByLabelText("Share link");
const removeButton = (n: number) =>
  screen.getByRole("button", { name: `Remove Falls ${n} from the trip` });

function stubClipboard(writeText: ((text: string) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: writeText === undefined ? undefined : { writeText: vi.fn(writeText) },
  });
  return (navigator.clipboard as unknown as { writeText: ReturnType<typeof vi.fn> } | undefined)
    ?.writeText;
}

beforeEach(() => {
  for (const mock of [get, enable, revoke, rename, del, remove, reorder]) mock.mockReset();
});

afterEach(() => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  vi.restoreAllMocks();
});

describe("visibility and states", () => {
  it("sharing disabled on the server: no Sharing section at all", async () => {
    await renderReady(tripOf({ sharing_enabled: false, is_shared: true }));
    expect(sharingSection()).toBeNull();
    expect(screen.queryByRole("button", { name: /share link|new link|sharing/i })).toBeNull();
  });

  it("not shared: explains public access and forwarding, offers Create share link", async () => {
    await renderReady();
    const section = sharingSection()!;
    expect(within(section).getByRole("heading", { level: 3, name: "Sharing" })).toBeInTheDocument();
    expect(section).toHaveTextContent("anyone who has the link can view");
    expect(section).toHaveTextContent("without signing in");
    expect(section).toHaveTextContent("can forward it");
    expect(createLinkButton()).toBeInTheDocument();
    expect(screen.queryByLabelText("Share link")).toBeNull();
  });

  it("shared with no link held (after a reload): explains, offers Create new link and Turn off sharing, invents no link", async () => {
    await renderReady(tripOf({ is_shared: true }));
    const section = sharingSection()!;
    expect(section).toHaveTextContent("the current link can't be shown again");
    expect(section).toHaveTextContent(
      "Create new link replaces the current link: the current link stops working.",
    );
    expect(newLinkButton()).toBeInTheDocument();
    expect(turnOffButton()).toBeInTheDocument();
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(section.textContent).not.toMatch(/shared\/trips/);
  });
});

describe("create, rotate, revoke", () => {
  it("create: pending feedback, the provisional link hidden until the re-read confirms it, then shown with focus on Copy link", async () => {
    await renderReady();
    const request = deferred<string>();
    const reread = deferred<OwnerTrip>();
    enable.mockReturnValueOnce(request.promise);
    get.mockReturnValueOnce(reread.promise);
    await userEvent.click(createLinkButton());
    expect(enable).toHaveBeenCalledWith(TRIP_A);
    expect(status()).toHaveTextContent("Creating share link…");
    expect(createLinkButton()).toHaveAttribute("aria-disabled", "true");
    await act(async () => request.resolve(URL_1));
    // The URL has arrived but is not confirmed: nothing shows it.
    expect(status()).toHaveTextContent("Updating the trip…");
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN_1);
    await act(async () => reread.resolve(tripOf({ version: 4, is_shared: true })));
    expect(linkField()).toHaveValue(URL_1);
    expect(linkField()).toHaveAttribute("readonly");
    expect(status()).toHaveTextContent(
      "Share link created. Anyone with the link can view this trip.",
    );
    expect(status().textContent).not.toContain(TOKEN_1);
    expect(copyButton()).toHaveFocus();
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("rotate: the held link disappears as the change begins; the new one appears only after confirmation", async () => {
    await renderWithHeldLink();
    const request = deferred<string>();
    enable.mockReturnValueOnce(request.promise);
    get.mockResolvedValueOnce(tripOf({ version: 5, is_shared: true }));
    await userEvent.click(newLinkButton());
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN_1);
    await act(async () => request.resolve(URL_2));
    expect(linkField()).toHaveValue(URL_2);
    expect(status()).toHaveTextContent(
      "New share link created. The previous link no longer works.",
    );
  });

  it("rotate: while the mandatory re-read is pending, neither the old nor the new link is shown", async () => {
    await renderWithHeldLink();
    const reread = deferred<OwnerTrip>();
    enable.mockResolvedValueOnce(URL_2);
    get.mockReturnValueOnce(reread.promise);
    await userEvent.click(newLinkButton());
    expect(status()).toHaveTextContent("Updating the trip…");
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN_1);
    expect(document.body.innerHTML).not.toContain(TOKEN_2);
    await act(async () => reread.resolve(tripOf({ version: 5, is_shared: true })));
    expect(linkField()).toHaveValue(URL_2);
  });

  it("a re-read at a version other than captured + 1 discards the received link (another change intervened)", async () => {
    await renderReady(tripOf({ version: 3 }));
    enable.mockResolvedValueOnce(URL_1);
    get.mockResolvedValueOnce(tripOf({ version: 5, is_shared: true }));
    await userEvent.click(createLinkButton());
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(
      "this trip changed at the same time, so that link couldn't be confirmed and isn't shown",
    );
    expect(newLinkButton()).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Sharing" })).toHaveFocus();
    expect(document.body.textContent).not.toContain(TOKEN_1);
  });

  it("a re-read showing sharing inactive discards the received link", async () => {
    await renderReady(tripOf({ version: 3 }));
    enable.mockResolvedValueOnce(URL_1);
    get.mockResolvedValueOnce(tripOf({ version: 4, is_shared: false }));
    await userEvent.click(createLinkButton());
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent("sharing isn't active for this trip now");
    expect(createLinkButton()).toBeInTheDocument();
  });

  it("a re-read showing sharing disabled hides the section and moves lost focus to Stops", async () => {
    await renderReady(tripOf({ version: 3 }));
    enable.mockResolvedValueOnce(URL_1);
    get.mockResolvedValueOnce(tripOf({ version: 4, is_shared: true, sharing_enabled: false }));
    await userEvent.click(createLinkButton());
    expect(sharingSection()).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Stops" })).toHaveFocus();
    expect(document.body.textContent).not.toContain(TOKEN_1);
  });

  it("a failed re-read after a created link: stale, no link; Reload only reads and shows no link", async () => {
    await renderReady(tripOf({ version: 3 }));
    enable.mockResolvedValueOnce(URL_1);
    get.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    await userEvent.click(createLinkButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "A share link was created, but the updated trip couldn't be loaded",
    );
    get.mockResolvedValueOnce(tripOf({ version: 4, is_shared: true }));
    await userEvent.click(within(alert).getByRole("button", { name: "Reload trip" }));
    expect(await screen.findByRole("button", { name: "Create new link" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it("revoke: the held link disappears at once; confirmed off is announced with focus on Create share link", async () => {
    await renderWithHeldLink();
    const request = deferred<void>();
    revoke.mockReturnValueOnce(request.promise);
    get.mockResolvedValueOnce(tripOf({ version: 5, is_shared: false }));
    await userEvent.click(turnOffButton());
    expect(revoke).toHaveBeenCalledWith(TRIP_A);
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(status()).toHaveTextContent("Turning off sharing…");
    await act(async () => request.resolve());
    expect(status()).toHaveTextContent("Sharing turned off. The previous link no longer works.");
    expect(createLinkButton()).toHaveFocus();
  });

  it("revoke confirmed, but the re-read shows sharing on again: says so, shows no link", async () => {
    await renderWithHeldLink();
    revoke.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce(tripOf({ version: 6, is_shared: true }));
    await userEvent.click(turnOffButton());
    expect(screen.getByRole("alert")).toHaveTextContent("the trip is shared again now");
    expect(status()).not.toHaveTextContent("Sharing turned off");
    expect(screen.queryByLabelText("Share link")).toBeNull();
  });

  it("a failed re-read after a revoke: stale ('unshared'); Reload only reads", async () => {
    await renderWithHeldLink();
    revoke.mockResolvedValueOnce(undefined);
    get.mockRejectedValueOnce(new ApiError(503, "SERVICE_UNAVAILABLE", "x"));
    await userEvent.click(turnOffButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Sharing was turned off, but the updated trip couldn't be loaded.",
    );
    get.mockResolvedValueOnce(tripOf({ version: 5 }));
    await userEvent.click(within(alert).getByRole("button", { name: "Reload trip" }));
    expect(await screen.findByRole("button", { name: "Create share link" })).toBeInTheDocument();
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});

describe("unavailable, refusals, and uncertain outcomes", () => {
  it("409 TRIP_SHARING_UNAVAILABLE: re-reads, hides the section, announces, never retries", async () => {
    await renderReady();
    enable.mockRejectedValueOnce(new ApiError(409, "TRIP_SHARING_UNAVAILABLE", "x"));
    get.mockResolvedValueOnce(tripOf({ sharing_enabled: false }));
    await userEvent.click(createLinkButton());
    expect(status()).toHaveTextContent("Sharing isn't available right now.");
    expect(sharingSection()).toBeNull();
    expect(screen.getByRole("heading", { level: 3, name: "Stops" })).toHaveFocus();
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it("401 re-checks the session; 404 is the generic not-found", async () => {
    const { refresh } = await renderReady();
    enable.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "x"));
    await userEvent.click(createLinkButton());
    expect(refresh).toHaveBeenCalled();
    expect(sharingSection()).toBeNull();
  });

  it("404 to a revoke is the generic not-found", async () => {
    await renderReady(tripOf({ is_shared: true }));
    revoke.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "x"));
    await userEvent.click(turnOffButton());
    expect(await screen.findByText(/This trip couldn.t be found/)).toBeInTheDocument();
  });

  it.each<[string, ApiError, string]>([
    [
      "429",
      new ApiError(429, "RATE_LIMITED", "x", 6),
      "Couldn't change the trip. Too many requests. Please try again in 6 seconds.",
    ],
    [
      "403",
      new ApiError(403, "INVALID_ORIGIN", "raw detail"),
      "Couldn't change the trip. Please try again.",
    ],
  ])("%s: the established alert, nothing replayed", async (_label, error, text) => {
    await renderReady();
    enable.mockRejectedValueOnce(error);
    await userEvent.click(createLinkButton());
    expect(screen.getByRole("alert")).toHaveTextContent(text);
    expect(screen.getByRole("alert")).not.toHaveTextContent("raw detail");
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it("uncertain create, sharing now on: may have been created, earlier link may not work, no link shown", async () => {
    await renderWithHeldLink();
    enable.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    get.mockResolvedValueOnce(tripOf({ version: 5, is_shared: true }));
    await userEvent.click(newLinkButton());
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "a new link may have been created, and an earlier link may no longer work",
    );
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(enable).toHaveBeenCalledTimes(2);
  });

  it("uncertain create, sharing now off: says sharing is currently off (not 'no link was created')", async () => {
    await renderReady();
    enable.mockRejectedValueOnce(new ApiError(502, "BAD_GATEWAY", "x"));
    get.mockResolvedValueOnce(tripOf({ version: 3, is_shared: false }));
    await userEvent.click(createLinkButton());
    expect(status()).toHaveTextContent("Sharing is currently off for this trip.");
    expect(status()).not.toHaveTextContent("no link");
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it("uncertain create with a failed re-read: stale; Reload only reads", async () => {
    await renderReady();
    enable.mockRejectedValueOnce(new ApiError(200, "INVALID_RESPONSE", "x"));
    get.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    await userEvent.click(createLinkButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn't confirm whether the sharing change was saved");
    get.mockResolvedValueOnce(tripOf({ version: 4, is_shared: true }));
    await userEvent.click(within(alert).getByRole("button", { name: "Reload trip" }));
    expect(await screen.findByRole("button", { name: "Create new link" })).toBeInTheDocument();
    expect(enable).toHaveBeenCalledTimes(1);
  });

  it.each<[boolean, string]>([
    [true, "Couldn't confirm that sharing was turned off. Sharing is still on."],
    [false, "Couldn't confirm the change, but sharing is currently off for this trip."],
  ])("uncertain revoke, sharing now %s", async (active, text) => {
    await renderWithHeldLink();
    revoke.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    get.mockResolvedValueOnce(tripOf({ version: active ? 4 : 5, is_shared: active }));
    await userEvent.click(turnOffButton());
    expect(document.body).toHaveTextContent(text);
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(revoke).toHaveBeenCalledTimes(1);
  });
});

describe("held-link invalidation", () => {
  it("our own confirmed rename (one increment) keeps the link", async () => {
    await renderWithHeldLink();
    rename.mockResolvedValueOnce(tripOf({ version: 5, is_shared: true, name: "Renamed" }));
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Trip name"), { target: { value: "Renamed" } });
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(linkField()).toHaveValue(URL_1);
  });

  it("our own confirmed move (one increment) keeps the link", async () => {
    await renderWithHeldLink();
    reorder.mockResolvedValueOnce(tripOf({ version: 5, is_shared: true }, [2, 1]));
    await userEvent.click(screen.getByRole("button", { name: "Move down: Falls 1" }));
    expect(linkField()).toHaveValue(URL_1);
  });

  it("our own removal whose re-read is exactly one increment later keeps the link", async () => {
    await renderWithHeldLink();
    remove.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce(tripOf({ version: 5, is_shared: true }, [2]));
    await userEvent.click(removeButton(1));
    expect(linkField()).toHaveValue(URL_1);
  });

  it("a removal whose re-read shows more than one increment clears the link (something else changed)", async () => {
    await renderWithHeldLink();
    remove.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce(tripOf({ version: 6, is_shared: true }, [2]));
    await userEvent.click(removeButton(1));
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(newLinkButton()).toBeInTheDocument();
  });

  it("a rename conflict (another change happened) clears the link", async () => {
    await renderWithHeldLink();
    rename.mockRejectedValueOnce(new ApiError(409, "TRIP_VERSION_CONFLICT", "x"));
    get.mockResolvedValueOnce(tripOf({ version: 6, is_shared: true }));
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Trip name"), { target: { value: "Mine" } });
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    expect(screen.queryByLabelText("Share link")).toBeNull();
  });

  it("an uncertain change whose re-read shows the same version keeps the link (nothing changed)", async () => {
    await renderWithHeldLink();
    reorder.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    get.mockResolvedValueOnce(tripOf({ version: 4, is_shared: true }));
    await userEvent.click(screen.getByRole("button", { name: "Move down: Falls 1" }));
    expect(linkField()).toHaveValue(URL_1);
  });

  it("a re-read showing sharing off (revoked elsewhere) clears the link", async () => {
    await renderWithHeldLink();
    reorder.mockRejectedValueOnce(new ApiError(409, "TRIP_VERSION_CONFLICT", "x"));
    get.mockResolvedValueOnce(tripOf({ version: 5, is_shared: false }));
    await userEvent.click(screen.getByRole("button", { name: "Move down: Falls 1" }));
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(createLinkButton()).toBeInTheDocument();
  });

  it("sharing switched off on the server at the SAME version clears the link; switching it back on does not restore it", async () => {
    await renderWithHeldLink();
    reorder.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    get.mockResolvedValueOnce(tripOf({ version: 4, is_shared: true, sharing_enabled: false }));
    await userEvent.click(screen.getByRole("button", { name: "Move down: Falls 1" }));
    expect(sharingSection()).toBeNull();
    reorder.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    get.mockResolvedValueOnce(tripOf({ version: 4, is_shared: true, sharing_enabled: true }));
    await userEvent.click(screen.getByRole("button", { name: "Move down: Falls 1" }));
    expect(newLinkButton()).toBeInTheDocument();
    expect(screen.queryByLabelText("Share link")).toBeNull();
  });

  it("a stale trip clears the link, and Reload never brings it back", async () => {
    await renderWithHeldLink();
    remove.mockResolvedValueOnce(undefined);
    get.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "x"));
    await userEvent.click(removeButton(1));
    get.mockResolvedValueOnce(tripOf({ version: 5, is_shared: true }, [2]));
    await userEvent.click(await screen.findByRole("button", { name: "Reload trip" }));
    expect(await screen.findByRole("button", { name: "Create new link" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Share link")).toBeNull();
  });
});

describe("clipboard", () => {
  it("success is reported only after writeText resolves; the link itself is never announced", async () => {
    await renderWithHeldLink();
    const write = deferred<void>();
    const writeText = stubClipboard(() => write.promise)!;
    await userEvent.click(copyButton());
    expect(writeText).toHaveBeenCalledWith(URL_1);
    expect(status()).not.toHaveTextContent("copied");
    await act(async () => write.resolve());
    expect(status()).toHaveTextContent("Share link copied.");
    expect(status().textContent).not.toContain(TOKEN_1);
  });

  it("a rejected copy selects the field's text and explains manual copying", async () => {
    await renderWithHeldLink();
    stubClipboard(() => Promise.reject(new Error("denied")));
    await userEvent.click(copyButton());
    const field = linkField() as HTMLInputElement;
    expect(field).toHaveFocus();
    expect(field.selectionStart).toBe(0);
    expect(field.selectionEnd).toBe(URL_1.length);
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't copy the link automatically. The link is selected in the Share link field",
    );
    expect(screen.getByRole("alert").textContent).not.toContain(TOKEN_1);
    expect(status()).not.toHaveTextContent("copied");
  });

  it("without the Clipboard API: the same manual fallback", async () => {
    await renderWithHeldLink();
    stubClipboard(undefined);
    await userEvent.click(copyButton());
    expect(linkField()).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't copy the link automatically.");
  });

  it("a failed copy never takes focus the user moved elsewhere", async () => {
    await renderWithHeldLink();
    const write = deferred<void>();
    stubClipboard(() => write.promise);
    await userEvent.click(copyButton());
    const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
    elsewhere.focus();
    await act(async () => write.reject(new Error("denied")));
    expect(elsewhere).toHaveFocus();
    expect(screen.getByRole("alert")).toHaveTextContent("Select the link in the Share link field");
  });

  it("a copy that finishes after the link was replaced reports nothing", async () => {
    await renderWithHeldLink();
    const write = deferred<void>();
    stubClipboard(() => write.promise);
    await userEvent.click(copyButton());
    enable.mockReturnValueOnce(new Promise(() => undefined));
    await userEvent.click(newLinkButton());
    await act(async () => write.resolve());
    expect(status()).not.toHaveTextContent("copied");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a copy that finishes after the user changed reports nothing", async () => {
    const { setSession } = await renderWithHeldLink();
    const write = deferred<void>();
    stubClipboard(() => write.promise);
    await userEvent.click(copyButton());
    get.mockResolvedValueOnce(tripOf({ is_shared: true }));
    setSession({ status: "authenticated", user: OTHER_USER });
    await act(async () => write.reject(new Error("late")));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(status()).not.toHaveTextContent("copied");
  });
});

describe("the shared single-change lock", () => {
  it("a pending share change blocks rename, remove, and delete", async () => {
    await renderReady();
    const request = deferred<string>();
    enable.mockReturnValueOnce(request.promise);
    await userEvent.click(createLinkButton());
    await userEvent.click(removeButton(1));
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Trip name"), { target: { value: "X" } });
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete trip" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete trip permanently" }));
    expect(remove).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
    await act(async () => request.reject(new ApiError(429, "RATE_LIMITED", "x")));
  });

  it("pending rename, move, or delete block creating and turning off sharing", async () => {
    await renderReady(tripOf({ is_shared: true }));
    const renaming = deferred<OwnerTrip>();
    rename.mockReturnValueOnce(renaming.promise);
    await userEvent.click(screen.getByRole("button", { name: "Rename" }));
    fireEvent.change(screen.getByLabelText("Trip name"), { target: { value: "X" } });
    await userEvent.click(screen.getByRole("button", { name: "Save name" }));
    await userEvent.click(newLinkButton());
    await userEvent.click(turnOffButton());
    expect(enable).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
    await act(async () => renaming.resolve(tripOf({ version: 4, is_shared: true, name: "X" })));

    const moving = deferred<OwnerTrip>();
    reorder.mockReturnValueOnce(moving.promise);
    await userEvent.click(screen.getByRole("button", { name: "Move down: Falls 1" }));
    await userEvent.click(newLinkButton());
    expect(enable).not.toHaveBeenCalled();
    await act(async () =>
      moving.resolve(tripOf({ version: 5, is_shared: true, name: "X" }, [2, 1])),
    );

    const deleting = deferred<void>();
    del.mockReturnValueOnce(deleting.promise);
    await userEvent.click(screen.getByRole("button", { name: "Delete trip" }));
    await userEvent.click(screen.getByRole("button", { name: "Delete trip permanently" }));
    await userEvent.click(turnOffButton());
    expect(revoke).not.toHaveBeenCalled();
    await act(async () => deleting.reject(new ApiError(429, "RATE_LIMITED", "x")));
  });

  it("the lock is held through the mandatory re-read", async () => {
    await renderReady();
    const reread = deferred<OwnerTrip>();
    enable.mockResolvedValueOnce(URL_1);
    get.mockReturnValueOnce(reread.promise);
    await userEvent.click(createLinkButton());
    expect(status()).toHaveTextContent("Updating the trip…");
    await userEvent.click(removeButton(1));
    expect(remove).not.toHaveBeenCalled();
    await act(async () => reread.resolve(tripOf({ version: 4, is_shared: true })));
  });

  it("repeated activations before React re-renders send one request", async () => {
    await renderReady();
    enable.mockReturnValue(new Promise(() => undefined));
    act(() => {
      fireEvent.click(createLinkButton());
      fireEvent.click(createLinkButton());
      fireEvent.click(createLinkButton());
    });
    expect(enable).toHaveBeenCalledTimes(1);
  });
});

describe("session isolation and confidentiality", () => {
  it("a different user never sees the link, and a late share response restores nothing", async () => {
    const { setSession } = await renderWithHeldLink();
    const request = deferred<string>();
    enable.mockReturnValueOnce(request.promise);
    await userEvent.click(newLinkButton());
    get.mockResolvedValueOnce(tripOf({ is_shared: true, name: "Bob's trip" }));
    setSession({ status: "authenticated", user: OTHER_USER });
    await screen.findByRole("heading", { level: 2, name: "Bob's trip" });
    get.mockResolvedValueOnce(tripOf({ version: 5, is_shared: true }));
    await act(async () => request.resolve(URL_2));
    expect(screen.queryByLabelText("Share link")).toBeNull();
    expect(document.body.textContent).not.toContain(TOKEN_1);
    expect(document.body.textContent).not.toContain(TOKEN_2);
  });

  it("an unconfirmed session clears the link; the same user re-verified does not get it back", async () => {
    const { setSession } = await renderWithHeldLink();
    setSession({ status: "loading" });
    expect(screen.queryByLabelText("Share link")).toBeNull();
    get.mockResolvedValueOnce(tripOf({ version: 4, is_shared: true }));
    setSession({ status: "authenticated", user: TEST_USER });
    expect(await screen.findByRole("button", { name: "Create new link" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Share link")).toBeNull();
  });

  it("the link is never stored, logged, put in the URL or history state, or announced", async () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const logs = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level),
    );
    await renderWithHeldLink();
    stubClipboard(() => Promise.resolve());
    await userEvent.click(copyButton());
    expect(setItem).not.toHaveBeenCalled();
    for (const storage of [localStorage, sessionStorage]) {
      for (let i = 0; i < storage.length; i += 1) {
        expect(storage.getItem(storage.key(i)!)).not.toContain(TOKEN_1);
      }
    }
    for (const spy of logs) {
      for (const call of spy.mock.calls) expect(JSON.stringify(call)).not.toContain(TOKEN_1);
    }
    const location = screen.getByTestId("location");
    expect(location.textContent).not.toContain(TOKEN_1);
    expect(location.getAttribute("data-state")).not.toContain(TOKEN_1);
    expect(status().textContent).not.toContain(TOKEN_1);
    // The only place the token appears is the read-only field's value.
    expect(document.body.innerHTML.split(TOKEN_1).length - 1).toBe(1);
    expect((linkField() as HTMLInputElement).value).toBe(URL_1);
  });

  it("existing stop editing works with the Sharing section present", async () => {
    await renderReady();
    remove.mockResolvedValueOnce(undefined);
    get.mockResolvedValueOnce(tripOf({ version: 4 }, [2]));
    await userEvent.click(removeButton(1));
    expect(status()).toHaveTextContent("Removed Falls 1 from the trip.");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
