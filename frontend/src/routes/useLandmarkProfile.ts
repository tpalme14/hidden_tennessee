import { useEffect, useState } from "react";
import { ApiError } from "../api/client";
import { getLandmarkProfile, MalformedLandmarkProfileError } from "../api/landmarks";
import { isMinimalProfile } from "../api/types";
import type { LandmarkFullProfile, LandmarkMinimalProfile } from "../api/types";

export type LandmarkProfileStatus =
  | { kind: "loading" }
  | { kind: "full"; profile: LandmarkFullProfile }
  | { kind: "minimal"; profile: LandmarkMinimalProfile }
  | { kind: "unavailable" }
  | { kind: "error"; message: string };

/**
 * Fetches and validates a single landmark profile by ID. A 404 (`ApiError`
 * with `status === 404`) and a malformed/unexpected response body are both
 * treated as the identical `"unavailable"` outcome — the page must not be
 * able to tell them apart, let alone show different content for each. Any
 * other `ApiError` (network/server failure) is `"error"`, with `retry`
 * re-running the fetch.
 */
export function useLandmarkProfile(id: string | undefined): [LandmarkProfileStatus, () => void] {
  const [status, setStatus] = useState<LandmarkProfileStatus>({ kind: "loading" });
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (!id) {
      setStatus({ kind: "unavailable" });
      return;
    }

    let cancelled = false;
    setStatus({ kind: "loading" });

    async function load(landmarkId: string) {
      try {
        const profile = await getLandmarkProfile(landmarkId);
        if (cancelled) return;
        setStatus(isMinimalProfile(profile) ? { kind: "minimal", profile } : { kind: "full", profile });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof MalformedLandmarkProfileError) {
          setStatus({ kind: "unavailable" });
        } else if (error instanceof ApiError) {
          setStatus(error.status === 404 ? { kind: "unavailable" } : { kind: "error", message: error.message });
        } else {
          setStatus({ kind: "error", message: "Unable to load this landmark." });
        }
      }
    }

    void load(id);

    return () => {
      cancelled = true;
    };
  }, [id, retryToken]);

  return [status, () => setRetryToken((t) => t + 1)];
}
