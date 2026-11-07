import { act, render, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import type { DiscoveryUrlState } from "./discoveryUrlState";
import { useDiscoveryUrlState, type DiscoveryUrlActions } from "./useDiscoveryUrlState";

let latestState: DiscoveryUrlState | null = null;
let latestActions: DiscoveryUrlActions | null = null;

function Probe() {
  const [state, actions] = useDiscoveryUrlState();
  latestState = state;
  latestActions = actions;
  return null;
}

function setup(initialPath = "/") {
  const router = createMemoryRouter([{ path: "/", element: <Probe /> }], { initialEntries: [initialPath] });
  render(<RouterProvider router={router} />);
  return router;
}

describe("useDiscoveryUrlState — push vs. replace (spec §9.6)", () => {
  afterEach(() => {
    latestState = null;
    latestActions = null;
  });

  it("commitText uses replaceState — no new history entry", async () => {
    const router = setup("/");
    act(() => latestActions!.commitText("Coal"));
    await waitFor(() => expect(router.state.location.search).toBe("?q=Coal"));
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("commitCategories uses replaceState", async () => {
    const router = setup("/");
    act(() => latestActions!.commitCategories(["arch", "falls"]));
    await waitFor(() => expect(router.state.location.search).toBe("?categories=arch%2Cfalls"));
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("commitBbox uses pushState — a new, back-navigable history entry", async () => {
    const router = setup("/");
    act(() => latestActions!.commitBbox({ minLng: -85, minLat: 35, maxLng: -84, maxLat: 36 }));
    await waitFor(() => expect(router.state.location.search).toContain("bbox="));
    expect(router.state.historyAction).toBe("PUSH");
    expect(latestState!.mode).toBe("bbox");
  });

  it("commitNearOrigin uses pushState and sets mode=near", async () => {
    const router = setup("/");
    act(() => latestActions!.commitNearOrigin({ lat: 35.5, lng: -85.5 }, 25));
    await waitFor(() => expect(router.state.location.search).toContain("near="));
    expect(router.state.historyAction).toBe("PUSH");
    expect(latestState!.mode).toBe("near");
    expect(latestState!.near).toEqual({ lat: 35.5, lng: -85.5 });
    expect(latestState!.radius).toBe(25);
  });

  it("commitRadius (already in near mode) uses replaceState and only changes the radius", async () => {
    const router = setup("/?mode=near&near=35.5,-85.5&radius=25");
    act(() => latestActions!.commitRadius(50));
    await waitFor(() => expect(latestState!.radius).toBe(50));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(latestState!.near).toEqual({ lat: 35.5, lng: -85.5 });
  });

  it("exitProximity uses pushState, returns to bbox mode, and keeps the previously committed bbox", async () => {
    const router = setup("/?mode=near&near=35.5,-85.5&radius=25&bbox=-85,35,-84,36");
    act(() => latestActions!.exitProximity());
    await waitFor(() => expect(latestState!.mode).toBe("bbox"));
    expect(router.state.historyAction).toBe("PUSH");
    expect(latestState!.bbox).toEqual({ minLng: -85, minLat: 35, maxLng: -84, maxLat: 36 });
  });

  it("updateViewport uses replaceState and never resets the committed query/geo params", async () => {
    const router = setup("/?q=Coal&mode=near&near=35.5,-85.5&radius=25");
    act(() => latestActions!.updateViewport([35.9, -85.1], 9));
    await waitFor(() => expect(latestState!.viewport).toEqual({ center: [35.9, -85.1], zoom: 9 }));
    expect(router.state.historyAction).toBe("REPLACE");
    expect(latestState!.q).toBe("Coal");
    expect(latestState!.mode).toBe("near");
  });

  it("commitText clears the q param entirely for an empty string, rather than leaving an empty value", async () => {
    const router = setup("/?q=Coal");
    act(() => latestActions!.commitText(""));
    await waitFor(() => expect(router.state.location.search).toBe(""));
  });

  it("re-committing the identical text does not throw and leaves state unchanged", async () => {
    setup("/?q=Coal");
    act(() => latestActions!.commitText("Coal"));
    await waitFor(() => expect(latestState!.q).toBe("Coal"));
  });
});
