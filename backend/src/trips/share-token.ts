import { createHash, randomBytes } from "node:crypto";

/**
 * Trip share tokens (M05-T03 Increment 5; specs/TRIP_PLANNING_SPEC.md v1.1
 * §§4, 5.4, 7.2, 10.3; ADR-014 decision 10).
 *
 * A token is exactly 32 bytes from `crypto.randomBytes(32)`, encoded base64url
 * without padding (43 characters). Only its hexadecimal SHA-256 digest is
 * stored (`trips.share_token_hash`, unique); a presented token is resolved by
 * hashing it and looking the hash up, so no stored value is compared
 * character by character. A fast hash suffices because the token is 256 bits
 * of randomness, not a password.
 *
 * The raw token exists only in memory between generation and the enable
 * response's `share_url`. Nothing here logs, and callers must never log, a
 * token, a hash, or a share URL.
 */

export const SHARE_TOKEN_BYTES = 32;
/** base64url of 32 bytes, unpadded. */
export const SHARE_TOKEN_LENGTH = 43;
const SHARE_TOKEN_SYNTAX = /^[A-Za-z0-9_-]{43}$/;
const SHARE_TOKEN_HASH_SYNTAX = /^[0-9a-f]{64}$/;

/** The public page path that displays a shared trip (spec §7.2). */
export const SHARED_TRIP_PAGE_PATH = "/shared/trips/";

/** A fresh, independent token. */
export function generateShareToken(): string {
  const token = randomBytes(SHARE_TOKEN_BYTES).toString("base64url");
  if (!SHARE_TOKEN_SYNTAX.test(token)) {
    throw new Error("share token: unexpected encoding");
  }
  return token;
}

/**
 * Whether a presented path value has token syntax (43 base64url characters).
 * Anything else is answered with the generic 404 without a database lookup.
 */
export function isShareTokenSyntax(value: unknown): value is string {
  return typeof value === "string" && SHARE_TOKEN_SYNTAX.test(value);
}

/** The stored form: lower-case hexadecimal SHA-256 of the token string. */
export function hashShareToken(token: string): string {
  if (!isShareTokenSyntax(token)) throw new Error("share token: invalid syntax");
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function isShareTokenHash(value: unknown): value is string {
  return typeof value === "string" && SHARE_TOKEN_HASH_SYNTAX.test(value);
}

/**
 * `<public origin>/shared/trips/<token>`, built from the configured public
 * origin the way password-reset links are (only the origin of the configured
 * value is used).
 */
export function buildShareUrl(publicOrigin: string, token: string): string {
  if (!isShareTokenSyntax(token)) throw new Error("share token: invalid syntax");
  return new URL(`${SHARED_TRIP_PAGE_PATH}${token}`, new URL(publicOrigin).origin).toString();
}
