import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { useLandmarkSearch } from "./useLandmarkSearch";

vi.mock("./useLandmarkSearch", () => ({ useLandmarkSearch: vi.fn() }));

const { LandmarkSearch } = await import("./LandmarkSearch");

function renderSearch(props: { committedQuery?: string; categories?: string[] } = {}) {
  return render(
    <MemoryRouter>
      <LandmarkSearch committedQuery={props.committedQuery ?? ""} categories={props.categories ?? []} />
    </MemoryRouter>,
  );
}

function baseControls(overrides: Partial<ReturnType<typeof useLandmarkSearch>> = {}) {
  return {
    status: { kind: "idle" as const },
    onNextPage: vi.fn(),
    onPreviousPage: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
}

describe("LandmarkSearch (M02-T07: results list only — filters UI moved to DiscoveryFilters)", () => {
  it("passes committedQuery/categories straight through to useLandmarkSearch", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(baseControls());
    renderSearch({ committedQuery: "Coal", categories: ["arch"] });

    expect(useLandmarkSearch).toHaveBeenCalledWith("Coal", ["arch"]);
  });

  it("shows the section heading, focusable as a skip-link target (M02-T08)", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(baseControls());
    renderSearch();

    const heading = screen.getByRole("heading", { name: /name search results/i });
    expect(heading).toBeInTheDocument();
    expect(heading).toHaveAttribute("id", "search-heading");
    expect(heading).toHaveAttribute("tabIndex", "-1");
  });

  it("shows an instructional message in the idle state", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(baseControls());
    renderSearch();

    expect(screen.getByText(/type a landmark name or choose a category above/i)).toBeInTheDocument();
  });

  it("shows a loading state while searching", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(baseControls({ status: { kind: "loading" } }));
    renderSearch();

    expect(screen.getByRole("status")).toHaveTextContent(/searching/i);
  });

  it("shows a real error state with working retry", async () => {
    const retry = vi.fn();
    vi.mocked(useLandmarkSearch).mockReturnValue(baseControls({ status: { kind: "error", message: "Server error." }, retry }));
    renderSearch();

    expect(screen.getByRole("alert")).toHaveTextContent("Server error.");
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows an empty-results state for zero matches", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({ status: { kind: "success", items: [], page: 1, hasMore: false, isTruncated: false } }),
    );
    renderSearch();

    expect(screen.getByText(/no landmarks found matching your search/i)).toBeInTheDocument();
  });

  it("renders only name and category for each result, identically for PUBLIC- and non-PUBLIC-shaped records, and never shows coordinates", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({
        status: {
          kind: "success",
          page: 1,
          hasMore: false,
          isTruncated: false,
          items: [
            { id: "a", display_name: "Open Falls", category: "falls", latitude: 35.123456, longitude: -85.654321 },
            { id: "b", display_name: "Hidden Peak", category: "peak" },
          ],
        },
      }),
    );
    renderSearch();

    const resultsList = screen.getByRole("list");
    const openLink = within(resultsList).getByRole("link", { name: "Open Falls" });
    const hiddenLink = within(resultsList).getByRole("link", { name: "Hidden Peak" });
    expect(openLink).toHaveAttribute("href", "/landmarks/a");
    expect(hiddenLink).toHaveAttribute("href", "/landmarks/b");
    expect(within(resultsList).getByText("Waterfall")).toBeInTheDocument();
    expect(within(resultsList).getByText("Mountain Peak")).toBeInTheDocument();

    expect(screen.queryByText(/35\.123456/)).not.toBeInTheDocument();
    expect(screen.queryByText(/-85\.654321/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\d+\.\d{4,}/);
  });

  it("marks each profile link with fromDiscovery state so return navigation can use navigate(-1)", async () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({
        status: {
          kind: "success",
          page: 1,
          hasMore: false,
          isTruncated: false,
          items: [{ id: "a", display_name: "Open Falls", category: "falls" }],
        },
      }),
    );

    function LocationProbe() {
      const location = useLocation();
      const state = location.state as { fromDiscovery?: boolean } | null;
      return <div>fromDiscovery: {String(Boolean(state?.fromDiscovery))}</div>;
    }

    render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<LandmarkSearch committedQuery="" categories={[]} />} />
          <Route path="/landmarks/:id" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    await userEvent.click(screen.getByRole("link", { name: "Open Falls" }));
    expect(await screen.findByText("fromDiscovery: true")).toBeInTheDocument();
  });

  it("shows the truncation notice only when is_truncated is true, separate from has_more", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({
        status: {
          kind: "success",
          page: 1,
          hasMore: true,
          isTruncated: false,
          items: [{ id: "a", display_name: "A", category: "falls" }],
        },
      }),
    );
    const { unmount } = renderSearch();
    expect(screen.queryByText(/more results exist/i)).not.toBeInTheDocument();
    unmount();

    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({
        status: {
          kind: "success",
          page: 1,
          hasMore: false,
          isTruncated: true,
          items: [{ id: "a", display_name: "A", category: "falls" }],
        },
      }),
    );
    renderSearch();
    expect(screen.getByText(/more results exist/i)).toBeInTheDocument();
  });

  it("disables Previous on page 1 and Next when has_more is false; enables them otherwise", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({
        status: {
          kind: "success",
          page: 1,
          hasMore: false,
          isTruncated: false,
          items: [{ id: "a", display_name: "A", category: "falls" }],
        },
      }),
    );
    renderSearch();
    expect(screen.getByRole("button", { name: /previous/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("enables Previous past page 1 and Next when another page exists; clicking calls the right handler", async () => {
    const onNextPage = vi.fn();
    const onPreviousPage = vi.fn();
    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({
        status: {
          kind: "success",
          page: 2,
          hasMore: true,
          isTruncated: false,
          items: [{ id: "a", display_name: "A", category: "falls" }],
        },
        onNextPage,
        onPreviousPage,
      }),
    );
    renderSearch();

    const next = screen.getByRole("button", { name: /next/i });
    const previous = screen.getByRole("button", { name: /previous/i });
    expect(next).toBeEnabled();
    expect(previous).toBeEnabled();

    await userEvent.click(next);
    expect(onNextPage).toHaveBeenCalledOnce();
    await userEvent.click(previous);
    expect(onPreviousPage).toHaveBeenCalledOnce();
  });
});

describe("LandmarkSearch — retaining previous results during loading/error (M02-T08, closing the M02-T07 follow-up)", () => {
  const previousItem = { id: "a", display_name: "A", category: "falls" };

  it("shows the plain loading label and no list when there is no previous result", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(baseControls({ status: { kind: "loading" } }));
    renderSearch();

    expect(screen.getByRole("status")).toHaveTextContent(/^searching/i);
    expect(screen.queryByText(/previous search/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("shows retained results, labeled as previous (not confirmed), while a subsequent search is loading", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({
        status: {
          kind: "loading",
          previous: { items: [previousItem], page: 1, hasMore: false, isTruncated: false },
        },
      }),
    );
    renderSearch();

    expect(screen.getByText(/updating search results/i)).toBeInTheDocument();
    expect(screen.getByText(/previous search/i)).toHaveTextContent(/the update loads/i);
    expect(screen.getByText(/may not match your current search or filters/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "A" })).toBeInTheDocument();
  });

  it("shows retained results, labeled as previous, alongside the real error alert when a subsequent search fails", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({
        status: {
          kind: "error",
          message: "Server error.",
          previous: { items: [previousItem], page: 1, hasMore: false, isTruncated: false },
        },
      }),
    );
    renderSearch();

    expect(screen.getByRole("alert")).toHaveTextContent("Server error.");
    expect(screen.getByText(/previous search/i)).toHaveTextContent(/the update failed/i);
    expect(screen.getByRole("link", { name: "A" })).toBeInTheDocument();
  });

  it("shows no previous-results notice or list on error when nothing was ever successfully fetched", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({ status: { kind: "error", message: "Server error." } }),
    );
    renderSearch();

    expect(screen.getByRole("alert")).toHaveTextContent("Server error.");
    expect(screen.queryByText(/previous search/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("does not show a previous-results notice when the retained previous result was itself empty", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({
        status: { kind: "loading", previous: { items: [], page: 1, hasMore: false, isTruncated: false } },
      }),
    );
    renderSearch();

    expect(screen.queryByText(/previous search/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
  });

  it("a successful (even empty) response is never shown as 'previous' — success is always authoritative", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({ status: { kind: "success", items: [], page: 1, hasMore: false, isTruncated: false } }),
    );
    renderSearch();

    expect(screen.queryByText(/previous search/i)).not.toBeInTheDocument();
    expect(screen.getByText(/no landmarks found matching your search/i)).toBeInTheDocument();
  });

  it("Previous/Next controls reflect the retained previous page's pagination state", () => {
    vi.mocked(useLandmarkSearch).mockReturnValue(
      baseControls({
        status: {
          kind: "loading",
          previous: { items: [previousItem], page: 2, hasMore: true, isTruncated: false },
        },
      }),
    );
    renderSearch();

    expect(screen.getByRole("button", { name: /previous/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /next/i })).toBeEnabled();
  });
});
