import { describe, expect, it } from "vitest";
import { TRIP_NAME_CASES } from "../trips/testdata/tripNameCorpus";
import {
  isShareToken,
  parseAddedStopResponse,
  parseOwnerTrip,
  parseOwnerTripResponse,
  parseShareResponse,
  parseShareUrl,
  parseSharedTripResponse,
  parseTripListPage,
  parseTripStop,
} from "./tripValidation";

/**
 * M05-T04 Increment 1 — runtime validation of trips responses: exact shapes
 * (spec v1.1 §7.2), fail-closed rejection of broken wrappers, and the
 * downgrade of any untrusted landmark to the unavailable placeholder so its
 * data is never kept.
 */

const TRIP_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const STOP = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const LANDMARK = (n: number) => `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const TIME = "2026-11-23T16:00:00.000Z";

function landmark(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: LANDMARK(n),
    display_name: `Example ${n}`,
    category: "falls",
    latitude: 35.6 + n / 100,
    longitude: -83.5 + n / 100,
    ...extra,
  };
}

function available(n: number, distance: number | null) {
  return {
    id: STOP(n),
    position: n,
    is_available: true,
    distance_from_previous_miles: distance,
    landmark: landmark(n),
  };
}

function unavailable(n: number) {
  return {
    id: STOP(n),
    position: n,
    is_available: false,
    distance_from_previous_miles: null,
    landmark: { id: LANDMARK(n), is_available: false },
  };
}

function trip(stops: unknown[], summary: unknown, extra: Record<string, unknown> = {}) {
  return {
    id: TRIP_ID,
    name: "Weekend Waterfalls",
    version: 3,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops,
    distance_summary: summary,
    ...extra,
  };
}

/** The spec §7 example: two available stops with one measured leg, then an unavailable stop. */
const EXAMPLE = trip([available(0, null), available(1, 5.24), unavailable(2)], {
  total_miles: 5.24,
  measured_legs: 1,
  total_legs: 2,
});

describe("parseOwnerTrip — valid shapes", () => {
  it("accepts the spec example and rebuilds it field for field", () => {
    const parsed = parseOwnerTrip(EXAMPLE);
    expect(parsed).toEqual(EXAMPLE);
    expect(parsed).not.toBe(EXAMPLE);
    expect(parsed!.stops[0]!.landmark).not.toBe(EXAMPLE.stops[0]);
  });

  it("accepts a new empty trip and the { trip } wrapper", () => {
    const empty = trip([], { total_miles: null, measured_legs: 0, total_legs: 0 }, { version: 0 });
    expect(parseOwnerTripResponse({ trip: empty })).toEqual(empty);
  });

  it("lower-cases IDs (the server's UUIDs are case-insensitive)", () => {
    const upper = trip(
      [],
      { total_miles: null, measured_legs: 0, total_legs: 0 },
      {
        id: TRIP_ID.toUpperCase(),
      },
    );
    expect(parseOwnerTrip(upper)!.id).toBe(TRIP_ID);
  });

  it("accepts a full 25-stop trip and a total within floating-point rounding", () => {
    const stops = Array.from({ length: 25 }, (_, i) => available(i, i === 0 ? null : 0.1));
    const sum = stops.reduce((s, x) => s + (x.distance_from_previous_miles ?? 0), 0);
    const parsed = parseOwnerTrip(
      trip(stops, { total_miles: sum + 1e-12, measured_legs: 24, total_legs: 24 }),
    );
    expect(parsed!.stops).toHaveLength(25);
  });
});

describe("parseOwnerTrip — fail closed on broken wrappers", () => {
  const summary = { total_miles: 5.24, measured_legs: 1, total_legs: 2 };
  it.each([
    ["an extra trip field (owner identity)", { ...EXAMPLE, user_id: TRIP_ID }],
    ["an extra trip field (share hash)", { ...EXAMPLE, share_token_hash: "a".repeat(64) }],
    ["a missing trip field", (({ version: _v, ...rest }) => rest)(EXAMPLE)],
    ["a malformed trip ID", { ...EXAMPLE, id: "trip-1" }],
    ["an empty name", { ...EXAMPLE, name: "" }],
    ["a 101-code-point name", { ...EXAMPLE, name: "a".repeat(101) }],
    ["a negative version", { ...EXAMPLE, version: -1 }],
    ["a string version", { ...EXAMPLE, version: "3" }],
    ["a non-ISO timestamp", { ...EXAMPLE, updated_at: "2026-11-23" }],
    ["a non-boolean is_shared", { ...EXAMPLE, is_shared: "false" }],
    ["stops not an array", { ...EXAMPLE, stops: {} }],
    [
      "26 stops",
      trip(
        Array.from({ length: 26 }, (_, i) => unavailable(i)),
        summary,
      ),
    ],
    ["positions out of order", trip([available(1, null), available(0, 1)], summary)],
    [
      "a duplicate stop ID",
      trip([available(0, null), { ...available(1, 1), id: STOP(0) }], summary),
    ],
    [
      "a duplicate landmark",
      trip([available(0, null), { ...available(1, 1), landmark: landmark(0) }], summary),
    ],
    ["an extra stop field", trip([{ ...available(0, null), note: "x" }], summary)],
    ["a malformed stop ID", trip([{ ...available(0, null), id: "s" }], summary)],
    [
      "a missing landmark ID",
      trip([{ ...unavailable(0), landmark: { is_available: false } }], summary),
    ],
    ["a negative distance", trip([available(0, null), available(1, -2)], summary)],
    ["a missing summary", trip([], undefined)],
    [
      "an extra summary field",
      trip([], { total_miles: null, measured_legs: 0, total_legs: 0, x: 1 }),
    ],
    [
      "a summary with the wrong leg count",
      trip([available(0, null)], { total_miles: null, measured_legs: 0, total_legs: 1 }),
    ],
    [
      "a summary with the wrong measured count",
      trip([available(0, null), available(1, 2)], {
        total_miles: 2,
        measured_legs: 0,
        total_legs: 1,
      }),
    ],
    [
      "a summary with the wrong total",
      trip([available(0, null), available(1, 2)], {
        total_miles: 3,
        measured_legs: 1,
        total_legs: 1,
      }),
    ],
  ])("rejects %s", (_label, raw) => {
    expect(parseOwnerTrip(raw)).toBeNull();
  });

  it("rejects a non-object and a wrapper with extra keys", () => {
    expect(parseOwnerTripResponse(null)).toBeNull();
    expect(parseOwnerTripResponse([EXAMPLE])).toBeNull();
    expect(parseOwnerTripResponse({ trip: EXAMPLE, extra: 1 })).toBeNull();
  });
});

describe("untrusted landmark data is never kept as an available stop", () => {
  const SECRETS = ["restricted", "source", "36.123456", "-84.654321", "Hidden Name"];

  function expectNoSecrets(value: unknown) {
    const text = JSON.stringify(value);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  }

  it.each([
    ["an extra landmark field", landmark(1, { source_description: "restricted" })],
    ["a missing landmark field", (({ category: _c, ...rest }) => rest)(landmark(1))],
    ["latitude out of range", landmark(1, { latitude: 91 })],
    ["a non-numeric longitude (as text)", landmark(1, { longitude: "-84.654321" })],
    [
      "coordinates of a hidden place plus a source field",
      landmark(1, { latitude: 36.123456, source_url: "https://example.com/restricted" }),
    ],
    ["an empty display name", landmark(1, { display_name: "" })],
    ["a category that is not a slug", landmark(1, { category: "Hidden Name" })],
  ])(
    "an is_available: true stop with %s becomes the unavailable placeholder, keeping only the landmark ID",
    (_label, badLandmark) => {
      const raw = trip(
        [available(0, null), { ...available(1, 3.5), landmark: badLandmark }, available(2, 1.25)],
        { total_miles: 4.75, measured_legs: 2, total_legs: 2 },
      );
      const parsed = parseOwnerTrip(raw)!;
      expect(parsed.stops[1]).toEqual({
        id: STOP(1),
        position: 1,
        is_available: false,
        distance_from_previous_miles: null,
        landmark: { id: LANDMARK(1), is_available: false },
      });
      // Its neighbour's leg touches the hidden stop, so it is dropped too; the summary is recomputed.
      expect(parsed.stops[2]!.distance_from_previous_miles).toBeNull();
      expect(parsed.distance_summary).toEqual({
        total_miles: null,
        measured_legs: 0,
        total_legs: 2,
      });
      expectNoSecrets(parsed.stops[1]);
    },
  );

  it("an is_available: false stop that leaks landmark fields or a distance keeps only the placeholder", () => {
    const leaky = {
      ...unavailable(1),
      distance_from_previous_miles: 2.5,
      landmark: {
        id: LANDMARK(1),
        is_available: false,
        display_name: "Hidden Name",
        latitude: 36.123456,
        longitude: -84.654321,
        source_url: "https://example.com/restricted",
      },
    };
    const parsed = parseOwnerTrip(
      trip([available(0, null), leaky], { total_miles: 2.5, measured_legs: 1, total_legs: 1 }),
    )!;
    expect(parsed.stops[1]).toEqual(unavailable(1));
    expect(parsed.distance_summary).toEqual({ total_miles: null, measured_legs: 0, total_legs: 1 });
    expectNoSecrets(parsed);
  });

  it("a distance on the first stop, or next to an unavailable stop, is dropped", () => {
    const parsed = parseOwnerTrip(
      trip([available(0, 9), unavailable(1), available(2, 4), available(3, 1.5)], {
        total_miles: 14.5,
        measured_legs: 3,
        total_legs: 3,
      }),
    )!;
    expect(parsed.stops.map((s) => s.distance_from_previous_miles)).toEqual([
      null,
      null,
      null,
      1.5,
    ]);
    expect(parsed.distance_summary).toEqual({ total_miles: 1.5, measured_legs: 1, total_legs: 3 });
  });

  it("is_available that is not a boolean fails the whole response", () => {
    expect(parseTripStop({ ...available(0, null), is_available: "true" }, 0)).toBeNull();
  });
});

describe("parseTripListPage", () => {
  const item = (n: number) => ({
    id: STOP(n),
    name: `Trip ${n}`,
    stop_count: n,
    updated_at: TIME,
    is_shared: n % 2 === 0,
  });

  it("accepts an exact page matching the request", () => {
    const raw = { trips: [item(1), item(2)], page: 2, limit: 2, has_more: true };
    expect(parseTripListPage(raw, { page: 2, limit: 2 })).toEqual(raw);
    expect(
      parseTripListPage({ trips: [], page: 1, limit: 20, has_more: false }, { page: 1, limit: 20 }),
    ).toEqual({
      trips: [],
      page: 1,
      limit: 20,
      has_more: false,
    });
  });

  it.each([
    ["a different page", { trips: [], page: 2, limit: 20, has_more: false }],
    ["a different limit", { trips: [], page: 1, limit: 10, has_more: false }],
    [
      "more items than the limit",
      { trips: Array.from({ length: 21 }, (_, i) => item(i)), page: 1, limit: 20, has_more: false },
    ],
    ["a duplicate trip", { trips: [item(1), item(1)], page: 1, limit: 20, has_more: false }],
    [
      "an extra item field",
      { trips: [{ ...item(1), user_id: TRIP_ID }], page: 1, limit: 20, has_more: false },
    ],
    [
      "a stop count over 25",
      { trips: [{ ...item(1), stop_count: 26 }], page: 1, limit: 20, has_more: false },
    ],
    ["an extra page field", { trips: [], page: 1, limit: 20, has_more: false, total: 0 }],
    ["a non-boolean has_more", { trips: [], page: 1, limit: 20, has_more: "no" }],
  ])("rejects %s", (_label, raw) => {
    expect(parseTripListPage(raw, { page: 1, limit: 20 })).toBeNull();
  });
});

describe("parseAddedStopResponse — exactly { stop: { id, position, is_available: true, landmark } }", () => {
  const added = { id: STOP(4), position: 4, is_available: true, landmark: landmark(4) };

  it("accepts the approved shape", () => {
    expect(parseAddedStopResponse({ stop: added })).toEqual(added);
  });

  it.each([
    ["a distance field", { ...added, distance_from_previous_miles: null }],
    ["is_available false", { ...added, is_available: false }],
    ["an extra landmark field", { ...added, landmark: landmark(4, { source_url: "x" }) }],
    ["position 25", { ...added, position: 25 }],
    ["a malformed stop ID", { ...added, id: "new" }],
  ])("rejects %s", (_label, stop) => {
    expect(parseAddedStopResponse({ stop })).toBeNull();
  });

  it("rejects a bare stop and a wrapper with extra keys", () => {
    expect(parseAddedStopResponse(added)).toBeNull();
    expect(parseAddedStopResponse({ stop: added, trip: {} })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// M05-T06 Increment 1 — the public shared trip and share links.
// ---------------------------------------------------------------------------

/** The shared view of a trip: exactly name, stops, and summary. */
function shared(stops: unknown[], summary: unknown, extra: Record<string, unknown> = {}) {
  return { trip: { name: "Weekend Waterfalls", stops, distance_summary: summary, ...extra } };
}

const SHARED_EXAMPLE = shared([available(0, null), available(1, 5.24), unavailable(2)], {
  total_miles: 5.24,
  measured_legs: 1,
  total_legs: 2,
});

describe("parseSharedTripResponse — valid shapes", () => {
  it("accepts the spec's shared view and rebuilds it with no owner fields", () => {
    const parsed = parseSharedTripResponse(SHARED_EXAMPLE);
    expect(parsed).toEqual(SHARED_EXAMPLE.trip);
    expect(parsed).not.toBe(SHARED_EXAMPLE.trip);
    expect(Object.keys(parsed!).sort()).toEqual(["distance_summary", "name", "stops"]);
    expect(parsed!.stops[2]).toEqual(unavailable(2));
  });

  it("accepts an empty trip", () => {
    const empty = shared([], { total_miles: null, measured_legs: 0, total_legs: 0 });
    expect(parseSharedTripResponse(empty)).toEqual(empty.trip);
  });

  it("accepts every valid corpus name as stored (trimmed) and rejects every corpus rejection", () => {
    const summary = { total_miles: null, measured_legs: 0, total_legs: 0 };
    for (const testCase of TRIP_NAME_CASES) {
      const stored = testCase.expect.kind === "name" ? testCase.expect.value : testCase.input;
      const parsed = parseSharedTripResponse(shared([], summary, { name: stored }));
      if (testCase.expect.kind === "name") expect(parsed?.name).toBe(stored);
      else expect(parsed).toBeNull();
      // A name the server would have trimmed is not a stored name.
      if (testCase.expect.kind === "name" && testCase.input !== testCase.expect.value) {
        expect(parseSharedTripResponse(shared([], summary, { name: testCase.input }))).toBeNull();
      }
    }
  });
});

describe("parseSharedTripResponse — fail closed", () => {
  const summary = { total_miles: 5.24, measured_legs: 1, total_legs: 2 };
  const stops = [available(0, null), available(1, 5.24), unavailable(2)];

  it.each([
    ["id", TRIP_ID],
    ["version", 3],
    ["created_at", TIME],
    ["updated_at", TIME],
    ["is_shared", true],
    ["sharing_enabled", true],
    ["user_id", TRIP_ID],
    ["owner", { email: "owner@example.com" }],
    ["share_token_hash", "a".repeat(64)],
  ])("rejects an owner-only or unexpected trip field: %s", (field, value) => {
    expect(parseSharedTripResponse(shared(stops, summary, { [field]: value }))).toBeNull();
  });

  it.each([
    ["a non-object", null],
    ["an array", [SHARED_EXAMPLE]],
    ["a bare trip", SHARED_EXAMPLE.trip],
    ["an extra wrapper key", { ...SHARED_EXAMPLE, owner: "x" }],
    ["a missing name", { trip: { stops, distance_summary: summary } }],
    ["a missing summary", { trip: { name: "Trip", stops } }],
    ["stops not an array", shared({} as unknown as unknown[], summary)],
    ["an empty name", shared(stops, summary, { name: "" })],
    ["a non-string name", shared(stops, summary, { name: 7 })],
    ["an untrimmed name", shared(stops, summary, { name: " Trip" })],
    ["a name with an internal tab", shared(stops, summary, { name: "Day\t1" })],
    ["a name over 100 code points", shared(stops, summary, { name: "a".repeat(101) })],
    ["positions out of order", shared([available(1, null), available(0, 1)], summary)],
    ["an extra stop field", shared([{ ...available(0, null), note: "x" }], summary)],
    [
      "a summary that disagrees with the stops",
      shared([available(0, null), available(1, 2)], {
        total_miles: 3,
        measured_legs: 1,
        total_legs: 1,
      }),
    ],
  ])("rejects %s", (_label, raw) => {
    expect(parseSharedTripResponse(raw)).toBeNull();
  });
});

describe("parseSharedTripResponse — redaction is kept fail-closed", () => {
  const SECRETS = ["Hidden Name", "36.123456", "-84.654321", "restricted", "waterfall-source"];

  function expectNoSecrets(value: unknown) {
    const text = JSON.stringify(value);
    for (const secret of SECRETS) expect(text).not.toContain(secret);
  }

  it("an unavailable stop that leaks a name, category, coordinates, or a distance keeps only the placeholder", () => {
    const leaky = {
      ...unavailable(1),
      distance_from_previous_miles: 2.5,
      landmark: {
        id: LANDMARK(1),
        is_available: false,
        display_name: "Hidden Name",
        category: "waterfall-source",
        latitude: 36.123456,
        longitude: -84.654321,
      },
    };
    const parsed = parseSharedTripResponse(
      shared([available(0, null), leaky, available(2, 1)], {
        total_miles: 3.5,
        measured_legs: 2,
        total_legs: 2,
      }),
    )!;
    expect(parsed.stops[1]).toEqual(unavailable(1));
    expect(parsed.stops[2]!.distance_from_previous_miles).toBeNull();
    expect(parsed.distance_summary).toEqual({ total_miles: null, measured_legs: 0, total_legs: 2 });
    expectNoSecrets(parsed);
  });

  it("an available stop with protected extra fields becomes the placeholder; neighbouring legs are dropped", () => {
    const parsed = parseSharedTripResponse(
      shared(
        [
          available(0, null),
          {
            ...available(1, 3.5),
            landmark: landmark(1, {
              display_name: "Hidden Name",
              latitude: 36.123456,
              source_url: "https://example.com/restricted",
            }),
          },
          available(2, 1.25),
          available(3, 2),
        ],
        { total_miles: 6.75, measured_legs: 3, total_legs: 3 },
      ),
    )!;
    expect(parsed.stops.map((s) => s.is_available)).toEqual([true, false, true, true]);
    expect(parsed.stops.map((s) => s.distance_from_previous_miles)).toEqual([null, null, null, 2]);
    expect(parsed.distance_summary).toEqual({ total_miles: 2, measured_legs: 1, total_legs: 3 });
    expectNoSecrets(parsed);
  });
});

describe("share tokens and share URLs", () => {
  const TOKEN = `${"A".repeat(20)}-_${"b9".repeat(10)}z`;
  const VALID = `https://share.example.test/shared/trips/${TOKEN}`;

  it("isShareToken accepts exactly 43 base64url characters", () => {
    expect(TOKEN).toHaveLength(43);
    expect(isShareToken(TOKEN)).toBe(true);
    for (const bad of [
      "",
      TOKEN.slice(1),
      `${TOKEN}A`,
      `${TOKEN.slice(1)}=`,
      `${TOKEN.slice(1)}+`,
      `${TOKEN.slice(1)}/`,
      `${TOKEN.slice(1)} `,
      `${TOKEN.slice(1)}\n`,
      `${TOKEN.slice(3)}%2F`,
      undefined,
      43,
    ]) {
      expect(isShareToken(bad)).toBe(false);
    }
  });

  it.each([
    [VALID],
    [`http://localhost:3000/shared/trips/${TOKEN}`],
    [`http://127.0.0.1:8080/shared/trips/${TOKEN}`],
    [`https://[::1]:8443/shared/trips/${TOKEN}`],
    [`https://share.example.test/shared/trips/${"-".repeat(21)}${"_".repeat(22)}`],
  ])("accepts %s — any configured origin, unchanged", (url) => {
    expect(parseShareUrl(url)).toBe(url);
  });

  it.each([
    ["a non-http scheme", `ftp://share.example.test/shared/trips/${TOKEN}`],
    ["a javascript URL", `javascript:alert(1)//shared/trips/${TOKEN}`],
    ["a relative URL", `/shared/trips/${TOKEN}`],
    ["a scheme-relative URL", `//share.example.test/shared/trips/${TOKEN}`],
    ["an empty host", `https:///shared/trips/${TOKEN}`],
    ["a user name", `https://user@share.example.test/shared/trips/${TOKEN}`],
    ["a user name and password", `https://user:pw@share.example.test/shared/trips/${TOKEN}`],
    ["a query", `${VALID}?x=1`],
    ["an empty query", `${VALID}?`],
    ["a fragment", `${VALID}#top`],
    ["an empty fragment", `${VALID}#`],
    ["a trailing slash", `${VALID}/`],
    ["an extra segment", `${VALID}/x`],
    ["a path prefix", `https://share.example.test/app/shared/trips/${TOKEN}`],
    ["the wrong path", `https://share.example.test/shared/trip/${TOKEN}`],
    ["a capitalised path", `https://share.example.test/Shared/trips/${TOKEN}`],
    ["no token", "https://share.example.test/shared/trips/"],
    ["a 42-character token", `https://share.example.test/shared/trips/${TOKEN.slice(1)}`],
    ["a 44-character token", `${VALID}A`],
    ["base64 padding", `https://share.example.test/shared/trips/${TOKEN.slice(1)}=`],
    ["a plus sign", `https://share.example.test/shared/trips/${TOKEN.slice(1)}+`],
    ["leading whitespace", ` ${VALID}`],
    ["trailing whitespace", `${VALID} `],
    ["a trailing newline", `${VALID}\n`],
    ["an internal tab", `https://share.example.test/shared/\ttrips/${TOKEN}`],
    ["an encoded separator in the path", `https://share.example.test/shared/trips%2F${TOKEN}`],
    ["an encoded token", `https://share.example.test/shared/trips/${TOKEN.slice(3)}%41%41%41`],
    ["a percent-encoded host", `https://share.ex%61mple.test/shared/trips/${TOKEN}`],
    ["dot segments", `https://share.example.test/x/../shared/trips/${TOKEN}`],
    ["a single-dot segment", `https://share.example.test/shared/./trips/${TOKEN}`],
    ["backslashes", `https://share.example.test\\shared\\trips\\${TOKEN}`],
    ["an upper-case scheme", `HTTPS://share.example.test/shared/trips/${TOKEN}`],
    ["an upper-case host", `https://Share.Example.test/shared/trips/${TOKEN}`],
    ["an explicit default port (https)", `https://share.example.test:443/shared/trips/${TOKEN}`],
    ["an explicit default port (http)", `http://share.example.test:80/shared/trips/${TOKEN}`],
    ["a non-ASCII host", `https://exämple.test/shared/trips/${TOKEN}`],
  ])("rejects %s", (_label, url) => {
    expect(parseShareUrl(url)).toBeNull();
  });

  it("rejects non-strings without throwing", () => {
    for (const value of [undefined, null, 5, {}, new URL(VALID), [VALID]]) {
      expect(parseShareUrl(value)).toBeNull();
    }
  });

  it("parseShareResponse requires exactly { share_url } with a valid link", () => {
    expect(parseShareResponse({ share_url: VALID })).toBe(VALID);
    expect(parseShareResponse({ share_url: VALID, token: TOKEN })).toBeNull();
    expect(parseShareResponse({ url: VALID })).toBeNull();
    expect(parseShareResponse({ share_url: `${VALID}?x` })).toBeNull();
    expect(parseShareResponse(VALID)).toBeNull();
    expect(parseShareResponse(null)).toBeNull();
  });
});
