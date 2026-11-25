import { afterEach, describe, expect, it, vi } from "vitest";
import { TRIP_NAME_CASES } from "../trips/testdata/tripNameCorpus";
import {
  TRIP_SHARING_UNAVAILABLE,
  TRIP_STOP_ALREADY_EXISTS,
  TRIP_STOP_LIMIT_REACHED,
  TRIP_VERSION_CONFLICT,
  addTripStop,
  createTrip,
  deleteTrip,
  enableTripSharing,
  getSharedTrip,
  getTrip,
  listTrips,
  removeTripStop,
  renameTrip,
  reorderTripStops,
  revokeTripSharing,
} from "./trips";

/**
 * M05-T04 Increment 1 — the trips API wrappers: exact request paths, methods,
 * and bodies; validated, rebuilt responses; and the server's error codes
 * passed through as `ApiError`s.
 */

const TRIP_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const LANDMARK_ID = "11111111-1111-4111-8111-000000000001";
const STOP = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const TIME = "2026-11-23T16:00:00.000Z";

function stopFixture(n: number) {
  return {
    id: STOP(n),
    position: n,
    is_available: true,
    distance_from_previous_miles: n === 0 ? null : 1.5,
    landmark: {
      id: `11111111-1111-4111-8111-${String(n + 10).padStart(12, "0")}`,
      display_name: `Arch ${n}`,
      category: "arch",
      latitude: 36,
      longitude: -84 + n / 10,
    },
  };
}

function tripFixture(stopCount: number, extra: Record<string, unknown> = {}) {
  const stops = Array.from({ length: stopCount }, (_, i) => stopFixture(i));
  const legs = Math.max(stopCount - 1, 0);
  return {
    id: TRIP_ID,
    name: "Weekend",
    version: 0,
    created_at: TIME,
    updated_at: TIME,
    is_shared: false,
    sharing_enabled: true,
    stops,
    distance_summary: {
      total_miles: legs === 0 ? null : legs * 1.5,
      measured_legs: legs,
      total_legs: legs,
    },
    ...extra,
  };
}

function respond(status: number, body?: unknown, headers: Record<string, string> = {}) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers(headers),
    json: () =>
      body === undefined ? Promise.reject(new SyntaxError("no body")) : Promise.resolve(body),
  } as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function call(fetchMock: ReturnType<typeof respond>) {
  const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { path, init, body: init.body === undefined ? undefined : JSON.parse(String(init.body)) };
}

function envelope(code: string, message = "msg") {
  return { error: { code, message } };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("listTrips", () => {
  it("requests page 1, limit 20 by default and returns the validated page", async () => {
    const page = {
      trips: [{ id: TRIP_ID, name: "Weekend", stop_count: 2, updated_at: TIME, is_shared: false }],
      page: 1,
      limit: 20,
      has_more: false,
    };
    const fetchMock = respond(200, page);
    await expect(listTrips()).resolves.toEqual(page);
    expect(call(fetchMock).path).toBe("/api/v1/trips?page=1&limit=20");
  });

  it("passes page and limit (up to 100) and rejects a page that does not match the request", async () => {
    const fetchMock = respond(200, { trips: [], page: 3, limit: 100, has_more: false });
    await listTrips({ page: 3, limit: 100 });
    expect(call(fetchMock).path).toBe("/api/v1/trips?page=3&limit=100");
    respond(200, { trips: [], page: 1, limit: 100, has_more: false });
    await expect(listTrips({ page: 3, limit: 100 })).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("refuses an invalid query before any request", async () => {
    const fetchMock = respond(200, {});
    for (const query of [{ page: 0 }, { page: 1.5 }, { limit: 0 }, { limit: 101 }]) {
      await expect(listTrips(query)).rejects.toBeInstanceOf(RangeError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createTrip", () => {
  it("POSTs { name } and returns the new empty trip", async () => {
    const fetchMock = respond(201, { trip: tripFixture(0) });
    await expect(createTrip("Weekend")).resolves.toMatchObject({ id: TRIP_ID, version: 0 });
    const { path, init, body } = call(fetchMock);
    expect(path).toBe("/api/v1/trips");
    expect(init.method).toBe("POST");
    expect(body).toEqual({ name: "Weekend" });
  });

  it("rejects a response that is not a new empty trip", async () => {
    respond(201, { trip: tripFixture(1) });
    await expect(createTrip("Weekend")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    respond(201, { trip: tripFixture(0, { version: 1 }) });
    await expect(createTrip("Weekend")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("passes the server's 400 name error through unchanged", async () => {
    respond(400, envelope("INVALID_REQUEST", "name must be at most 100 characters."));
    await expect(createTrip("x")).rejects.toMatchObject({
      status: 400,
      code: "INVALID_REQUEST",
      message: "name must be at most 100 characters.",
    });
  });
});

describe("getTrip", () => {
  it("GETs the trip by encoded ID and returns the validated owner view", async () => {
    const fetchMock = respond(200, { trip: tripFixture(3) });
    const trip = await getTrip(TRIP_ID.toUpperCase());
    expect(trip.stops.map((s) => s.position)).toEqual([0, 1, 2]);
    expect(call(fetchMock).path).toBe(`/api/v1/trips/${TRIP_ID.toUpperCase()}`);
  });

  it("encodes the ID path segment", async () => {
    const fetchMock = respond(404, envelope("NOT_FOUND", "Resource not found."));
    await expect(getTrip("../x?y")).rejects.toMatchObject({ status: 404 });
    expect(call(fetchMock).path).toBe("/api/v1/trips/..%2Fx%3Fy");
  });

  it("rejects a response for a different trip and a malformed body", async () => {
    respond(200, { trip: tripFixture(0, { id: STOP(9) }) });
    await expect(getTrip(TRIP_ID)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    respond(200, { trip: { ...tripFixture(0), user_id: TRIP_ID } });
    await expect(getTrip(TRIP_ID)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("passes 401, 404, and 429 (with Retry-After) through", async () => {
    respond(401, envelope("UNAUTHENTICATED"));
    await expect(getTrip(TRIP_ID)).rejects.toMatchObject({ status: 401, code: "UNAUTHENTICATED" });
    respond(404, envelope("NOT_FOUND"));
    await expect(getTrip(TRIP_ID)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    respond(429, envelope("RATE_LIMITED"), { "Retry-After": "12" });
    await expect(getTrip(TRIP_ID)).rejects.toMatchObject({ retryAfterSeconds: 12 });
  });
});

describe("addTripStop", () => {
  const added = {
    id: STOP(3),
    position: 3,
    is_available: true,
    landmark: {
      id: LANDMARK_ID,
      display_name: "Example Falls",
      category: "falls",
      latitude: 35.61,
      longitude: -83.52,
    },
  };

  it("POSTs { landmark_id } and returns the stop without a distance", async () => {
    const fetchMock = respond(201, { stop: added });
    const stop = await addTripStop(TRIP_ID, LANDMARK_ID);
    expect(stop).toEqual(added);
    expect(stop).not.toHaveProperty("distance_from_previous_miles");
    const { path, init, body } = call(fetchMock);
    expect(path).toBe(`/api/v1/trips/${TRIP_ID}/stops`);
    expect(init.method).toBe("POST");
    expect(body).toEqual({ landmark_id: LANDMARK_ID });
  });

  it("rejects a response with a distance field or for a different landmark", async () => {
    respond(201, { stop: { ...added, distance_from_previous_miles: 2 } });
    await expect(addTripStop(TRIP_ID, LANDMARK_ID)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    respond(201, { stop: { ...added, landmark: { ...added.landmark, id: STOP(7) } } });
    await expect(addTripStop(TRIP_ID, LANDMARK_ID)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it.each([
    [409, TRIP_STOP_ALREADY_EXISTS],
    [409, TRIP_STOP_LIMIT_REACHED],
    [404, "NOT_FOUND"],
  ])("passes %i %s through", async (status, code) => {
    respond(status, envelope(code));
    await expect(addTripStop(TRIP_ID, LANDMARK_ID)).rejects.toMatchObject({ status, code });
  });
});

describe("removeTripStop", () => {
  it("DELETEs the stop and resolves on 204 with no body", async () => {
    const fetchMock = respond(204);
    await expect(removeTripStop(TRIP_ID, STOP(1))).resolves.toBeUndefined();
    const { path, init, body } = call(fetchMock);
    expect(path).toBe(`/api/v1/trips/${TRIP_ID}/stops/${STOP(1)}`);
    expect(init.method).toBe("DELETE");
    expect(body).toBeUndefined();
  });

  it("treats a 200 as INVALID_RESPONSE and passes 404 through", async () => {
    respond(200, { success: true });
    await expect(removeTripStop(TRIP_ID, STOP(1))).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    respond(404, envelope("NOT_FOUND"));
    await expect(removeTripStop(TRIP_ID, STOP(1))).rejects.toMatchObject({ status: 404 });
  });
});

describe("reorderTripStops", () => {
  it("PUTs { stop_ids, version } and returns the reordered trip", async () => {
    const reordered = tripFixture(2, { version: 4 });
    reordered.stops = [
      { ...stopFixture(1), position: 0, distance_from_previous_miles: null },
      { ...stopFixture(0), position: 1, distance_from_previous_miles: 1.5 },
    ];
    reordered.distance_summary = { total_miles: 1.5, measured_legs: 1, total_legs: 1 };
    const fetchMock = respond(200, { trip: reordered });
    const trip = await reorderTripStops(TRIP_ID, [STOP(1), STOP(0)], 3);
    expect(trip.version).toBe(4);
    expect(trip.stops.map((s) => s.id)).toEqual([STOP(1), STOP(0)]);
    const { path, init, body } = call(fetchMock);
    expect(path).toBe(`/api/v1/trips/${TRIP_ID}/stops/order`);
    expect(init.method).toBe("PUT");
    expect(body).toEqual({ stop_ids: [STOP(1), STOP(0)], version: 3 });
  });

  it("rejects a response whose order is not the requested order", async () => {
    respond(200, { trip: tripFixture(2, { version: 4 }) });
    await expect(reorderTripStops(TRIP_ID, [STOP(1), STOP(0)], 3)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("passes 409 TRIP_VERSION_CONFLICT and 400 INVALID_REQUEST through", async () => {
    respond(409, envelope(TRIP_VERSION_CONFLICT));
    await expect(reorderTripStops(TRIP_ID, [STOP(0)], 1)).rejects.toMatchObject({
      status: 409,
      code: TRIP_VERSION_CONFLICT,
    });
    respond(400, envelope("INVALID_REQUEST"));
    await expect(reorderTripStops(TRIP_ID, [STOP(0)], 1)).rejects.toMatchObject({ status: 400 });
  });

  it("refuses an empty or oversized list and an invalid version before any request", async () => {
    const fetchMock = respond(200, {});
    await expect(reorderTripStops(TRIP_ID, [], 0)).rejects.toBeInstanceOf(RangeError);
    await expect(
      reorderTripStops(
        TRIP_ID,
        Array.from({ length: 26 }, (_, i) => STOP(i)),
        0,
      ),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(reorderTripStops(TRIP_ID, [STOP(0)], -1)).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// M05-T06 Increment 1 — rename, delete, sharing, and the public shared read.
// ---------------------------------------------------------------------------

const TOKEN = `${"A".repeat(20)}-_${"b9".repeat(10)}z`; // 43 base64url characters
const SHARE_URL = `https://share.example.test/shared/trips/${TOKEN}`;

function sharedFixture(extra: Record<string, unknown> = {}) {
  const { name, stops, distance_summary } = tripFixture(2);
  return { trip: { name, stops, distance_summary, ...extra } };
}

describe("renameTrip", () => {
  it("PATCHes { name, version } with the trimmed name and returns the renamed trip", async () => {
    const fetchMock = respond(200, { trip: tripFixture(1, { name: "Fall Loop", version: 4 }) });
    const trip = await renameTrip(TRIP_ID.toUpperCase(), "  Fall Loop\n", 3);
    expect(trip).toMatchObject({ id: TRIP_ID, name: "Fall Loop", version: 4 });
    const { path, init, body } = call(fetchMock);
    expect(path).toBe(`/api/v1/trips/${TRIP_ID}`);
    expect(init.method).toBe("PATCH");
    expect(init.credentials).toBe("same-origin");
    expect(body).toEqual({ name: "Fall Loop", version: 3 });
  });

  it.each([
    ["a different trip", tripFixture(0, { id: STOP(9), name: "Fall Loop", version: 4 })],
    ["the same version", tripFixture(0, { name: "Fall Loop", version: 3 })],
    ["an older version", tripFixture(0, { name: "Fall Loop", version: 2 })],
    ["a different name", tripFixture(0, { name: "Other", version: 4 })],
    [
      "an owner-identity field",
      tripFixture(0, { name: "Fall Loop", version: 4, user_id: TRIP_ID }),
    ],
  ])("rejects a response with %s as INVALID_RESPONSE", async (_label, trip) => {
    respond(200, { trip });
    await expect(renameTrip(TRIP_ID, "Fall Loop", 3)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
  });

  it("rejects a success status other than 200", async () => {
    respond(201, { trip: tripFixture(0, { name: "Fall Loop", version: 4 }) });
    await expect(renameTrip(TRIP_ID, "Fall Loop", 3)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
      status: 201,
    });
  });

  it("refuses an invalid trip ID, name, or version before any request", async () => {
    const fetchMock = respond(200, {});
    await expect(renameTrip("../x", "Fall Loop", 0)).rejects.toBeInstanceOf(RangeError);
    for (const version of [-1, 1.5, Number.NaN, 2_147_483_648, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(renameTrip(TRIP_ID, "Fall Loop", version)).rejects.toBeInstanceOf(RangeError);
    }
    for (const testCase of TRIP_NAME_CASES.filter((c) => c.expect.kind === "reject")) {
      await expect(renameTrip(TRIP_ID, testCase.input, 0)).rejects.toBeInstanceOf(RangeError);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends every valid corpus name exactly as the shared rule produces it", async () => {
    for (const testCase of TRIP_NAME_CASES) {
      if (testCase.expect.kind !== "name") continue;
      const expected = testCase.expect.value;
      const fetchMock = respond(200, { trip: tripFixture(0, { name: expected, version: 1 }) });
      await renameTrip(TRIP_ID, testCase.input, 0);
      expect(call(fetchMock).body).toEqual({ name: expected, version: 0 });
    }
  });

  it("passes 409 TRIP_VERSION_CONFLICT, 404, 400, and 429 through", async () => {
    respond(409, envelope(TRIP_VERSION_CONFLICT));
    await expect(renameTrip(TRIP_ID, "Fall Loop", 3)).rejects.toMatchObject({
      status: 409,
      code: TRIP_VERSION_CONFLICT,
    });
    respond(404, envelope("NOT_FOUND"));
    await expect(renameTrip(TRIP_ID, "Fall Loop", 3)).rejects.toMatchObject({ status: 404 });
    respond(400, envelope("INVALID_REQUEST", "name contains characters that are not allowed."));
    await expect(renameTrip(TRIP_ID, "Fall Loop", 3)).rejects.toMatchObject({
      status: 400,
      message: "name contains characters that are not allowed.",
    });
    respond(429, envelope("RATE_LIMITED"), { "Retry-After": "7" });
    await expect(renameTrip(TRIP_ID, "Fall Loop", 3)).rejects.toMatchObject({
      retryAfterSeconds: 7,
    });
  });
});

describe("deleteTrip", () => {
  it("DELETEs the trip with no body and resolves on 204", async () => {
    const fetchMock = respond(204);
    await expect(deleteTrip(TRIP_ID)).resolves.toBeUndefined();
    const { path, init, body } = call(fetchMock);
    expect(path).toBe(`/api/v1/trips/${TRIP_ID}`);
    expect(init.method).toBe("DELETE");
    expect(body).toBeUndefined();
    expect(init.credentials).toBe("same-origin");
  });

  it("treats a 200 as INVALID_RESPONSE, passes 404 through, and maps a transport failure", async () => {
    respond(200, { success: true });
    await expect(deleteTrip(TRIP_ID)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    respond(404, envelope("NOT_FOUND"));
    await expect(deleteTrip(TRIP_ID)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await expect(deleteTrip(TRIP_ID)).rejects.toMatchObject({ code: "NETWORK_ERROR" });
  });

  it("refuses a malformed trip ID before any request", async () => {
    const fetchMock = respond(204);
    await expect(deleteTrip("not-a-uuid")).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("enableTripSharing", () => {
  it("POSTs an empty JSON object and returns the validated share URL", async () => {
    const fetchMock = respond(200, { share_url: SHARE_URL });
    await expect(enableTripSharing(TRIP_ID)).resolves.toBe(SHARE_URL);
    const { path, init, body } = call(fetchMock);
    expect(path).toBe(`/api/v1/trips/${TRIP_ID}/share`);
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(body).toEqual({});
  });

  it("accepts a configured origin that differs from the frontend's", async () => {
    const other = `http://localhost:3000/shared/trips/${TOKEN}`;
    respond(200, { share_url: other });
    await expect(enableTripSharing(TRIP_ID)).resolves.toBe(other);
  });

  it.each([
    ["an extra key", { share_url: SHARE_URL, token: TOKEN }],
    ["a missing key", {}],
    ["a query string", { share_url: `${SHARE_URL}?x=1` }],
    ["a short token", { share_url: SHARE_URL.slice(0, -1) }],
    ["a non-string", { share_url: 5 }],
  ])("rejects a response with %s as INVALID_RESPONSE", async (_label, response) => {
    respond(200, response);
    await expect(enableTripSharing(TRIP_ID)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("passes 409 TRIP_SHARING_UNAVAILABLE and 404 through", async () => {
    respond(409, envelope(TRIP_SHARING_UNAVAILABLE));
    await expect(enableTripSharing(TRIP_ID)).rejects.toMatchObject({
      status: 409,
      code: TRIP_SHARING_UNAVAILABLE,
    });
    respond(404, envelope("NOT_FOUND"));
    await expect(enableTripSharing(TRIP_ID)).rejects.toMatchObject({ status: 404 });
  });

  it("refuses a malformed trip ID before any request", async () => {
    const fetchMock = respond(200, { share_url: SHARE_URL });
    await expect(enableTripSharing("x")).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("revokeTripSharing", () => {
  it("DELETEs the share with no body and resolves on 204", async () => {
    const fetchMock = respond(204);
    await expect(revokeTripSharing(TRIP_ID)).resolves.toBeUndefined();
    const { path, init, body } = call(fetchMock);
    expect(path).toBe(`/api/v1/trips/${TRIP_ID}/share`);
    expect(init.method).toBe("DELETE");
    expect(body).toBeUndefined();
  });

  it("treats a 200 as INVALID_RESPONSE, passes 404 through, and refuses a malformed ID", async () => {
    respond(200, {});
    await expect(revokeTripSharing(TRIP_ID)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    respond(404, envelope("NOT_FOUND"));
    await expect(revokeTripSharing(TRIP_ID)).rejects.toMatchObject({ status: 404 });
    const fetchMock = respond(204);
    await expect(revokeTripSharing("")).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getSharedTrip", () => {
  it("GETs the shared trip without credentials and returns only name, stops, and summary", async () => {
    const fetchMock = respond(200, sharedFixture());
    const trip = await getSharedTrip(TOKEN);
    expect(Object.keys(trip).sort()).toEqual(["distance_summary", "name", "stops"]);
    expect(trip.stops).toHaveLength(2);
    const { path, init } = call(fetchMock);
    expect(path).toBe(`/api/v1/shared/trips/${TOKEN}`);
    expect(init.method ?? "GET").toBe("GET");
    expect(init.credentials).toBe("omit");
    expect(init.headers).toEqual({ Accept: "application/json" });
    expect(init.body).toBeUndefined();
  });

  it.each([
    ["", "empty"],
    [TOKEN.slice(1), "42 characters"],
    [`${TOKEN}a`, "44 characters"],
    [`${TOKEN.slice(1)}=`, "padding"],
    [`${TOKEN.slice(1)}+`, "a non-base64url character"],
    [`${TOKEN.slice(3)}%2F`, "an encoded separator"],
    [` ${TOKEN.slice(1)}`, "whitespace"],
    [`../${TOKEN.slice(3)}`, "a path segment"],
  ])("refuses %j (%s) before any request", async (token) => {
    const fetchMock = respond(200, sharedFixture());
    await expect(getSharedTrip(token)).rejects.toBeInstanceOf(RangeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["id"],
    ["version"],
    ["created_at"],
    ["updated_at"],
    ["is_shared"],
    ["sharing_enabled"],
    ["user_id"],
    ["owner"],
  ])("rejects a response carrying the owner-only field %s", async (field) => {
    respond(200, sharedFixture({ [field]: field === "id" ? TRIP_ID : 1 }));
    await expect(getSharedTrip(TOKEN)).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("passes the generic 404 and a 5xx through", async () => {
    respond(404, envelope("NOT_FOUND", "Resource not found."));
    await expect(getSharedTrip(TOKEN)).rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
    respond(500, envelope("INTERNAL_ERROR"));
    await expect(getSharedTrip(TOKEN)).rejects.toMatchObject({ status: 500 });
  });
});

describe("token confidentiality", () => {
  it("never puts a token or share URL in an error message, and never logs", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {}),
    );
    const messages: string[] = [];
    const capture = async (promise: Promise<unknown>) => {
      try {
        await promise;
      } catch (error) {
        messages.push(String((error as Error).message), String(error));
      }
    };
    await capture(getSharedTrip(`${TOKEN}x`));
    respond(200, sharedFixture({ id: TRIP_ID }));
    await capture(getSharedTrip(TOKEN));
    respond(404, envelope("NOT_FOUND", "Resource not found."));
    await capture(getSharedTrip(TOKEN));
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError(`Failed ${TOKEN}`)));
    await capture(getSharedTrip(TOKEN));
    respond(200, { share_url: `${SHARE_URL}?leak=1` });
    await capture(enableTripSharing(TRIP_ID));
    respond(200, { share_url: SHARE_URL, extra: SHARE_URL });
    await capture(enableTripSharing(TRIP_ID));

    expect(messages).toHaveLength(12);
    for (const message of messages) {
      expect(message).not.toContain(TOKEN.slice(0, 20));
      expect(message).not.toContain("shared/trips");
    }
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});
