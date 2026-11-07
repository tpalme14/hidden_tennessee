// Verified against all 1,693 real records in M01-T01: exact match, zero
// exceptions, case-sensitive (spec §4.2, §8.1).
export const SOURCE_CODE_PATTERN = /^[A-Z]{3}[0-9]{3}$/;

// Preliminary Tennessee-focused quality-control heuristic, not a legal
// boundary (spec §6.3). Confirmed well-calibrated against the real dataset
// in M01-T01 — zero records fall outside it, including the 3 out-of-state
// records.
export const TN_WARNING_ENVELOPE = {
  minLat: 34.8,
  maxLat: 36.7,
  minLon: -90.3,
  maxLon: -81.6,
};

export function isOutsideWarningEnvelope(latitude: number, longitude: number): boolean {
  return (
    latitude < TN_WARNING_ENVELOPE.minLat ||
    latitude > TN_WARNING_ENVELOPE.maxLat ||
    longitude < TN_WARNING_ENVELOPE.minLon ||
    longitude > TN_WARNING_ENVELOPE.maxLon
  );
}

/** Trims a raw value; returns null if it isn't a nonempty string after trimming. */
export function trimToNonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Per spec §6.1: optional fields that are empty after trimming are absent. */
export function trimToNullable(value: unknown): string | null {
  return trimToNonEmpty(value);
}

export function isValidSourceCode(value: string): boolean {
  return SOURCE_CODE_PATTERN.test(value);
}

export function isFiniteCoordinate(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isValidLatitude(value: number): boolean {
  return value >= -90 && value <= 90;
}

export function isValidLongitude(value: number): boolean {
  return value >= -180 && value <= 180;
}

/** Only a nonempty, syntactically valid absolute URL may become a navigable source URL (spec §4.5). */
export function parseValidUrl(href: unknown): string | null {
  const trimmed = trimToNonEmpty(href);
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return trimmed;
  } catch {
    return null;
  }
}
