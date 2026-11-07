/**
 * Types mirroring the backend's actual implemented contracts
 * (backend/src/landmarks/service.ts, redaction.ts, router.ts — M01-T05).
 * Kept here rather than shared across workspaces, consistent with this
 * project's single-repo-but-separate-workspaces structure; if drift becomes
 * a real problem later, generating these from the backend is a future option,
 * not assumed now.
 */

export interface Category {
  slug: string;
  label: string;
}

export interface LandmarkCollectionItem {
  id: string;
  display_name: string;
  category: string;
  latitude?: number;
  longitude?: number;
  distance_miles?: number;
}

export interface LandmarkCollectionResponse {
  items: LandmarkCollectionItem[];
  page: number;
  limit: number;
  has_more: boolean;
  is_truncated: boolean;
}

/** Full profile: active, PUBLIC landmarks only (spec LANDMARK_DISCOVERY_SPEC.md §7.3). */
export interface LandmarkFullProfile {
  id: string;
  display_name: string;
  category: string;
  latitude: number;
  longitude: number;
  source_description: string | null;
  source_access_label: string | null;
  source_url: string | null;
}

/** Minimal redacted profile: active UNREVIEWED/SENSITIVE landmarks (spec §9.4a) — this exact field set, nothing else. */
export interface LandmarkMinimalProfile {
  id: string;
  display_name: string;
  category: string;
  redacted: true;
}

export type LandmarkProfile = LandmarkFullProfile | LandmarkMinimalProfile;

export function isMinimalProfile(profile: LandmarkProfile): profile is LandmarkMinimalProfile {
  return "redacted" in profile;
}

export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}
