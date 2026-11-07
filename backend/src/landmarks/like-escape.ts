/**
 * Escapes ILIKE/LIKE metacharacters so a user-supplied substring matches
 * literally (spec LANDMARK_DISCOVERY_SPEC.md §4.1: "%" and "_" entered by
 * users must not unexpectedly broaden results). The backslash itself is
 * escaped first, so a literal backslash in the input isn't re-interpreted
 * by the later replacements as the start of an escape sequence.
 *
 * Callers must pair this with an explicit `ESCAPE '\'` clause — Postgres's
 * default LIKE escape character is already backslash, but this makes it
 * unambiguous rather than relying on that default silently.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}
