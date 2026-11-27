import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { TripPicker } from "./TripPicker";
import { NEW_TRIP, type PickerSelection, type UseAddToTrip } from "./useAddToTrip";

/**
 * M06-T02 Increment 3b-ii — the picker's "Add to the selected trip" as an
 * online-only action (OFF-UX-5), with a stand-in flow so the exact calls into
 * the hook are visible. Choosing a trip, "Show more trips", and the list's
 * "Try again" are reads and stay available; the selection is the hook's and is
 * never cleared by a connectivity change. (The real hook is exercised in
 * AddToTripButton.connectivity.test.tsx.)
 */

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

const TRIP = "00000000-0000-4000-8000-000000000001";

function flowWith(overrides: Partial<UseAddToTrip> = {}, selection: PickerSelection = TRIP) {
  const flow: UseAddToTrip = {
    session: "signed-in",
    list: {
      status: "ready",
      trips: [
        {
          id: TRIP,
          name: "Weekend",
          stop_count: 1,
          updated_at: "2026-11-23T16:00:00.000Z",
          is_shared: false,
        },
      ],
      page: 1,
      hasMore: true,
      loadingMore: false,
      moreFailure: null,
    },
    selection,
    selectionCleared: false,
    action: null,
    feedback: null,
    landmarkUnavailable: false,
    pendingTrip: null,
    select: vi.fn(),
    retryList: vi.fn(),
    loadMore: vi.fn(),
    addToSelected: vi.fn(() => Promise.resolve()),
    createAndAdd: vi.fn(() => Promise.resolve({})),
    retryAdd: vi.fn(() => Promise.resolve()),
    ...overrides,
  };
  return flow;
}

const addButton = () =>
  screen.getByRole("button", { name: "Add to the selected trip: Alpha Falls" });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("TripPicker — adding to the selected trip needs the server", () => {
  it.each(STATES)("adds normally with %s", async (_label, apply) => {
    const flow = flowWith();
    render(<TripPicker flow={flow} landmarkName="Alpha Falls" />);
    apply();
    await userEvent.click(addButton());
    expect(flow.addToSelected).toHaveBeenCalledTimes(1);
  });

  it("while unreachable, adding asks nothing of the hook; selecting and loading more still do; the selection stays", async () => {
    const flow = flowWith();
    render(<TripPicker flow={flow} landmarkName="Alpha Falls" />);
    evidence("network-failure");
    expect(screen.getByRole("radio", { name: "Weekend (1 stop)" })).toBeChecked();
    expect(addButton()).toHaveAttribute("aria-disabled", "true");
    expect(addButton()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    await userEvent.click(addButton());
    addButton().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(flow.addToSelected).not.toHaveBeenCalled();
    expect(addButton()).toHaveFocus();

    await userEvent.click(screen.getByRole("radio", { name: "New trip" }));
    expect(flow.select).toHaveBeenCalledWith(NEW_TRIP);
    await userEvent.click(screen.getByRole("button", { name: "Show more trips" }));
    expect(flow.loadMore).toHaveBeenCalledTimes(1);
    expect(flow.select).not.toHaveBeenCalledWith(null);
  });

  it("the list's Try again is a read and stays available while unreachable", async () => {
    const flow = flowWith({ list: { status: "error", failure: { kind: "error" } } });
    render(<TripPicker flow={flow} landmarkName="Alpha Falls" />);
    evidence("network-failure");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(flow.retryList).toHaveBeenCalledTimes(1);
  });

  it("recovery restores the button without adding; an explicit press then adds", async () => {
    const flow = flowWith();
    render(<TripPicker flow={flow} landmarkName="Alpha Falls" />);
    evidence("network-failure");
    browserEvent("offline");
    browserEvent("online");
    expect(addButton()).not.toHaveAttribute("aria-disabled");
    expect(flow.addToSelected).not.toHaveBeenCalled();
    await userEvent.click(addButton());
    expect(flow.addToSelected).toHaveBeenCalledTimes(1);
  });

  it("the existing busy and landmark-unavailable conditions are kept through loss and recovery", () => {
    const { rerender } = render(
      <TripPicker flow={flowWith({ action: "adding" })} landmarkName="Alpha Falls" />,
    );
    evidence("network-failure");
    evidence("response");
    expect(addButton()).toHaveAttribute("aria-disabled", "true");
    rerender(
      <TripPicker flow={flowWith({ landmarkUnavailable: true })} landmarkName="Alpha Falls" />,
    );
    expect(addButton()).toHaveAttribute("aria-disabled", "true");
  });

  it("the picker's two online-only reasons (add and New trip) never share an id", async () => {
    const flow = flowWith();
    const { rerender } = render(<TripPicker flow={flow} landmarkName="Alpha Falls" />);
    evidence("network-failure");
    const addReasonId = addButton().getAttribute("aria-describedby");
    rerender(<TripPicker flow={flowWith({}, NEW_TRIP)} landmarkName="Alpha Falls" />);
    const createReasonId = screen
      .getByRole("button", { name: "Create trip and add Alpha Falls" })
      .getAttribute("aria-describedby");
    expect(addReasonId).toBeTruthy();
    expect(createReasonId).toBeTruthy();
    expect(createReasonId).not.toBe(addReasonId);
  });
});

describe("TripPicker — data-pending (D2)", () => {
  it("'Show more trips' carries the marker only while more trips are loading", () => {
    const loadingFlow = flowWith();
    if (loadingFlow.list.status === "ready") {
      loadingFlow.list = { ...loadingFlow.list, loadingMore: true };
    }
    const { rerender } = render(<TripPicker flow={flowWith()} landmarkName="Alpha Falls" />);
    expect(screen.getByRole("button", { name: "Show more trips" })).not.toHaveAttribute(
      "data-pending",
    );
    rerender(<TripPicker flow={loadingFlow} landmarkName="Alpha Falls" />);
    const more = screen.getByRole("button", { name: "Loading more trips…" });
    expect(more).toHaveAttribute("data-pending", "true");
    expect(more).toHaveAttribute("aria-disabled", "true");
  });
});
