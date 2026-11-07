import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { getLandmarkProfile, MalformedLandmarkProfileError } from "../api/landmarks";
import { useLandmarkProfile } from "./useLandmarkProfile";

vi.mock("../api/landmarks", async () => {
  const actual = await vi.importActual<typeof import("../api/landmarks")>("../api/landmarks");
  return { ...actual, getLandmarkProfile: vi.fn() };
});

const FULL_PROFILE = {
  id: "a",
  display_name: "Public Arch",
  category: "arch",
  latitude: 36.2,
  longitude: -84.1,
  source_description: null,
  source_access_label: null,
  source_url: null,
};

const MINIMAL_PROFILE = { id: "b", display_name: "Hidden Falls", category: "falls", redacted: true as const };

describe("useLandmarkProfile", () => {
  it("returns unavailable immediately when no id is given, without fetching", () => {
    const { result } = renderHook(() => useLandmarkProfile(undefined));
    expect(result.current[0]).toEqual({ kind: "unavailable" });
    expect(getLandmarkProfile).not.toHaveBeenCalled();
  });

  it("returns the full profile on success", async () => {
    vi.mocked(getLandmarkProfile).mockResolvedValue(FULL_PROFILE);

    const { result } = renderHook(() => useLandmarkProfile("a"));
    expect(result.current[0]).toEqual({ kind: "loading" });

    await waitFor(() => expect(result.current[0]).toEqual({ kind: "full", profile: FULL_PROFILE }));
  });

  it("returns the minimal profile on success", async () => {
    vi.mocked(getLandmarkProfile).mockResolvedValue(MINIMAL_PROFILE);

    const { result } = renderHook(() => useLandmarkProfile("b"));

    await waitFor(() => expect(result.current[0]).toEqual({ kind: "minimal", profile: MINIMAL_PROFILE }));
  });

  it("treats a 404 ApiError as unavailable", async () => {
    vi.mocked(getLandmarkProfile).mockRejectedValue(new ApiError(404, "NOT_FOUND", "Resource not found."));

    const { result } = renderHook(() => useLandmarkProfile("unknown"));

    await waitFor(() => expect(result.current[0]).toEqual({ kind: "unavailable" }));
  });

  it("treats a malformed-profile error as unavailable, identically to a 404", async () => {
    vi.mocked(getLandmarkProfile).mockRejectedValue(new MalformedLandmarkProfileError());

    const { result } = renderHook(() => useLandmarkProfile("c"));

    await waitFor(() => expect(result.current[0]).toEqual({ kind: "unavailable" }));
  });

  it("treats a non-404 ApiError as a genuine error, with its message", async () => {
    vi.mocked(getLandmarkProfile).mockRejectedValue(new ApiError(500, "INTERNAL", "Server error."));

    const { result } = renderHook(() => useLandmarkProfile("d"));

    await waitFor(() => expect(result.current[0]).toEqual({ kind: "error", message: "Server error." }));
  });

  it("retry re-invokes the fetch", async () => {
    vi.mocked(getLandmarkProfile)
      .mockRejectedValueOnce(new ApiError(500, "INTERNAL", "Server error."))
      .mockResolvedValueOnce(FULL_PROFILE);

    const { result } = renderHook(() => useLandmarkProfile("a"));
    await waitFor(() => expect(result.current[0].kind).toBe("error"));

    result.current[1](); // retry

    await waitFor(() => expect(result.current[0]).toEqual({ kind: "full", profile: FULL_PROFILE }));
    expect(getLandmarkProfile).toHaveBeenCalledTimes(2);
  });
});
