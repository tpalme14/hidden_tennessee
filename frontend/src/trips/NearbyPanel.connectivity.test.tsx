import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef } from "react";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import type { NearbyLandmarkView, NearbyResultSet } from "./nearbyLandmarks";
import { NearbyPanel } from "./NearbyPanel";
import type { NearbyStatus, UseNearbyLandmarksResult } from "./useNearbyLandmarks";

/**
 * M06-T02 Increment 3b-ii — "Add to this trip" in the nearby panel as an
 * online-only action (OFF-UX-5). The search itself (radius, Try again,
 * links, Close) is read-only and stays available.
 */

// The supplementary map is not under test here (it has its own tests).
vi.mock("./NearbyMap", () => ({ NearbyMap: () => null }));

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

const ORIGIN = {
  stopId: "00000000-0000-4000-8000-000000000001",
  landmarkId: "11111111-1111-4111-8111-000000000001",
  latitude: 35.6,
  longitude: -83.5,
};
function landmark(n: number, name: string, inTrip = false): NearbyLandmarkView {
  return {
    id: `11111111-1111-4111-8111-00000000010${n}`,
    display_name: name,
    category: "falls",
    latitude: 35.6,
    longitude: -83.5,
    distance_miles: n,
    inTrip: inTrip ? { stopId: "s", stopNumber: 2 } : null,
  };
}
const LANDMARKS = [
  landmark(1, "Beta Arch"),
  landmark(2, "Gamma Bald"),
  landmark(3, "Delta Sink", true),
];
const SET: NearbyResultSet = {
  origin: ORIGIN,
  radius: 25,
  results: LANDMARKS,
  hasMore: false,
  isTruncated: false,
  malformedCount: 0,
};

function nearbyState(status: NearbyStatus = { kind: "success", result: SET }) {
  const value: UseNearbyLandmarksResult = {
    status,
    radius: 25,
    origin: { stopId: ORIGIN.stopId, stopNumber: 1, displayName: "Alpha Falls" },
    shown: { set: SET, landmarks: LANDMARKS, isCurrent: status.kind === "success" },
    open: vi.fn(() => true),
    setRadius: vi.fn(),
    retry: vi.fn(),
    close: vi.fn(),
  };
  return value;
}

function renderPanel({ busy = false, nearby = nearbyState() } = {}) {
  const onAdd = vi.fn();
  const onClose = vi.fn();
  const view = (b: boolean) => (
    <MemoryRouter>
      <NearbyPanel
        nearby={nearby}
        headingRef={createRef()}
        onClose={onClose}
        adding={{ busy: b, tripFull: false, maxStops: 25, onAdd }}
      />
    </MemoryRouter>
  );
  const result = render(view(busy));
  return { onAdd, onClose, nearby, rerender: (b: boolean) => result.rerender(view(b)) };
}

const addButton = (name: string) =>
  screen.getByRole("button", { name: `Add to this trip: ${name}` });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("NearbyPanel — adding a nearby landmark needs the server", () => {
  it.each(STATES)("adds normally with %s", async (_label, apply) => {
    const { onAdd } = renderPanel();
    apply();
    await userEvent.click(addButton("Beta Arch"));
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd.mock.calls[0]![0]).toMatchObject({ display_name: "Beta Arch" });
  });

  it("while unreachable, Add sends nothing (one shared reason); radius, links, and Close still work", async () => {
    const { onAdd, onClose, nearby } = renderPanel();
    evidence("network-failure");
    for (const name of ["Beta Arch", "Gamma Bald"]) {
      expect(addButton(name)).toHaveAttribute("aria-disabled", "true");
      expect(addButton(name)).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
      await userEvent.click(addButton(name));
    }
    addButton("Beta Arch").focus();
    await userEvent.keyboard("{Enter}");
    expect(addButton("Beta Arch")).toHaveFocus();
    expect(onAdd).not.toHaveBeenCalled();
    expect(screen.getAllByText(ONLINE_ONLY_REASON)).toHaveLength(1);
    expect(screen.getByText("In this trip (Stop 2)")).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByRole("combobox", { name: /Radius/ }), "50");
    expect(nearby.setRadius).toHaveBeenCalledWith(50);
    expect(screen.getByRole("link", { name: "Beta Arch" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Close nearby landmarks" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("the read-only Try again stays available while unreachable", async () => {
    const nearby = nearbyState({
      kind: "error",
      origin: ORIGIN,
      radius: 25,
      failure: "error",
      previous: SET,
    });
    renderPanel({ nearby });
    evidence("network-failure");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(nearby.retry).toHaveBeenCalledTimes(1);
  });

  it("recovery restores Add without adding; an explicit press then adds", async () => {
    const { onAdd } = renderPanel();
    evidence("network-failure");
    browserEvent("offline");
    browserEvent("online");
    expect(addButton("Gamma Bald")).not.toHaveAttribute("aria-disabled");
    expect(onAdd).not.toHaveBeenCalled();
    await userEvent.click(addButton("Gamma Bald"));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("the trip's change lock is kept through loss and recovery", () => {
    const { rerender } = renderPanel({ busy: true });
    evidence("network-failure");
    evidence("response");
    rerender(true);
    expect(addButton("Beta Arch")).toHaveAttribute("aria-disabled", "true");
    expect(addButton("Beta Arch")).not.toHaveAccessibleDescription(ONLINE_ONLY_REASON);
  });
});
