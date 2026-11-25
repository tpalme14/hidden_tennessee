import { createHmac } from "node:crypto";
import express, { Router, type Express, type Request, type Response } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { auth } from "../src/auth/auth.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { mountProtected } from "../src/auth/mount-protected.js";
import { requireTrustedOrigin } from "../src/auth/require-trusted-origin.js";
import { prisma } from "../src/db/prisma.js";
import { MESSAGES } from "../src/trips/request-schema.js";
import { createTripsRateLimiter } from "../src/trips/rate-limit.js";
import { createTripsRouter } from "../src/trips/router.js";
import {
  TEST_ORIGIN,
  anonymous,
  asUser,
  createSignedInUser,
  createTwoUsers,
  signOut,
  type TestUser,
} from "./helpers/test-users.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M05-T03 Increment 4 — the authenticated trips HTTP API over real HTTP, real
 * session cookies, and landmarks_test (specs/TRIP_PLANNING_SPEC.md v1.1 §§4,
 * 5, 6, 7, 7.1–7.3, 10.1, 10.2; ADR-012; ADR-014): every endpoint's status
 * and exact contract, authentication (missing, forged, expired, signed-out
 * sessions), CSRF, ownership (two accounts; non-owned is indistinguishable
 * from missing), strict validation, pagination, the 25-stop limit and the
 * amended add-stop precedence, stale versions, 204s without a body,
 * no-store, the fixed 500, throttling with Retry-After, and disclosure (no
 * restricted landmark field, owner identity, or share-token hash).
 *
 * Limiter isolation: tests on the real `createApp()` use the PRODUCTION
 * trips limiter (60 mutations / 120 reads per user per minute); every test
 * creates fresh users, so counters never accumulate across tests. Throttling
 * boundaries are tested on test-only apps, each with a FRESH trips limiter
 * at the approved limits and an injected clock. Every test ends with the
 * guarded resetTestDatabase().
 */

const NO_STORE = "private, no-store";
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Resource not found." } };
const UNAUTHENTICATED = { error: { code: "UNAUTHENTICATED", message: "Authentication required." } };
const INVALID_ORIGIN = {
  error: { code: "INVALID_ORIGIN", message: "Request origin not allowed." },
};
const RATE_LIMITED = {
  error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
};
const INTERNAL_ERROR = {
  error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
};
const STOP_EXISTS = {
  error: { code: "TRIP_STOP_ALREADY_EXISTS", message: "This landmark is already in the trip." },
};
const STOP_LIMIT = {
  error: { code: "TRIP_STOP_LIMIT_REACHED", message: "A trip can have at most 25 stops." },
};
const VERSION_CONFLICT = {
  error: {
    code: "TRIP_VERSION_CONFLICT",
    message: "This trip has changed. Reload it and try again.",
  },
};
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TAB = String.fromCodePoint(9);
/** A recognisable fake share-token hash (64 hex characters) that must never be serialized. */
const FAKE_HASH = "feedface".repeat(8);

const invalidRequest = (message: string) => ({ error: { code: "INVALID_REQUEST", message } });
const invalidQuery = (message: string) => ({ error: { code: "INVALID_QUERY", message } });

const TRIP_KEYS = [
  "created_at",
  "distance_summary",
  "id",
  "is_shared",
  "name",
  "sharing_enabled",
  "stops",
  "updated_at",
  "version",
];
const STOP_KEYS = ["distance_from_previous_miles", "id", "is_available", "landmark", "position"];
const ADDED_STOP_KEYS = ["id", "is_available", "landmark", "position"];
const LANDMARK_KEYS = ["category", "display_name", "id", "latitude", "longitude"];
const LIST_ITEM_KEYS = ["id", "is_shared", "name", "stop_count", "updated_at"];

type Status = "UNREVIEWED" | "PUBLIC" | "SENSITIVE";
let sequence = 0;

/** A landmark carrying restricted fields that no trip response may ever contain. */
async function createLandmark(
  options: { status?: Status; active?: boolean; latitude?: number; longitude?: number } = {},
): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `THT${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNARCHES",
      category: "ARCH",
      displayName: `Trip Arch ${sequence}`,
      latitude: options.latitude ?? 35.1 + (sequence % 40) / 100,
      longitude: options.longitude ?? -84.9 + (sequence % 40) / 100,
      sourceDescription: "restricted description",
      sourceAccessLabel: "restricted access",
      sourceUrl: "https://example.com/restricted",
      sensitivityStatus: options.status ?? "PUBLIC",
      isActive: options.active ?? true,
    },
  });
  return landmark.id;
}

async function createLandmarks(n: number): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i += 1) ids.push(await createLandmark());
  return ids;
}

async function setLandmark(id: string, data: { status?: Status; active?: boolean }) {
  await prisma.landmark.update({
    where: { id },
    data: {
      ...(data.status ? { sensitivityStatus: data.status } : {}),
      ...(data.active !== undefined ? { isActive: data.active } : {}),
    },
  });
}

const tripsPath = "/api/v1/trips";
const tripPath = (tripId: string) => `/api/v1/trips/${tripId}`;
const stopsPath = (tripId: string) => `/api/v1/trips/${tripId}/stops`;
const stopPath = (tripId: string, stopId: string) => `/api/v1/trips/${tripId}/stops/${stopId}`;
const orderPath = (tripId: string) => `/api/v1/trips/${tripId}/stops/order`;

function expectNoStore(response: request.Response, label = "") {
  expect(response.headers["cache-control"], label).toBe(NO_STORE);
}

/** 204 No Content: no body bytes and no Content-Type. */
function expectNoContent(response: request.Response) {
  expect(response.status).toBe(204);
  expect(response.text).toBe("");
  expect(response.headers["content-type"]).toBeUndefined();
  expectNoStore(response);
}

/** A validly signed session cookie for a token the database does not know. */
function forgedCookie(): string {
  const value = "ForgedTokenNotInTheDatabase0000";
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(value)
    .digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${value}.${signature}`)}`;
}

/** Creates a trip as `user` through the real API; returns the `trip` object. */
async function createVia(app: Express, user: TestUser, name = "Weekend Trip") {
  const response = await asUser(app, user).post(tripsPath).send({ name });
  expect(response.status).toBe(201);
  return response.body.trip as { id: string; version: number };
}

/** Adds a stop as `user` through the real API; returns the stop ID. */
async function addVia(app: Express, user: TestUser, tripId: string, landmarkId: string) {
  const response = await asUser(app, user)
    .post(stopsPath(tripId))
    .send({ landmark_id: landmarkId });
  expect(response.status).toBe(201);
  return response.body.stop.id as string;
}

/** Fixture: fills a trip with stops directly (fast; bypasses the API). */
async function fillDirectly(tripId: string, landmarkIds: string[]): Promise<string[]> {
  const ids: string[] = [];
  for (const [position, landmarkId] of landmarkIds.entries()) {
    const [row] = await prisma.$queryRaw<{ id: string }[]>`
      INSERT INTO trip_stops (trip_id, landmark_id, position)
      VALUES (${tripId}::uuid, ${landmarkId}::uuid, ${position}::int)
      RETURNING id::text AS id`;
    ids.push(row!.id);
  }
  return ids;
}

async function storedStops(tripId: string) {
  return prisma.tripStop.findMany({
    where: { tripId },
    orderBy: { position: "asc" },
    select: { id: true, landmarkId: true, position: true },
  });
}

async function storedTrip(tripId: string) {
  return prisma.trip.findUnique({
    where: { id: tripId },
    select: { name: true, version: true, updatedAt: true, userId: true },
  });
}

/** Independent straight-line miles between two landmarks (PostGIS geography). */
async function milesBetween(a: string, b: string): Promise<number> {
  const [row] = await prisma.$queryRaw<{ miles: number }[]>`
    SELECT (ST_Distance(
      ST_SetSRID(ST_MakePoint(la.longitude, la.latitude), 4326)::geography,
      ST_SetSRID(ST_MakePoint(lb.longitude, lb.latitude), 4326)::geography
    ) / 1609.344)::float8 AS miles
    FROM landmarks la, landmarks lb
    WHERE la.id = ${a}::uuid AND lb.id = ${b}::uuid`;
  return row!.miles;
}

/** Text that must never appear in a response serialized for `user`. */
function expectNoIdentity(text: string, ...users: TestUser[]) {
  for (const user of users) {
    expect(text).not.toContain(user.userId);
    expect(text).not.toContain(user.email);
  }
  for (const forbidden of [
    "user_id",
    "userId",
    "share_token",
    "shareToken",
    FAKE_HASH.slice(0, 56),
    "restricted",
    "source",
    "email",
  ]) {
    expect(text).not.toContain(forbidden);
  }
}

/**
 * A test-only app wired like src/app.ts (Better Auth, JSON parser, the real
 * CSRF check, the real `mountProtected`), with a trips router built from
 * `routerDeps`.
 */
function fixtureApp(routerDeps: Parameters<typeof createTripsRouter>[0]): Express {
  const app = express();
  mountBetterAuth(app, auth);
  app.use(express.json());
  const api = Router();
  mountProtected(api, "/trips", createTripsRouter(routerDeps));
  app.use("/api/v1", requireTrustedOrigin, api);
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json(NOT_FOUND);
  });
  return app;
}

const NON_VISIBLE: [string, { status?: Status; active?: boolean }][] = [
  ["SENSITIVE", { status: "SENSITIVE" }],
  ["UNREVIEWED", { status: "UNREVIEWED" }],
  ["retired PUBLIC", { active: false }],
  ["retired SENSITIVE", { status: "SENSITIVE", active: false }],
];

describe("trips HTTP API (integration, M05-T03 Increment 4)", () => {
  const app = createApp();

  afterEach(async () => {
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  describe("create — POST /api/v1/trips", () => {
    it("201 { trip } with exactly the §7.2 owner representation of an empty trip; name trimmed; owned by the session user", async () => {
      const user = await createSignedInUser(app);
      const response = await asUser(app, user)
        .post(tripsPath)
        .send({ name: `  Weekend Waterfalls${TAB} ` });
      expect(response.status).toBe(201);
      expect(response.headers["content-type"]).toMatch(/^application\/json/);
      expectNoStore(response);
      expect(Object.keys(response.body)).toEqual(["trip"]);
      const trip = response.body.trip;
      expect(Object.keys(trip).sort()).toEqual(TRIP_KEYS);
      expect(trip).toEqual({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: "Weekend Waterfalls",
        version: 0,
        created_at: expect.stringMatching(ISO_UTC_MS),
        updated_at: trip.created_at,
        is_shared: false,
        sharing_enabled: true,
        stops: [],
        distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
      });
      expectNoIdentity(response.text, user);
      expect(await storedTrip(trip.id)).toMatchObject({
        name: "Weekend Waterfalls",
        version: 0,
        userId: user.userId,
      });
    });

    it("sharing_enabled reports the server setting (false when TRIP_SHARING_ENABLED is off)", async () => {
      const off = fixtureApp({ sharingEnabled: false });
      const user = await createSignedInUser(off);
      const created = await asUser(off, user).post(tripsPath).send({ name: "Off" });
      expect(created.status).toBe(201);
      expect(created.body.trip.sharing_enabled).toBe(false);
      const read = await asUser(off, user).get(tripPath(created.body.trip.id));
      expect(read.body.trip.sharing_enabled).toBe(false);
    });

    it.each([
      ["missing name", {}, MESSAGES.nameType],
      ["non-string name", { name: 5 }, MESSAGES.nameType],
      ["internal tab", { name: `Day 1${TAB}Falls` }, MESSAGES.nameCharacters],
      ["whitespace only", { name: "   " }, MESSAGES.nameNoVisible],
      ["101 code points", { name: "a".repeat(101) }, MESSAGES.nameTooLong],
      ["client identity field", { name: "A", user_id: UNKNOWN_ID }, MESSAGES.unsupportedFields],
      ["unknown field", { name: "A", stops: [] }, MESSAGES.unsupportedFields],
      ["array body", ["A"], MESSAGES.invalidBodyShape],
    ])("400 INVALID_REQUEST for %s; nothing created; input never echoed", async (_l, body, msg) => {
      const user = await createSignedInUser(app);
      const response = await asUser(app, user).post(tripsPath).send(body);
      expect(response.status).toBe(400);
      expect(response.body).toEqual(invalidRequest(msg));
      expectNoStore(response);
      expect(await prisma.trip.count()).toBe(0);
    });

    it("400 INVALID_QUERY for any query parameter (including an identity override); nothing created", async () => {
      const [a, b] = await createTwoUsers(app);
      const response = await asUser(app, b).post(`${tripsPath}?user_id=${a.userId}`).send({
        name: "Mine",
      });
      expect(response.status).toBe(400);
      expect(response.body).toEqual(invalidQuery(MESSAGES.noQuery));
      expect(response.text).not.toContain(a.userId);
      expect(await prisma.trip.count()).toBe(0);
    });
  });

  describe("list — GET /api/v1/trips", () => {
    async function insertTrip(userId: string, name: string, updatedAt: Date, shared = false) {
      const [row] = await prisma.$queryRaw<{ id: string }[]>`
        INSERT INTO trips (user_id, name, updated_at, created_at, share_token_hash)
        VALUES (${userId}::uuid, ${name}, ${updatedAt}, ${updatedAt}, ${shared ? `${FAKE_HASH.slice(0, 56)}${String(sequence++).padStart(8, "0")}` : null})
        RETURNING id::text AS id`;
      return row!.id;
    }

    it("empty state: 200 { trips: [], page: 1, limit: 20, has_more: false } with no-store", async () => {
      const user = await createSignedInUser(app);
      const response = await asUser(app, user).get(tripsPath);
      expect(response.status).toBe(200);
      expectNoStore(response);
      expect(response.body).toEqual({ trips: [], page: 1, limit: 20, has_more: false });
    });

    it("owner-scoped, ordered updated_at DESC then id DESC, exact item shape, stable pages with has_more", async () => {
      const [a, b] = await createTwoUsers(app);
      const base = Date.UTC(2026, 10, 1);
      const ids: string[] = [];
      for (let i = 0; i < 22; i += 1) {
        // Trips 0–2 share one timestamp, so the id DESC tie-break decides their order.
        const at = i < 3 ? new Date(base) : new Date(base + i * 60_000);
        ids.push(await insertTrip(a.userId, `A trip ${i}`, at, i === 5));
      }
      await insertTrip(b.userId, "B trip", new Date(base + 99 * 60_000));
      const landmarks = await createLandmarks(2);
      await fillDirectly(ids[21]!, landmarks);

      const expectedOrder = [...ids.slice(3).reverse(), ...ids.slice(0, 3).sort().reverse()];

      const first = await asUser(app, a).get(tripsPath);
      expect(first.status).toBe(200);
      expect(first.body).toMatchObject({ page: 1, limit: 20, has_more: true });
      expect(first.body.trips.map((t: { id: string }) => t.id)).toEqual(expectedOrder.slice(0, 20));
      for (const item of first.body.trips) expect(Object.keys(item).sort()).toEqual(LIST_ITEM_KEYS);
      expect(first.body.trips[0]).toEqual({
        id: ids[21],
        name: "A trip 21",
        stop_count: 2,
        updated_at: new Date(base + 21 * 60_000).toISOString(),
        is_shared: false,
      });
      const shared = first.body.trips.find((t: { id: string }) => t.id === ids[5]);
      expect(shared.is_shared).toBe(true);
      expectNoIdentity(first.text, a, b);
      expect(first.text).not.toContain("B trip");

      const second = await asUser(app, a).get(`${tripsPath}?page=2`);
      expect(second.body).toMatchObject({ page: 2, limit: 20, has_more: false });
      expect(second.body.trips.map((t: { id: string }) => t.id)).toEqual(expectedOrder.slice(20));

      const pages: string[] = [];
      for (let page = 1; page <= 5; page += 1) {
        const response = await asUser(app, a).get(`${tripsPath}?page=${page}&limit=5`);
        expect(response.body.has_more).toBe(page < 5);
        pages.push(...response.body.trips.map((t: { id: string }) => t.id));
      }
      expect(pages).toEqual(expectedOrder);

      const beyond = await asUser(app, a).get(`${tripsPath}?page=9&limit=100`);
      expect(beyond.body).toEqual({ trips: [], page: 9, limit: 100, has_more: false });

      const other = await asUser(app, b).get(tripsPath);
      expect(other.body.trips.map((t: { name: string }) => t.name)).toEqual(["B trip"]);
    });

    it.each([
      ["limit=101"],
      ["limit=0"],
      ["page=0"],
      ["page=-1"],
      ["page=1.5"],
      ["page=01"],
      ["page=1&page=2"],
      ["sort=name"],
      [`user_id=${UNKNOWN_ID}`],
    ])("400 INVALID_QUERY for %s", async (query) => {
      const user = await createSignedInUser(app);
      const response = await asUser(app, user).get(`${tripsPath}?${query}`);
      expect(response.status).toBe(400);
      expect(response.body).toEqual(invalidQuery(MESSAGES.listQuery));
      expectNoStore(response);
    });

    it("identity comes only from the session: query, body, and header identity overrides never list another user's trips", async () => {
      const [a, b] = await createTwoUsers(app);
      await createVia(app, a, "Only A");
      await createVia(app, b, "Only B");
      for (const param of ["user_id", "userId", "as", "owner", "owner_id", "uid"]) {
        const response = await asUser(app, b).get(`${tripsPath}?${param}=${a.userId}`);
        expect(response.status, param).toBe(400);
        expect(response.body).toEqual(invalidQuery(MESSAGES.listQuery));
        expect(response.text).not.toContain("Only A");
        expect(response.text).not.toContain(a.userId);
      }
      const withHeaders = await asUser(app, b)
        .get(tripsPath)
        .set("X-User-Id", a.userId)
        .set("X-Forwarded-User", a.email);
      expect(withHeaders.status).toBe(200);
      expect(withHeaders.body.trips.map((t: { name: string }) => t.name)).toEqual(["Only B"]);
      const withBody = await asUser(app, b).get(tripsPath).send({ user_id: a.userId });
      expect(withBody.body.trips.map((t: { name: string }) => t.name)).toEqual(["Only B"]);
    });

    it("400 INVALID_QUERY when the page offset is not a safe integer", async () => {
      const user = await createSignedInUser(app);
      const response = await asUser(app, user).get(`${tripsPath}?page=99999999999999999999`);
      expect(response.status).toBe(400);
      expect(response.body).toEqual(invalidQuery(MESSAGES.pageTooLarge));
    });
  });

  describe("detail — GET /api/v1/trips/:tripId", () => {
    it("200 { trip } with ordered stops, server-side redaction of unavailable landmarks, and straight-line distances", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user, "Mixed");
      const [l1, l2, l3, l4] = [
        await createLandmark({ latitude: 35.61, longitude: -83.52 }),
        await createLandmark({ latitude: 35.66, longitude: -83.45 }),
        await createLandmark({ latitude: 35.7, longitude: -83.4 }),
        await createLandmark({ latitude: 35.75, longitude: -83.35 }),
      ];
      const stopIds = [];
      for (const l of [l1!, l2!, l3!, l4!]) stopIds.push(await addVia(app, user, trip.id, l));
      await setLandmark(l3!, { status: "SENSITIVE" });
      await prisma.trip.update({ where: { id: trip.id }, data: { shareTokenHash: FAKE_HASH } });

      const response = await asUser(app, user).get(tripPath(trip.id));
      expect(response.status).toBe(200);
      expectNoStore(response);
      const body = response.body.trip;
      expect(Object.keys(response.body)).toEqual(["trip"]);
      expect(Object.keys(body).sort()).toEqual(TRIP_KEYS);
      expect(body).toMatchObject({ id: trip.id, name: "Mixed", version: 4, is_shared: true });
      expect(body.stops.map((s: { id: string }) => s.id)).toEqual(stopIds);
      expect(body.stops.map((s: { position: number }) => s.position)).toEqual([0, 1, 2, 3]);
      for (const stop of body.stops) expect(Object.keys(stop).sort()).toEqual(STOP_KEYS);

      const leg = await milesBetween(l1!, l2!);
      expect(body.stops[0]).toEqual({
        id: stopIds[0],
        position: 0,
        is_available: true,
        distance_from_previous_miles: null,
        landmark: {
          id: l1,
          display_name: expect.stringMatching(/^Trip Arch \d+$/),
          category: "arch",
          latitude: 35.61,
          longitude: -83.52,
        },
      });
      expect(Object.keys(body.stops[1].landmark).sort()).toEqual(LANDMARK_KEYS);
      expect(body.stops[1].distance_from_previous_miles).toBeCloseTo(leg, 9);
      expect(body.stops[2]).toEqual({
        id: stopIds[2],
        position: 2,
        is_available: false,
        distance_from_previous_miles: null,
        landmark: { id: l3, is_available: false },
      });
      expect(body.stops[3].is_available).toBe(true);
      expect(body.stops[3].distance_from_previous_miles).toBeNull();
      expect(body.distance_summary.measured_legs).toBe(1);
      expect(body.distance_summary.total_legs).toBe(3);
      expect(body.distance_summary.total_miles).toBeCloseTo(leg, 9);

      // The hidden landmark's coordinates and name are nowhere in the response.
      const hidden = await prisma.landmark.findUniqueOrThrow({ where: { id: l3! } });
      expect(response.text).not.toContain(`"latitude":35.7,`);
      expect(response.text).not.toContain(`"longitude":-83.4}`);
      expect(response.text).not.toContain(`"${hidden.displayName}"`);
      expectNoIdentity(response.text, user);
    });

    it("404 for another user's trip and for a missing trip — identical status, body, and headers", async () => {
      const [a, b] = await createTwoUsers(app);
      const trip = await createVia(app, a, "Private");
      const foreign = await asUser(app, b).get(tripPath(trip.id));
      const missing = await asUser(app, b).get(tripPath(UNKNOWN_ID));
      for (const response of [foreign, missing]) {
        expect(response.status).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
        expectNoStore(response);
      }
      expect(foreign.text).toBe(missing.text);
      expect(foreign.headers["content-length"]).toBe(missing.headers["content-length"]);
      expect(foreign.text).not.toContain("Private");
    });

    it("an upper-case trip ID is accepted; a malformed one is 400 INVALID_REQUEST; a query parameter is 400 INVALID_QUERY", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user);
      expect((await asUser(app, user).get(tripPath(trip.id.toUpperCase()))).status).toBe(200);
      const malformed = await asUser(app, user).get(tripPath("not-a-uuid"));
      expect(malformed.status).toBe(400);
      expect(malformed.body).toEqual(invalidRequest(MESSAGES.invalidTripId));
      expect(malformed.text).not.toContain("not-a-uuid");
      const query = await asUser(app, user).get(`${tripPath(trip.id)}?include=owner`);
      expect(query.status).toBe(400);
      expect(query.body).toEqual(invalidQuery(MESSAGES.noQuery));
    });
  });

  describe("rename — PATCH /api/v1/trips/:tripId", () => {
    it("200 { trip } with the new name and version + 1, with or without a current version", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user, "Old");
      const first = await asUser(app, user).patch(tripPath(trip.id)).send({ name: " New " });
      expect(first.status).toBe(200);
      expectNoStore(first);
      expect(Object.keys(first.body)).toEqual(["trip"]);
      expect(Object.keys(first.body.trip).sort()).toEqual(TRIP_KEYS);
      expect(first.body.trip).toMatchObject({ id: trip.id, name: "New", version: 1 });
      const second = await asUser(app, user)
        .patch(tripPath(trip.id))
        .send({ name: "Newer", version: 1 });
      expect(second.status).toBe(200);
      expect(second.body.trip).toMatchObject({ name: "Newer", version: 2 });
      expect(await storedTrip(trip.id)).toMatchObject({ name: "Newer", version: 2 });
    });

    it("409 TRIP_VERSION_CONFLICT for a stale version; nothing changes", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user, "Original");
      await asUser(app, user).patch(tripPath(trip.id)).send({ name: "Moved on" });
      const stale = await asUser(app, user)
        .patch(tripPath(trip.id))
        .send({ name: "Stale", version: 0 });
      expect(stale.status).toBe(409);
      expect(stale.body).toEqual(VERSION_CONFLICT);
      expectNoStore(stale);
      expect(stale.text).not.toContain(trip.id);
      expect(await storedTrip(trip.id)).toMatchObject({ name: "Moved on", version: 1 });
    });

    it("404 for another user's trip and a missing trip (identical); the owner's trip is unchanged", async () => {
      const [a, b] = await createTwoUsers(app);
      const trip = await createVia(app, a, "Mine");
      const foreign = await asUser(app, b).patch(tripPath(trip.id)).send({ name: "Taken" });
      const missing = await asUser(app, b).patch(tripPath(UNKNOWN_ID)).send({ name: "Taken" });
      expect(foreign.status).toBe(404);
      expect(foreign.text).toBe(missing.text);
      expect(missing.status).toBe(404);
      expect(await storedTrip(trip.id)).toMatchObject({ name: "Mine", version: 0 });
    });

    it.each([
      ["no name", { version: 0 }, MESSAGES.nameType],
      ["invalid name", { name: "a".repeat(101) }, MESSAGES.nameTooLong],
      ["negative version", { name: "A", version: -1 }, MESSAGES.invalidVersion],
      ["string version", { name: "A", version: "0" }, MESSAGES.invalidVersion],
      ["null version", { name: "A", version: null }, MESSAGES.invalidVersion],
      ["identity field", { name: "A", user_id: UNKNOWN_ID }, MESSAGES.unsupportedFields],
    ])(
      "400 INVALID_REQUEST for %s — even on a trip the user does not own",
      async (_l, body, msg) => {
        const [a, b] = await createTwoUsers(app);
        const trip = await createVia(app, a, "Mine");
        for (const actor of [a, b]) {
          const response = await asUser(app, actor).patch(tripPath(trip.id)).send(body);
          expect(response.status).toBe(400);
          expect(response.body).toEqual(invalidRequest(msg));
        }
        expect(await storedTrip(trip.id)).toMatchObject({ name: "Mine", version: 0 });
      },
    );
  });

  describe("delete — DELETE /api/v1/trips/:tripId", () => {
    it("204 with no body; the trip and its stops are gone, landmarks remain; a repeat is 404", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user);
      const landmarks = await createLandmarks(2);
      for (const l of landmarks) await addVia(app, user, trip.id, l);
      const response = await asUser(app, user).delete(tripPath(trip.id));
      expectNoContent(response);
      expect(await storedTrip(trip.id)).toBeNull();
      expect(await prisma.tripStop.count()).toBe(0);
      expect(await prisma.landmark.count({ where: { id: { in: landmarks } } })).toBe(2);
      const again = await asUser(app, user).delete(tripPath(trip.id));
      expect(again.status).toBe(404);
      expect(again.body).toEqual(NOT_FOUND);
      expect((await asUser(app, user).get(tripPath(trip.id))).status).toBe(404);
    });

    it("404 for another user's trip and a missing trip (identical); nothing deleted", async () => {
      const [a, b] = await createTwoUsers(app);
      const trip = await createVia(app, a);
      const foreign = await asUser(app, b).delete(tripPath(trip.id));
      const missing = await asUser(app, b).delete(tripPath(UNKNOWN_ID));
      expect(foreign.status).toBe(404);
      expect(foreign.text).toBe(missing.text);
      expect(await storedTrip(trip.id)).not.toBeNull();
    });

    it("400 INVALID_REQUEST for body fields; 400 INVALID_QUERY for query parameters; nothing deleted", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user);
      const body = await asUser(app, user).delete(tripPath(trip.id)).send({ confirm: true });
      expect(body.status).toBe(400);
      expect(body.body).toEqual(invalidRequest(MESSAGES.noBodyFields));
      const query = await asUser(app, user).delete(`${tripPath(trip.id)}?force=1`);
      expect(query.status).toBe(400);
      expect(query.body).toEqual(invalidQuery(MESSAGES.noQuery));
      expect(await storedTrip(trip.id)).not.toBeNull();
      expectNoContent(await asUser(app, user).delete(tripPath(trip.id)).send({}));
    });
  });

  describe("add stop — POST /api/v1/trips/:tripId/stops", () => {
    it("201 { stop } with exactly id, position, is_available, landmark — no distance; appended; version + 1", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user);
      const [l1, l2] = await createLandmarks(2);
      await addVia(app, user, trip.id, l1!);
      const response = await asUser(app, user)
        .post(stopsPath(trip.id))
        .send({ landmark_id: l2!.toUpperCase() });
      expect(response.status).toBe(201);
      expectNoStore(response);
      expect(Object.keys(response.body)).toEqual(["stop"]);
      expect(Object.keys(response.body.stop).sort()).toEqual(ADDED_STOP_KEYS);
      expect(response.body.stop).not.toHaveProperty("distance_from_previous_miles");
      expect(Object.keys(response.body.stop.landmark).sort()).toEqual(LANDMARK_KEYS);
      expect(response.body.stop).toMatchObject({
        position: 1,
        is_available: true,
        landmark: { id: l2, category: "arch" },
      });
      expectNoIdentity(response.text, user);
      expect((await storedStops(trip.id)).map((s) => s.landmarkId)).toEqual([l1, l2]);
      expect((await storedTrip(trip.id))!.version).toBe(2);
    });

    it("409 TRIP_STOP_ALREADY_EXISTS for a duplicate, without the existing stop's ID; nothing changes", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user);
      const landmark = await createLandmark();
      const stopId = await addVia(app, user, trip.id, landmark);
      const response = await asUser(app, user)
        .post(stopsPath(trip.id))
        .send({ landmark_id: landmark });
      expect(response.status).toBe(409);
      expect(response.body).toEqual(STOP_EXISTS);
      expectNoStore(response);
      expect(response.text).not.toContain(stopId);
      expect(response.text).not.toContain(landmark);
      expect(await storedStops(trip.id)).toHaveLength(1);
      expect((await storedTrip(trip.id))!.version).toBe(1);
    });

    it.each(NON_VISIBLE)(
      "404 for a %s landmark, identical to an unknown landmark; no landmark data; nothing changes",
      async (_l, state) => {
        const user = await createSignedInUser(app);
        const trip = await createVia(app, user);
        const hiddenId = await createLandmark(state);
        const hidden = await asUser(app, user)
          .post(stopsPath(trip.id))
          .send({ landmark_id: hiddenId });
        const unknown = await asUser(app, user)
          .post(stopsPath(trip.id))
          .send({ landmark_id: UNKNOWN_ID });
        for (const response of [hidden, unknown]) {
          expect(response.status).toBe(404);
          expect(response.body).toEqual(NOT_FOUND);
          expectNoStore(response);
        }
        expect(hidden.text).toBe(unknown.text);
        expect(hidden.text).not.toContain(hiddenId);
        expect(await storedStops(trip.id)).toHaveLength(0);
        expect((await storedTrip(trip.id))!.version).toBe(0);
      },
    );

    it("full trip (25 stops), amended precedence: unknown/unavailable → 404, already present → 409 EXISTS, new visible → 409 LIMIT; nothing changes", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user);
      const landmarks = await createLandmarks(25);
      await fillDirectly(trip.id, landmarks);
      const fresh = await createLandmark();
      const sensitive = await createLandmark({ status: "SENSITIVE" });
      const add = (landmarkId: string) =>
        asUser(app, user).post(stopsPath(trip.id)).send({ landmark_id: landmarkId });

      const limit = await add(fresh);
      expect(limit.status).toBe(409);
      expect(limit.body).toEqual(STOP_LIMIT);
      expectNoStore(limit);
      const existing = await add(landmarks[7]!);
      expect(existing.status).toBe(409);
      expect(existing.body).toEqual(STOP_EXISTS);
      for (const id of [UNKNOWN_ID, sensitive]) {
        const response = await add(id);
        expect(response.status).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
      }
      const stops = await storedStops(trip.id);
      expect(stops).toHaveLength(25);
      expect(stops.map((s) => s.position)).toEqual(Array.from({ length: 25 }, (_, i) => i));
      expect((await storedTrip(trip.id))!.version).toBe(0);

      // Removing one stop makes room for exactly one more.
      expectNoContent(await asUser(app, user).delete(stopPath(trip.id, stops[0]!.id)));
      expect((await add(fresh)).status).toBe(201);
      expect((await add(await createLandmark())).body).toEqual(STOP_LIMIT);
    });

    it("404 for another user's trip and a missing trip (identical); nothing added to either", async () => {
      const [a, b] = await createTwoUsers(app);
      const trip = await createVia(app, a);
      const landmark = await createLandmark();
      const foreign = await asUser(app, b).post(stopsPath(trip.id)).send({ landmark_id: landmark });
      const missing = await asUser(app, b)
        .post(stopsPath(UNKNOWN_ID))
        .send({ landmark_id: landmark });
      expect(foreign.status).toBe(404);
      expect(foreign.text).toBe(missing.text);
      expect(await prisma.tripStop.count()).toBe(0);
    });

    it("400s run before any lookup: malformed IDs, unknown fields (position, identity), and query parameters", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user);
      const landmark = await createLandmark();
      const cases: [string, string, unknown, ReturnType<typeof invalidRequest>][] = [
        [stopsPath(trip.id), "", { landmark_id: "x" }, invalidRequest(MESSAGES.invalidLandmarkId)],
        [stopsPath(trip.id), "", {}, invalidRequest(MESSAGES.invalidLandmarkId)],
        [
          stopsPath(trip.id),
          "",
          { landmark_id: landmark, position: 0 },
          invalidRequest(MESSAGES.unsupportedFields),
        ],
        [
          stopsPath(trip.id),
          "",
          { landmark_id: landmark, user_id: user.userId },
          invalidRequest(MESSAGES.unsupportedFields),
        ],
        // A malformed body on a trip that does not exist is still 400, not 404.
        [
          stopsPath(UNKNOWN_ID),
          "",
          { landmark_id: "x" },
          invalidRequest(MESSAGES.invalidLandmarkId),
        ],
        [stopsPath("bad"), "", { landmark_id: landmark }, invalidRequest(MESSAGES.invalidTripId)],
        [
          stopsPath(trip.id),
          "?position=0",
          { landmark_id: landmark },
          invalidQuery(MESSAGES.noQuery),
        ],
      ];
      for (const [path, query, body, expected] of cases) {
        const response = await asUser(app, user)
          .post(path + query)
          .send(body as object);
        expect(response.status, `${path}${query}`).toBe(400);
        expect(response.body).toEqual(expected);
        expect(response.text).not.toContain(user.userId);
      }
      expect(await prisma.tripStop.count()).toBe(0);
    });
  });

  describe("remove stop — DELETE /api/v1/trips/:tripId/stops/:stopId", () => {
    it("204 with no body; later positions close up; version + 1; a repeat is 404", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user);
      const landmarks = await createLandmarks(3);
      const stops = [];
      for (const l of landmarks) stops.push(await addVia(app, user, trip.id, l));
      const response = await asUser(app, user).delete(stopPath(trip.id, stops[1]!));
      expectNoContent(response);
      expect(await storedStops(trip.id)).toEqual([
        { id: stops[0], landmarkId: landmarks[0], position: 0 },
        { id: stops[2], landmarkId: landmarks[2], position: 1 },
      ]);
      expect((await storedTrip(trip.id))!.version).toBe(4);
      const again = await asUser(app, user).delete(stopPath(trip.id, stops[1]!));
      expect(again.status).toBe(404);
      expect(again.body).toEqual(NOT_FOUND);
      expect((await storedTrip(trip.id))!.version).toBe(4);
    });

    it("an unavailable stop can be removed", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user);
      const landmark = await createLandmark();
      const stop = await addVia(app, user, trip.id, landmark);
      await setLandmark(landmark, { active: false, status: "SENSITIVE" });
      expectNoContent(await asUser(app, user).delete(stopPath(trip.id, stop)));
      expect(await storedStops(trip.id)).toEqual([]);
    });

    it("404 (identical) for a stop in another user's trip, a stop of another trip under the wrong trip ID, and a missing stop; nothing changes", async () => {
      const [a, b] = await createTwoUsers(app);
      const tripA = await createVia(app, a, "A");
      const tripA2 = await createVia(app, a, "A2");
      const tripB = await createVia(app, b, "B");
      const landmark = await createLandmark();
      const stopA = await addVia(app, a, tripA.id, landmark);
      const stopB = await addVia(app, b, tripB.id, landmark);
      const responses = [
        await asUser(app, b).delete(stopPath(tripA.id, stopA)),
        await asUser(app, b).delete(stopPath(tripB.id, stopA)),
        await asUser(app, a).delete(stopPath(tripA.id, stopB)),
        await asUser(app, a).delete(stopPath(tripA2.id, stopA)),
        await asUser(app, a).delete(stopPath(tripA.id, UNKNOWN_ID)),
        await asUser(app, a).delete(stopPath(UNKNOWN_ID, stopA)),
      ];
      for (const response of responses) {
        expect(response.status).toBe(404);
        expect(response.text).toBe(JSON.stringify(NOT_FOUND));
        expectNoStore(response);
      }
      expect(await prisma.tripStop.count()).toBe(2);
      expect((await storedTrip(tripA.id))!.version).toBe(1);
      expect((await storedTrip(tripB.id))!.version).toBe(1);
    });

    it("400s: malformed stop ID (INVALID_REQUEST), body fields (INVALID_REQUEST), query parameters (INVALID_QUERY)", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user);
      const stop = await addVia(app, user, trip.id, await createLandmark());
      const malformed = await asUser(app, user).delete(stopPath(trip.id, "nope"));
      expect(malformed.status).toBe(400);
      expect(malformed.body).toEqual(invalidRequest(MESSAGES.invalidStopId));
      const body = await asUser(app, user).delete(stopPath(trip.id, stop)).send({ position: 0 });
      expect(body.status).toBe(400);
      expect(body.body).toEqual(invalidRequest(MESSAGES.noBodyFields));
      const query = await asUser(app, user).delete(`${stopPath(trip.id, stop)}?x=1`);
      expect(query.status).toBe(400);
      expect(query.body).toEqual(invalidQuery(MESSAGES.noQuery));
      expect(await storedStops(trip.id)).toHaveLength(1);
    });
  });

  describe("reorder — PUT /api/v1/trips/:tripId/stops/order", () => {
    async function tripWithStops(user: TestUser, n = 3) {
      const trip = await createVia(app, user);
      const landmarks = await createLandmarks(n);
      const stops = [];
      for (const l of landmarks) stops.push(await addVia(app, user, trip.id, l));
      return { tripId: trip.id, landmarks, stops, version: n };
    }

    it("200 { trip } in exactly the requested order, version + 1, distances recalculated", async () => {
      const user = await createSignedInUser(app);
      const { tripId, landmarks, stops, version } = await tripWithStops(user);
      const order = [stops[2]!, stops[0]!, stops[1]!];
      const response = await asUser(app, user)
        .put(orderPath(tripId))
        .send({ stop_ids: order.map((id) => id.toUpperCase()), version });
      expect(response.status).toBe(200);
      expectNoStore(response);
      expect(Object.keys(response.body)).toEqual(["trip"]);
      expect(Object.keys(response.body.trip).sort()).toEqual(TRIP_KEYS);
      expect(response.body.trip.version).toBe(version + 1);
      expect(response.body.trip.stops.map((s: { id: string }) => s.id)).toEqual(order);
      expect(response.body.trip.stops.map((s: { position: number }) => s.position)).toEqual([
        0, 1, 2,
      ]);
      expect(response.body.trip.stops[1].distance_from_previous_miles).toBeCloseTo(
        await milesBetween(landmarks[2]!, landmarks[0]!),
        9,
      );
      expect((await storedStops(tripId)).map((s) => s.id)).toEqual(order);
    });

    it("409 TRIP_VERSION_CONFLICT for a stale version (checked before the ID set); order unchanged", async () => {
      const user = await createSignedInUser(app);
      const { tripId, stops, version } = await tripWithStops(user);
      const reversed = [...stops].reverse();
      for (const body of [
        { stop_ids: reversed, version: version - 1 },
        { stop_ids: [UNKNOWN_ID], version: version - 1 },
      ]) {
        const response = await asUser(app, user).put(orderPath(tripId)).send(body);
        expect(response.status).toBe(409);
        expect(response.body).toEqual(VERSION_CONFLICT);
        expectNoStore(response);
      }
      expect((await storedStops(tripId)).map((s) => s.id)).toEqual(stops);
      expect((await storedTrip(tripId))!.version).toBe(version);
    });

    it("a reorder prepared before an add or a remove is rejected with 409 and does not undo it", async () => {
      const user = await createSignedInUser(app);
      const { tripId, stops, version } = await tripWithStops(user, 2);
      const extra = await addVia(app, user, tripId, await createLandmark());
      const afterAdd = await asUser(app, user)
        .put(orderPath(tripId))
        .send({ stop_ids: [stops[1], stops[0]], version });
      expect(afterAdd.status).toBe(409);
      expect(afterAdd.body).toEqual(VERSION_CONFLICT);
      expectNoContent(await asUser(app, user).delete(stopPath(tripId, stops[0]!)));
      const afterRemove = await asUser(app, user)
        .put(orderPath(tripId))
        .send({ stop_ids: [extra, stops[1], stops[0]], version: version + 1 });
      expect(afterRemove.status).toBe(409);
      expect((await storedStops(tripId)).map((s) => s.id)).toEqual([stops[1], extra]);
    });

    it("400 INVALID_REQUEST (fixed message) when the list is not exactly the trip's stops — missing, unknown, or another trip's; order unchanged", async () => {
      const [a, b] = await createTwoUsers(app);
      const { tripId, stops, version } = await tripWithStops(a);
      const other = await tripWithStops(b, 1);
      for (const stopIds of [
        [stops[0], stops[1]],
        [stops[0], stops[1], UNKNOWN_ID],
        [stops[0], stops[1], other.stops[0]],
        [stops[0], stops[1], stops[2], UNKNOWN_ID],
      ]) {
        const response = await asUser(app, a)
          .put(orderPath(tripId))
          .send({ stop_ids: stopIds, version });
        expect(response.status).toBe(400);
        expect(response.body).toEqual(invalidRequest(MESSAGES.invalidStopIds));
        expect(response.text).not.toContain(other.stops[0]!);
        expectNoStore(response);
      }
      expect((await storedStops(tripId)).map((s) => s.id)).toEqual(stops);
      expect((await storedTrip(tripId))!.version).toBe(version);
    });

    it("400s before any lookup: duplicates, empty or oversized lists, missing or invalid version, unknown fields, query parameters", async () => {
      const user = await createSignedInUser(app);
      const { tripId, stops, version } = await tripWithStops(user, 2);
      const many = Array.from(
        { length: 26 },
        (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      );
      const cases: [unknown, string, ReturnType<typeof invalidRequest>][] = [
        [{ stop_ids: [stops[0], stops[0]], version }, "", invalidRequest(MESSAGES.invalidStopIds)],
        [
          { stop_ids: [stops[0], stops[0]!.toUpperCase()], version },
          "",
          invalidRequest(MESSAGES.invalidStopIds),
        ],
        [{ stop_ids: [], version }, "", invalidRequest(MESSAGES.invalidStopIds)],
        [{ stop_ids: many, version }, "", invalidRequest(MESSAGES.invalidStopIds)],
        [{ stop_ids: ["x"], version }, "", invalidRequest(MESSAGES.invalidStopIds)],
        [{ stop_ids: stops }, "", invalidRequest(MESSAGES.invalidVersion)],
        [{ stop_ids: stops, version: "2" }, "", invalidRequest(MESSAGES.invalidVersion)],
        [
          { stop_ids: stops, version, positions: [0, 1] },
          "",
          invalidRequest(MESSAGES.unsupportedFields),
        ],
        [{ stop_ids: stops, version }, "?version=2", invalidQuery(MESSAGES.noQuery)],
      ];
      for (const [body, query, expected] of cases) {
        // The same 400 on a trip that does not exist: validation never depends on existence.
        for (const id of [tripId, UNKNOWN_ID]) {
          const response = await asUser(app, user)
            .put(orderPath(id) + query)
            .send(body as object);
          expect(response.status).toBe(400);
          expect(response.body).toEqual(expected);
        }
      }
      expect((await storedStops(tripId)).map((s) => s.id)).toEqual(stops);
      expect((await storedTrip(tripId))!.version).toBe(version);
    });

    it("404 for another user's trip and a missing trip (identical), even with that trip's own stop IDs and version", async () => {
      const [a, b] = await createTwoUsers(app);
      const { tripId, stops, version } = await tripWithStops(a, 2);
      const foreign = await asUser(app, b)
        .put(orderPath(tripId))
        .send({ stop_ids: [stops[1], stops[0]], version });
      const missing = await asUser(app, b)
        .put(orderPath(UNKNOWN_ID))
        .send({ stop_ids: [stops[1], stops[0]], version });
      expect(foreign.status).toBe(404);
      expect(foreign.text).toBe(missing.text);
      expect((await storedStops(tripId)).map((s) => s.id)).toEqual(stops);
    });
  });

  describe("authentication, CSRF, and middleware order", () => {
    /** Every endpoint, against a real trip/stop of `owner`, with a VALID body. */
    function everyEndpoint(tripId: string, stopId: string, landmarkId: string) {
      return [
        (r: ReturnType<typeof anonymous>) => r.get(tripsPath),
        (r: ReturnType<typeof anonymous>) => r.post(tripsPath).send({ name: "X" }),
        (r: ReturnType<typeof anonymous>) => r.get(tripPath(tripId)),
        (r: ReturnType<typeof anonymous>) => r.patch(tripPath(tripId)).send({ name: "X" }),
        (r: ReturnType<typeof anonymous>) => r.delete(tripPath(tripId)),
        (r: ReturnType<typeof anonymous>) =>
          r.post(stopsPath(tripId)).send({ landmark_id: landmarkId }),
        (r: ReturnType<typeof anonymous>) => r.delete(stopPath(tripId, stopId)),
        (r: ReturnType<typeof anonymous>) =>
          r.put(orderPath(tripId)).send({ stop_ids: [stopId], version: 1 }),
      ];
    }

    async function ownedFixture() {
      const owner = await createSignedInUser(app, "owner");
      const trip = await createVia(app, owner, "Owned");
      const stop = await addVia(app, owner, trip.id, await createLandmark());
      return { owner, tripId: trip.id, stopId: stop, landmarkId: await createLandmark() };
    }

    async function expectUnchanged(tripId: string) {
      expect(await storedTrip(tripId)).toMatchObject({ name: "Owned", version: 1 });
      expect(await prisma.trip.count()).toBe(1);
      expect(await prisma.tripStop.count()).toBe(1);
    }

    it("missing, forged, malformed, expired, and signed-out sessions get the identical 401 (no-store) on all eight endpoints; nothing changes", async () => {
      const { tripId, stopId, landmarkId } = await ownedFixture();
      const revoked = await createSignedInUser(app, "revoked");
      await signOut(app, revoked);
      const expired = await createSignedInUser(app, "expired");
      await prisma.session.updateMany({
        where: { userId: expired.userId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      const variants = [
        undefined,
        forgedCookie(),
        "better-auth.session_token=%%%not-a-token",
        expired.cookie,
        revoked.cookie,
      ];
      let count = 0;
      for (const cookie of variants) {
        for (const endpoint of everyEndpoint(tripId, stopId, landmarkId)) {
          const builder = anonymous(app);
          const wrapped = {
            get: (p: string) => (cookie ? builder.get(p).set("Cookie", cookie) : builder.get(p)),
            post: (p: string) => (cookie ? builder.post(p).set("Cookie", cookie) : builder.post(p)),
            put: (p: string) => (cookie ? builder.put(p).set("Cookie", cookie) : builder.put(p)),
            patch: (p: string) =>
              cookie ? builder.patch(p).set("Cookie", cookie) : builder.patch(p),
            delete: (p: string) =>
              cookie ? builder.delete(p).set("Cookie", cookie) : builder.delete(p),
          };
          const response = await endpoint(wrapped);
          expect(response.status).toBe(401);
          expect(response.text).toBe(JSON.stringify(UNAUTHENTICATED));
          expectNoStore(response);
          count += 1;
        }
      }
      expect(count).toBe(40);
      await expectUnchanged(tripId);
    });

    it("an invalid request without a session is still 401: the session check precedes validation", async () => {
      for (const response of [
        await anonymous(app).post(tripsPath).send({ name: 5 }),
        await anonymous(app).get(tripPath("not-a-uuid")),
        await anonymous(app).get(`${tripsPath}?limit=500`),
        await anonymous(app).put(orderPath("x")).send({}),
      ]) {
        expect(response.status).toBe(401);
        expect(response.body).toEqual(UNAUTHENTICATED);
      }
    });

    it("403 INVALID_ORIGIN (no-store) for cookie-bearing writes with a missing or foreign Origin — before the session check; nothing changes", async () => {
      const { owner, tripId, stopId, landmarkId } = await ownedFixture();
      const writes = everyEndpoint(tripId, stopId, landmarkId).filter(
        (_, i) => ![0, 2].includes(i),
      );
      for (const origin of [undefined, "https://evil.example", "null"]) {
        for (const endpoint of writes) {
          const make = (method: "get" | "post" | "put" | "patch" | "delete") => (p: string) => {
            const r = request(app)[method](p).set("Cookie", owner.cookie);
            return origin ? r.set("Origin", origin) : r;
          };
          const response = await endpoint({
            get: make("get"),
            post: make("post"),
            put: make("put"),
            patch: make("patch"),
            delete: make("delete"),
          });
          expect(response.status).toBe(403);
          expect(response.body).toEqual(INVALID_ORIGIN);
          expectNoStore(response);
        }
      }
      // Origin precedes the session check: a cross-origin write with a bogus cookie is 403, not 401.
      const crossOrigin = await request(app)
        .post(tripsPath)
        .set("Origin", "https://evil.example")
        .set("Cookie", "better-auth.session_token=x")
        .send({ name: "X" });
      expect(crossOrigin.status).toBe(403);
      // Reads are not origin-checked; a same-site GET still works.
      expect((await asUser(app, owner).get(tripPath(tripId))).status).toBe(200);
      await expectUnchanged(tripId);
    });

    it("unsupported methods and paths under /api/v1/trips are denied: 401 anonymously, 404 when signed in; an unknown share token is the generic 404", async () => {
      const user = await createSignedInUser(app);
      const trip = await createVia(app, user);
      for (const [method, path] of [
        ["put", tripsPath],
        ["delete", tripsPath],
        ["post", tripPath(trip.id)],
        ["put", tripPath(trip.id)],
        ["get", stopsPath(trip.id)],
        ["delete", stopsPath(trip.id)],
        ["get", orderPath(trip.id)],
        ["post", orderPath(trip.id)],
        ["patch", stopPath(trip.id, UNKNOWN_ID)],
        ["get", `${tripPath(trip.id)}/share`],
        ["put", `${tripPath(trip.id)}/share`],
      ] as const) {
        const signedIn = await asUser(app, user)[method](path).send({});
        expect(signedIn.status, `${method} ${path}`).toBe(404);
        expect(signedIn.body).toEqual(NOT_FOUND);
        const anon = await anonymous(app)[method](path).send({});
        expect(anon.status, `${method} ${path}`).toBe(401);
      }
      const shared = await anonymous(app).get(`/api/v1/shared/trips/${"A".repeat(43)}`);
      expect(shared.status).toBe(404);
      expect(shared.body).toEqual(NOT_FOUND);
      expect((await storedTrip(trip.id))!.version).toBe(0);
    });
  });

  describe("fixed server errors", () => {
    it("an unexpected service failure is the fixed 500 INTERNAL_ERROR with no-store and no detail, on reads and writes", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const fail = async () => {
        throw new Error(`secret internal detail ${UNKNOWN_ID} SELECT * FROM trips`);
      };
      const failing = {
        listTrips: fail,
        createTrip: fail,
        getTrip: fail,
        renameTrip: fail,
        deleteTrip: fail,
        addTripStop: fail,
        removeTripStop: fail,
        reorderTripStops: fail,
      };
      const broken = fixtureApp({ service: failing as never });
      const user = await createSignedInUser(broken);
      for (const response of [
        await asUser(broken, user).get(tripsPath),
        await asUser(broken, user).post(tripsPath).send({ name: "X" }),
        await asUser(broken, user).get(tripPath(UNKNOWN_ID)),
        await asUser(broken, user).delete(stopPath(UNKNOWN_ID, UNKNOWN_ID)),
        await asUser(broken, user)
          .put(orderPath(UNKNOWN_ID))
          .send({ stop_ids: [UNKNOWN_ID], version: 0 }),
      ]) {
        expect(response.status).toBe(500);
        expect(response.body).toEqual(INTERNAL_ERROR);
        expectNoStore(response);
        expect(response.text).not.toContain("secret");
        expect(response.text).not.toContain(UNKNOWN_ID);
        expect(response.text).not.toContain("SELECT");
      }
    });
  });

  describe("throttling (fresh limiter at the approved limits, injected clock)", () => {
    function throttledApp() {
      let t = 1_000_000;
      const log = vi.fn();
      const limiter = createTripsRateLimiter({ now: () => t, log });
      return {
        app: fixtureApp({ limiter }),
        advance: (ms: number) => {
          t += ms;
        },
      };
    }

    it("60 mutations (every mutation route, valid and invalid) are allowed; the 61st is 429 with Retry-After, before validation", async () => {
      const { app: limited, advance } = throttledApp();
      const user = await createSignedInUser(limited);
      const trip = await createVia(limited, user); // 1
      const landmarks = await createLandmarks(10);
      const stops: string[] = [];
      for (const l of landmarks) stops.push(await addVia(limited, user, trip.id, l)); // 11
      for (let i = 0; i < 10; i += 1) {
        const r = await asUser(limited, user)
          .patch(tripPath(trip.id))
          .send({ name: `Rename ${i}` });
        expect(r.status).toBe(200); // 21
      }
      for (let i = 0; i < 10; i += 1) {
        const r = await asUser(limited, user).post(tripsPath).send({ name: 5 });
        expect(r.status).toBe(400); // 31 — invalid requests count too
      }
      for (let i = 0; i < 10; i += 1) {
        const r = await asUser(limited, user).delete(stopPath(trip.id, UNKNOWN_ID));
        expect(r.status).toBe(404); // 41
      }
      for (let i = 0; i < 9; i += 1) {
        const r = await asUser(limited, user)
          .put(orderPath(trip.id))
          .send({ stop_ids: stops, version: 0 });
        expect(r.status).toBe(409); // 50
      }
      for (let i = 0; i < 9; i += 1) {
        const r = await asUser(limited, user).delete(tripPath(UNKNOWN_ID));
        expect(r.status).toBe(404); // 59
      }
      expectNoContent(await asUser(limited, user).delete(stopPath(trip.id, stops[9]!))); // 60

      advance(15_000);
      for (const attempt of [
        () => asUser(limited, user).post(tripsPath).send({ name: 5 }),
        () => asUser(limited, user).patch(tripPath(trip.id)).send({ name: "Blocked" }),
        () => asUser(limited, user).delete(tripPath(trip.id)),
        () => asUser(limited, user).post(stopsPath(trip.id)).send({ landmark_id: "bad" }),
        () => asUser(limited, user).delete(stopPath(trip.id, stops[0]!)),
        () => asUser(limited, user).put(orderPath(trip.id)).send({}),
      ]) {
        const response = await attempt();
        expect(response.status).toBe(429);
        expect(response.body).toEqual(RATE_LIMITED);
        expect(response.headers["retry-after"]).toBe("45");
        expectNoStore(response);
      }
      expect(await storedTrip(trip.id)).toMatchObject({ name: "Rename 9" });
      expect(await storedStops(trip.id)).toHaveLength(9);

      // Reads use the independent read bucket.
      expect((await asUser(limited, user).get(tripPath(trip.id))).status).toBe(200);

      // After the window, mutations are allowed again.
      advance(45_000);
      const renamed = await asUser(limited, user).patch(tripPath(trip.id)).send({ name: "Again" });
      expect(renamed.status).toBe(200);
    });

    it("120 reads (list and detail) are allowed; the 121st is 429 with Retry-After; mutations are unaffected", async () => {
      const { app: limited } = throttledApp();
      const user = await createSignedInUser(limited);
      const trip = await createVia(limited, user);
      for (let i = 0; i < 60; i += 1) {
        expect((await asUser(limited, user).get(tripsPath)).status).toBe(200);
        expect((await asUser(limited, user).get(tripPath(trip.id))).status).toBe(200);
      }
      const blocked = await asUser(limited, user).get(`${tripsPath}?limit=999`); // invalid, but throttled first
      expect(blocked.status).toBe(429);
      expect(blocked.body).toEqual(RATE_LIMITED);
      expect(blocked.headers["retry-after"]).toBe("60");
      expectNoStore(blocked);
      expect((await asUser(limited, user).get(tripPath(UNKNOWN_ID))).status).toBe(429);
      expect((await asUser(limited, user).post(tripsPath).send({ name: "Still" })).status).toBe(
        201,
      );
    });

    it("counters are per user: another user is unaffected when one is throttled", async () => {
      const { app: limited } = throttledApp();
      const [a, b] = await createTwoUsers(limited);
      for (let i = 0; i < 60; i += 1) await asUser(limited, a).delete(tripPath(UNKNOWN_ID));
      expect((await asUser(limited, a).delete(tripPath(UNKNOWN_ID))).status).toBe(429);
      expect((await asUser(limited, b).delete(tripPath(UNKNOWN_ID))).status).toBe(404);
    });
  });

  describe("limiter independence on the real application", () => {
    it("exhausting the trips mutation limit leaves trip reads, favorites, and reviews unaffected", async () => {
      const user = await createSignedInUser(app);
      const landmark = await createLandmark();
      for (let i = 0; i < 60; i += 1) {
        expect((await asUser(app, user).delete(tripPath(UNKNOWN_ID))).status).toBe(404);
      }
      const throttled = await asUser(app, user).post(tripsPath).send({ name: "Blocked" });
      expect(throttled.status).toBe(429);
      expect(throttled.body).toEqual(RATE_LIMITED);
      expect(Number(throttled.headers["retry-after"])).toBeGreaterThan(0);
      expect(await prisma.trip.count()).toBe(0);

      expect((await asUser(app, user).get(tripsPath)).status).toBe(200);
      expect((await asUser(app, user).put(`/api/v1/favorites/${landmark}`).send({})).status).toBe(
        201,
      );
      expect(
        (await asUser(app, user).post("/api/v1/reviews").send({ landmark_id: landmark, rating: 4 }))
          .status,
      ).toBe(201);
    });
  });

  describe("request origin of TEST_ORIGIN is the trusted origin used throughout", () => {
    it("a same-origin write succeeds (sanity check for the CSRF tests above)", async () => {
      const user = await createSignedInUser(app);
      const response = await request(app)
        .post(tripsPath)
        .set("Origin", TEST_ORIGIN)
        .set("Cookie", user.cookie)
        .send({ name: "Same origin" });
      expect(response.status).toBe(201);
    });
  });
});
