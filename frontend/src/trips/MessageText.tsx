import { Fragment } from "react";
import type { MessagePart } from "./messageParts";

/** Renders message parts; every name is direction-isolated in its own `<bdi>`. */
export function MessageText({ parts }: { parts: readonly MessagePart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          <Fragment key={index}>{part}</Fragment>
        ) : (
          <bdi key={index}>{part.name}</bdi>
        ),
      )}
    </>
  );
}
