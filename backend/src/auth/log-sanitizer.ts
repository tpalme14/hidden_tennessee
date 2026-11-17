/**
 * Safe logging for Better Auth (M03-T02 Increment 4).
 *
 * The library's `logger.log` callback receives `(level, message, ...args)`
 * AFTER its own level filter. Some messages interpolate request-controlled
 * values (`Invalid origin: <Origin header>`, `Invalid callbackURL: <body
 * value>`), and extra arguments are Error instances or small diagnostic
 * objects. This module turns each call into ONE bounded, control-character
 * free line that keeps the severity and the useful diagnostics (error name,
 * sanitized message, code) while dropping stacks, unknown object contents,
 * and anything that could carry credentials or database query details.
 */

export type SafeLogLevel = "debug" | "info" | "warn" | "error";

/** Hard cap on the complete formatted entry, timestamp and prefix included. */
export const MAX_LOG_ENTRY_LENGTH = 1024;
/** Cap on the library's own message text. */
export const MAX_MESSAGE_LENGTH = 512;
/** Cap on any single argument's rendering. */
export const MAX_FIELD_LENGTH = 256;

// C0 controls (incl. \n, \r, ESC), DEL, and C1 controls.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;

/** Diagnostic keys of a plain-object argument whose VALUES may be logged. */
const SAFE_OBJECT_KEYS = new Set([
  "code",
  "statusCode",
  "status",
  "provider",
  "issues",
  "model",
  "field",
]);

/** Replaces control characters with U+FFFD and truncates with a visible marker. */
export function sanitizeText(value: string, max = MAX_FIELD_LENGTH): string {
  const clean = value.replace(CONTROL_CHARACTERS, "�");
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…[+${clean.length - max} chars]`;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Renders one extra argument. Errors keep name, sanitized message, and
 * code; stacks and other properties are dropped. Errors raised by the
 * database layer keep only name and code, because their messages can echo
 * query arguments. Plain objects keep values only for known diagnostic keys.
 */
export function describeLogArgument(arg: unknown): string {
  if (arg instanceof Error) {
    const withCode = arg as Error & { code?: unknown; statusCode?: unknown };
    const code = withCode.code ?? withCode.statusCode;
    const codeText = code !== undefined ? ` (code ${sanitizeText(String(code), 64)})` : "";
    const isDatabaseError =
      /^(Prisma|Pg|Postgres|Database)/i.test(arg.name) || arg.name === "error";
    return isDatabaseError
      ? `${sanitizeText(arg.name, 64)}${codeText}`
      : `${sanitizeText(arg.name, 64)}: ${sanitizeText(arg.message)}${codeText}`;
  }
  if (typeof arg === "string") return sanitizeText(arg);
  if (arg === null || arg === undefined || typeof arg === "number" || typeof arg === "boolean") {
    return String(arg);
  }
  if (typeof arg === "object") {
    const parts = Object.entries(arg as Record<string, unknown>).map(([key, value]) =>
      SAFE_OBJECT_KEYS.has(key)
        ? `${key}=${sanitizeText(safeStringify(value))}`
        : `${sanitizeText(key, 64)}=[omitted]`,
    );
    return `{ ${parts.join(", ")} }`;
  }
  return `[${typeof arg}]`;
}

/** The complete, bounded entry: `<iso timestamp> <LEVEL> [Better Auth]: <message> <args…>`. */
export function formatLogEntry(level: SafeLogLevel, message: string, args: unknown[]): string {
  const body = [sanitizeText(message, MAX_MESSAGE_LENGTH), ...args.map(describeLogArgument)].join(
    " ",
  );
  const entry = `${new Date().toISOString()} ${level.toUpperCase()} [Better Auth]: ${body}`;
  return entry.length <= MAX_LOG_ENTRY_LENGTH
    ? entry
    : `${entry.slice(0, MAX_LOG_ENTRY_LENGTH - 1)}…`;
}

/** Better Auth `logger.log` callback: same severity channel as the library's default logger. */
export function safeAuthLog(level: SafeLogLevel, message: string, ...args: unknown[]): void {
  const entry = formatLogEntry(level, message, args);
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.log(entry);
}
