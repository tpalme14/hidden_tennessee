import { createHash, createHmac } from "node:crypto";
import express, { Router, type Express, type Request, type Response } from "express";
import { Client } from "pg";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createApp } from "../src/app.js";
import { auth } from "../src/auth/auth.js";
import { mountBetterAuth } from "../src/auth/mount.js";
import { mountProtected } from "../src/auth/mount-protected.js";
import { requireTrustedOrigin } from "../src/auth/require-trusted-origin.js";
import { env } from "../src/config/env.js";
import { prisma } from "../src/db/prisma.js";
import { MESSAGES } from "../src/trips/request-schema.js";
import { createTripsRateLimiter } from "../src/trips/rate-limit.js";
import { createTripsRouter } from "../src/trips/router.js";
import { enableTripSharing, revokeTripSharing } from "../src/trips/service.js";
import { createSharedTripsRouter } from "../src/trips/shared-router.js";
import {
  anonymous,
  asUser,
  createSignedInUser,
  createTwoUsers,
  signOut,
  type TestUser,
} from "./helpers/test-users.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";
import {
  assertConnectedToTestDatabase,
  getVerifiedTestDatabaseUrl,
} from "./setup/test-db-guard.js";

/**
 * Lets one test force the next generated token (to provoke a hash collision,
 * T3-7); every other call uses the real `crypto.randomBytes(32)` generator.
 */
const tokenControl = vi.hoisted(() => ({ next: null as string | null }));
vi.mock("../src/trips/share-token.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/trips/share-token.js")>();
  return {
    ...actual,
    generateShareToken: () => {
      const forced = tokenControl.next;
      tokenControl.next = null;
      return forced ?? actual.generateShareToken();
    },
  };
});

/**
 * M05-T03 Increment 5 — owner sharing (POST/DELETE /api/v1/trips/:tripId/share)
 * and the public read-only shared trip (GET /api/v1/shared/trips/:shareToken)
 * over real HTTP, real sessions, and landmarks_test (spec v1.1 §§4, 5.4, 6.4,
 * 7, 7.1–7.3, 9 #18–#21, #24, #28–#29, 10.3, 10.6; ADR-014 decision 10;
 * decisions T3-1, T3-2 revised, T3-4 revised, T3-7).
 *
 * The real `createApp()` runs with TRIP_SHARING_ENABLED on (the default
 * outside production). The disabled gate is tested on test-only apps that
 * mount the REAL routers with `sharingEnabled: false`. Every test ends with
 * the guarded resetTestDatabase().
 */

const NO_STORE = "private, no-store";
const NOT_FOUND = { error: { code: "NOT_FOUND", message: "Resource not found." } };
const UNAUTHENTICATED = { error: { code: "UNAUTHENTICATED", message: "Authentication required." } };
const INVALID_ORIGIN = {
  error: { code: "INVALID_ORIGIN", message: "Request origin not allowed." },
};
const INTERNAL_ERROR = {
  error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
};
const RATE_LIMITED = {
  error: { code: "RATE_LIMITED", message: "Too many requests. Please try again later." },
};
const SHARING_UNAVAILABLE = {
  error: { code: "TRIP_SHARING_UNAVAILABLE", message: "Trip sharing is not available." },
};
const VERSION_CONFLICT = {
  error: {
    code: "TRIP_VERSION_CONFLICT",
    message: "This trip has changed. Reload it and try again.",
  },
};
const UNKNOWN_ID = "00000000-0000-4000-8000-000000000000";
const PUBLIC_ORIGIN = new URL(env.auth.baseUrl).origin;
const SHARE_URL = new RegExp(
  `^${PUBLIC_ORIGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/shared/trips/([A-Za-z0-9_-]{43})$`,
);
const STOP_KEYS = ["distance_from_previous_miles", "id", "is_available", "landmark", "position"];
const LANDMARK_KEYS = ["category", "display_name", "id", "latitude", "longitude"];

const invalidRequest = (message: string) => ({ error: { code: "INVALID_REQUEST", message } });
const invalidQuery = (message: string) => ({ error: { code: "INVALID_QUERY", message } });
const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

type Status = "UNREVIEWED" | "PUBLIC" | "SENSITIVE";
let sequence = 0;

async function createLandmark(
  options: { status?: Status; active?: boolean; latitude?: number; longitude?: number } = {},
): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `TSH${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNARCHES",
      category: "ARCH",
      displayName: `Shared Arch ${sequence}`,
      latitude: options.latitude ?? 35.2 + (sequence % 40) / 100,
      longitude: options.longitude ?? -84.8 + (sequence % 40) / 100,
      sourceDescription: "restricted description",
      sourceAccessLabel: "restricted access",
      sourceUrl: "https://example.com/restricted",
      sensitivityStatus: options.status ?? "PUBLIC",
      isActive: options.active ?? true,
    },
  });
  return landmark.id;
}

const tripsPath = "/api/v1/trips";
const tripPath = (tripId: string) => `/api/v1/trips/${tripId}`;
const sharePath = (tripId: string) => `/api/v1/trips/${tripId}/share`;
const stopsPath = (tripId: string) => `/api/v1/trips/${tripId}/stops`;
const orderPath = (tripId: string) => `/api/v1/trips/${tripId}/stops/order`;
const sharedPath = (token: string) => `/api/v1/shared/trips/${token}`;

function expectNoStore(response: request.Response) {
  expect(response.headers["cache-control"]).toBe(NO_STORE);
}

/** The public route's headers: no-store, noindex, and never a cookie. */
function expectPublicHeaders(response: request.Response) {
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers["x-robots-tag"]).toBe("noindex, nofollow");
  expect(response.headers["set-cookie"]).toBeUndefined();
}

function expectNoContent(response: request.Response) {
  expect(response.status).toBe(204);
  expect(response.text).toBe("");
  expect(response.headers["content-type"]).toBeUndefined();
  expectNoStore(response);
}

function forgedCookie(): string {
  const value = "ForgedTokenNotInTheDatabase0000";
  const signature = createHmac("sha256", process.env.BETTER_AUTH_SECRET!)
    .update(value)
    .digest("base64");
  return `better-auth.session_token=${encodeURIComponent(`${value}.${signature}`)}`;
}

async function createTripVia(app: Express, user: TestUser, name = "Shared Waterfalls") {
  const response = await asUser(app, user).post(tripsPath).send({ name });
  expect(response.status).toBe(201);
  return response.body.trip.id as string;
}

async function addVia(app: Express, user: TestUser, tripId: string, landmarkId: string) {
  const response = await asUser(app, user)
    .post(stopsPath(tripId))
    .send({ landmark_id: landmarkId });
  expect(response.status).toBe(201);
  return response.body.stop.id as string;
}

/** Enables sharing through the API; returns the raw token taken from `share_url`. */
async function enableVia(app: Express, user: TestUser, tripId: string): Promise<string> {
  const response = await asUser(app, user).post(sharePath(tripId)).send();
  expect(response.status).toBe(200);
  const match = SHARE_URL.exec(response.body.share_url);
  expect(match).not.toBeNull();
  return match![1]!;
}

async function storedTrip(tripId: string) {
  return prisma.trip.findUnique({
    where: { id: tripId },
    select: { version: true, shareTokenHash: true, updatedAt: true, name: true },
  });
}

/**
 * A test-only app wired like src/app.ts — Better Auth, JSON parser, the real
 * CSRF check, the REAL routers — with the sharing setting and other
 * dependencies chosen by the test.
 */
function fixtureApp(
  options: {
    sharingEnabled?: boolean;
    trips?: Parameters<typeof createTripsRouter>[0];
    shared?: Parameters<typeof createSharedTripsRouter>[0];
  } = {},
): Express {
  const sharingEnabled = options.sharingEnabled ?? true;
  const app = express();
  mountBetterAuth(app, auth);
  app.use(express.json());
  const api = Router();
  api.use(createSharedTripsRouter({ sharingEnabled, ...options.shared }));
  mountProtected(api, "/trips", createTripsRouter({ sharingEnabled, ...options.trips }));
  app.use("/api/v1", requireTrustedOrigin, api);
  app.use("/api", (_req: Request, res: Response) => {
    res.status(404).json(NOT_FOUND);
  });
  return app;
}

/** A Prisma client wrapper that records every property used, to prove "no database access". */
function recordingPrisma() {
  const used: string[] = [];
  const client = new Proxy(prisma, {
    get(target, property, receiver) {
      used.push(String(property));
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PrismaClient;
  return { client, used };
}

// ---- controlled lock order (same approach as the stops suite) ----------------

async function openTestConnection(): Promise<Client> {
  const url = getVerifiedTestDatabaseUrl();
  await assertConnectedToTestDatabase(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function waitUntilBlockedBy(observer: Client, blockerPid: number): Promise<string> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const { rows } = await observer.query<{ query: string }>(
      `SELECT query FROM pg_stat_activity
       WHERE datname = current_database() AND state = 'active' AND wait_event_type = 'Lock'
         AND $1 = ANY (pg_blocking_pids(pid))`,
      [blockerPid],
    );
    if (rows.length === 1) return rows[0]!.query;
    if (rows.length > 1) throw new Error(`expected one blocked backend, found ${rows.length}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`no backend was blocked by pid ${blockerPid}`);
}

async function withTripRowLocked(
  tripId: string,
  scenario: (ctx: {
    blocker: Client;
    blockerPid: number;
    observer: Client;
    finish: (action: "COMMIT" | "ROLLBACK") => Promise<void>;
  }) => Promise<void>,
): Promise<void> {
  const blocker = await openTestConnection();
  const observer = await openTestConnection();
  let open = false;
  try {
    const { rows } = await blocker.query<{ pid: number }>("SELECT pg_backend_pid() AS pid");
    await blocker.query("BEGIN");
    open = true;
    await blocker.query("SELECT id FROM trips WHERE id = $1 FOR UPDATE", [tripId]);
    await scenario({
      blocker,
      blockerPid: rows[0]!.pid,
      observer,
      finish: async (action) => {
        open = false;
        await blocker.query(action);
      },
    });
  } finally {
    if (open) await blocker.query("ROLLBACK").catch(() => undefined);
    await blocker.end().catch(() => undefined);
    await observer.end().catch(() => undefined);
  }
}

const ON = { sharingEnabled: true, publicOrigin: env.auth.baseUrl };

describe("trip sharing (integration, M05-T03 Increment 5)", () => {
  const app = createApp();

  afterEach(async () => {
    tokenControl.next = null;
    vi.restoreAllMocks();
    await resetTestDatabase();
  });

  describe("enable and rotate — POST /api/v1/trips/:tripId/share", () => {
    it("200 { share_url } only; a 43-character base64url token; only its SHA-256 hex is stored; version + 1", async () => {
      expect(env.trips.sharingEnabled).toBe(true);
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const before = await storedTrip(tripId);
      const response = await asUser(app, user).post(sharePath(tripId)).send({});
      expect(response.status).toBe(200);
      expectNoStore(response);
      expect(Object.keys(response.body)).toEqual(["share_url"]);
      const match = SHARE_URL.exec(response.body.share_url);
      expect(match).not.toBeNull();
      const token = match![1]!;
      expect(Buffer.from(token, "base64url")).toHaveLength(32);

      const after = await storedTrip(tripId);
      expect(after!.shareTokenHash).toBe(sha256(token));
      expect(after!.shareTokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(after!.version).toBe(before!.version + 1);
      expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime());
      // The raw token is nowhere in the database.
      const [dump] = await prisma.$queryRaw<{ text: string }[]>`
        SELECT string_agg(t::text, ' ') AS text FROM trips t`;
      expect(dump!.text).not.toContain(token);

      // The owner views report is_shared but never the token or hash.
      for (const owner of [
        await asUser(app, user).get(tripPath(tripId)),
        await asUser(app, user).get(tripsPath),
      ]) {
        expect(owner.text).not.toContain(token);
        expect(owner.text).not.toContain(after!.shareTokenHash!);
        expect(owner.text).toContain('"is_shared":true');
      }
    });

    it("each enable rotates: a fresh independent token, the previous link stops working at once, version + 1 each time", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const tokens = [
        await enableVia(app, user, tripId),
        await enableVia(app, user, tripId),
        await enableVia(app, user, tripId),
      ];
      expect(new Set(tokens).size).toBe(3);
      expect((await storedTrip(tripId))!.version).toBe(3);
      for (const old of tokens.slice(0, 2)) {
        const response = await anonymous(app).get(sharedPath(old));
        expect(response.status).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
      }
      expect((await anonymous(app).get(sharedPath(tokens[2]!))).status).toBe(200);
      // Reading the owner view or the shared view does not rotate the token.
      await asUser(app, user).get(tripPath(tripId));
      await anonymous(app).get(sharedPath(tokens[2]!));
      expect((await storedTrip(tripId))!.shareTokenHash).toBe(sha256(tokens[2]!));
      expect((await storedTrip(tripId))!.version).toBe(3);
    });

    it("404 for another user's trip and a missing trip — identical; nothing changes", async () => {
      const [a, b] = await createTwoUsers(app);
      const tripId = await createTripVia(app, a);
      const foreign = await asUser(app, b).post(sharePath(tripId)).send();
      const missing = await asUser(app, b).post(sharePath(UNKNOWN_ID)).send();
      for (const response of [foreign, missing]) {
        expect(response.status).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
        expectNoStore(response);
      }
      expect(foreign.text).toBe(missing.text);
      expect(await storedTrip(tripId)).toMatchObject({ version: 0, shareTokenHash: null });
    });

    it("400s before any lookup: malformed trip ID, body fields, query parameters", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const malformed = await asUser(app, user).post(sharePath("nope")).send();
      expect(malformed.status).toBe(400);
      expect(malformed.body).toEqual(invalidRequest(MESSAGES.invalidTripId));
      for (const id of [tripId, UNKNOWN_ID]) {
        const body = await asUser(app, user).post(sharePath(id)).send({ rotate: true });
        expect(body.status).toBe(400);
        expect(body.body).toEqual(invalidRequest(MESSAGES.noBodyFields));
        const query = await asUser(app, user)
          .post(`${sharePath(id)}?rotate=1`)
          .send();
        expect(query.status).toBe(400);
        expect(query.body).toEqual(invalidQuery(MESSAGES.noQuery));
      }
      expect(await storedTrip(tripId)).toMatchObject({ version: 0, shareTokenHash: null });
    });

    it("a hash collision (forced) is the fixed 500; the transaction rolls back and the existing link is untouched (T3-7)", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const [a, b] = await createTwoUsers(app);
      const tripA = await createTripVia(app, a);
      const tripB = await createTripVia(app, b);
      const tokenA = await enableVia(app, a, tripA);
      const tokenB = await enableVia(app, b, tripB);
      tokenControl.next = tokenA; // B's next "fresh" token collides with A's
      const response = await asUser(app, b).post(sharePath(tripB)).send();
      expect(response.status).toBe(500);
      expect(response.body).toEqual(INTERNAL_ERROR);
      expectNoStore(response);
      expect(response.text).not.toContain(tokenA);
      expect(await storedTrip(tripB)).toMatchObject({ version: 1, shareTokenHash: sha256(tokenB) });
      expect(await storedTrip(tripA)).toMatchObject({ version: 1, shareTokenHash: sha256(tokenA) });
      expect((await anonymous(app).get(sharedPath(tokenB))).status).toBe(200);
      const logged = vi.mocked(console.error).mock.calls.flat().join("\n");
      expect(logged).toContain("PROTECTED_ROUTE_FAILURE");
      expect(logged).not.toContain(tokenA);
      expect(logged).not.toContain(sha256(tokenA));
    });
  });

  describe("revoke — DELETE /api/v1/trips/:tripId/share", () => {
    it("204 with no body; the link stops working at once; is_shared false; version + 1", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const token = await enableVia(app, user, tripId);
      expect((await anonymous(app).get(sharedPath(token))).status).toBe(200);
      expectNoContent(await asUser(app, user).delete(sharePath(tripId)));
      const after = await storedTrip(tripId);
      expect(after).toMatchObject({ version: 2, shareTokenHash: null });
      const shared = await anonymous(app).get(sharedPath(token));
      expect(shared.status).toBe(404);
      expect(shared.body).toEqual(NOT_FOUND);
      expect((await asUser(app, user).get(tripPath(tripId))).body.trip.is_shared).toBe(false);
    });

    it("repeated revocation is 204 each time (version + 1 each, never re-enabling); re-enabling issues a new token", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const first = await enableVia(app, user, tripId);
      expectNoContent(await asUser(app, user).delete(sharePath(tripId)));
      expectNoContent(await asUser(app, user).delete(sharePath(tripId)));
      expect(await storedTrip(tripId)).toMatchObject({ version: 3, shareTokenHash: null });
      const second = await enableVia(app, user, tripId);
      expect(second).not.toBe(first);
      expect((await anonymous(app).get(sharedPath(first))).status).toBe(404);
      expect((await anonymous(app).get(sharedPath(second))).status).toBe(200);
      expect((await storedTrip(tripId))!.version).toBe(4);
    });

    it("404 for another user's trip and a missing trip — identical; the owner's link keeps working", async () => {
      const [a, b] = await createTwoUsers(app);
      const tripId = await createTripVia(app, a);
      const token = await enableVia(app, a, tripId);
      const foreign = await asUser(app, b).delete(sharePath(tripId));
      const missing = await asUser(app, b).delete(sharePath(UNKNOWN_ID));
      expect(foreign.status).toBe(404);
      expect(foreign.text).toBe(missing.text);
      expect((await anonymous(app).get(sharedPath(token))).status).toBe(200);
      expect((await storedTrip(tripId))!.version).toBe(1);
    });

    it("400 for body fields and query parameters; the link keeps working", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const token = await enableVia(app, user, tripId);
      const body = await asUser(app, user).delete(sharePath(tripId)).send({ all: true });
      expect(body.status).toBe(400);
      expect(body.body).toEqual(invalidRequest(MESSAGES.noBodyFields));
      const query = await asUser(app, user).delete(`${sharePath(tripId)}?x=1`);
      expect(query.status).toBe(400);
      expect(query.body).toEqual(invalidQuery(MESSAGES.noQuery));
      expect((await anonymous(app).get(sharedPath(token))).status).toBe(200);
    });

    it("deleting the trip invalidates its link", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const token = await enableVia(app, user, tripId);
      expectNoContent(await asUser(app, user).delete(tripPath(tripId)));
      const shared = await anonymous(app).get(sharedPath(token));
      expect(shared.status).toBe(404);
      expect(shared.body).toEqual(NOT_FOUND);
    });
  });

  describe("public shared trip — GET /api/v1/shared/trips/:shareToken", () => {
    it("200 with exactly { trip: { name, stops, distance_summary } }; stops identical to the owner view, with redaction and partial distances", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user, "Shared Waterfalls");
      const landmarks = [
        await createLandmark({ latitude: 35.61, longitude: -83.52 }), // PUBLIC
        await createLandmark({ latitude: 35.66, longitude: -83.45 }), // PUBLIC
        await createLandmark({ latitude: 35.71, longitude: -83.41 }), // → SENSITIVE
        await createLandmark({ latitude: 35.72, longitude: -83.38 }), // PUBLIC
        await createLandmark({ latitude: 35.73, longitude: -83.37 }), // → UNREVIEWED
        await createLandmark({ latitude: 35.74, longitude: -83.36 }), // → inactive PUBLIC
        await createLandmark({ latitude: 35.75, longitude: -83.35 }), // PUBLIC
        await createLandmark({ latitude: 35.76, longitude: -83.34 }), // PUBLIC
      ];
      const stopIds: string[] = [];
      for (const l of landmarks) stopIds.push(await addVia(app, user, tripId, l));
      await prisma.landmark.update({
        where: { id: landmarks[2]! },
        data: { sensitivityStatus: "SENSITIVE" },
      });
      await prisma.landmark.update({
        where: { id: landmarks[4]! },
        data: { sensitivityStatus: "UNREVIEWED" },
      });
      await prisma.landmark.update({ where: { id: landmarks[5]! }, data: { isActive: false } });
      const token = await enableVia(app, user, tripId);

      const response = await anonymous(app).get(sharedPath(token));
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toMatch(/^application\/json/);
      expectPublicHeaders(response);
      expect(Object.keys(response.body)).toEqual(["trip"]);
      const trip = response.body.trip;
      expect(Object.keys(trip)).toEqual(["name", "stops", "distance_summary"]);
      expect(trip.name).toBe("Shared Waterfalls");
      expect(trip.stops.map((s: { id: string }) => s.id)).toEqual(stopIds);
      expect(trip.stops.map((s: { position: number }) => s.position)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7,
      ]);
      for (const stop of trip.stops) expect(Object.keys(stop).sort()).toEqual(STOP_KEYS);

      const available = [true, true, false, true, false, false, true, true];
      trip.stops.forEach((stop: Record<string, unknown>, i: number) => {
        expect(stop.is_available, `stop ${i}`).toBe(available[i]);
        if (available[i]) {
          expect(Object.keys(stop.landmark as object).sort()).toEqual(LANDMARK_KEYS);
        } else {
          expect(stop).toEqual({
            id: stopIds[i],
            position: i,
            is_available: false,
            distance_from_previous_miles: null,
            landmark: { id: landmarks[i], is_available: false },
          });
        }
      });
      // Measured legs only between adjacent available stops: 0→1 and 6→7.
      const measured = trip.stops.map((s: { distance_from_previous_miles: number | null }) =>
        s.distance_from_previous_miles === null ? null : "m",
      );
      expect(measured).toEqual([null, "m", null, null, null, null, null, "m"]);
      expect(trip.distance_summary.measured_legs).toBe(2);
      expect(trip.distance_summary.total_legs).toBe(7);

      // Exactly the owner's stops and summary.
      const owner = await asUser(app, user).get(tripPath(tripId));
      expect(trip.stops).toEqual(owner.body.trip.stops);
      expect(trip.distance_summary).toEqual(owner.body.trip.distance_summary);

      // No owner, trip, sharing, or restricted value anywhere.
      const text = response.text;
      const stored = await storedTrip(tripId);
      for (const forbidden of [
        tripId,
        user.userId,
        user.email,
        token,
        stored!.shareTokenHash!,
        "version",
        "created_at",
        "updated_at",
        "is_shared",
        "sharing_enabled",
        "user",
        "owner",
        "restricted",
        "source",
        owner.body.trip.updated_at,
        '"latitude":35.71',
        '"latitude":35.73',
        '"latitude":35.74',
      ]) {
        expect(text, forbidden).not.toContain(forbidden);
      }
      for (const hidden of [landmarks[2]!, landmarks[4]!, landmarks[5]!]) {
        const row = await prisma.landmark.findUniqueOrThrow({ where: { id: hidden } });
        expect(text).not.toContain(`"${row.displayName}"`);
      }
    });

    it("reactivation is reflected at read time without changing the stop", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const landmark = await createLandmark();
      const stopId = await addVia(app, user, tripId, landmark);
      const token = await enableVia(app, user, tripId);
      await prisma.landmark.update({ where: { id: landmark }, data: { isActive: false } });
      expect((await anonymous(app).get(sharedPath(token))).body.trip.stops[0].is_available).toBe(
        false,
      );
      await prisma.landmark.update({ where: { id: landmark }, data: { isActive: true } });
      const restored = (await anonymous(app).get(sharedPath(token))).body.trip.stops[0];
      expect(restored).toMatchObject({
        id: stopId,
        is_available: true,
        landmark: { id: landmark },
      });
    });

    it("an empty shared trip has no stops and an empty summary", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user, "Empty");
      const token = await enableVia(app, user, tripId);
      const response = await anonymous(app).get(sharedPath(token));
      expect(response.body).toEqual({
        trip: {
          name: "Empty",
          stops: [],
          distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
        },
      });
    });

    it("identical for every caller: anonymous, the owner's session, and another user's session; no cookie is set", async () => {
      const [a, b] = await createTwoUsers(app);
      const tripId = await createTripVia(app, a);
      await addVia(app, a, tripId, await createLandmark());
      const token = await enableVia(app, a, tripId);
      const responses = [
        await anonymous(app).get(sharedPath(token)),
        await asUser(app, a).get(sharedPath(token)),
        await asUser(app, b).get(sharedPath(token)),
        await request(app).get(sharedPath(token)).set("Cookie", forgedCookie()),
        await request(app).get(`${sharedPath(token)}?user_id=${a.userId}&include=owner`),
      ];
      for (const response of responses) {
        expect(response.status).toBe(200);
        expectPublicHeaders(response);
        expect(response.text).toBe(responses[0]!.text);
        expect(response.text).not.toContain(a.userId);
      }
    });

    it("malformed, unknown, revoked, rotated, and deleted-trip tokens all get the identical generic 404 with no-store and noindex", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const rotated = await enableVia(app, user, tripId);
      const revoked = await enableVia(app, user, tripId);
      expectNoContent(await asUser(app, user).delete(sharePath(tripId)));
      const deletedTrip = await createTripVia(app, user, "Gone");
      const deleted = await enableVia(app, user, deletedTrip);
      expectNoContent(await asUser(app, user).delete(tripPath(deletedTrip)));
      const unknownApi = await anonymous(app).get("/api/v1/no-such-route");

      const values = [
        "A".repeat(43), // well-formed, unknown
        rotated,
        revoked,
        deleted,
        "A".repeat(42),
        "A".repeat(44),
        `${"A".repeat(42)}=`,
        `${"A".repeat(41)}%2B`,
        `${"A".repeat(41)}%2F`,
        `${"A".repeat(42)}%C3%A9`,
        sha256("A".repeat(43)), // the stored form is not a token
        "..",
        "x",
      ];
      const texts = new Set<string>();
      for (const value of values) {
        const response = await anonymous(app).get(sharedPath(value));
        expect(response.status, value).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
        expectPublicHeaders(response);
        texts.add(`${response.text}|${response.headers["content-length"]}`);
      }
      expect(texts.size).toBe(1);
      expect(unknownApi.text).toBe(JSON.stringify(NOT_FOUND));
      expect([...texts][0]).toContain(unknownApi.text);
    });

    it("a value without token syntax is answered without any database access; a well-formed one is hashed and looked up", async () => {
      const recorder = recordingPrisma();
      const probe = fixtureApp({ shared: { prisma: recorder.client } });
      for (const value of ["short", "A".repeat(44), `${"A".repeat(42)}=`, `${"A".repeat(41)}%2F`]) {
        expect((await anonymous(probe).get(sharedPath(value))).status).toBe(404);
      }
      expect(recorder.used).toEqual([]);
      expect((await anonymous(probe).get(sharedPath("A".repeat(43)))).status).toBe(404);
      expect(recorder.used).toContain("$transaction");
    });

    it("write methods on the shared path are never handled: anonymous POST/PUT/PATCH/DELETE get the generic 404; nothing changes", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const token = await enableVia(app, user, tripId);
      for (const method of ["post", "put", "patch", "delete"] as const) {
        const response = await anonymous(app)[method](sharedPath(token)).send({ name: "Hijack" });
        expect(response.status, method).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
      }
      // Cross-origin writes carrying the owner's cookie are refused by the CSRF check.
      const crossOrigin = await request(app)
        .delete(sharedPath(token))
        .set("Origin", "https://evil.example")
        .set("Cookie", user.cookie);
      expect(crossOrigin.status).toBe(403);
      expect(await storedTrip(tripId)).toMatchObject({ name: "Shared Waterfalls", version: 1 });
      expect((await anonymous(app).get(sharedPath(token))).status).toBe(200);
    });

    it("is not throttled: 150 consecutive reads all succeed", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const token = await enableVia(app, user, tripId);
      for (let i = 0; i < 150; i += 1) {
        expect((await asUser(app, user).get(sharedPath(token))).status).toBe(200);
      }
    });

    it("an unexpected failure is the fixed JSON 500 with no-store and noindex; one log line with only the event code and class name — no token", async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const token = "Q".repeat(43);
      const broken = fixtureApp({
        shared: {
          service: {
            getSharedTrip: async () => {
              throw new TypeError(`secret detail for ${token} SELECT * FROM trips`);
            },
          },
        },
      });
      const response = await anonymous(broken).get(sharedPath(token));
      expect(response.status).toBe(500);
      expect(response.body).toEqual(INTERNAL_ERROR);
      expectPublicHeaders(response);
      expect(response.text).not.toContain(token);
      expect(response.text).not.toContain("secret");
      expect(errors).toHaveBeenCalledTimes(1);
      const line = String(errors.mock.calls[0]![0]);
      expect(line).toContain("SHARED_TRIP_READ_FAILED");
      expect(line).toContain("TypeError");
      expect(line).not.toContain(token);
      expect(line).not.toContain("secret");
      expect(line).not.toContain("SELECT");
    });

    it("a real database failure on the public route is the same fixed JSON 500", async () => {
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      const failing = {
        $transaction: async () => {
          throw new Error("connection refused at postgres://user:pass@db/landmarks");
        },
      } as unknown as PrismaClient;
      const broken = fixtureApp({ shared: { prisma: failing } });
      const response = await anonymous(broken).get(sharedPath("Z".repeat(43)));
      expect(response.status).toBe(500);
      expect(response.body).toEqual(INTERNAL_ERROR);
      expectPublicHeaders(response);
      expect(response.text).not.toContain("postgres");
    });

    it("a malformed percent-encoded path still fails in Express's URL decoding (known app-wide gap, unchanged): 400, no trip data", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user, "Secret Name");
      await enableVia(app, user, tripId);
      const response = await anonymous(app).get("/api/v1/shared/trips/%E0%A4%A");
      expect(response.status).toBe(400);
      expect(response.text).not.toContain("Secret Name");
      expect(response.headers["set-cookie"]).toBeUndefined();
    });
  });

  describe("TRIP_SHARING_ENABLED off (production default) — the release gate", () => {
    it("the production default is off and explicit values are respected", async () => {
      const { resolveTripSharingEnabled } = await import("../src/config/trip-sharing.js");
      expect(resolveTripSharingEnabled(undefined, "production")).toBe(false);
      expect(resolveTripSharingEnabled(undefined, "test")).toBe(true);
    });

    it("enable: 409 TRIP_SHARING_UNAVAILABLE for the owner only, after the ownership check; nothing changes; others get the generic 404", async () => {
      const off = fixtureApp({ sharingEnabled: false });
      const [a, b] = await createTwoUsers(off);
      const tripId = await createTripVia(off, a);
      const owner = await asUser(off, a).post(sharePath(tripId)).send();
      expect(owner.status).toBe(409);
      expect(owner.body).toEqual(SHARING_UNAVAILABLE);
      expectNoStore(owner);
      const foreign = await asUser(off, b).post(sharePath(tripId)).send();
      const missing = await asUser(off, b).post(sharePath(UNKNOWN_ID)).send();
      expect(foreign.status).toBe(404);
      expect(foreign.text).toBe(missing.text);
      expect(await storedTrip(tripId)).toMatchObject({ version: 0, shareTokenHash: null });
      expect((await asUser(off, a).get(tripPath(tripId))).body.trip.sharing_enabled).toBe(false);
    });

    it("a previously issued link is never served while off — the same 404, without any database access — and works again only if sharing is switched back on", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user, "Issued Before");
      await addVia(app, user, tripId, await createLandmark());
      const token = await enableVia(app, user, tripId);

      const recorder = recordingPrisma();
      const off = fixtureApp({ sharingEnabled: false, shared: { prisma: recorder.client } });
      const disabled = await anonymous(off).get(sharedPath(token));
      const unknown = await anonymous(off).get(sharedPath("A".repeat(43)));
      for (const response of [disabled, unknown]) {
        expect(response.status).toBe(404);
        expect(response.body).toEqual(NOT_FOUND);
        expectPublicHeaders(response);
      }
      expect(disabled.text).toBe(unknown.text);
      expect(disabled.text).not.toContain("Issued Before");
      expect(recorder.used).toEqual([]);

      // Switching the setting back on (the real app) serves the same link again:
      // the setting hides links; only revocation or rotation invalidates them.
      expect((await anonymous(app).get(sharedPath(token))).status).toBe(200);
    });

    it("revoke still works while off (T3-1): 204, the hash is cleared, version + 1", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const token = await enableVia(app, user, tripId);
      const off = fixtureApp({ sharingEnabled: false });
      expectNoContent(await asUser(off, user).delete(sharePath(tripId)));
      expect(await storedTrip(tripId)).toMatchObject({ version: 2, shareTokenHash: null });
      expect((await anonymous(app).get(sharedPath(token))).status).toBe(404);
    });
  });

  describe("authentication and CSRF on the owner sharing routes", () => {
    it("missing, forged, malformed, expired, and signed-out sessions get the identical 401 on enable and revoke; nothing changes", async () => {
      const owner = await createSignedInUser(app, "owner");
      const tripId = await createTripVia(app, owner);
      const token = await enableVia(app, owner, tripId);
      const revoked = await createSignedInUser(app, "revoked");
      await signOut(app, revoked);
      const expired = await createSignedInUser(app, "expired");
      await prisma.session.updateMany({
        where: { userId: expired.userId },
        data: { expiresAt: new Date(Date.now() - 60_000) },
      });
      for (const cookie of [
        undefined,
        forgedCookie(),
        "better-auth.session_token=%%%not-a-token",
        expired.cookie,
        revoked.cookie,
      ]) {
        for (const method of ["post", "delete"] as const) {
          const pending = anonymous(app)[method](sharePath(tripId));
          const response = await (cookie ? pending.set("Cookie", cookie) : pending).send();
          expect(response.status).toBe(401);
          expect(response.text).toBe(JSON.stringify(UNAUTHENTICATED));
          expectNoStore(response);
        }
      }
      expect(await storedTrip(tripId)).toMatchObject({ version: 1, shareTokenHash: sha256(token) });
    });

    it("403 INVALID_ORIGIN for cookie-bearing enable and revoke with a missing or foreign Origin; nothing changes", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const token = await enableVia(app, user, tripId);
      for (const origin of [undefined, "https://evil.example", "null"]) {
        for (const method of ["post", "delete"] as const) {
          const pending = request(app)[method](sharePath(tripId)).set("Cookie", user.cookie);
          const response = await (origin ? pending.set("Origin", origin) : pending).send();
          expect(response.status).toBe(403);
          expect(response.body).toEqual(INVALID_ORIGIN);
          expectNoStore(response);
        }
      }
      expect(await storedTrip(tripId)).toMatchObject({ version: 1, shareTokenHash: sha256(token) });
    });

    it("enable and revoke count toward the 60-mutation limit; the 61st is 429 with Retry-After", async () => {
      let t = 5_000_000;
      const limited = fixtureApp({
        trips: { limiter: createTripsRateLimiter({ now: () => t, log: vi.fn() }) },
      });
      const user = await createSignedInUser(limited);
      const tripId = await createTripVia(limited, user); // 1
      for (let i = 0; i < 59; i += 1) {
        const response =
          i % 2 === 0
            ? await asUser(limited, user).post(sharePath(tripId)).send()
            : await asUser(limited, user).delete(sharePath(tripId));
        expect([200, 204]).toContain(response.status);
      }
      t += 10_000;
      for (const method of ["post", "delete"] as const) {
        const response = await asUser(limited, user)[method](sharePath(tripId)).send();
        expect(response.status).toBe(429);
        expect(response.body).toEqual(RATE_LIMITED);
        expect(response.headers["retry-after"]).toBe("50");
      }
      expect((await storedTrip(tripId))!.version).toBe(59);
    });
  });

  describe("serialization with other trip mutations (trip-row lock)", () => {
    it("a reorder prepared before an enable or a revoke is rejected with 409 and changes nothing", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const stops = [
        await addVia(app, user, tripId, await createLandmark()),
        await addVia(app, user, tripId, await createLandmark()),
      ];
      await enableVia(app, user, tripId); // version 2 → 3
      const stale = await asUser(app, user)
        .put(orderPath(tripId))
        .send({ stop_ids: [stops[1], stops[0]], version: 2 });
      expect(stale.status).toBe(409);
      expect(stale.body).toEqual(VERSION_CONFLICT);
      expectNoContent(await asUser(app, user).delete(sharePath(tripId))); // → 4
      const staleAgain = await asUser(app, user)
        .put(orderPath(tripId))
        .send({ stop_ids: [stops[1], stops[0]], version: 3 });
      expect(staleAgain.status).toBe(409);
      const ok = await asUser(app, user)
        .put(orderPath(tripId))
        .send({ stop_ids: [stops[1], stops[0]], version: 4 });
      expect(ok.status).toBe(200);
      expect(ok.body.trip).toMatchObject({ version: 5, is_shared: false });
    });

    it("concurrent enables serialize: each succeeds once, version counts them, and only the last committed token works", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const userId = user.userId;
      const outcomes = await Promise.all(
        Array.from({ length: 8 }, () => enableTripSharing(prisma, userId, tripId, ON)),
      );
      const tokens = outcomes.map((o) => {
        expect(o.kind).toBe("shared");
        return SHARE_URL.exec((o as { shareUrl: string }).shareUrl)![1]!;
      });
      expect(new Set(tokens).size).toBe(8);
      const stored = await storedTrip(tripId);
      expect(stored!.version).toBe(8);
      const live = tokens.filter((t) => sha256(t) === stored!.shareTokenHash);
      expect(live).toHaveLength(1);
      for (const token of tokens) {
        expect((await anonymous(app).get(sharedPath(token))).status).toBe(
          token === live[0] ? 200 : 404,
        );
      }
    });

    it("concurrent enable, revoke, and stop add on one trip: every operation is counted exactly once, and the stored hash matches the final state", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const landmarks = [await createLandmark(), await createLandmark(), await createLandmark()];
      const results = await Promise.all([
        asUser(app, user).post(sharePath(tripId)).send(),
        asUser(app, user).delete(sharePath(tripId)),
        asUser(app, user).post(sharePath(tripId)).send(),
        ...landmarks.map((l) => asUser(app, user).post(stopsPath(tripId)).send({ landmark_id: l })),
        asUser(app, user).delete(sharePath(tripId)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 201, 201, 201, 204, 204]);
      const stored = await storedTrip(tripId);
      expect(stored!.version).toBe(7);
      const tokens = results
        .filter((r) => r.status === 200)
        .map((r) => SHARE_URL.exec(r.body.share_url)![1]!);
      const live = tokens.filter((t) => sha256(t) === stored!.shareTokenHash);
      expect(live.length).toBe(stored!.shareTokenHash === null ? 0 : 1);
      expect(
        (await prisma.tripStop.findMany({ where: { tripId }, orderBy: { position: "asc" } })).map(
          (s) => s.position,
        ),
      ).toEqual([0, 1, 2]);
    });

    it("controlled order: an enable waiting behind a lock holder that deletes the trip → not_found; nothing is created", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      await withTripRowLocked(tripId, async ({ blocker, blockerPid, observer, finish }) => {
        const pending = enableTripSharing(prisma, user.userId, tripId, ON);
        expect(await waitUntilBlockedBy(observer, blockerPid)).toMatch(/FOR UPDATE/);
        await blocker.query("DELETE FROM trips WHERE id = $1", [tripId]);
        await finish("COMMIT");
        expect(await pending).toEqual({ kind: "not_found" });
      });
      expect(await prisma.trip.count()).toBe(0);
    });

    it("controlled order: a revoke waiting behind a holder that rotates the link clears the NEW hash; an enable behind a holder's revoke issues a working token", async () => {
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const original = await enableVia(app, user, tripId); // version 1
      const rotatedHash = sha256("R".repeat(43));
      await withTripRowLocked(tripId, async ({ blocker, blockerPid, observer, finish }) => {
        const pending = revokeTripSharing(prisma, user.userId, tripId);
        await waitUntilBlockedBy(observer, blockerPid);
        await blocker.query(
          "UPDATE trips SET share_token_hash = $2, version = version + 1, updated_at = now() WHERE id = $1",
          [tripId, rotatedHash],
        );
        await finish("COMMIT");
        expect(await pending).toEqual({ kind: "revoked" });
      });
      expect(await storedTrip(tripId)).toMatchObject({ version: 3, shareTokenHash: null });
      expect((await anonymous(app).get(sharedPath("R".repeat(43)))).status).toBe(404);
      expect((await anonymous(app).get(sharedPath(original))).status).toBe(404);

      let issued = "";
      await withTripRowLocked(tripId, async ({ blocker, blockerPid, observer, finish }) => {
        const pending = enableTripSharing(prisma, user.userId, tripId, ON);
        await waitUntilBlockedBy(observer, blockerPid);
        await blocker.query(
          "UPDATE trips SET share_token_hash = NULL, version = version + 1, updated_at = now() WHERE id = $1",
          [tripId],
        );
        await finish("COMMIT");
        const outcome = await pending;
        expect(outcome.kind).toBe("shared");
        issued = SHARE_URL.exec((outcome as { shareUrl: string }).shareUrl)![1]!;
      });
      expect(await storedTrip(tripId)).toMatchObject({
        version: 5,
        shareTokenHash: sha256(issued),
      });
      expect((await anonymous(app).get(sharedPath(issued))).status).toBe(200);
    });
  });

  describe("no token in any log line", () => {
    it("a full lifecycle (enable, read, rotate, revoke, failed reads) writes no token, hash, or share URL to the console", async () => {
      const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) =>
        vi.spyOn(console, m),
      );
      const user = await createSignedInUser(app);
      const tripId = await createTripVia(app, user);
      const first = await asUser(app, user).post(sharePath(tripId)).send();
      const token1 = SHARE_URL.exec(first.body.share_url)![1]!;
      await anonymous(app).get(sharedPath(token1));
      const token2 = await enableVia(app, user, tripId);
      await anonymous(app).get(sharedPath(token1));
      await asUser(app, user).delete(sharePath(tripId));
      await anonymous(app).get(sharedPath(token2));
      await anonymous(app).get(sharedPath(`${token2}x`));
      const output = spies
        .flatMap((s) => s.mock.calls)
        .flat()
        .map(String)
        .join("\n");
      for (const secret of [token1, token2, sha256(token1), sha256(token2), "/shared/trips/"]) {
        expect(output).not.toContain(secret);
      }
    });
  });
});
