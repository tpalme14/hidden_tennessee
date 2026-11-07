import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { useCategoryOptions } from "./useCategoryOptions";
import type { DiscoveryFiltersControls } from "./useDiscoveryFilters";

vi.mock("./useCategoryOptions", () => ({ useCategoryOptions: vi.fn() }));

const { DiscoveryFilters } = await import("./DiscoveryFilters");

const TWO_CATEGORIES = [
  { slug: "arch", label: "Natural Arch" },
  { slug: "falls", label: "Waterfall" },
];

function baseCategoryOptions(overrides: Partial<ReturnType<typeof useCategoryOptions>> = {}) {
  return {
    status: { kind: "success" as const, categories: TWO_CATEGORIES },
    retry: vi.fn(),
    ...overrides,
  };
}

function baseControls(overrides: Partial<DiscoveryFiltersControls> = {}): DiscoveryFiltersControls {
  return {
    inputValue: "",
    committedQuery: "",
    selectedCategories: [],
    onInputChange: vi.fn(),
    onSubmitNow: vi.fn(),
    onToggleCategory: vi.fn(),
    onClearAll: vi.fn(),
    ...overrides,
  };
}

describe("DiscoveryFilters (M02-T07: shared text/category controls, lifted out of LandmarkSearch)", () => {
  it("wires the input, Enter key, and Clear all filters button to their handlers", async () => {
    const onInputChange = vi.fn();
    const onSubmitNow = vi.fn();
    const onClearAll = vi.fn();
    vi.mocked(useCategoryOptions).mockReturnValue(baseCategoryOptions());
    render(<DiscoveryFilters controls={baseControls({ onInputChange, onSubmitNow, onClearAll })} />);

    const input = screen.getByLabelText(/search landmarks by name/i);
    await userEvent.type(input, "C");
    expect(onInputChange).toHaveBeenCalled();

    await userEvent.type(input, "{Enter}");
    expect(onSubmitNow).toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /clear all filters/i }));
    expect(onClearAll).toHaveBeenCalledOnce();
  });

  it("caps the input at 100 characters via maxLength", () => {
    vi.mocked(useCategoryOptions).mockReturnValue(baseCategoryOptions());
    render(<DiscoveryFilters controls={baseControls()} />);

    expect(screen.getByLabelText(/search landmarks by name/i)).toHaveAttribute("maxLength", "100");
  });

  it("renders a labeled fieldset with one checkbox per fetched category", () => {
    vi.mocked(useCategoryOptions).mockReturnValue(baseCategoryOptions());
    render(<DiscoveryFilters controls={baseControls()} />);

    const group = screen.getByRole("group", { name: /filter by category/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Natural Arch" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Waterfall" })).toBeInTheDocument();
  });

  it("reflects selectedCategories as checked, and toggles call onToggleCategory with the right slug", async () => {
    const onToggleCategory = vi.fn();
    vi.mocked(useCategoryOptions).mockReturnValue(baseCategoryOptions());
    render(<DiscoveryFilters controls={baseControls({ selectedCategories: ["arch"], onToggleCategory })} />);

    const archBox = screen.getByRole("checkbox", { name: "Natural Arch" });
    const fallsBox = screen.getByRole("checkbox", { name: "Waterfall" });
    expect(archBox).toBeChecked();
    expect(fallsBox).not.toBeChecked();

    await userEvent.click(fallsBox);
    expect(onToggleCategory).toHaveBeenCalledWith("falls");
  });

  it("shows a loading state for the category list without blocking the name-search input", () => {
    vi.mocked(useCategoryOptions).mockReturnValue({ status: { kind: "loading" }, retry: vi.fn() });
    render(<DiscoveryFilters controls={baseControls()} />);

    expect(screen.getByText(/loading categories/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/search landmarks by name/i)).toBeInTheDocument();
  });

  it("shows a real error with retry for the category list, independent of the search input", async () => {
    const categoryRetry = vi.fn();
    vi.mocked(useCategoryOptions).mockReturnValue({
      status: { kind: "error", message: "Could not load categories." },
      retry: categoryRetry,
    });
    render(<DiscoveryFilters controls={baseControls()} />);

    expect(screen.getByText("Could not load categories.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /try again/i }));
    expect(categoryRetry).toHaveBeenCalledOnce();
    expect(screen.getByLabelText(/search landmarks by name/i)).toBeInTheDocument();
  });

  it("shows an empty state if the category list legitimately has zero entries", () => {
    vi.mocked(useCategoryOptions).mockReturnValue({ status: { kind: "success", categories: [] }, retry: vi.fn() });
    render(<DiscoveryFilters controls={baseControls()} />);

    expect(screen.getByText(/no category filters are available/i)).toBeInTheDocument();
  });
});
