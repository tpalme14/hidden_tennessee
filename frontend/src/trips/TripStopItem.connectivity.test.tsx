import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TripStop } from "../api/trips";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { TripStopItem, type TripStopControls } from "./TripStopItem";

/**
 * M06-T02 Increment 3b-ii â€” Move up, Move down, and Remove as online-only
 * actions (OFF-UX-5). Refused here, before the page is asked, so the page's
 * order and stops cannot change; the first/last `disabled` rules and the
 * page's lock (`busy`) are unchanged; Find nearby (read-only) stays available.
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

function stop(position: number, name: string): TripStop {
  return {
    id: `00000000-0000-4000-8000-00000000000${position}`,
    position,
    is_available: true,
    distance_from_previous_miles: position === 0 ? null : 1.5,
    landmark: {
      id: `11111111-1111-4111-8111-00000000000${position}`,
      display_name: name,
      category: "falls",
      latitude: 35.6,
      longitude: -83.5,
    },
  };
}
const STOPS = [stop(0, "Alpha Falls"), stop(1, "Beta Arch"), stop(2, "Gamma Bald")];

function renderStops({ busy = false } = {}) {
  const onMove = vi.fn();
  const onRemove = vi.fn();
  const onFind = vi.fn();
  const view = (isBusy: boolean) => (
    <MemoryRouter>
      <ol>
        {STOPS.map((s, i) => {
          const controls: TripStopControls = {
            isFirst: i === 0,
            isLast: i === STOPS.length - 1,
            busy: isBusy,
            onMove,
            onRemove,
            setButtonRef: () => () => undefined,
            nearby: { onFind, isOpen: false, panelId: "nearby" },
          };
          return <TripStopItem key={s.id} stop={s} controls={controls} />;
        })}
      </ol>
    </MemoryRouter>
  );
  const result = render(view(busy));
  return { onMove, onRemove, onFind, rerender: (b: boolean) => result.rerender(view(b)) };
}

const up = (name: string) => screen.getByRole("button", { name: `Move up: ${name}` });
const down = (name: string) => screen.getByRole("button", { name: `Move down: ${name}` });
const remove = (name: string) =>
  screen.getByRole("button", { name: `Remove ${name} from the trip` });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("TripStopItem â€” reordering and removing need the server", () => {
  it.each(STATES)("moves and removes normally with %s", async (_label, apply) => {
    const { onMove, onRemove } = renderStops();
    apply();
    expect(up("Beta Arch")).not.toHaveAttribute("aria-disabled");
    await userEvent.click(up("Beta Arch"));
    await userEvent.click(down("Beta Arch"));
    await userEvent.click(remove("Beta Arch"));
    expect(onMove.mock.calls.map((c) => c[0])).toEqual(["up", "down"]);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("while unreachable nothing is asked of the page, the first/last rules still hold, and Find nearby still works", async () => {
    const { onMove, onRemove, onFind } = renderStops();
    evidence("network-failure");

    for (const control of [up("Beta Arch"), down("Beta Arch"), remove("Beta Arch")]) {
      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(control).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
      await userEvent.click(control);
    }
    remove("Alpha Falls").focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(remove("Alpha Falls")).toHaveFocus();
    expect(onMove).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();

    // The existing boundary restrictions are unchanged (native disabled).
    expect(up("Alpha Falls")).toBeDisabled();
    expect(down("Gamma Bald")).toBeDisabled();
    expect(down("Alpha Falls")).toBeEnabled();

    await userEvent.click(screen.getByRole("button", { name: "Find nearby: Stop 2, Beta Arch" }));
    expect(onFind).toHaveBeenCalledTimes(1);
  });

  it("each stop's reason has its own id", () => {
    renderStops();
    evidence("network-failure");
    const reasons = screen.getAllByText(ONLINE_ONLY_REASON);
    expect(reasons).toHaveLength(3);
    const ids = reasons.map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
    expect(remove("Gamma Bald").getAttribute("aria-describedby")).toBe(ids[2]);
  });

  it("recovery restores the controls without asking the page for anything; an explicit press then works", async () => {
    const { onMove, onRemove } = renderStops();
    evidence("network-failure");
    browserEvent("offline");
    browserEvent("online"); // unreachable â†’ unknown
    expect(remove("Beta Arch")).not.toHaveAttribute("aria-disabled");
    expect(remove("Beta Arch")).not.toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    expect(onMove).not.toHaveBeenCalled();
    expect(onRemove).not.toHaveBeenCalled();
    await userEvent.click(down("Alpha Falls"));
    expect(onMove).toHaveBeenCalledWith("down", expect.any(HTMLElement));
  });

  it("the page's pending lock is kept through loss and recovery", () => {
    const { rerender } = renderStops({ busy: true });
    evidence("network-failure");
    evidence("response");
    rerender(true);
    expect(up("Beta Arch")).toHaveAttribute("aria-disabled", "true");
    expect(remove("Beta Arch")).toHaveAttribute("aria-disabled", "true");
    expect(remove("Beta Arch")).not.toHaveAccessibleDescription(ONLINE_ONLY_REASON);
  });
});

describe("TripStopItem — data-pending (D2)", () => {
  it("absent for connectivity and boundary restrictions; present on every change control while the page's change is pending", () => {
    const { rerender } = renderStops();
    evidence("network-failure");
    expect(remove("Beta Arch")).not.toHaveAttribute("data-pending");
    expect(up("Alpha Falls")).toBeDisabled();
    expect(up("Alpha Falls")).not.toHaveAttribute("data-pending");
    rerender(true);
    for (const control of [
      up("Alpha Falls"),
      up("Beta Arch"),
      down("Beta Arch"),
      remove("Gamma Bald"),
    ]) {
      expect(control).toHaveAttribute("data-pending", "true");
    }
    expect(up("Alpha Falls")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Find nearby: Stop 2, Beta Arch" }),
    ).not.toHaveAttribute("data-pending");
    rerender(false);
    expect(remove("Beta Arch")).not.toHaveAttribute("data-pending");
  });
});
