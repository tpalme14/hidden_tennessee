import { act, cleanup, render, waitFor } from "@testing-library/react";
import {
  BrowserRouter,
  createMemoryRouter,
  MemoryRouter,
  Route,
  RouterProvider,
  Routes,
  useNavigate,
  type NavigateFunction,
} from "react-router";
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
  const router = createMemoryRouter([{ path: "/", element: <Probe /> }], {
    initialEntries: [initialPath],
  });
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

/**
 * M06-T02 Increment 5a — route ownership at the URL-write boundary. Order C
 * (observed in the browser): the router's history has ALREADY moved to another
 * route while the Discover hook is still mounted (React's commit follows in a
 * transition), and a delayed Discover write (a viewport report, the text
 * debounce) runs in that gap. With the real BrowserRouter, the gap is
 * reproduced by moving `window.history` directly — the router has not
 * re-rendered and the hook's actions are still the live, mounted ones (this is
 * NOT the post-unmount case the tracker's lifecycle guard covers).
 */
describe("useDiscoveryUrlState — route ownership (Increment 5a)", () => {
  let navigateTo: NavigateFunction | null = null;
  function Navigator() {
    navigateTo = useNavigate();
    return null;
  }

  function renderInBrowserRouter() {
    window.history.replaceState(null, "", "/");
    render(
      <BrowserRouter>
        <Navigator />
        <Routes>
          <Route path="/" element={<Probe />} />
          <Route path="/sign-in" element={<p>Sign in page</p>} />
        </Routes>
      </BrowserRouter>,
    );
  }

  afterEach(() => {
    cleanup();
    window.history.replaceState(null, "", "/");
    latestState = null;
    latestActions = null;
    navigateTo = null;
  });

  const BBOX = { minLng: -85, minLat: 35, maxLng: -84, maxLat: 36 };

  it("a legitimate viewport update writes the Discover search parameters (browser router)", () => {
    renderInBrowserRouter();
    act(() => latestActions!.updateViewport([35.5, -85.5], 9));
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("?lat=35.50000&lng=-85.50000&zoom=9");
  });

  it("query-only changes within the owned route remain permitted (push and replace)", () => {
    renderInBrowserRouter();
    const before = window.history.length;
    act(() => latestActions!.commitText("Coal"));
    expect(window.location.search).toBe("?q=Coal");
    expect(window.history.length).toBe(before); // replace
    act(() => latestActions!.commitBbox(BBOX));
    expect(window.location.search).toContain("bbox=");
    expect(window.history.length).toBe(before + 1); // push
  });

  it.each<[string, (a: DiscoveryUrlActions) => void]>([
    ["updateViewport", (a) => a.updateViewport([35.5, -85.5], 9)],
    ["commitText", (a) => a.commitText("Coal")],
    ["commitCategories", (a) => a.commitCategories(["falls"])],
    ["commitBbox", (a) => a.commitBbox(BBOX)],
    ["commitNearOrigin", (a) => a.commitNearOrigin({ lat: 35.5, lng: -85.5 }, 25)],
    ["commitRadius", (a) => a.commitRadius(10)],
    ["exitProximity", (a) => a.exitProximity()],
  ])(
    "Order C: after history moved to another route but before Discover unmounts, %s writes nothing and the destination stays",
    (_name, write) => {
      renderInBrowserRouter();
      const live = latestActions!; // the mounted hook's current actions
      // The navigation has updated browser history; React has not re-rendered.
      window.history.pushState(null, "", "/sign-in");
      expect(latestActions).toBe(live); // still mounted, same callbacks
      const entries = window.history.length;
      act(() => write(live));
      expect(window.location.pathname).toBe("/sign-in");
      expect(window.location.search).toBe("");
      expect(window.history.length).toBe(entries); // no write at all
    },
  );

  it("after a real navigation away and back, the new Discover instance updates the URL normally", async () => {
    renderInBrowserRouter();
    act(() => navigateTo!("/sign-in"));
    await waitFor(() => expect(window.location.pathname).toBe("/sign-in"));
    act(() => navigateTo!("/"));
    await waitFor(() => expect(latestActions).not.toBeNull());
    act(() => latestActions!.updateViewport([35.6, -85.6], 10));
    expect(window.location.pathname).toBe("/");
    expect(window.location.search).toBe("?lat=35.60000&lng=-85.60000&zoom=10");
  });

  it("data router (createMemoryRouter): a write after the router moved elsewhere is dropped; same-route writes work", async () => {
    const router = createMemoryRouter(
      [
        { path: "/", element: <Probe /> },
        { path: "/sign-in", element: <p>Sign in page</p> },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);
    act(() => latestActions!.commitText("Coal"));
    await waitFor(() => expect(router.state.location.search).toBe("?q=Coal"));
    const live = latestActions!;
    await act(async () => {
      await router.navigate("/sign-in");
      live.updateViewport([35.5, -85.5], 9); // a stale write from the old route's callbacks
    });
    expect(router.state.location.pathname).toBe("/sign-in");
    expect(router.state.location.search).toBe("");
  });

  it("component MemoryRouter: same-route writes still work (no comparison with window.location)", async () => {
    window.history.replaceState(null, "", "/somewhere-else");
    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<Probe />} />
        </Routes>
      </MemoryRouter>,
    );
    act(() => latestActions!.commitText("Coal"));
    await waitFor(() => expect(latestState!.q).toBe("Coal"));
    expect(window.location.pathname).toBe("/somewhere-else"); // the browser was never touched
  });
});
