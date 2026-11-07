import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { searchLandmarks } from "../api/landmarks";

// Deliberately does NOT mock ./useLandmarkSearch — only the network-level API
// call is mocked. This is what actually proves a real click on the real
// rendered "Try again" button, through the real hook, issues a genuinely new
// network request (LandmarkSearch.test.tsx mocks the hook; useLandmarkSearch
// .test.ts mocks the component away entirely — neither alone proves the two
// are wired together correctly). Re-scoped for M02-T07: `LandmarkSearch` now
// takes its committed `q`/`categories` as props (lifted out to
// `useDiscoveryFilters`/the URL) rather than owning input/category state
// itself, so this test drives it directly via props.
vi.mock("../api/landmarks", () => ({ searchLandmarks: vi.fn() }));

const { LandmarkSearch } = await import("./LandmarkSearch");

function renderReal(committedQuery: string, categories: string[]) {
  return render(
    <MemoryRouter>
      <LandmarkSearch committedQuery={committedQuery} categories={categories} />
    </MemoryRouter>,
  );
}

describe("LandmarkSearch — real hook, mocked network only (M02-T07 retry-path verification)", () => {
  it("clicking the real Try again button issues a genuinely new request for the same committed term/categories/page", async () => {
    vi.mocked(searchLandmarks)
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL", "Server error."))
      .mockResolvedValueOnce({
        items: [{ id: "a", display_name: "Coal Creek Arches", category: "arch" }],
        page: 1,
        limit: 20,
        has_more: false,
        is_truncated: false,
      });

    renderReal("Coal", []);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Server error."));
    expect(searchLandmarks).toHaveBeenCalledTimes(1);
    expect(searchLandmarks).toHaveBeenCalledWith({ q: "Coal", categories: [], page: 1, limit: 20 });

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(screen.getByText("Coal Creek Arches")).toBeInTheDocument());
    expect(searchLandmarks).toHaveBeenCalledTimes(2);
    expect(searchLandmarks).toHaveBeenNthCalledWith(1, { q: "Coal", categories: [], page: 1, limit: 20 });
    expect(searchLandmarks).toHaveBeenNthCalledWith(2, { q: "Coal", categories: [], page: 1, limit: 20 });
  });

  it("works identically when categories are passed instead of (or alongside) text", async () => {
    vi.mocked(searchLandmarks)
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL", "Server error."))
      .mockResolvedValueOnce({
        items: [{ id: "b", display_name: "Coalfield Falls", category: "falls" }],
        page: 1,
        limit: 20,
        has_more: false,
        is_truncated: false,
      });

    renderReal("", ["falls"]);

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Server error."));
    expect(searchLandmarks).toHaveBeenCalledWith({ q: "", categories: ["falls"], page: 1, limit: 20 });

    await userEvent.click(screen.getByRole("button", { name: /try again/i }));

    await waitFor(() => expect(screen.getByText("Coalfield Falls")).toBeInTheDocument());
    expect(searchLandmarks).toHaveBeenCalledTimes(2);
    expect(searchLandmarks).toHaveBeenNthCalledWith(2, { q: "", categories: ["falls"], page: 1, limit: 20 });
  });

  it("re-fetches with the new committed values when the component is re-rendered with different committed props (proving real DiscoveryFilters commits would drive a real refetch)", async () => {
    vi.mocked(searchLandmarks).mockResolvedValue({
      items: [{ id: "a", display_name: "A", category: "falls" }],
      page: 1,
      limit: 20,
      has_more: false,
      is_truncated: false,
    });

    const { rerender } = render(
      <MemoryRouter>
        <LandmarkSearch committedQuery="Coal" categories={[]} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(searchLandmarks).toHaveBeenCalledTimes(1));

    rerender(
      <MemoryRouter>
        <LandmarkSearch committedQuery="Falls" categories={["arch"]} />
      </MemoryRouter>,
    );

    await waitFor(() => expect(searchLandmarks).toHaveBeenCalledTimes(2));
    expect(searchLandmarks).toHaveBeenLastCalledWith({ q: "Falls", categories: ["arch"], page: 1, limit: 20 });
  });
});
