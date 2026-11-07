import { useEffect, useRef, useState } from "react";
import { ApiError } from "../api/client";
import { getLandmarkGeoMarkers } from "../api/landmarks";
import type { LandmarkCollectionItem } from "../api/types";
import { formatBboxParam, formatNearParam, isValidLatitude, isValidLongitude, type AllowedRadiusMiles, type GeoBbox, type GeoOrigin } from "./geo";

export type LandmarkMarker = LandmarkCollectionItem & { latitude: number; longitude: number };

export interface PreviousMarkerResult {
  markers: LandmarkMarker[];
  isTruncated: boolean;
}

export type MapMarkersStatus =
  | { kind: "loading"; previous?: PreviousMarkerResult }
  | { kind: "error"; message: string; previous?: PreviousMarkerResult }
  | { kind: "success"; markers: LandmarkMarker[]; isTruncated: boolean };

export interface UseMapMarkersParams {
  q: string;
  categories: string[];
  geo: { mode: "bbox"; bbox: GeoBbox } | { mode: "near"; near: GeoOrigin; radius: AllowedRadiusMiles };
}

function hasValidCoordinates(item: LandmarkCollectionItem): item is LandmarkMarker {
  return (
    item.latitude !== undefined &&
    item.longitude !== undefined &&
    isValidLatitude(item.latitude) &&
    isValidLongitude(item.longitude)
  );
}

function requestKey(params: UseMapMarkersParams): string {
  const geoKey =
    params.geo.mode === "bbox"
      ? `bbox:${formatBboxParam(params.geo.bbox)}`
      : `near:${formatNearParam(params.geo.near)}:${params.geo.radius}`;
  return `${params.q}::${params.categories.join(",")}::${geoKey}`;
}

/**
 * Live viewport/proximity-driven map-marker fetch (M02-T07), replacing the
 * static Tennessee-wide-only `useLandmarkMarkers` (M02-T03). A single
 * committed `(q, categories, geo)` composite key drives exactly one fetch —
 * `bbox` or `near`+`radius`, restricted server-side to active `PUBLIC`
 * landmarks only (M01-T05) — and any change to any part of that key (a
 * filter commit, "Search this area", a proximity-origin/radius change)
 * starts a new request whose own cancelled-flag guard (the idiom already
 * used by `useLandmarkSearch`/`useLandmarkProfile`) discards an
 * out-of-order-resolving older response, regardless of which axis changed.
 *
 * Always fetches a single page (`page=1`, `limit=200` fixed) — markers have
 * no Next/Previous control, so `has_more` is not requested or used here;
 * `is_truncated` alone drives the "zoom in or refine filters" messaging
 * (spec §4.3/§7.2), read directly from the response rather than inferred
 * from `items.length`.
 *
 * WGS84 range validation (not just `Number.isFinite`) is defense-in-depth
 * against a protected record ever rendering as a marker, closing the
 * coordinate-validation follow-up recorded during M02-T03.
 *
 * The last successful result is retained (via `lastGoodRef`, not component
 * state that would itself need clearing) and surfaced as `previous` on the
 * `loading`/`error` variants, so a live refetch — "Search this area," a
 * proximity/radius change, a filter commit — doesn't make the map's markers
 * disappear while the next request is in flight or if it fails (found
 * missing, against the approved plan, during M02-T07 final verification).
 * `previous` holds only already-validated `PUBLIC` markers from a prior
 * successful response, so retaining it introduces no new privacy surface.
 * A new success always REPLACES `lastGoodRef` outright, including with an
 * empty result — `previous` is never shown once a `success` status lands,
 * so retained markers are never presented as confirmed matches for the
 * query that produced them.
 */
export function useMapMarkers(params: UseMapMarkersParams): [MapMarkersStatus, () => void] {
  const [status, setStatus] = useState<MapMarkersStatus>({ kind: "loading" });
  const [retryToken, setRetryToken] = useState(0);
  const key = requestKey(params);
  const lastGoodRef = useRef<PreviousMarkerResult | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setStatus({ kind: "loading", previous: lastGoodRef.current });

    const geo =
      params.geo.mode === "bbox"
        ? ({ mode: "bbox", bbox: formatBboxParam(params.geo.bbox) } as const)
        : ({ mode: "near", near: formatNearParam(params.geo.near), radius: params.geo.radius } as const);

    getLandmarkGeoMarkers({ q: params.q, categories: params.categories, geo })
      .then((response) => {
        if (cancelled) return;
        const markers = response.items.filter(hasValidCoordinates);
        const result: PreviousMarkerResult = { markers, isTruncated: response.is_truncated };
        lastGoodRef.current = result;
        setStatus({ kind: "success", ...result });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof ApiError ? error.message : "Unable to load landmarks.";
        setStatus({ kind: "error", message, previous: lastGoodRef.current });
      });

    return () => {
      cancelled = true;
    };
    // `key` is the composite dependency: any change to q/categories/geo mode/bbox/near/radius re-triggers this effect.
  }, [key, retryToken]);

  return [status, () => setRetryToken((t) => t + 1)];
}
