import type { LandmarkFullProfile, LandmarkMinimalProfile, LandmarkProfile } from "./types";

/**
 * Runtime validation of the landmark detail response — TypeScript interfaces
 * alone only check the shape the compiler is told to expect, not what the
 * network actually returned. A small, focused hand-written validator is used
 * here rather than Zod, which is not currently a frontend dependency (adding
 * it for a single response shape would be an unnecessary dependency; Zod
 * isn't used for this kind of validation in the backend workspace either —
 * see `backend/src/landmarks/query-schema.ts`).
 *
 * Both validators reject any object carrying keys outside its own exact
 * allowlist, so a minimal profile that also happens to include `latitude`,
 * `source_url`, `sensitivityStatus`, or any other protected/unexpected field
 * is rejected outright, not rendered with the extra field ignored.
 */

const MINIMAL_PROFILE_KEYS = new Set(["id", "display_name", "category", "redacted"]);
const FULL_PROFILE_KEYS = new Set([
  "id",
  "display_name",
  "category",
  "latitude",
  "longitude",
  "source_description",
  "source_access_label",
  "source_url",
]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyAllowedKeys(obj: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(obj).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isValidLatitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -90 && value <= 90;
}

function isValidLongitude(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= -180 && value <= 180;
}

export function isValidMinimalProfile(value: unknown): value is LandmarkMinimalProfile {
  if (!isPlainObject(value) || !hasOnlyAllowedKeys(value, MINIMAL_PROFILE_KEYS)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.display_name) &&
    isNonEmptyString(value.category) &&
    value.redacted === true
  );
}

export function isValidFullProfile(value: unknown): value is LandmarkFullProfile {
  if (!isPlainObject(value) || !hasOnlyAllowedKeys(value, FULL_PROFILE_KEYS)) return false;
  return (
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.display_name) &&
    isNonEmptyString(value.category) &&
    isValidLatitude(value.latitude) &&
    isValidLongitude(value.longitude) &&
    isNullableString(value.source_description) &&
    isNullableString(value.source_access_label) &&
    isNullableString(value.source_url)
  );
}

/** Returns the validated profile, narrowed to its exact shape, or `null` for anything that doesn't match either shape exactly. */
export function parseLandmarkProfile(value: unknown): LandmarkProfile | null {
  if (isValidFullProfile(value)) return value;
  if (isValidMinimalProfile(value)) return value;
  return null;
}

/** A source URL is clickable only if it is a syntactically valid, non-empty http(s) URL (spec §4.5/§6) — validated again here, not only trusted from the backend. */
export function parseSafeHttpUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}
