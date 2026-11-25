import { describe, expect, it } from "vitest";
import { TRIPS_PAGE_SIZE, TRIPS_PATH, parseTripsPageParam, tripsPageHref } from "./tripsPageParam";

/** M05-T06 Increment 2 — `?page=` for My Trips (the My Favorites convention, page size 20). */

const parse = (search: string) => parseTripsPageParam(new URLSearchParams(search));

describe("parseTripsPageParam", () => {
  it("uses the approved page size of 20 and the /trips path", () => {
    expect(TRIPS_PAGE_SIZE).toBe(20);
    expect(TRIPS_PATH).toBe("/trips");
  });

  it("absent → 1; a canonical positive integer → that page", () => {
    expect(parse("")).toBe(1);
    expect(parse("page=1")).toBe(1);
    expect(parse("page=2")).toBe(2);
    expect(parse("page=987")).toBe(987);
    expect(parse("other=x&page=4")).toBe(4);
  });

  it.each([
    "page=",
    "page=0",
    "page=-1",
    "page=+2",
    "page=01",
    "page=1.0",
    "page=1e3",
    "page=two",
    "page=%201",
    "page=1&page=1",
    "page=12345678901234567",
    `page=${Math.floor(Number.MAX_SAFE_INTEGER / 20) + 2}`,
  ])("%s → null (canonicalized to page 1)", (search) => {
    expect(parse(search)).toBeNull();
  });
});

describe("tripsPageHref", () => {
  it("page 1 is the bare path; later pages carry ?page=", () => {
    expect(tripsPageHref(1)).toBe("/trips");
    expect(tripsPageHref(0)).toBe("/trips");
    expect(tripsPageHref(3)).toBe("/trips?page=3");
  });
});
