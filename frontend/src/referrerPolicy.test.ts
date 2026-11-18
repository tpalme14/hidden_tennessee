import { describe, expect, it } from "vitest";
import indexHtml from "../index.html?raw";

/**
 * M03-T03 decision 5 / refinement 1, amended 2026-11-18: the document's
 * referrer policy is exactly `strict-origin`. Guards against both regressions:
 * a laxer policy (which could put a reset token's URL in a Referer) and
 * `no-referrer` (which breaks OpenStreetMap's tile usage policy). The browser
 * behaviour itself is verified in e2e/referrer-policy.spec.ts.
 */

describe("index.html referrer policy", () => {
  it("declares exactly one referrer policy, and it is strict-origin", () => {
    const doc = new DOMParser().parseFromString(indexHtml, "text/html");
    const metas = doc.querySelectorAll('meta[name="referrer"]');
    expect(metas).toHaveLength(1);
    expect(metas[0]!.getAttribute("content")).toBe("strict-origin");
  });

  it("places the policy in <head>, before the application script", () => {
    const meta = indexHtml.indexOf('<meta name="referrer"');
    const script = indexHtml.indexOf('<script type="module"');
    expect(meta).toBeGreaterThan(indexHtml.indexOf("<head>"));
    expect(meta).toBeLessThan(indexHtml.indexOf("</head>"));
    expect(meta).toBeLessThan(script);
  });
});
