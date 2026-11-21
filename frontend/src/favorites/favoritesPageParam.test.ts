import { describe, expect, it } from "vitest";
import { favoritesPageHref, parseFavoritesPageParam } from "./favoritesPageParam";

/** M03-T06 Increment 5, decision M4 — which `?page=` values are valid. */

const parse = (query: string) => parseFavoritesPageParam(new URLSearchParams(query));

describe("parseFavoritesPageParam", () => {
  it("absent → page 1", () => {
    expect(parse("")).toBe(1);
    expect(parse("other=x")).toBe(1);
  });

  it.each([
    ["page=1", 1],
    ["page=2", 2],
    ["page=37", 37],
  ])("%s → %d", (query, expected) => {
    expect(parse(query)).toBe(expected);
  });

  it.each([
    "page=",
    "page=0",
    "page=-1",
    "page=+2",
    "page=1.5",
    "page=01",
    "page=abc",
    "page=2x",
    "page=%202",
    "page=1e3",
    "page=1&page=2",
    "page=99999999999999999",
    // (page - 1) * 50 would not be a safe integer.
    `page=${Math.floor(Number.MAX_SAFE_INTEGER / 50) + 2}`,
  ])("%s → invalid", (query) => {
    expect(parse(query)).toBeNull();
  });

  it("accepts the largest page whose offset is still a safe integer", () => {
    const largest = Math.floor(Number.MAX_SAFE_INTEGER / 50) + 1;
    expect(parse(`page=${largest}`)).toBe(largest);
  });
});

describe("favoritesPageHref", () => {
  it("page 1 is the canonical URL without ?page=", () => {
    expect(favoritesPageHref(1)).toBe("/favorites");
    expect(favoritesPageHref(2)).toBe("/favorites?page=2");
  });
});
