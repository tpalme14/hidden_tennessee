import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  FavoritesAnnouncer,
  useFavoritesAnnouncer,
  type FavoritesAnnouncerValue,
} from "./FavoritesAnnouncer";

/**
 * M03-T06 Increment 4 — the shared favorites announcer (resolution B2): one
 * polite live region and at most one alert, newest message per region,
 * per-landmark clearing, no focus movement.
 */

let api: FavoritesAnnouncerValue;
function Capture() {
  api = useFavoritesAnnouncer()!;
  return <button type="button">elsewhere</button>;
}

function setup() {
  const utils = render(
    <FavoritesAnnouncer>
      <Capture />
    </FavoritesAnnouncer>,
  );
  const polite = () => utils.container.querySelector<HTMLElement>('[aria-live="polite"]')!;
  return { ...utils, polite };
}

describe("FavoritesAnnouncer", () => {
  it("renders exactly one polite live region (no explicit status role) and no alert when idle", () => {
    const { container, polite } = setup();
    expect(container.querySelectorAll("[aria-live]")).toHaveLength(1);
    expect(polite()).toHaveAttribute("aria-atomic", "true");
    expect(polite()).toBeEmptyDOMElement();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("useFavoritesAnnouncer is null outside an announcer", () => {
    let value: unknown = "unset";
    function Probe() {
      value = useFavoritesAnnouncer();
      return null;
    }
    render(<Probe />);
    expect(value).toBeNull();
  });

  it("a status shows in the polite region; a repeated identical status replaces its node (re-announced)", () => {
    const { polite } = setup();
    act(() => api.announce("status", "a", "Saved Alpha to favorites."));
    expect(polite()).toHaveTextContent("Saved Alpha to favorites.");
    const first = polite().firstElementChild;
    act(() => api.announce("status", "a", "Saved Alpha to favorites."));
    expect(polite()).toHaveTextContent("Saved Alpha to favorites.");
    expect(polite().firstElementChild).not.toBe(first);
  });

  it("an alert appears as a single role=alert element", () => {
    setup();
    act(() => api.announce("alert", "a", "Alpha: Couldn't update favorites."));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("Alpha: Couldn't update favorites.");
  });

  it("concurrent outcomes: each region shows only the NEWEST message, never a concatenation", () => {
    const { polite } = setup();
    act(() => {
      api.announce("status", "a", "Saved Alpha to favorites.");
      api.announce("status", "b", "Saved Bravo to favorites.");
    });
    expect(polite()).toHaveTextContent(/^Saved Bravo to favorites\.$/);
    act(() => {
      api.announce("alert", "a", "Alpha: failed.");
      api.announce("alert", "b", "Bravo: failed.");
    });
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent(/^Bravo: failed\.$/);
  });

  it("another landmark's success never hides an existing error; the same landmark's success does", () => {
    const { polite } = setup();
    act(() => api.announce("alert", "a", "Alpha: failed."));
    act(() => api.announce("status", "b", "Saved Bravo to favorites."));
    expect(screen.getByRole("alert")).toHaveTextContent("Alpha: failed.");
    expect(polite()).toHaveTextContent("Saved Bravo to favorites.");

    act(() => api.announce("status", "a", "Saved Alpha to favorites."));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(polite()).toHaveTextContent("Saved Alpha to favorites.");
  });

  it("an error for a landmark clears that landmark's earlier success only", () => {
    const { polite } = setup();
    act(() => api.announce("status", "a", "Saved Alpha to favorites."));
    act(() => api.announce("alert", "b", "Bravo: failed."));
    expect(polite()).toHaveTextContent("Saved Alpha to favorites.");
    act(() => api.announce("alert", "a", "Alpha: failed."));
    expect(polite()).toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toHaveTextContent("Alpha: failed.");
  });

  it("clear(landmark) removes only that landmark's messages", () => {
    const { polite } = setup();
    act(() => {
      api.announce("status", "a", "Saved Alpha to favorites.");
      api.announce("alert", "b", "Bravo: failed.");
    });
    act(() => api.clear("a"));
    expect(polite()).toBeEmptyDOMElement();
    expect(screen.getByRole("alert")).toHaveTextContent("Bravo: failed.");
    act(() => api.clear("b"));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("never moves focus and its regions are not focusable", () => {
    const { container } = setup();
    const elsewhere = screen.getByRole("button", { name: "elsewhere" });
    elsewhere.focus();
    act(() => {
      api.announce("status", "a", "Saved Alpha to favorites.");
      api.announce("alert", "b", "Bravo: failed.");
    });
    expect(elsewhere).toHaveFocus();
    expect(container.querySelector('[aria-live="polite"]')).not.toHaveAttribute("tabindex");
    expect(screen.getByRole("alert")).not.toHaveAttribute("tabindex");
  });
});
