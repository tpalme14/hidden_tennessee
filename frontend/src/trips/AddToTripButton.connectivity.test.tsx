import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
import { AuthContext, type AuthContextValue } from "../auth/session";
import { deferred, TEST_USER } from "../auth/testFixtures";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { AddToTripButton } from "./AddToTripButton";
import { TripsAnnouncer } from "./TripsAnnouncer";

/**
 * M06-T02 Increment 3b-ii — the add-to-trip flow's server mutations as
 * online-only actions (OFF-UX-5), with the REAL `useAddToTrip` hook and a
 * mocked trips API. Adding to the selected trip, creating a trip and adding,
 * and "Try adding again" are refused while the server is unreachable; opening
 * the picker, choosing a trip, typing a name, and closing are not. The
 * selection, the typed name, and an uncertain add's pending trip survive
 * every connectivity change, and recovery never sends anything by itself.
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

const LANDMARK = "11111111-1111-4111-8111-000000000001";
const TRIP = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TIME = "2026-11-23T16:00:00.000Z";

function item(n: number, name = `Trip ${n}`): TripListItem {
  return { id: TRIP(n), name, stop_count: 0, updated_at: TIME, is_shared: false };
}
const pageOf = (trips: TripListItem[]): TripListPage => ({
  trips,
  page: 1,
  limit: 100,
  has_more: false,
});
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

function evidence(kind: RequestEvidence) {
  act(() => connectivity.reportOutcome(connectivity.beginRequest(), kind));
}
const browserEvent = (type: "online" | "offline") =>
  act(() => {
    window.dispatchEvent(new Event(type));
  });
const STATES: [string, () => void][] = [
  ["reachable", () => evidence("response")],
  [
    "unknown reachability",
    () => {
      evidence("network-failure");
      browserEvent("online");
    },
  ],
  ["a server problem", () => evidence("server-problem")],
  ["the browser's offline hint alone", () => browserEvent("offline")],
];

function renderButton(variant: "profile" | "list" = "profile") {
  const auth: AuthContextValue = {
    session: { status: "authenticated", user: TEST_USER },
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  const button = (
    <AddToTripButton landmarkId={LANDMARK} displayName="Alpha Falls" variant={variant} />
  );
  return render(
    <MemoryRouter initialEntries={[`/landmarks/${LANDMARK}`]}>
      <AuthContext.Provider value={auth}>
        <Routes>
          <Route
            path="/landmarks/:id"
            element={variant === "list" ? <TripsAnnouncer>{button}</TripsAnnouncer> : button}
          />
        </Routes>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
}

const toggle = () => screen.getByRole("button", { name: "Add to trip: Alpha Falls" });
const radio = (name: string) => screen.getByRole("radio", { name });
const addButton = () =>
  screen.getByRole("button", { name: "Add to the selected trip: Alpha Falls" });
const nameInput = () => screen.getByRole("textbox", { name: "New trip name" });
const createButton = () => screen.getByRole("button", { name: "Create trip and add Alpha Falls" });
const retryButton = () => screen.getByRole("button", { name: "Try adding again" });

async function openWith(page: TripListPage, variant: "profile" | "list" = "profile") {
  list.mockResolvedValueOnce(page);
  renderButton(variant);
  await userEvent.click(toggle());
  await screen.findByRole("group", { name: "Choose a trip" });
}

/** Create succeeds, the add is definitely refused: "Try adding again" targets the new trip. */
async function partialOutcome(variant: "profile" | "list" = "profile") {
  await openWith(pageOf([]), variant);
  await userEvent.click(radio("New trip"));
  create.mockResolvedValueOnce(ownerTrip(TRIP(7), "Smokies Loop"));
  add.mockRejectedValueOnce(new ApiError(403, "INVALID_ORIGIN", "x"));
  list.mockResolvedValue(pageOf([item(7, "Smokies Loop")]));
  await userEvent.type(nameInput(), "Smokies Loop");
  await userEvent.click(createButton());
  await screen.findByRole("button", { name: "Try adding again" });
  expect(create).toHaveBeenCalledTimes(1);
  expect(add).toHaveBeenCalledTimes(1);
}

beforeEach(() => {
  list.mockReset();
  add.mockReset();
  create.mockReset();
  read.mockReset();
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("Add to trip — adding to the selected trip needs the server", () => {
  it.each(STATES)("adds normally with %s", async (_label, apply) => {
    await openWith(pageOf([item(1, "Weekend")]));
    apply();
    await userEvent.click(radio("Weekend (0 stops)"));
    add.mockResolvedValueOnce(addedStop());
    expect(addButton()).not.toHaveAttribute("aria-disabled");
    await userEvent.click(addButton());
    expect(add).toHaveBeenCalledWith(TRIP(1), LANDMARK);
  });

  it("while unreachable the picker still opens, selects, and closes; adding sends nothing; the selection survives; recovery sends nothing until asked", async () => {
    await openWith(pageOf([item(1, "Weekend"), item(2, "Loop")]));
    evidence("network-failure");
    await userEvent.click(radio("Weekend (0 stops)"));
    expect(radio("Weekend (0 stops)")).toBeChecked();

    expect(addButton()).toHaveAttribute("aria-disabled", "true");
    expect(addButton()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    await userEvent.click(addButton());
    addButton().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(add).not.toHaveBeenCalled();
    expect(addButton()).toHaveFocus();

    browserEvent("offline");
    browserEvent("online"); // unreachable → unknown: recovery, but nothing is sent
    expect(radio("Weekend (0 stops)")).toBeChecked();
    expect(addButton()).not.toHaveAttribute("aria-disabled");
    expect(addButton()).not.toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    expect(add).not.toHaveBeenCalled();

    add.mockResolvedValueOnce(addedStop());
    await userEvent.click(addButton());
    expect(add).toHaveBeenCalledTimes(1);

    // Closing stays available regardless.
    evidence("network-failure");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  it("an in-flight add keeps its pending state through loss and recovery, and a second press cannot start another", async () => {
    await openWith(pageOf([item(1, "Weekend")]));
    await userEvent.click(radio("Weekend (0 stops)"));
    const pending = deferred<AddedTripStop>();
    add.mockReturnValueOnce(pending.promise);
    await userEvent.click(addButton());
    expect(screen.getByRole("status")).toHaveTextContent("Adding to the trip…");

    evidence("network-failure");
    expect(screen.getByRole("status")).toHaveTextContent("Adding to the trip…");
    evidence("response");
    expect(addButton()).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(addButton());
    expect(add).toHaveBeenCalledTimes(1);

    await act(async () => pending.resolve(addedStop()));
    expect(screen.getByRole("status")).toHaveTextContent("Added Alpha Falls to Weekend");
    expect(add).toHaveBeenCalledTimes(1);
  });
});

describe("Add to trip — create, then add, needs the server", () => {
  it.each(STATES)("creates normally with %s", async (_label, apply) => {
    await openWith(pageOf([]));
    await userEvent.click(radio("New trip"));
    apply();
    create.mockResolvedValueOnce(ownerTrip(TRIP(7), "Smokies Loop"));
    add.mockResolvedValueOnce(addedStop());
    list.mockResolvedValue(pageOf([item(7, "Smokies Loop")]));
    await userEvent.type(nameInput(), "Smokies Loop");
    await userEvent.click(createButton());
    await waitFor(() => expect(add).toHaveBeenCalledWith(TRIP(7), LANDMARK));
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("while unreachable, click, Enter, and direct submission create nothing; the name survives; recovery creates nothing until asked", async () => {
    await openWith(pageOf([]));
    await userEvent.click(radio("New trip"));
    evidence("network-failure");
    await userEvent.type(nameInput(), "Smokies Loop");
    expect(createButton()).toHaveAttribute("aria-disabled", "true");
    expect(createButton()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);

    await userEvent.click(createButton());
    await userEvent.type(nameInput(), "{Enter}");
    const form = nameInput().closest("form")!;
    fireEvent.submit(form);
    act(() => form.requestSubmit());
    expect(create).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(nameInput()).toHaveValue("Smokies Loop");
    expect(radio("New trip")).toBeChecked();

    evidence("response");
    expect(nameInput()).toHaveValue("Smokies Loop");
    expect(create).not.toHaveBeenCalled();

    create.mockResolvedValueOnce(ownerTrip(TRIP(7), "Smokies Loop"));
    add.mockResolvedValueOnce(addedStop());
    list.mockResolvedValue(pageOf([item(7, "Smokies Loop")]));
    await userEvent.click(createButton());
    expect(create).toHaveBeenCalledWith("Smokies Loop");
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
  });
});

describe("Add to trip — 'Try adding again' after a partial outcome needs the server", () => {
  it("profile: refused while unreachable with a reason outside the alert; the created trip is kept; recovery retries nothing; an explicit retry adds to THAT trip only", async () => {
    await partialOutcome();
    const alert = screen.getByRole("alert");
    evidence("network-failure");
    expect(retryButton()).toHaveAttribute("aria-disabled", "true");
    expect(retryButton()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    // The reason is not inside the alert, so it never re-announces it.
    expect(alert).not.toHaveTextContent(ONLINE_ONLY_REASON);
    await userEvent.click(retryButton());
    expect(add).toHaveBeenCalledTimes(1);
    expect(alert).toHaveTextContent("The trip Smokies Loop was created");

    evidence("response");
    expect(retryButton()).not.toHaveAttribute("aria-disabled");
    expect(add).toHaveBeenCalledTimes(1);

    add.mockResolvedValueOnce(addedStop());
    await userEvent.click(retryButton());
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add).toHaveBeenLastCalledWith(TRIP(7), LANDMARK);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("list variant: the announcer's 'Try adding again' is refused while unreachable (handler guard) and works after recovery", async () => {
    await partialOutcome("list");
    const announcerRetry = within(screen.getByRole("alert")).getByRole("button", {
      name: "Try adding again",
    });
    evidence("network-failure");
    await userEvent.click(announcerRetry);
    expect(add).toHaveBeenCalledTimes(1);

    evidence("response");
    expect(add).toHaveBeenCalledTimes(1);
    add.mockResolvedValueOnce(addedStop());
    await userEvent.click(announcerRetry);
    await waitFor(() => expect(add).toHaveBeenCalledTimes(2));
    expect(add).toHaveBeenLastCalledWith(TRIP(7), LANDMARK);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("Add to trip — data-pending marks only a genuinely pending action (D2)", () => {
  it("add to the selected trip: absent while available or only unreachable; present while adding, through loss and recovery; removed after", async () => {
    await openWith(pageOf([item(1, "Weekend")]));
    await userEvent.click(radio("Weekend (0 stops)"));
    expect(addButton()).not.toHaveAttribute("data-pending");
    evidence("network-failure");
    expect(addButton()).toHaveAttribute("aria-disabled", "true");
    expect(addButton()).not.toHaveAttribute("data-pending");
    evidence("response");

    const pending = deferred<AddedTripStop>();
    add.mockReturnValueOnce(pending.promise);
    await userEvent.click(addButton());
    expect(addButton()).toHaveAttribute("data-pending", "true");
    evidence("network-failure");
    expect(addButton()).toHaveAttribute("data-pending", "true");
    evidence("response");
    expect(addButton()).toHaveAttribute("data-pending", "true");
    await act(async () => pending.resolve(addedStop()));
    expect(addButton()).not.toHaveAttribute("data-pending");
    expect(add).toHaveBeenCalledTimes(1);
  });

  it("create, then add: the marker covers BOTH steps and is removed after", async () => {
    await openWith(pageOf([]));
    await userEvent.click(radio("New trip"));
    await userEvent.type(nameInput(), "Smokies Loop");
    const creating = deferred<OwnerTrip>();
    const adding = deferred<AddedTripStop>();
    create.mockReturnValueOnce(creating.promise);
    add.mockReturnValueOnce(adding.promise);
    list.mockResolvedValue(pageOf([item(7, "Smokies Loop")]));
    await userEvent.click(createButton());
    expect(createButton()).toHaveAttribute("data-pending", "true");
    evidence("network-failure");
    await act(async () => creating.resolve(ownerTrip(TRIP(7), "Smokies Loop")));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(createButton()).toHaveAttribute("data-pending", "true"); // the add step is pending
    evidence("response");
    await act(async () => adding.resolve(addedStop()));
    await waitFor(() =>
      expect(
        screen
          .queryByRole("button", { name: "Create trip and add Alpha Falls" })
          ?.getAttribute("data-pending") ?? null,
      ).toBeNull(),
    );
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("profile 'Try adding again': absent while only unreachable; while the retry runs the alert (and its button) gives way to the pending status", async () => {
    await partialOutcome();
    evidence("network-failure");
    expect(retryButton()).toHaveAttribute("aria-disabled", "true");
    expect(retryButton()).not.toHaveAttribute("data-pending");
    evidence("response");
    const pending = deferred<AddedTripStop>();
    add.mockReturnValueOnce(pending.promise);
    await userEvent.click(retryButton());
    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Adding to the trip…"),
    );
    expect(screen.queryByRole("button", { name: "Try adding again" })).toBeNull();
    await act(async () => pending.resolve(addedStop()));
    expect(add).toHaveBeenCalledTimes(2);
  });

  it("the landmark-unavailable restriction is not pending", async () => {
    await openWith(pageOf([item(1, "Weekend")]));
    await userEvent.click(radio("Weekend (0 stops)"));
    add.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "x"));
    list.mockResolvedValue(pageOf([item(1, "Weekend")]));
    await userEvent.click(addButton());
    await waitFor(() => expect(addButton()).toHaveAttribute("aria-disabled", "true"));
    expect(addButton()).not.toHaveAttribute("data-pending");
  });
});
