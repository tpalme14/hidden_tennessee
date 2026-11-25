import { useEffect } from "react";

/** The robots directive for the public shared-trip page (spec v1.1 §7.2; decision D2). */
export const SHARED_TRIP_ROBOTS = "noindex, nofollow";

/**
 * While the calling route is mounted, the document carries
 * `<meta name="robots" content="noindex, nofollow">` (M05-T06 Increment 5a).
 *
 * Only metadata this hook owns is touched: if the document has no robots meta
 * tag, one is added and removed again on unmount; if it already has one, its
 * content is replaced and the original content restored on unmount. No other
 * element is changed, so other pages keep their own indexing behavior, and a
 * token change (same route, same mount) never duplicates the tag.
 *
 * Limitation: this is client-side metadata, applied after the page's script
 * runs. It is not a substitute for the HTTP `X-Robots-Tag` response header on
 * the page itself (reserved for Increment 5b); crawlers that do not run
 * JavaScript see only the header.
 */
export function useRobotsNoindex(): void {
  useEffect(() => {
    const existing = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
    if (existing !== null) {
      const previous = existing.getAttribute("content");
      existing.setAttribute("content", SHARED_TRIP_ROBOTS);
      return () => {
        if (previous === null) existing.removeAttribute("content");
        else existing.setAttribute("content", previous);
      };
    }
    const meta = document.createElement("meta");
    meta.setAttribute("name", "robots");
    meta.setAttribute("content", SHARED_TRIP_ROBOTS);
    document.head.appendChild(meta);
    return () => {
      meta.remove();
    };
  }, []);
}
