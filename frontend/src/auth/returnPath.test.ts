import { describe, expect, it } from "vitest";
import { HOME_PATH, safeReturnPath } from "./returnPath";

/** M03-T03 Increment 1 — the return-destination allow-list (spec §4.2; decision 4 and refinement 2). */

const ORIGIN = "http://localhost:3000";

describe("safeReturnPath", () => {
  describe("accepts internal destinations and preserves query strings and fragments", () => {
    it.each([
      ["/", "/"],
      ["/landmarks/abc", "/landmarks/abc"],
      ["/landmarks/abc?x=1#top", "/landmarks/abc?x=1#top"],
      [
        "/?q=falls&categories=arch,bald&mode=near&near=35.1,-85.2&radius=25",
        "/?q=falls&categories=arch,bald&mode=near&near=35.1,-85.2&radius=25",
      ],
      ["/landmarks/abc#section", "/landmarks/abc#section"],
      ["/a/b/../c", "/a/c"], // normalized by the URL parser, still internal
      ["/x%2Fy", "/x%2Fy"], // an encoded slash NOT at the start is an ordinary internal path
    ])("%s → %s", (input, expected) => {
      expect(safeReturnPath(input, ORIGIN)).toBe(expected);
    });
  });

  describe("rejects everything else, falling back to the home route", () => {
    it.each([
      ["empty string", ""],
      ["absolute https URL", "https://evil.example/steal"],
      ["absolute http URL", "http://localhost:3000/looks-internal"],
      ["protocol-relative", "//evil.example"],
      ["protocol-relative with path", "//evil.example/path"],
      ["backslash after slash", "/\\evil.example"],
      ["double backslash", "\\\\evil.example"],
      ["backslash anywhere", "/landmarks\\abc"],
      ["encoded protocol-relative", "/%2F%2Fevil.example"],
      ["encoded backslash", "/%5Cevil.example"],
      ["encoded backslash later", "/landmarks%5Cabc"],
      ["javascript scheme", "javascript:alert(1)"],
      ["data scheme", "data:text/html,hi"],
      ["no leading slash", "landmarks/abc"],
      ["leading space", " /landmarks/abc"],
      ["embedded space", "/landmarks/a bc"],
      ["embedded newline", "/landmarks/abc\n"],
      ["encoded newline", "/landmarks/abc%0A"],
      ["embedded null byte", "/landmarks\u0000abc"],
      ["encoded null byte", "/landmarks%00abc"],
      ["embedded tab", "/landmarks\tabc"],
      ["DEL character", "/landmarks\u007fabc"],
      ["malformed percent-encoding", "/landmarks/%E0%A4%A"],
      ["lone percent sign", "/%"],
      ["over the length cap", "/" + "a".repeat(2048)],
    ])("%s", (_label, input) => {
      expect(safeReturnPath(input, ORIGIN)).toBe(HOME_PATH);
    });
  });

  it("rejects non-string input", () => {
    expect(safeReturnPath(undefined, ORIGIN)).toBe(HOME_PATH);
    expect(safeReturnPath(null, ORIGIN)).toBe(HOME_PATH);
    expect(safeReturnPath(42, ORIGIN)).toBe(HOME_PATH);
    expect(safeReturnPath(["/x"], ORIGIN)).toBe(HOME_PATH);
  });

  it("accepts a path exactly at the length cap", () => {
    const input = "/" + "a".repeat(2047);
    expect(safeReturnPath(input, ORIGIN)).toBe(input);
  });

  it("defaults the origin to the current window origin", () => {
    expect(safeReturnPath("/landmarks/abc")).toBe("/landmarks/abc");
    expect(safeReturnPath(`${window.location.origin}/landmarks/abc`)).toBe(HOME_PATH);
  });
});
