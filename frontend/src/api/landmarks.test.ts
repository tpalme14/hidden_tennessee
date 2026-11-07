import { describe, expect, it, vi } from "vitest";

vi.mock("./client", async () => {
  const actual = await vi.importActual<typeof import("./client")>("./client");
  return {
    ...actual,
    getJson: vi.fn().mockResolvedValue({ items: [], page: 1, limit: 20, has_more: false, is_truncated: false }),
  };
});

const { getJson } = await import("./client");
const { searchLandmarks, getLandmarkGeoMarkers } = await import("./landmarks");

describe("searchLandmarks", () => {
  it("builds the request URL via URLSearchParams without any custom escaping of the query text", async () => {
    const rawQuery = "100% off_set\\path";
    await searchLandmarks({ q: rawQuery, categories: [], page: 1, limit: 20 });

    const expectedParams = new URLSearchParams({ q: rawQuery, page: "1", limit: "20" });
    expect(getJson).toHaveBeenCalledWith(`/api/v1/landmarks?${expectedParams.toString()}`);
  });

  it("passes the page and limit through as-is", async () => {
    await searchLandmarks({ q: "Falls", categories: [], page: 3, limit: 20 });

    const expectedParams = new URLSearchParams({ q: "Falls", page: "3", limit: "20" });
    expect(getJson).toHaveBeenCalledWith(`/api/v1/landmarks?${expectedParams.toString()}`);
  });

  it("omits the categories parameter entirely when no categories are selected", async () => {
    await searchLandmarks({ q: "", categories: [], page: 1, limit: 20 });

    const url = vi.mocked(getJson).mock.calls.at(-1)?.[0] as string;
    expect(url).not.toContain("categories");
  });

  it("joins multiple selected categories with a comma", async () => {
    await searchLandmarks({ q: "", categories: ["arch", "falls"], page: 1, limit: 20 });

    const expectedParams = new URLSearchParams({ q: "", page: "1", limit: "20", categories: "arch,falls" });
    expect(getJson).toHaveBeenCalledWith(`/api/v1/landmarks?${expectedParams.toString()}`);
  });

  it("combines a name query and categories together (AND semantics is the server's job; this just confirms both params are sent)", async () => {
    await searchLandmarks({ q: "Coal", categories: ["arch"], page: 1, limit: 20 });

    const expectedParams = new URLSearchParams({ q: "Coal", page: "1", limit: "20", categories: "arch" });
    expect(getJson).toHaveBeenCalledWith(`/api/v1/landmarks?${expectedParams.toString()}`);
  });
});

describe("getLandmarkGeoMarkers", () => {
  it("builds a bbox-mode request, always at page=1/limit=200, omitting q and categories when empty", async () => {
    await getLandmarkGeoMarkers({ q: "", categories: [], geo: { mode: "bbox", bbox: "-90,34,-81,37" } });

    const url = vi.mocked(getJson).mock.calls.at(-1)?.[0] as string;
    expect(url).toBe("/api/v1/landmarks?bbox=-90%2C34%2C-81%2C37&page=1&limit=200");
  });

  it("builds a near-mode request with near and radius, never a bbox param", async () => {
    await getLandmarkGeoMarkers({ q: "", categories: [], geo: { mode: "near", near: "35.5,-85.5", radius: 25 } });

    const url = vi.mocked(getJson).mock.calls.at(-1)?.[0] as string;
    expect(url).toBe("/api/v1/landmarks?near=35.5%2C-85.5&radius=25&page=1&limit=200");
    expect(url).not.toContain("bbox");
  });

  it("includes q and categories alongside the geo params when present", async () => {
    await getLandmarkGeoMarkers({ q: "Coal", categories: ["arch", "falls"], geo: { mode: "bbox", bbox: "-90,34,-81,37" } });

    const url = vi.mocked(getJson).mock.calls.at(-1)?.[0] as string;
    expect(url).toContain("q=Coal");
    expect(url).toContain("categories=arch%2Cfalls");
    expect(url).toContain("bbox=-90%2C34%2C-81%2C37");
  });
});
