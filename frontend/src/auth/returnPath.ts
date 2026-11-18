/**
 * Safe return destination after sign-in (spec §4.2: "never accept arbitrary
 * external redirect URLs"; M03-T03 decision 4). Only an internal path on this
 * origin is ever returned; everything else — and anything malformed — falls
 * back to the home route. The result is meant for the router's `navigate`,
 * never for `location.assign`.
 */

export const HOME_PATH = "/";
const MAX_LENGTH = 2048;

// C0 controls, DEL, and any whitespace (which also covers U+0085 and friends).
// eslint-disable-next-line no-control-regex -- rejecting these bytes is the point
const CONTROL_OR_WHITESPACE = /[\u0000-\u001f\u007f\s]/;

function hasSafeShape(value: string): boolean {
  if (!value.startsWith("/")) return false;
  if (value[1] === "/" || value[1] === "\\") return false; // protocol-relative or backslash variant
  if (value.includes("\\")) return false;
  if (CONTROL_OR_WHITESPACE.test(value)) return false;
  return true;
}

/**
 * Returns `raw` as a normalized internal path (pathname + query + fragment)
 * when it is safe, otherwise `HOME_PATH`.
 *
 * Rules, in order: a string of at most 2048 characters; percent-decoding must
 * succeed (malformed encoding fails safe); the raw AND the decoded value must
 * start with exactly one forward slash, contain no backslash, and contain no
 * control or whitespace character (so `/%2F%2F…` and `/%5C…` are rejected
 * even though they would resolve internally); and the value resolved against
 * `origin` must stay on `origin`.
 */
export function safeReturnPath(raw: unknown, origin: string = window.location.origin): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_LENGTH) return HOME_PATH;

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return HOME_PATH;
  }
  if (!hasSafeShape(raw) || !hasSafeShape(decoded)) return HOME_PATH;

  let url: URL;
  try {
    url = new URL(raw, origin);
  } catch {
    return HOME_PATH;
  }
  if (url.origin !== origin) return HOME_PATH;

  return `${url.pathname}${url.search}${url.hash}`;
}
