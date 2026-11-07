import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getCategories } from "../api/categories";
import { ApiError } from "../api/client";
import { useCategoryOptions } from "./useCategoryOptions";

vi.mock("../api/categories", () => ({ getCategories: vi.fn() }));

describe("useCategoryOptions", () => {
  it("starts loading, then succeeds with the fetched categories", async () => {
    vi.mocked(getCategories).mockResolvedValue([{ slug: "falls", label: "Waterfall" }]);

    const { result } = renderHook(() => useCategoryOptions());
    expect(result.current.status).toEqual({ kind: "loading" });

    await waitFor(() =>
      expect(result.current.status).toEqual({
        kind: "success",
        categories: [{ slug: "falls", label: "Waterfall" }],
      }),
    );
  });

  it("does not treat an in-progress request as an empty category list", () => {
    vi.mocked(getCategories).mockReturnValue(new Promise(() => {}));

    const { result } = renderHook(() => useCategoryOptions());

    expect(result.current.status.kind).toBe("loading");
    expect(result.current.status).not.toMatchObject({ kind: "success", categories: [] });
  });

  it("reports a real error on failure, with a working retry", async () => {
    vi.mocked(getCategories)
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL", "Server error."))
      .mockResolvedValueOnce([{ slug: "arch", label: "Natural Arch" }]);

    const { result } = renderHook(() => useCategoryOptions());
    await waitFor(() => expect(result.current.status).toEqual({ kind: "error", message: "Server error." }));

    result.current.retry();
    await waitFor(() =>
      expect(result.current.status).toEqual({
        kind: "success",
        categories: [{ slug: "arch", label: "Natural Arch" }],
      }),
    );
    expect(getCategories).toHaveBeenCalledTimes(2);
  });
});
