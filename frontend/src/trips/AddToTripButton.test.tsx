import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AuthUser } from "../api/auth";
import { ApiError } from "../api/client";
import {
  addTripStop,
  createTrip,
  getTrip,
  listTrips,
  type AddedTripStop,
  type OwnerTrip,
  type TripListItem,
  type TripListPage,
} from "../api/trips";
import { AuthContext, type AuthContextValue, type SessionState } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { AddToTripButton } from "./AddToTripButton";
import { TRIP_NAME_MESSAGES } from "./tripNameRule";

/**
 * M05-T04 Increment 5 — "Add to trip" (profile variant) with the REAL
 * `useAddToTrip` hook; the trips API module is mocked and the auth context
 * supplied. Covers session gating, the picker (loading, empty, error,
 * pagination, selection), adding to an existing trip, create-then-add with
 * partial and uncertain outcomes, the single-action guard, stale-response
 * isolation, focus, and announcements.
 */

vi.mock("../api/trips", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/trips")>()),
  listTrips: vi.fn(),
  addTripStop: vi.fn(),
  createTrip: vi.fn(),
  getTrip: vi.fn(),
}));

const list = vi.mocked(listTrips);
const add = vi.mocked(addTripStop);
const create = vi.mocked(createTrip);
const read = vi.mocked(getTrip);

const OTHER_USER: AuthUser = { ...TEST_USER, id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const LANDMARK = "11111111-1111-4111-8111-000000000001";
const OTHER_LANDMARK = "11111111-1111-4111-8111-000000000002";
const TRIP = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TIME = "2026-11-23T16:00:00.000Z";
const RLO = String.fromCodePoint(0x202e);

function item(n: number, name = `Trip ${n}`, stops = n % 3): TripListItem {
  return { id: TRIP(n), name, stop_count: stops, updated_at: TIME, is_shared: false };
}

function pageOf(trips: TripListItem[], page = 1, hasMore = false): TripListPage {
  return { trips, page, limit: 100, has_more: hasMore };
}

function ownerTrip(id: string, name: string): OwnerTrip {
  return {
    id,
    name,
    version: 0,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops: [],
    distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
  };
}

function addedStop(): AddedTripStop {
  return {
    id: TRIP(900),
    position: 0,
    is_available: true,
    landmark: {
      id: LANDMARK,
      display_name: "Alpha Falls",
      category: "falls",
      latitude: 35.6,
      longitude: -83.5,
    },
  };
}

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function Harness({
  session,
  refresh,
  landmarkId = LANDMARK,
  name = "Alpha Falls",
}: {
  session: SessionState;
  refresh: () => Promise<void>;
  landmarkId?: string;
  name?: string;
}) {
  const auth: AuthContextValue = {
    session,
    checking: false,
    refresh,
    signOut: vi.fn(() => Promise.resolve()),
  };
  return (
    <AuthContext.Provider value={auth}>
      <Routes>
        <Route
          path="/landmarks/:id"
          element={<AddToTripButton landmarkId={landmarkId} displayName={name} />}
        />
      </Routes>
      <button type="button">Elsewhere</button>
      <LocationProbe />
    </AuthContext.Provider>
  );
}

function renderButton(
  session: SessionState = { status: "authenticated", user: TEST_USER },
  path = `/landmarks/${LANDMARK}?from=map`,
) {
  const refresh = vi.fn(() => Promise.resolve());
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Harness session={session} refresh={refresh} />
    </MemoryRouter>,
  );
  return {
    refresh,
    view,
    rerender(next: { session?: SessionState; landmarkId?: string; name?: string }) {
      view.rerender(
        <MemoryRouter initialEntries={[path]}>
          <Harness
            session={next.session ?? session}
            refresh={refresh}
            landmarkId={next.landmarkId ?? LANDMARK}
            name={next.name ?? "Alpha Falls"}
          />
        </MemoryRouter>,
      );
    },
  };
}

const toggle = () => screen.getByRole("button", { name: "Add to trip: Alpha Falls" });
const panel = () => screen.getByRole("region", { name: "Add Alpha Falls to a trip" });
const radio = (name: RegExp | string) => screen.getByRole("radio", { name });
const addButton = () =>
  screen.getByRole("button", { name: "Add to the selected trip: Alpha Falls" });
const status = () => screen.getByRole("status");

async function openWith(...pages: TripListPage[]) {
  for (const p of pages) list.mockResolvedValueOnce(p);
  const harness = renderButton();
  await userEvent.click(toggle());
  await screen.findByRole("group", { name: "Choose a trip" });
  return harness;
}

/**
 * Finds a live region (status, alert, or aria-live) whose FULL text matches —
 * messages render names in their own <bdi> elements (Increment 6), so the text
 * spans several nodes and `findByText` cannot match it.
 */
async function findMessage(text: string | RegExp): Promise<HTMLElement> {
  let found: HTMLElement | undefined;
  await waitFor(() => {
    const regions = Array.from(
      document.querySelectorAll<HTMLElement>("[role=status], [role=alert], [aria-live]"),
    );
    found = regions.find((r) => {
      const content = r.textContent ?? "";
      return typeof text === "string" ? content.includes(text) : text.test(content);
    });
    expect(found).toBeDefined();
  });
  return found!;
}

beforeEach(() => {
  list.mockReset();
  add.mockReset();
  create.mockReset();
  read.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("session gating", () => {
  it("renders nothing and requests nothing while the session is unverified", () => {
    const { view } = renderButton({ status: "loading" });
    expect(view.container.querySelector("button, a")?.textContent).toBe("Elsewhere");
    expect(list).not.toHaveBeenCalled();
  });

  it("signed out: a sign-in link that returns to this page", () => {
    renderButton({ status: "anonymous" });
    const link = screen.getByRole("link", { name: "Sign in to add to a trip: Alpha Falls" });
    expect(link).toHaveAttribute(
      "href",
      `/sign-in?returnTo=${encodeURIComponent(`/landmarks/${LANDMARK}?from=map`)}`,
    );
    expect(list).not.toHaveBeenCalled();
  });

  it("renders nothing without an auth context", () => {
    const { container } = render(
      <MemoryRouter>
        <AddToTripButton landmarkId={LANDMARK} displayName="Alpha Falls" />
      </MemoryRouter>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not load trips until the picker is opened", () => {
    renderButton();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(list).not.toHaveBeenCalled();
  });
});

describe("the picker", () => {
  it("opens as a disclosure: expanded, controls the region, moves focus into it, loads page 1 with limit 100", async () => {
    const pending = deferred<TripListPage>();
    list.mockReturnValueOnce(pending.promise);
    renderButton();
    await userEvent.click(toggle());
    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(toggle()).toHaveAttribute("aria-controls", panel().id);
    expect(panel()).toHaveFocus();
    expect(list).toHaveBeenCalledWith({ page: 1, limit: 100 });
    expect(within(panel()).getByText("Loading your trips…")).toBeInTheDocument();
    await act(async () => pending.resolve(pageOf([item(1, "Weekend", 1), item(2, "Gorges", 4)])));
    expect(radio(/Weekend \(1 stop\)/)).toBeInTheDocument();
    expect(radio(/Gorges \(4 stops\)/)).toBeInTheDocument();
    expect(radio("New trip")).toBeInTheDocument();
  });

  it("empty: says so and still offers New trip", async () => {
    await openWith(pageOf([]));
    expect(screen.getByText("You don't have any trips yet.")).toBeInTheDocument();
    expect(radio("New trip")).toBeInTheDocument();
  });

  it("a failed load offers Try again; a 429 shows the wait", async () => {
    list.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x"));
    renderButton();
    await userEvent.click(toggle());
    expect(await screen.findByText("Couldn't load your trips. Please try again.")).toBeTruthy();
    list.mockRejectedValueOnce(new ApiError(429, "RATE_LIMITED", "x", 9));
    await userEvent.click(within(panel()).getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByText("Too many requests. Please try again in 9 seconds."),
    ).toBeTruthy();
    list.mockResolvedValueOnce(pageOf([item(1)]));
    await userEvent.click(within(panel()).getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("radio", { name: /Trip 1/ })).toBeTruthy();
  });

  it("Show more requests the next page only while has_more, appends without duplicates, and ignores a second click", async () => {
    await openWith(pageOf([item(1), item(2)], 1, true));
    const more = deferred<TripListPage>();
    list.mockReturnValueOnce(more.promise);
    const showMore = screen.getByRole("button", { name: "Show more trips" });
    fireEvent.click(showMore);
    fireEvent.click(showMore);
    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith({ page: 2, limit: 100 });
    await act(async () => more.resolve(pageOf([item(2), item(3)], 2, false)));
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("value"))).toEqual([
      TRIP(1),
      TRIP(2),
      TRIP(3),
      "new",
    ]);
    expect(screen.queryByRole("button", { name: "Show more trips" })).toBeNull();
  });

  it("a failed Show more keeps the list and says so", async () => {
    await openWith(pageOf([item(1)], 1, true));
    list.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    await userEvent.click(screen.getByRole("button", { name: "Show more trips" }));
    expect(await screen.findByText("Couldn't load more trips. Please try again.")).toBeTruthy();
    expect(radio(/Trip 1/)).toBeInTheDocument();
  });

  it("Escape closes the picker and returns focus to the button; Close does the same", async () => {
    await openWith(pageOf([item(1)]));
    radio(/Trip 1/).focus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region")).toBeNull();
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(toggle()).toHaveFocus();
    list.mockResolvedValueOnce(pageOf([item(1)]));
    await userEvent.click(toggle());
    await screen.findByRole("group", { name: "Choose a trip" });
    await userEvent.click(within(panel()).getByRole("button", { name: "Close" }));
    expect(toggle()).toHaveFocus();
  });

  it("re-opening fetches the trips fresh", async () => {
    await openWith(pageOf([item(1, "Old name")]));
    await userEvent.click(toggle());
    list.mockResolvedValueOnce(pageOf([item(1, "New name")]));
    await userEvent.click(toggle());
    expect(await screen.findByRole("radio", { name: /New name/ })).toBeTruthy();
    expect(list).toHaveBeenCalledTimes(2);
  });

  it("renders trip names as plain, direction-isolated text", async () => {
    const hostile = `<img src=x onerror=alert(1)>${RLO}evil`;
    const { view } = await openWith(pageOf([item(1, hostile)]));
    expect(view.container.querySelector("img")).toBeNull();
    const bdi = radio(/evil/).closest("label")!.querySelector("bdi")!;
    expect(bdi.textContent).toBe(hostile);
  });
});

describe("adding to an existing trip", () => {
  it("adds after confirmation: pending feedback, then 'Added … — View trip', with no navigation and no focus move", async () => {
    await openWith(pageOf([item(1, "Weekend")]));
    await userEvent.click(radio(/Weekend/));
    const pending = deferred<AddedTripStop>();
    add.mockReturnValueOnce(pending.promise);
    list.mockResolvedValueOnce(pageOf([item(1, "Weekend", 2)]));
    await userEvent.click(addButton());
    expect(add).toHaveBeenCalledWith(TRIP(1), LANDMARK);
    expect(status()).toHaveTextContent("Adding to the trip…");
    expect(addButton()).toHaveAttribute("aria-disabled", "true");
    await act(async () => pending.resolve(addedStop()));
    expect(status()).toHaveTextContent("Added Alpha Falls to Weekend — View trip");
    expect(within(status()).getByRole("link", { name: "View trip" })).toHaveAttribute(
      "href",
      `/trips/${TRIP(1)}`,
    );
    expect(screen.getByTestId("location")).toHaveTextContent(`/landmarks/${LANDMARK}`);
    expect(addButton()).toHaveFocus();
    // The list is re-read quietly; the selection stays.
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("radio", { name: /Weekend \(2 stops\)/ })).toBeChecked();
  });

  it("rapid repeated clicks send one request", async () => {
    await openWith(pageOf([item(1)]));
    await userEvent.click(radio(/Trip 1/));
    const pending = deferred<AddedTripStop>();
    add.mockReturnValueOnce(pending.promise);
    act(() => {
      fireEvent.click(addButton());
      fireEvent.click(addButton());
      fireEvent.click(addButton());
    });
    expect(add).toHaveBeenCalledTimes(1);
    list.mockResolvedValue(pageOf([item(1)]));
    await act(async () => pending.resolve(addedStop()));
  });

  it.each([
    [new ApiError(409, "TRIP_STOP_ALREADY_EXISTS", "x"), "Already in this trip."],
    [new ApiError(409, "TRIP_STOP_LIMIT_REACHED", "x"), "This trip has 25 stops."],
    [
      new ApiError(429, "RATE_LIMITED", "x", 20),
      "Too many requests. Please try again in 20 seconds.",
    ],
    [
      new ApiError(403, "INVALID_ORIGIN", "x"),
      "Couldn't add Alpha Falls to Trip 1. Please try again.",
    ],
  ])("maps %s to its message", async (error, text) => {
    await openWith(pageOf([item(1)]));
    await userEvent.click(radio(/Trip 1/));
    add.mockRejectedValueOnce(error);
    await userEvent.click(addButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(text);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("404 for a landmark that is no longer addable: says so and blocks further adds", async () => {
    await openWith(pageOf([item(1)]));
    await userEvent.click(radio(/Trip 1/));
    add.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "x"));
    read.mockResolvedValueOnce(ownerTrip(TRIP(1), "Trip 1"));
    await userEvent.click(addButton());
    expect(await screen.findByRole("alert")).toHaveTextContent("This landmark can't be added.");
    expect(read).toHaveBeenCalledWith(TRIP(1));
    expect(addButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(addButton());
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("404 because the trip is gone: says so and deselects it after re-reading the list (never selecting another)", async () => {
    await openWith(pageOf([item(1), item(2)]));
    await userEvent.click(radio(/Trip 1/));
    add.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "x"));
    read.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "x"));
    list.mockResolvedValueOnce(pageOf([item(2)]));
    await userEvent.click(addButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That trip is no longer available. Choose another trip.",
    );
    expect(
      await screen.findByText("The trip you selected is no longer in your list. Choose a trip."),
    ).toBeTruthy();
    expect(radio(/Trip 2/)).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Add to the selected trip: Alpha Falls" }),
    ).toBeNull();
  });

  it("401 clears every trip name and selection and re-checks the session", async () => {
    const { refresh } = await openWith(pageOf([item(1, "Private Trip")]));
    await userEvent.click(radio(/Private Trip/));
    add.mockRejectedValueOnce(new ApiError(401, "UNAUTHENTICATED", "x"));
    await userEvent.click(addButton());
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Private Trip/)).toBeNull();
  });

  it("an uncertain outcome is neither success nor failure, is not replayed, and re-reads the list", async () => {
    await openWith(pageOf([item(1, "Weekend")]));
    await userEvent.click(radio(/Weekend/));
    add.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    list.mockResolvedValueOnce(pageOf([item(1, "Weekend")]));
    await userEvent.click(addButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "We couldn't confirm whether Alpha Falls was added to Weekend. Check the trip before trying again.",
    );
    expect(alert).not.toHaveTextContent(/^Added/);
    expect(within(alert).getByRole("link", { name: "View trip" })).toHaveAttribute(
      "href",
      `/trips/${TRIP(1)}`,
    );
    expect(add).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
  });

  it("closing the picker mid-request neither cancels nor replays it; the result is still reported", async () => {
    await openWith(pageOf([item(1, "Weekend")]));
    await userEvent.click(radio(/Weekend/));
    const pending = deferred<AddedTripStop>();
    add.mockReturnValueOnce(pending.promise);
    await userEvent.click(addButton());
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region")).toBeNull();
    await act(async () => pending.resolve(addedStop()));
    expect(status()).toHaveTextContent("Added Alpha Falls to Weekend — View trip");
    expect(add).toHaveBeenCalledTimes(1);
  });
});

describe("New trip: create, then add", () => {
  async function chooseNew(...pages: TripListPage[]) {
    const harness = await openWith(...(pages.length > 0 ? pages : [pageOf([])]));
    await userEvent.click(radio("New trip"));
    return harness;
  }
  const nameInput = () => screen.getByRole("textbox", { name: "New trip name" });
  const submit = () => screen.getByRole("button", { name: "Create trip and add Alpha Falls" });

  it("validates the name on the client, associating the error with the input", async () => {
    await chooseNew();
    await userEvent.type(nameInput(), "   ");
    await userEvent.click(submit());
    expect(create).not.toHaveBeenCalled();
    expect(nameInput()).toHaveAttribute("aria-invalid", "true");
    expect(nameInput()).toHaveAccessibleDescription(TRIP_NAME_MESSAGES.noVisible);
    expect(nameInput()).toHaveFocus();
  });

  it("shows the server's name error when the server disagrees", async () => {
    await chooseNew();
    create.mockRejectedValueOnce(
      new ApiError(400, "INVALID_REQUEST", "name contains characters that are not allowed."),
    );
    await userEvent.type(nameInput(), "Valid looking");
    await userEvent.click(submit());
    expect(await screen.findByText("name contains characters that are not allowed.")).toBeTruthy();
    expect(nameInput()).toHaveFocus();
    expect(add).not.toHaveBeenCalled();
  });

  it("creates the trip first, then adds the landmark to the NEW trip, and links to it", async () => {
    await chooseNew();
    create.mockResolvedValueOnce(ownerTrip(TRIP(7), "Smokies Loop"));
    add.mockResolvedValueOnce(addedStop());
    list.mockResolvedValueOnce(pageOf([item(7, "Smokies Loop", 1)]));
    await userEvent.type(nameInput(), "  Smokies Loop ");
    await userEvent.click(submit());
    expect(create).toHaveBeenCalledWith("Smokies Loop");
    await waitFor(() => expect(add).toHaveBeenCalledWith(TRIP(7), LANDMARK));
    expect(create.mock.invocationCallOrder[0]!).toBeLessThan(add.mock.invocationCallOrder[0]!);
    expect(await findMessage(/Added Alpha Falls to Smokies Loop/)).toBeTruthy();
    expect(within(status()).getByRole("link", { name: "View trip" })).toHaveAttribute(
      "href",
      `/trips/${TRIP(7)}`,
    );
  });

  it("created but the add failed: keeps the trip, says so, links to it, and 'Try adding again' adds to THAT trip without creating another", async () => {
    await chooseNew();
    create.mockResolvedValueOnce(ownerTrip(TRIP(7), "Smokies Loop"));
    // A definite refusal (nothing was added); 5xx/network outcomes are "uncertain" and verify first.
    add.mockRejectedValueOnce(new ApiError(403, "INVALID_ORIGIN", "x"));
    list.mockResolvedValue(pageOf([item(7, "Smokies Loop", 0)]));
    await userEvent.type(nameInput(), "Smokies Loop");
    await userEvent.click(submit());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "The trip Smokies Loop was created, but Alpha Falls couldn't be added to it.",
    );
    expect(alert).not.toHaveTextContent(/couldn't create/i);
    expect(within(alert).getByRole("link", { name: "View trip" })).toHaveAttribute(
      "href",
      `/trips/${TRIP(7)}`,
    );
    expect(add).toHaveBeenCalledTimes(1);

    add.mockResolvedValueOnce(addedStop());
    await userEvent.click(within(alert).getByRole("button", { name: "Try adding again" }));
    expect(await findMessage(/Added Alpha Falls to Smokies Loop/)).toBeTruthy();
    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenLastCalledWith(TRIP(7), LANDMARK);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("created but the add is uncertain: no success claim, no automatic replay", async () => {
    await chooseNew();
    create.mockResolvedValueOnce(ownerTrip(TRIP(7), "Smokies Loop"));
    add.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    list.mockResolvedValue(pageOf([item(7, "Smokies Loop", 0)]));
    await userEvent.type(nameInput(), "Smokies Loop");
    await userEvent.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't confirm whether Alpha Falls was added. Check the trip before trying again.",
    );
    expect(add).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("an uncertain create is not replayed, adds nothing, and re-reads the list without guessing by name", async () => {
    await chooseNew(pageOf([item(1)]));
    create.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    list.mockResolvedValueOnce(pageOf([item(1), item(8, "Smokies Loop")]));
    await userEvent.type(nameInput(), "Smokies Loop");
    await userEvent.click(submit());
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We couldn't confirm whether the trip was created. Check your trips below before trying again.",
    );
    expect(create).toHaveBeenCalledTimes(1);
    expect(add).not.toHaveBeenCalled();
    expect(await screen.findByRole("radio", { name: /Smokies Loop/ })).not.toBeChecked();
    expect(radio("New trip")).toBeChecked();
  });

  it("one submission covers the whole create-then-add sequence", async () => {
    await chooseNew();
    const created = deferred<OwnerTrip>();
    create.mockReturnValueOnce(created.promise);
    await userEvent.type(nameInput(), "Once");
    act(() => {
      fireEvent.click(submit());
      fireEvent.click(submit());
    });
    const adding = deferred<AddedTripStop>();
    add.mockReturnValueOnce(adding.promise);
    await act(async () => created.resolve(ownerTrip(TRIP(5), "Once")));
    fireEvent.click(submit());
    expect(create).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(1);
    list.mockResolvedValue(pageOf([item(5, "Once")]));
    await act(async () => adding.resolve(addedStop()));
    expect(status()).toHaveTextContent("Added Alpha Falls to Once");
  });
});

describe("isolation from stale state", () => {
  it("a failed session check clears trips and results; the late add result is dropped; re-verifying fetches fresh", async () => {
    const harness = await openWith(pageOf([item(1, "Private Trip")]));
    await userEvent.click(radio(/Private Trip/));
    const pending = deferred<AddedTripStop>();
    add.mockReturnValueOnce(pending.promise);
    await userEvent.click(addButton());
    harness.rerender({ session: { status: "unavailable", retry: vi.fn() } });
    expect(screen.queryByText(/Private Trip/)).toBeNull();
    await act(async () => pending.resolve(addedStop()));
    expect(screen.queryByText(/Added/)).toBeNull();
    harness.rerender({ session: { status: "authenticated", user: TEST_USER } });
    list.mockResolvedValueOnce(pageOf([item(1, "Private Trip")]));
    await userEvent.click(toggle());
    await screen.findByRole("group", { name: "Choose a trip" });
    expect(list).toHaveBeenCalledTimes(2);
    expect(radio(/Private Trip/)).not.toBeChecked();
  });

  it("a different user never sees the previous user's trips, even from a late response", async () => {
    const first = deferred<TripListPage>();
    list.mockReturnValueOnce(first.promise);
    const harness = renderButton();
    await userEvent.click(toggle());
    harness.rerender({ session: { status: "authenticated", user: OTHER_USER } });
    await act(async () => first.resolve(pageOf([item(1, "First User Trip")])));
    expect(screen.queryByText(/First User Trip/)).toBeNull();
  });

  it("a different landmark clears feedback and drops a late result for the old one", async () => {
    const harness = await openWith(pageOf([item(1, "Weekend")]));
    await userEvent.click(radio(/Weekend/));
    const pending = deferred<AddedTripStop>();
    add.mockReturnValueOnce(pending.promise);
    await userEvent.click(addButton());
    harness.rerender({ landmarkId: OTHER_LANDMARK, name: "Beta Arch" });
    await act(async () => pending.resolve(addedStop()));
    expect(screen.queryByText(/Added/)).toBeNull();
    expect(screen.getByRole("button", { name: "Add to trip: Beta Arch" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });
});

describe("retrying after an uncertain add (Increment 6 correction)", () => {
  function tripWith(landmarkIds: string[]): OwnerTrip {
    return {
      ...ownerTrip(TRIP(1), "Weekend"),
      stops: landmarkIds.map((id, position) => ({
        id: TRIP(500 + position),
        position,
        is_available: false as const,
        distance_from_previous_miles: null,
        landmark: { id, is_available: false as const },
      })),
      distance_summary: {
        total_miles: null,
        measured_legs: 0,
        total_legs: Math.max(landmarkIds.length - 1, 0),
      },
    };
  }

  async function uncertainAdd() {
    await openWith(pageOf([item(1, "Weekend")]));
    await userEvent.click(radio(/Weekend/));
    add.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    list.mockResolvedValue(pageOf([item(1, "Weekend")]));
    await userEvent.click(addButton());
    await findMessage(/We couldn't confirm whether Alpha Falls was added to Weekend/);
    expect(add).toHaveBeenCalledTimes(1);
  }

  it("reads the trip first; if the landmark is already there, confirms it and sends no second add", async () => {
    await uncertainAdd();
    read.mockResolvedValueOnce(tripWith([LANDMARK]));
    await userEvent.click(addButton());
    expect(await findMessage(/Added Alpha Falls to Weekend/)).toBeTruthy();
    expect(read).toHaveBeenCalledWith(TRIP(1));
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("if the landmark is absent, only then sends the add", async () => {
    await uncertainAdd();
    read.mockResolvedValueOnce(tripWith([OTHER_LANDMARK]));
    add.mockResolvedValueOnce(addedStop());
    await userEvent.click(addButton());
    expect(await findMessage(/Added Alpha Falls to Weekend/)).toBeTruthy();
    expect(read.mock.invocationCallOrder[0]!).toBeLessThan(add.mock.invocationCallOrder[1]!);
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("if the trip cannot be read, sends nothing and claims nothing; the next attempt verifies again", async () => {
    await uncertainAdd();
    read.mockRejectedValueOnce(new ApiError(500, "INTERNAL_ERROR", "x"));
    await userEvent.click(addButton());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "We still couldn't confirm whether Alpha Falls is in Weekend, so nothing was sent.",
    );
    expect(alert).not.toHaveTextContent(/^Added/);
    expect(add).toHaveBeenCalledTimes(1);
    read.mockResolvedValueOnce(tripWith([LANDMARK]));
    await userEvent.click(addButton());
    expect(await findMessage(/Added Alpha Falls to Weekend/)).toBeTruthy();
    expect(read).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("'Try adding again' after an uncertain add to a NEW trip verifies that trip first", async () => {
    await openWith(pageOf([]));
    await userEvent.click(radio("New trip"));
    create.mockResolvedValueOnce(ownerTrip(TRIP(7), "Smokies Loop"));
    add.mockRejectedValueOnce(new ApiError(0, "NETWORK_ERROR", "offline"));
    list.mockResolvedValue(pageOf([item(7, "Smokies Loop", 1)]));
    await userEvent.type(screen.getByRole("textbox", { name: "New trip name" }), "Smokies Loop");
    await userEvent.click(screen.getByRole("button", { name: "Create trip and add Alpha Falls" }));
    const alert = await screen.findByRole("alert");
    read.mockResolvedValueOnce({ ...tripWith([LANDMARK]), id: TRIP(7), name: "Smokies Loop" });
    await userEvent.click(within(alert).getByRole("button", { name: "Try adding again" }));
    expect(await findMessage(/Added Alpha Falls to Smokies Loop/)).toBeTruthy();
    expect(read).toHaveBeenCalledWith(TRIP(7));
    expect(add).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("session lost between create and add (Increment 6)", () => {
  it("an unconfirmed session after a successful create prevents the add", async () => {
    const harness = await openWith(pageOf([]));
    await userEvent.click(radio("New trip"));
    const created = deferred<OwnerTrip>();
    create.mockReturnValueOnce(created.promise);
    await userEvent.type(screen.getByRole("textbox", { name: "New trip name" }), "Interrupted");
    await userEvent.click(screen.getByRole("button", { name: "Create trip and add Alpha Falls" }));
    harness.rerender({ session: { status: "unavailable", retry: vi.fn() } });
    await act(async () => created.resolve(ownerTrip(TRIP(9), "Interrupted")));
    expect(add).not.toHaveBeenCalled();
    expect(screen.queryByText(/Interrupted/)).toBeNull();
  });
});

describe("label in name (WCAG 2.5.3; Increment 6 correction)", () => {
  it("the toggle, the add button, and the sign-in link names start with their visible text", async () => {
    await openWith(pageOf([item(1)]));
    await userEvent.click(radio(/Trip 1/));
    for (const control of [toggle(), addButton()]) {
      expect(control.getAttribute("aria-label")!.startsWith(control.textContent!)).toBe(true);
    }
  });

  it("the signed-out link too", () => {
    renderButton({ status: "anonymous" });
    const link = screen.getByRole("link", { name: "Sign in to add to a trip: Alpha Falls" });
    expect(link.getAttribute("aria-label")!.startsWith(link.textContent!)).toBe(true);
  });
});

describe("names in messages are direction-isolated (Increment 6 correction)", () => {
  it("a trip name with a right-to-left override cannot reorder the rest of the message or the View trip link", async () => {
    const spoof = `Trip ${RLO}evil`;
    await openWith(pageOf([item(1, spoof)]));
    await userEvent.click(radio(/evil/));
    add.mockResolvedValueOnce(addedStop());
    list.mockResolvedValue(pageOf([item(1, spoof)]));
    await userEvent.click(addButton());
    await screen.findByRole("link", { name: "View trip" });
    const region = status();
    const isolated = Array.from(region.querySelectorAll("bdi")).map((b) => b.textContent);
    expect(isolated).toEqual(["Alpha Falls", spoof]);
    // The override lives only inside its <bdi>; the link and the surrounding words are outside it.
    const link = within(region).getByRole("link", { name: "View trip" });
    expect(link.closest("bdi")).toBeNull();
    for (const node of Array.from(region.childNodes)) {
      if (node.nodeType === Node.TEXT_NODE) expect(node.textContent).not.toContain(RLO);
    }
  });
});
