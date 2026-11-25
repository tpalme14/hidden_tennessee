import { z } from "zod";
import { validateTripName, type TripNameRejection } from "./name-rule.js";

/**
 * Request validation for the trips API (M05-T03 Increment 1;
 * specs/TRIP_PLANNING_SPEC.md v1.1 §§3, 5.1.1, 5.5, 6, 7, 10.1; ADR-014
 * decisions 3–5; ADR-012 decision 5).
 *
 * Strict Zod objects reject every unexpected field — including any
 * client-supplied identity such as `user_id` — as defence in depth. Identity
 * itself never comes from the request: it is the session-derived user ID,
 * applied inside every query (M05-T03 Increment 2 onward).
 *
 * Every error carries a FIXED, safe message chosen here and never echoes the
 * submitted value. Mapping errors to HTTP envelopes is the router's job
 * (Increment 4): `INVALID_REQUEST` and `INVALID_QUERY` both answer 400.
 *
 * The small syntax rules below (UUID syntax, positive decimal digits) are the
 * same as the reviews and favorites validators; they are repeated here rather
 * than extracted, so this increment changes no existing module.
 */

export type TripsRequestErrorCode = "INVALID_REQUEST" | "INVALID_QUERY";

export class TripsRequestError extends Error {
  constructor(
    readonly code: TripsRequestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "TripsRequestError";
  }
}

/** Fixed messages — the only text a validation error can carry. */
export const MESSAGES = {
  invalidTripId: "Invalid trip ID.",
  invalidStopId: "Invalid stop ID.",
  invalidLandmarkId: "Invalid landmark ID.",
  invalidBodyShape: "The request body must be a JSON object.",
  unsupportedFields: "The request body contains unsupported fields.",
  nameType: "name is required and must be text.",
  nameCharacters: "name contains characters that are not allowed.",
  nameNoVisible: "name must contain at least one letter, number, punctuation mark, or symbol.",
  nameTooLong: "name must be at most 100 characters.",
  invalidVersion: "version must be a whole number of at least 0.",
  invalidStopIds: "stop_ids must list each of the trip's stops exactly once.",
  noBodyFields: "This request accepts no body fields.",
  noQuery: "This request accepts no query parameters.",
  listQuery: "page and limit must be positive integers; no other query parameters are accepted.",
  pageTooLarge: "page is too large.",
} as const;

const NAME_MESSAGES: Record<TripNameRejection, string> = {
  type: MESSAGES.nameType,
  characters: MESSAGES.nameCharacters,
  noVisible: MESSAGES.nameNoVisible,
  tooLong: MESSAGES.nameTooLong,
};

/** Any 8-4-4-4-12 hexadecimal string, any case (PostgreSQL's `uuid` syntax). */
const UUID_SYNTAX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A positive decimal integer with no sign, leading zero, fraction, exponent, or whitespace. */
const POSITIVE_DIGITS = /^[1-9][0-9]*$/;

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 20;
export const MAX_LIMIT = 100;
/** Spec §3.2: a trip has at most 25 stops, so a reorder lists at most 25. */
export const MAX_STOPS = 25;
/** `trips.version` is a PostgreSQL `integer`; larger values could never match. */
export const MAX_VERSION = 2_147_483_647;

const idSchema = z.string().regex(UUID_SYNTAX);
const versionSchema = z.number().int().min(0).max(MAX_VERSION);

// These shapes only reject unknown keys; each field's value (including a
// missing one) is checked afterwards so it gets its own fixed message. In
// Zod 4 a required `z.unknown()` still rejects a missing key, hence
// `.optional()` here.
const createTripSchema = z.strictObject({ name: z.unknown().optional() });
const renameTripSchema = z.strictObject({
  name: z.unknown().optional(),
  version: z.unknown().optional(),
});
const addStopSchema = z.strictObject({ landmark_id: idSchema });
const reorderSchema = z.strictObject({
  stop_ids: z.unknown().optional(),
  version: z.unknown().optional(),
});
const emptyObjectSchema = z.strictObject({});
const listQuerySchema = z.strictObject({
  page: z.string().regex(POSITIVE_DIGITS).optional(),
  limit: z.string().regex(POSITIVE_DIGITS).optional(),
});

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireObject(body: unknown): Record<string, unknown> {
  if (!isPlainObject(body)) {
    throw new TripsRequestError("INVALID_REQUEST", MESSAGES.invalidBodyShape);
  }
  return body;
}

function parseId(raw: unknown, message: string): string {
  const result = idSchema.safeParse(raw);
  if (!result.success) throw new TripsRequestError("INVALID_REQUEST", message);
  return result.data.toLowerCase();
}

/** Applies the §5.1.1 trip-name rule; returns the trimmed name. */
export function parseTripName(value: unknown): string {
  const result = validateTripName(value);
  if (!result.ok) throw new TripsRequestError("INVALID_REQUEST", NAME_MESSAGES[result.reason]);
  return result.value;
}

function parseVersion(value: unknown): number {
  const result = versionSchema.safeParse(value);
  if (!result.success) throw new TripsRequestError("INVALID_REQUEST", MESSAGES.invalidVersion);
  return result.data;
}

/** The `:tripId` path value, in canonical lower case (400 INVALID_REQUEST otherwise). */
export function parseTripId(raw: unknown): string {
  return parseId(raw, MESSAGES.invalidTripId);
}

/** The `:stopId` path value, in canonical lower case (400 INVALID_REQUEST otherwise). */
export function parseStopId(raw: unknown): string {
  return parseId(raw, MESSAGES.invalidStopId);
}

/** Every route except the list accepts no query parameters. */
export function parseNoQuery(query: unknown): void {
  if (!emptyObjectSchema.safeParse(query ?? {}).success) {
    throw new TripsRequestError("INVALID_QUERY", MESSAGES.noQuery);
  }
}

/** DELETE routes and share enable: the body must be absent or an empty JSON object. */
export function parseEmptyBody(body: unknown): void {
  if (body !== undefined && !emptyObjectSchema.safeParse(body).success) {
    throw new TripsRequestError("INVALID_REQUEST", MESSAGES.noBodyFields);
  }
}

/** `POST /api/v1/trips` body: `{ name }`, nothing else. */
export function parseCreateTripBody(body: unknown): { name: string } {
  const result = createTripSchema.safeParse(requireObject(body));
  if (!result.success) throw new TripsRequestError("INVALID_REQUEST", MESSAGES.unsupportedFields);
  return { name: parseTripName(result.data.name) };
}

/**
 * `PATCH /api/v1/trips/:tripId` body: `{ name, version? }` (spec §5.5). `name`
 * is required; `version`, when present, must be a non-negative integer
 * (`null` is not accepted). `version` is returned only when supplied.
 */
export function parseRenameTripBody(body: unknown): { name: string; version?: number } {
  const object = requireObject(body);
  const result = renameTripSchema.safeParse(object);
  if (!result.success) throw new TripsRequestError("INVALID_REQUEST", MESSAGES.unsupportedFields);
  const name = parseTripName(result.data.name);
  if (!Object.prototype.hasOwnProperty.call(object, "version")) return { name };
  return { name, version: parseVersion(result.data.version) };
}

/** `POST /api/v1/trips/:tripId/stops` body: `{ landmark_id }`, nothing else. */
export function parseAddStopBody(body: unknown): { landmarkId: string } {
  const result = addStopSchema.safeParse(requireObject(body));
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new TripsRequestError(
      "INVALID_REQUEST",
      issue?.code !== "unrecognized_keys" && issue?.path[0] === "landmark_id"
        ? MESSAGES.invalidLandmarkId
        : MESSAGES.unsupportedFields,
    );
  }
  return { landmarkId: result.data.landmark_id.toLowerCase() };
}

/**
 * `PUT /api/v1/trips/:tripId/stops/order` body: `{ stop_ids, version }`
 * (spec §§6.3, 6.4). Checked here, before any lookup: a required `version`,
 * and a non-empty list of at most 25 well-formed, distinct stop IDs (compared
 * case-insensitively; returned in lower case, in the submitted order).
 * Whether the list is exactly the trip's current stops is checked later,
 * under the trip-row lock, after the version check.
 */
export function parseReorderBody(body: unknown): { stopIds: string[]; version: number } {
  const object = requireObject(body);
  const result = reorderSchema.safeParse(object);
  if (!result.success) throw new TripsRequestError("INVALID_REQUEST", MESSAGES.unsupportedFields);
  if (!Object.prototype.hasOwnProperty.call(object, "version")) {
    throw new TripsRequestError("INVALID_REQUEST", MESSAGES.invalidVersion);
  }
  const version = parseVersion(result.data.version);

  const raw = result.data.stop_ids;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_STOPS) {
    throw new TripsRequestError("INVALID_REQUEST", MESSAGES.invalidStopIds);
  }
  const stopIds = raw.map((id) => parseId(id, MESSAGES.invalidStopIds));
  if (new Set(stopIds).size !== stopIds.length) {
    throw new TripsRequestError("INVALID_REQUEST", MESSAGES.invalidStopIds);
  }
  return { stopIds, version };
}

export interface TripsListQuery {
  page: number;
  limit: number;
  offset: number;
}

/**
 * `GET /api/v1/trips` query: only `page` (default 1) and `limit` (default 20,
 * maximum 100), each a single positive decimal integer (spec §10.1). Unknown
 * keys, repeated parameters (arrays), and an offset beyond a safe integer are
 * rejected with 400 INVALID_QUERY.
 */
export function parseListQuery(query: unknown): TripsListQuery {
  const result = listQuerySchema.safeParse(query ?? {});
  if (!result.success) throw new TripsRequestError("INVALID_QUERY", MESSAGES.listQuery);

  const page = result.data.page === undefined ? DEFAULT_PAGE : Number(result.data.page);
  const limit = result.data.limit === undefined ? DEFAULT_LIMIT : Number(result.data.limit);
  if (!Number.isSafeInteger(page)) {
    throw new TripsRequestError("INVALID_QUERY", MESSAGES.pageTooLarge);
  }
  if (limit > MAX_LIMIT) {
    throw new TripsRequestError("INVALID_QUERY", MESSAGES.listQuery);
  }
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) {
    throw new TripsRequestError("INVALID_QUERY", MESSAGES.pageTooLarge);
  }
  return { page, limit, offset };
}
