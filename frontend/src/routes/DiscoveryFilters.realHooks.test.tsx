import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { getCategories } from "../api/categories";
import { searchLandmarks } from "../api/landmarks";
import { DiscoveryFilters } from "./DiscoveryFilters";
import { LandmarkSearch } from "./LandmarkSearch";
import { useDiscoveryFilters } from "./useDiscoveryFilters";
import { useDiscoveryUrlState } from "./useDiscoveryUrlState";

// Only the network layer is mocked here — `useDiscoveryUrlState`,
// `useDiscoveryFilters`, `DiscoveryFilters`, `useLandmarkSearch`, and
// `LandmarkSearch` are all real. This is what actually proves the central
// M02-T07 architectural change (a single committed filters hook feeding the
// results list — and, by the same wiring, the map's `useMapMarkers`, not
// exercised in this file) rather than two separately-mocked halves that
// never prove they're connected.
vi.mock("../api/landmarks", () => ({ searchLandmarks: vi.fn() }));
vi.mock("../api/categories", () => ({ getCategories: vi.fn() }));

function Harness() {
  const [urlState, urlActions] = useDiscoveryUrlState();
  const filters = useDiscoveryFilters(urlState, urlActions);
  return (
    <>
      <DiscoveryFilters controls={filters} />
      <LandmarkSearch committedQuery={filters.committedQuery} categories={filters.selectedCategories} />
    </>
  );
}

function renderHarness(initialPath = "/") {
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <Routes>
        <Route path="/" element={<Harness />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("DiscoveryFilters + useDiscoveryUrlState + LandmarkSearch — real hooks wired together (M02-T07)", () => {
  it("typing a name and pressing Enter commits it to the URL and drives a real list fetch", async () => {
    vi.mocked(getCategories).mockResolvedValue([{ slug: "arch", label: "Natural Arch" }]);
    vi.mocked(searchLandmarks).mockResolvedValue({
      items: [{ id: "a", display_name: "Coal Creek Arches", category: "arch" }],
      page: 1,
      limit: 20,
      has_more: false,
      is_truncated: false,
    });

    renderHarness();

    const input = await screen.findByLabelText(/search landmarks by name/i);
    await userEvent.type(input, "Coal{Enter}");

    await waitFor(() => expect(screen.getByText("Coal Creek Arches")).toBeInTheDocument());
    expect(searchLandmarks).toHaveBeenCalledWith({ q: "Coal", categories: [], page: 1, limit: 20 });
  });

  it("checking a category commits it immediately and drives a real list fetch", async () => {
    vi.mocked(getCategories).mockResolvedValue([{ slug: "falls", label: "Waterfall" }]);
    vi.mocked(searchLandmarks).mockResolvedValue({
      items: [{ id: "b", display_name: "Coalfield Falls", category: "falls" }],
      page: 1,
      limit: 20,
      has_more: false,
      is_truncated: false,
    });

    renderHarness();

    const checkbox = await screen.findByRole("checkbox", { name: "Waterfall" });
    await userEvent.click(checkbox);

    await waitFor(() => expect(screen.getByText("Coalfield Falls")).toBeInTheDocument());
    expect(searchLandmarks).toHaveBeenCalledWith({ q: "", categories: ["falls"], page: 1, limit: 20 });
  });

  it("restores committed q/categories from the URL on first render (refresh/direct-link restoration, spec §9.6)", async () => {
    vi.mocked(getCategories).mockResolvedValue([{ slug: "arch", label: "Natural Arch" }]);
    vi.mocked(searchLandmarks).mockResolvedValue({
      items: [{ id: "a", display_name: "Restored Arch", category: "arch" }],
      page: 1,
      limit: 20,
      has_more: false,
      is_truncated: false,
    });

    renderHarness("/?q=Restored&categories=arch");

    expect(await screen.findByDisplayValue("Restored")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "Natural Arch" })).toBeChecked());
    await waitFor(() => expect(screen.getByText("Restored Arch")).toBeInTheDocument());
    expect(searchLandmarks).toHaveBeenCalledWith({ q: "Restored", categories: ["arch"], page: 1, limit: 20 });
  });

  it("Clear all filters clears the URL params and returns the list to idle", async () => {
    vi.mocked(getCategories).mockResolvedValue([{ slug: "arch", label: "Natural Arch" }]);
    vi.mocked(searchLandmarks).mockResolvedValue({
      items: [{ id: "a", display_name: "Restored Arch", category: "arch" }],
      page: 1,
      limit: 20,
      has_more: false,
      is_truncated: false,
    });

    renderHarness("/?q=Restored&categories=arch");
    await waitFor(() => expect(screen.getByText("Restored Arch")).toBeInTheDocument());

    await userEvent.click(screen.getByRole("button", { name: /clear all filters/i }));

    expect(await screen.findByText(/type a landmark name or choose a category/i)).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Natural Arch" })).not.toBeChecked();
  });
});
