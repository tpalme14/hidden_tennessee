import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthContext, type AuthContextValue } from "../auth/session";
import { TEST_USER } from "../auth/testFixtures";
import { connectivity, type RequestEvidence } from "../connectivity/connectivity";
import { ONLINE_ONLY_REASON } from "../connectivity/OnlineOnlyReason";
import { TripsAnnouncer, useTripsAnnouncer } from "./TripsAnnouncer";

/**
 * M06-T02 Increment 3b-ii-a — the shared announcer's list-variant "Try adding
 * again" as an online-only action (OFF-UX-5), with the real connectivity
 * store. While the server is unreachable the button is `aria-disabled`,
 * described by a visible reason rendered OUTSIDE the alert, and refuses
 * presses; the alert itself, its "View trip" link, and the polite region are
 * unchanged, and recovery never retries by itself.
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

const LANDMARK = "11111111-1111-4111-8111-000000000001";
const TRIP = "00000000-0000-4000-8000-000000000007";
const MESSAGE = "Alpha Falls: We couldn't confirm whether it was added to Weekend.";

/** Announces one uncertain-add alert with a retry, as a list control would. */
function Announcing({ onRetry, retryDisabled }: { onRetry: () => void; retryDisabled: boolean }) {
  const announcer = useTripsAnnouncer()!;
  return (
    <button
      type="button"
      onClick={() =>
        announcer.announce(LANDMARK, {
          tone: "alert",
          parts: [MESSAGE],
          viewTripId: TRIP,
          onRetry,
          retryDisabled,
        })
      }
    >
      Announce
    </button>
  );
}

async function renderAnnouncer({ retryDisabled = false } = {}) {
  const onRetry = vi.fn();
  const auth: AuthContextValue = {
    session: { status: "authenticated", user: TEST_USER },
    checking: false,
    refresh: vi.fn(() => Promise.resolve()),
    signOut: vi.fn(() => Promise.resolve()),
  };
  render(
    <MemoryRouter>
      <AuthContext.Provider value={auth}>
        <TripsAnnouncer>
          <Announcing onRetry={onRetry} retryDisabled={retryDisabled} />
        </TripsAnnouncer>
      </AuthContext.Provider>
    </MemoryRouter>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Announce" }));
  return onRetry;
}

const alert = () => screen.getByRole("alert");
const retry = () => within(alert()).getByRole("button", { name: "Try adding again" });

beforeEach(() => {
  evidence("response");
  browserEvent("online");
});
afterEach(() => {
  evidence("response");
  browserEvent("online");
});

describe("TripsAnnouncer — 'Try adding again' needs the server", () => {
  it.each(STATES)("retries normally with %s", async (_label, apply) => {
    const onRetry = await renderAnnouncer();
    apply();
    expect(retry()).not.toHaveAttribute("aria-disabled");
    expect(retry()).not.toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    await userEvent.click(retry());
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("while unreachable: unavailable with a visible reason outside the alert; click, Enter, and Space retry nothing; the alert and regions are unchanged", async () => {
    const onRetry = await renderAnnouncer();
    const liveRegionsBefore = document.querySelectorAll("[aria-live], [role=status], [role=alert]");
    evidence("network-failure");

    expect(retry()).toHaveAttribute("aria-disabled", "true");
    expect(retry()).toHaveAccessibleName("Try adding again");
    expect(retry()).toHaveAccessibleDescription(ONLINE_ONLY_REASON);
    const reason = screen.getByText(ONLINE_ONLY_REASON);
    expect(retry().getAttribute("aria-describedby")).toBe(reason.id);
    expect(alert()).not.toContainElement(reason);
    expect(reason.closest("[aria-live], [role=status], [role=alert]")).toBeNull();
    expect(alert()).toHaveTextContent(MESSAGE);
    expect(within(alert()).getByRole("link", { name: "View trip" })).toHaveAttribute(
      "href",
      `/trips/${TRIP}`,
    );
    // No region was added or removed.
    expect(document.querySelectorAll("[aria-live], [role=status], [role=alert]")).toHaveLength(
      liveRegionsBefore.length,
    );

    await userEvent.click(retry());
    retry().focus();
    await userEvent.keyboard("{Enter}");
    await userEvent.keyboard(" ");
    expect(onRetry).not.toHaveBeenCalled();
    expect(retry()).toHaveFocus();
  });

  it("recovery restores the button and removes the reason without retrying; an explicit press then retries once", async () => {
    const onRetry = await renderAnnouncer();
    evidence("network-failure");
    browserEvent("offline");
    browserEvent("online"); // unreachable → unknown
    expect(retry()).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByText(ONLINE_ONLY_REASON)).toBeNull();
    expect(onRetry).not.toHaveBeenCalled();
    retry().focus();
    await userEvent.keyboard("{Enter}");
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("an existing pending state (retryDisabled) is kept through loss and recovery", async () => {
    await renderAnnouncer({ retryDisabled: true });
    expect(retry()).toHaveAttribute("aria-disabled", "true");
    evidence("network-failure");
    expect(retry()).toHaveAttribute("aria-disabled", "true");
    evidence("response");
    expect(retry()).toHaveAttribute("aria-disabled", "true");
    expect(retry()).not.toHaveAccessibleDescription(ONLINE_ONLY_REASON);
  });

  it("no reason is shown for an alert without a retry", async () => {
    function NoRetry() {
      const announcer = useTripsAnnouncer()!;
      return (
        <button
          type="button"
          onClick={() => announcer.announce(LANDMARK, { tone: "alert", parts: [MESSAGE] })}
        >
          Announce plain
        </button>
      );
    }
    const auth: AuthContextValue = {
      session: { status: "authenticated", user: TEST_USER },
      checking: false,
      refresh: vi.fn(() => Promise.resolve()),
      signOut: vi.fn(() => Promise.resolve()),
    };
    render(
      <MemoryRouter>
        <AuthContext.Provider value={auth}>
          <TripsAnnouncer>
            <NoRetry />
          </TripsAnnouncer>
        </AuthContext.Provider>
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Announce plain" }));
    evidence("network-failure");
    expect(alert()).toHaveTextContent(MESSAGE);
    expect(screen.queryByText(ONLINE_ONLY_REASON)).toBeNull();
  });
});
