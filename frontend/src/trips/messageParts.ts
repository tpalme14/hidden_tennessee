/**
 * Message text with user-controlled names kept separate (M05-T04 Increment 6
 * correction). A trip or landmark name can contain bidirectional controls
 * (for example U+202E RIGHT-TO-LEFT OVERRIDE) or isolate characters; concatenated
 * into a sentence, it could reorder the rest of that sentence — including a
 * following "View trip" link. Names are therefore never joined into the
 * message string: each is a `{ name }` part, rendered in its own `<bdi>`
 * element (an element boundary a name cannot escape, unlike U+2068/U+2069).
 */

export type MessagePart = string | { name: string };

export const name = (value: string): MessagePart => ({ name: value });

/** The plain text of a message (for comparison and logging only — never for rendering). */
export function messageText(parts: readonly MessagePart[]): string {
  return parts.map((part) => (typeof part === "string" ? part : part.name)).join("");
}
