import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import * as repository from "../src/trips/repository.js";
import { parseListQuery } from "../src/trips/request-schema.js";
import {
  createTrip,
  deleteTrip,
  getTrip,
  listTrips,
  renameTrip,
  type OwnerTripRepresentation,
} from "../src/trips/service.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";
import {
  assertConnectedToTestDatabase,
  getVerifiedTestDatabaseUrl,
} from "./setup/test-db-guard.js";

/**
 * M05-T03 Increment 2 — trips repository and core service operations against
 * the REAL landmarks_test database (ADR-009), through the application's actual
 * Prisma client and PostgreSQL driver adapter: owner-scoped SQL and the
 * generic not-found outcome, list order and pagination, rename with the
 * trip-row lock and optional version, delete with CASCADE, transaction
 * rollback, the exact owner representation, read-time redaction (spec v1.1
 * §§4, 7.2), and straight-line distances (§5.6).
 *
 * Stops are inserted directly as fixtures: stop mutations are Increment 3.
 * Every test ends with the guarded resetTestDatabase(). The deterministic
 * locking tests hold an uncommitted transaction on a separate guard-verified
 * connection and wait (bounded) until the service is confirmed blocked on
 * exactly that transaction (`pg_blocking_pids`).
 */

type Status = "UNREVIEWED" | "PUBLIC" | "SENSITIVE";

const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";
const ISO_UTC_MS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ON = { sharingEnabled: true };
const OFF = { sharingEnabled: false };

let sequence = 0;

async function createUser(label = "user"): Promise<string> {
  sequence += 1;
  const user = await prisma.user.create({
    data: { name: "", email: `trips-${label}-${sequence}@example.com` },
  });
  return user.id;
}

interface LandmarkOptions {
  status?: Status;
  active?: boolean;
  latitude?: number;
  longitude?: number;
  name?: string;
}

async function createLandmark(options: LandmarkOptions = {}): Promise<string> {
  sequence += 1;
  const landmark = await prisma.landmark.create({
    data: {
      sourceCode: `TRP${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNFALLS",
      category: "FALLS",
      displayName: options.name ?? `Trip Falls ${sequence}`,
      latitude: options.latitude ?? 35.6532,
      longitude: options.longitude ?? -83.5079,
      sourceDescription: "restricted description",
      sourceAccessLabel: "restricted access",
      sourceUrl: "https://example.com/restricted",
      sensitivityStatus: options.status ?? "PUBLIC",
      isActive: options.active ?? true,
    },
  });
  return landmark.id;
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

async function seedTrip(userId: string, name = "Weekend Waterfalls"): Promise<string> {
  const outcome = await createTrip(prisma, userId, name, ON);
  return outcome.trip.id;
}

/** Inserts stops at positions 0 … n-1 directly (a fixture; stop mutations are Increment 3). */
async function insertStops(tripId: string, landmarkIds: string[]): Promise<string[]> {
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

async function storedTrip(tripId: string) {
  return prisma.trip.findUnique({ where: { id: tripId } });
}

async function ownerTrip(userId: string, tripId: string): Promise<OwnerTripRepresentation> {
  const outcome = await getTrip(prisma, userId, tripId, ON);
  if (outcome.kind !== "found") throw new Error("expected the trip to be found");
  return outcome.trip;
}

/** Straight-line miles between two landmarks, computed independently in SQL. */
async function expectedMiles(a: string, b: string): Promise<number> {
  const [row] = await prisma.$queryRaw<{ meters: number }[]>`
    SELECT ST_Distance(x.location, y.location) AS meters
    FROM landmarks x, landmarks y WHERE x.id = ${a}::uuid AND y.id = ${b}::uuid`;
  return row!.meters / 1609.344;
}

// ---------------------------------------------------------------------------
// Deterministic interleaving helpers (same approach as the reviews suite)
// ---------------------------------------------------------------------------

const WAIT_TIMEOUT_MS = 5_000;
const POLL_MS = 25;

async function openTestConnection(): Promise<Client> {
  const url = getVerifiedTestDatabaseUrl();
  await assertConnectedToTestDatabase(url);
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

async function waitUntilBlockedBy(observer: Client, blockerPid: number): Promise<string> {
  const deadline = Date.now() + WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { rows } = await observer.query<{ query: string }>(
      `SELECT query FROM pg_stat_activity
       WHERE datname = current_database()
         AND state = 'active'
         AND wait_event_type = 'Lock'
         AND $1 = ANY (pg_blocking_pids(pid))`,
      [blockerPid],
    );
    if (rows.length === 1) return rows[0]!.query;
    if (rows.length > 1) throw new Error(`expected one blocked backend, found ${rows.length}`);
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`no backend was blocked by pid ${blockerPid} within ${WAIT_TIMEOUT_MS} ms`);
}

/** Holds `SELECT … FOR UPDATE` on a trip row in a separate transaction while `scenario` runs. */
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

// ---------------------------------------------------------------------------

const UNAVAILABLE: [string, { status?: Status; active?: boolean }][] = [
  ["SENSITIVE", { status: "SENSITIVE" }],
  ["UNREVIEWED", { status: "UNREVIEWED" }],
  ["inactive (PUBLIC)", { status: "PUBLIC", active: false }],
  ["inactive (SENSITIVE)", { status: "SENSITIVE", active: false }],
];

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

describe("trips repository and service (integration, M05-T03 Increment 2)", () => {
  afterEach(async () => {
    await resetTestDatabase();
  });

  describe("create", () => {
    it("creates an empty trip at version 0 with the exact owner representation", async () => {
      const userId = await createUser();
      const outcome = await createTrip(prisma, userId, "Weekend Waterfalls", ON);
      expect(outcome.kind).toBe("created");
      const trip = outcome.trip;
      expect(Object.keys(trip).sort()).toEqual(TRIP_KEYS);
      expect(trip).toMatchObject({
        name: "Weekend Waterfalls",
        version: 0,
        is_shared: false,
        sharing_enabled: true,
        stops: [],
        distance_summary: { total_miles: null, measured_legs: 0, total_legs: 0 },
      });
      expect(trip.created_at).toMatch(ISO_UTC_MS);
      expect(trip.updated_at).toBe(trip.created_at);

      const stored = await storedTrip(trip.id);
      expect(stored).toMatchObject({ userId, name: "Weekend Waterfalls", version: 0 });
      expect(stored?.shareTokenHash).toBeNull();
    });

    it("reports sharing_enabled from the setting passed in", async () => {
      const userId = await createUser();
      expect((await createTrip(prisma, userId, "Off", OFF)).trip.sharing_enabled).toBe(false);
      const tripId = await seedTrip(userId);
      const outcome = await getTrip(prisma, userId, tripId, OFF);
      expect(outcome.kind === "found" && outcome.trip.sharing_enabled).toBe(false);
    });

    it("round-trips the stored name exactly (no normalization by the database)", async () => {
      const userId = await createUser();
      const name = `Caf${String.fromCodePoint(0xe9)} e${String.fromCodePoint(0x301)} ${String.fromCodePoint(0x1f3de, 0xfe0f)}`;
      const tripId = (await createTrip(prisma, userId, name, ON)).trip.id;
      expect((await ownerTrip(userId, tripId)).name).toBe(name);
    });
  });

  describe("ownership (generic not-found)", () => {
    it("finds the owner's trip; another user's trip and an unknown ID give the identical not_found", async () => {
      const owner = await createUser("owner");
      const other = await createUser("other");
      const tripId = await seedTrip(owner);
      expect((await getTrip(prisma, owner, tripId, ON)).kind).toBe("found");
      const asOther = await getTrip(prisma, other, tripId, ON);
      const unknown = await getTrip(prisma, owner, UNKNOWN_UUID, ON);
      expect(asOther).toEqual({ kind: "not_found" });
      expect(unknown).toEqual(asOther);
    });

    it("another user can neither rename nor delete the trip, and it is unchanged", async () => {
      const owner = await createUser("owner");
      const other = await createUser("other");
      const tripId = await seedTrip(owner, "Mine");
      const before = await storedTrip(tripId);
      expect(await renameTrip(prisma, other, tripId, { name: "Stolen" }, ON)).toEqual({
        kind: "not_found",
      });
      expect(await renameTrip(prisma, other, tripId, { name: "Stolen", version: 0 }, ON)).toEqual({
        kind: "not_found",
      });
      expect(await deleteTrip(prisma, other, tripId)).toEqual({ kind: "not_found" });
      expect(await storedTrip(tripId)).toEqual(before);
    });

    it("an unknown trip ID gives not_found for rename and delete", async () => {
      const userId = await createUser();
      expect(await renameTrip(prisma, userId, UNKNOWN_UUID, { name: "X" }, ON)).toEqual({
        kind: "not_found",
      });
      expect(await deleteTrip(prisma, userId, UNKNOWN_UUID)).toEqual({ kind: "not_found" });
    });

    it("the repository refuses an identity that is not a UUID (a programming error, never client input)", async () => {
      await expect(repository.findOwnedTrip(prisma, "not-a-uuid", UNKNOWN_UUID)).rejects.toThrow(
        /userId is not a UUID/,
      );
      await expect(repository.insertTrip(prisma, "", "Name")).rejects.toThrow(/userId/);
    });
  });

  describe("list (spec §10.1)", () => {
    it("lists only the user's trips, newest updated first, with stop counts and is_shared", async () => {
      const userId = await createUser();
      const other = await createUser("other");
      const landmark = await createLandmark();
      const first = await seedTrip(userId, "First");
      const second = await seedTrip(userId, "Second");
      await seedTrip(other, "Not mine");
      await insertStops(second, [landmark]);
      await prisma.$executeRaw`UPDATE trips SET updated_at = '2026-01-01 00:00:00' WHERE id = ${first}::uuid`;
      await prisma.$executeRaw`UPDATE trips SET updated_at = '2026-01-02 00:00:00', share_token_hash = ${"a".repeat(64)} WHERE id = ${second}::uuid`;

      const { body } = await listTrips(prisma, userId, parseListQuery({}));
      expect(body).toEqual({
        trips: [
          {
            id: second,
            name: "Second",
            stop_count: 1,
            updated_at: "2026-01-02T00:00:00.000Z",
            is_shared: true,
          },
          {
            id: first,
            name: "First",
            stop_count: 0,
            updated_at: "2026-01-01T00:00:00.000Z",
            is_shared: false,
          },
        ],
        page: 1,
        limit: 20,
        has_more: false,
      });
      expect(JSON.stringify(body)).not.toContain("a".repeat(64));
    });

    it("breaks updated_at ties by id DESC and pages without gaps or duplicates", async () => {
      const userId = await createUser();
      const ids: string[] = [];
      for (let i = 0; i < 5; i += 1) ids.push(await seedTrip(userId, `Trip ${i}`));
      await prisma.$executeRaw`UPDATE trips SET updated_at = '2026-03-01 00:00:00' WHERE user_id = ${userId}::uuid`;
      const expected = [...ids].sort().reverse();

      const seen: string[] = [];
      for (let page = 1; page <= 3; page += 1) {
        const { body } = await listTrips(
          prisma,
          userId,
          parseListQuery({ page: String(page), limit: "2" }),
        );
        seen.push(...body.trips.map((t) => t.id));
        expect(body.has_more).toBe(page < 3);
        expect(body.page).toBe(page);
        expect(body.limit).toBe(2);
      }
      expect(seen).toEqual(expected);
    });

    it("returns an empty first page for a user with no trips", async () => {
      const userId = await createUser();
      expect((await listTrips(prisma, userId, parseListQuery({}))).body).toEqual({
        trips: [],
        page: 1,
        limit: 20,
        has_more: false,
      });
    });
  });

  describe("rename (spec §§5.5, 6.4)", () => {
    it("renames, increments version exactly once, sets updated_at, and returns the committed trip", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId, "Old");
      await prisma.$executeRaw`UPDATE trips SET updated_at = '2026-01-01 00:00:00' WHERE id = ${tripId}::uuid`;

      const outcome = await renameTrip(prisma, userId, tripId, { name: "New" }, ON);
      expect(outcome.kind).toBe("renamed");
      if (outcome.kind !== "renamed") return;
      expect(outcome.trip).toMatchObject({ id: tripId, name: "New", version: 1 });
      expect(outcome.trip.updated_at).not.toBe("2026-01-01T00:00:00.000Z");
      expect(await storedTrip(tripId)).toMatchObject({ name: "New", version: 1 });
      expect(outcome.trip).toEqual(await ownerTrip(userId, tripId));
    });

    it("accepts a matching version and refuses a stale one without changing anything", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId, "Start");
      const ok = await renameTrip(prisma, userId, tripId, { name: "One", version: 0 }, ON);
      expect(ok.kind === "renamed" && ok.trip.version).toBe(1);

      const before = await storedTrip(tripId);
      for (const stale of [0, 2, 99]) {
        expect(
          await renameTrip(prisma, userId, tripId, { name: "Two", version: stale }, ON),
        ).toEqual({ kind: "version_conflict" });
      }
      expect(await storedTrip(tripId)).toEqual(before);
    });

    it("rolls back the whole transaction on a failure after the lock (database CHECK), leaving the trip unchanged", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId, "Kept");
      const before = await storedTrip(tripId);
      // Bypasses the request validator on purpose: the database backstop rejects 101 code points.
      await expect(
        renameTrip(prisma, userId, tripId, { name: "x".repeat(101) }, ON),
      ).rejects.toThrow();
      expect(await storedTrip(tripId)).toEqual(before);
    });

    it("rolls back a successful rename when the transaction fails afterwards", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId, "Kept");
      await expect(
        prisma.$transaction(async (tx) => {
          expect(await repository.lockOwnedTrip(tx, userId, tripId)).toEqual({ version: 0 });
          expect(await repository.renameLockedTrip(tx, userId, tripId, "Changed")).toBe(true);
          throw new Error("sentinel");
        }),
      ).rejects.toThrow("sentinel");
      expect(await storedTrip(tripId)).toMatchObject({ name: "Kept", version: 0 });
    });
  });

  describe("delete", () => {
    it("deletes the trip and its stops, and nothing else", async () => {
      const userId = await createUser();
      const [a, b] = [await createLandmark(), await createLandmark()];
      const tripId = await seedTrip(userId, "Deleted");
      const keptId = await seedTrip(userId, "Kept");
      await insertStops(tripId, [a, b]);
      await insertStops(keptId, [a]);
      await prisma.review.create({ data: { userId, landmarkId: a, rating: 4 } });
      await prisma.favorite.create({ data: { userId, landmarkId: a } });

      expect(await deleteTrip(prisma, userId, tripId)).toEqual({ kind: "deleted" });
      expect(await storedTrip(tripId)).toBeNull();
      expect(await prisma.tripStop.count({ where: { tripId } })).toBe(0);
      expect(await prisma.tripStop.count({ where: { tripId: keptId } })).toBe(1);
      expect(await prisma.landmark.count({ where: { id: { in: [a, b] } } })).toBe(2);
      expect(await prisma.review.count({ where: { userId } })).toBe(1);
      expect(await prisma.favorite.count({ where: { userId } })).toBe(1);
      expect(await deleteTrip(prisma, userId, tripId)).toEqual({ kind: "not_found" });
    });
  });

  describe("owner representation and redaction (spec §§4, 7.2)", () => {
    it("an available stop has exactly the approved keys and landmark fields", async () => {
      const userId = await createUser();
      const landmark = await createLandmark({
        name: "Example Falls",
        latitude: 35.61,
        longitude: -83.52,
      });
      const tripId = await seedTrip(userId);
      const [stopId] = await insertStops(tripId, [landmark]);
      const trip = await ownerTrip(userId, tripId);
      expect(trip.stops).toEqual([
        {
          id: stopId,
          position: 0,
          is_available: true,
          distance_from_previous_miles: null,
          landmark: {
            id: landmark,
            display_name: "Example Falls",
            category: "falls",
            latitude: 35.61,
            longitude: -83.52,
          },
        },
      ]);
      expect(Object.keys(trip.stops[0]!)).toEqual([
        "id",
        "position",
        "is_available",
        "distance_from_previous_miles",
        "landmark",
      ]);
      expect(trip.distance_summary).toEqual({ total_miles: null, measured_legs: 0, total_legs: 0 });
    });

    it.each(UNAVAILABLE)(
      "a %s landmark's stop is exactly the placeholder, with no protected value anywhere in the trip",
      async (_label, state) => {
        const userId = await createUser();
        const hidden = await createLandmark({
          ...state,
          name: "Secret Sinkhole",
          latitude: 36.123456,
          longitude: -84.654321,
        });
        // A neutral trip name, so the leak scan below cannot match the trip's own name.
        const tripId = await seedTrip(userId, "Hidden stop");
        const [stopId] = await insertStops(tripId, [hidden]);
        const trip = await ownerTrip(userId, tripId);
        expect(trip.stops).toEqual([
          {
            id: stopId,
            position: 0,
            is_available: false,
            distance_from_previous_miles: null,
            landmark: { id: hidden, is_available: false },
          },
        ]);
        const json = JSON.stringify(trip);
        for (const leak of [
          "Secret Sinkhole",
          "36.123456",
          "-84.654321",
          "falls",
          "FALLS",
          "restricted",
          "example.com",
          "TRP",
          "TNFALLS",
        ]) {
          expect(json).not.toContain(leak);
        }
      },
    );

    it("the repository itself returns NULL for every landmark field and distance of an unavailable stop (defence in depth below the service)", async () => {
      const userId = await createUser();
      const visible = await createLandmark({
        name: "Open Falls",
        latitude: 35.61,
        longitude: -83.52,
      });
      const tripId = await seedTrip(userId, "Layers");
      const hiddenIds: string[] = [];
      for (const [, state] of UNAVAILABLE) {
        hiddenIds.push(await createLandmark({ ...state, name: "Secret Sinkhole" }));
      }
      const afterHidden = await createLandmark();
      await insertStops(tripId, [visible, ...hiddenIds, afterHidden]);
      const rows = await repository.findTripStops(prisma, tripId);
      expect(rows[0]).toMatchObject({
        available: true,
        displayName: "Open Falls",
        category: "FALLS",
      });
      for (const row of rows.slice(1, 1 + hiddenIds.length)) {
        expect(row).toEqual({
          id: row.id,
          position: row.position,
          landmarkId: row.landmarkId,
          available: false,
          displayName: null,
          category: null,
          latitude: null,
          longitude: null,
          distanceFromPreviousMiles: null,
        });
      }
      // The stop after the last hidden one is available, but its leg touches a hidden stop.
      expect(rows.at(-1)).toMatchObject({ available: true, distanceFromPreviousMiles: null });
    });

    it("follows the landmark's CURRENT state: hidden when retired, restored on reactivation, stop unchanged", async () => {
      const userId = await createUser();
      const landmark = await createLandmark({ name: "Comes And Goes" });
      const tripId = await seedTrip(userId);
      const [stopId] = await insertStops(tripId, [landmark]);
      expect((await ownerTrip(userId, tripId)).stops[0]!.is_available).toBe(true);

      await setLandmark(landmark, { active: false });
      expect((await ownerTrip(userId, tripId)).stops[0]).toEqual({
        id: stopId,
        position: 0,
        is_available: false,
        distance_from_previous_miles: null,
        landmark: { id: landmark, is_available: false },
      });

      await setLandmark(landmark, { active: true });
      const restored = (await ownerTrip(userId, tripId)).stops[0]!;
      expect(restored.id).toBe(stopId);
      expect(restored.is_available && restored.landmark.display_name).toBe("Comes And Goes");
      expect(await prisma.tripStop.count({ where: { tripId } })).toBe(1);
    });

    it("never selects the owner or the share-token hash", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const hash = "b".repeat(64);
      await prisma.$executeRaw`UPDATE trips SET share_token_hash = ${hash} WHERE id = ${tripId}::uuid`;
      const trip = await ownerTrip(userId, tripId);
      expect(trip.is_shared).toBe(true);
      expect(JSON.stringify(trip)).not.toContain(hash);
      expect(JSON.stringify(trip)).not.toContain(userId);
    });
  });

  describe("straight-line distances (spec §5.6)", () => {
    it("measures each leg between adjacent available stops, unrounded, matching PostGIS directly", async () => {
      const userId = await createUser();
      const a = await createLandmark({ latitude: 35.61, longitude: -83.52 });
      const b = await createLandmark({ latitude: 35.66, longitude: -83.45 });
      const c = await createLandmark({ latitude: 35.7, longitude: -83.4 });
      const tripId = await seedTrip(userId);
      await insertStops(tripId, [a, b, c]);
      const trip = await ownerTrip(userId, tripId);

      const ab = await expectedMiles(a, b);
      const bc = await expectedMiles(b, c);
      expect(trip.stops.map((s) => s.distance_from_previous_miles)).toEqual([null, ab, bc]);
      expect(trip.distance_summary).toEqual({
        total_miles: ab + bc,
        measured_legs: 2,
        total_legs: 2,
      });
      // Unrounded, and in miles (about 5.2 for the first leg), not metres.
      expect(ab).toBeGreaterThan(5);
      expect(ab).toBeLessThan(5.5);
      expect(Number.isInteger(ab * 100)).toBe(false);
    });

    it("never measures across or around an unavailable stop: A, B (unavailable), C, D → only C→D, partial 1 of 3", async () => {
      const userId = await createUser();
      const a = await createLandmark({ latitude: 35.61, longitude: -83.52 });
      const b = await createLandmark({ latitude: 35.66, longitude: -83.45, status: "SENSITIVE" });
      const c = await createLandmark({ latitude: 35.7, longitude: -83.4 });
      const d = await createLandmark({ latitude: 35.72, longitude: -83.38 });
      const tripId = await seedTrip(userId);
      await insertStops(tripId, [a, b, c, d]);
      const trip = await ownerTrip(userId, tripId);

      const cd = await expectedMiles(c, d);
      expect(trip.stops.map((s) => s.distance_from_previous_miles)).toEqual([null, null, null, cd]);
      expect(trip.distance_summary).toEqual({ total_miles: cd, measured_legs: 1, total_legs: 3 });
      // In particular, no A→C distance (which would bridge the hidden stop).
      expect(trip.stops[2]!.distance_from_previous_miles).toBeNull();
    });

    it("reports no total when no leg can be measured", async () => {
      const userId = await createUser();
      const a = await createLandmark();
      const hidden = await createLandmark({ status: "UNREVIEWED" });
      const tripId = await seedTrip(userId);
      await insertStops(tripId, [a, hidden]);
      expect((await ownerTrip(userId, tripId)).distance_summary).toEqual({
        total_miles: null,
        measured_legs: 0,
        total_legs: 1,
      });
    });

    it("empty and single-stop trips have no legs", async () => {
      const userId = await createUser();
      const empty = await seedTrip(userId, "Empty");
      const single = await seedTrip(userId, "Single");
      await insertStops(single, [await createLandmark()]);
      expect((await ownerTrip(userId, empty)).distance_summary).toEqual({
        total_miles: null,
        measured_legs: 0,
        total_legs: 0,
      });
      expect((await ownerTrip(userId, single)).distance_summary).toEqual({
        total_miles: null,
        measured_legs: 0,
        total_legs: 0,
      });
    });

    it("measures the same landmark-to-landmark distance in both directions", async () => {
      const userId = await createUser();
      const a = await createLandmark({ latitude: 35.0, longitude: -85.0 });
      const b = await createLandmark({ latitude: 36.0, longitude: -84.0 });
      const forward = await seedTrip(userId, "Forward");
      const backward = await seedTrip(userId, "Backward");
      await insertStops(forward, [a, b]);
      await insertStops(backward, [b, a]);
      expect((await ownerTrip(userId, forward)).distance_summary.total_miles).toBeCloseTo(
        (await ownerTrip(userId, backward)).distance_summary.total_miles!,
        9,
      );
    });
  });

  describe("trip-row locking through Prisma's pg adapter (spec §6.4)", () => {
    it("a lock taken inside prisma.$transaction is held until the transaction ends", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const probe = await openTestConnection();
      try {
        const tryLock = () =>
          probe.query("SELECT id FROM trips WHERE id = $1 FOR UPDATE NOWAIT", [tripId]);
        await prisma.$transaction(async (tx) => {
          expect(await repository.lockOwnedTrip(tx, userId, tripId)).toEqual({ version: 0 });
          await expect(tryLock()).rejects.toMatchObject({ code: "55P03" }); // lock_not_available
        });
        await expect(tryLock()).resolves.toMatchObject({ rowCount: 1 });
      } finally {
        await probe.end();
      }
    });

    it("a rename waits for a concurrent lock holder, then sees the committed version: stale → version_conflict", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId, "Original");
      await withTripRowLocked(tripId, async ({ blocker, blockerPid, observer, finish }) => {
        const pending = renameTrip(prisma, userId, tripId, { name: "Mine", version: 0 }, ON);
        const blockedQuery = await waitUntilBlockedBy(observer, blockerPid);
        expect(blockedQuery).toMatch(/FOR UPDATE/);
        await blocker.query(
          "UPDATE trips SET version = version + 1, updated_at = now() WHERE id = $1",
          [tripId],
        );
        await finish("COMMIT");
        expect(await pending).toEqual({ kind: "version_conflict" });
      });
      expect(await storedTrip(tripId)).toMatchObject({ name: "Original", version: 1 });
    });

    it("a rename without a version waits, then applies on top of the committed change (version + 2 in total)", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId, "Original");
      await withTripRowLocked(tripId, async ({ blocker, blockerPid, observer, finish }) => {
        const pending = renameTrip(prisma, userId, tripId, { name: "Mine" }, ON);
        await waitUntilBlockedBy(observer, blockerPid);
        await blocker.query(
          "UPDATE trips SET version = version + 1, updated_at = now() WHERE id = $1",
          [tripId],
        );
        await finish("COMMIT");
        const outcome = await pending;
        expect(outcome.kind === "renamed" && outcome.trip.version).toBe(2);
      });
      expect(await storedTrip(tripId)).toMatchObject({ name: "Mine", version: 2 });
    });

    it("concurrent renames of one trip are serialized: each succeeds once and version rises by exactly the number of renames", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const outcomes = await Promise.all(
        Array.from({ length: 8 }, (_, i) =>
          renameTrip(prisma, userId, tripId, { name: `Name ${i}` }, ON),
        ),
      );
      expect(outcomes.every((o) => o.kind === "renamed")).toBe(true);
      const versions = outcomes
        .map((o) => (o.kind === "renamed" ? o.trip.version : -1))
        .sort((x, y) => x - y);
      expect(versions).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect((await storedTrip(tripId))?.version).toBe(8);
    });

    it("a lock on one trip does not block reading or renaming another trip", async () => {
      const userId = await createUser();
      const locked = await seedTrip(userId, "Locked");
      const free = await seedTrip(userId, "Free");
      await withTripRowLocked(locked, async ({ finish }) => {
        const outcome = await renameTrip(prisma, userId, free, { name: "Renamed" }, ON);
        expect(outcome.kind).toBe("renamed");
        expect((await getTrip(prisma, userId, locked, ON)).kind).toBe("found");
        await finish("ROLLBACK");
      });
    });
  });

  describe("integrity", () => {
    it("leaves positions contiguous and no orphan stops after the operations above", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      await insertStops(tripId, [await createLandmark(), await createLandmark()]);
      await renameTrip(prisma, userId, tripId, { name: "Renamed" }, ON);
      const { rows } = await (async () => {
        const client = await openTestConnection();
        try {
          return await client.query<{ orphans: number; gaps: number }>(
            `SELECT
               (SELECT count(*)::int FROM trip_stops s LEFT JOIN trips t ON t.id = s.trip_id WHERE t.id IS NULL) AS orphans,
               (SELECT count(*)::int FROM (
                  SELECT trip_id FROM trip_stops GROUP BY trip_id HAVING max(position) <> count(*) - 1
               ) g) AS gaps`,
          );
        } finally {
          await client.end();
        }
      })();
      expect(rows[0]).toEqual({ orphans: 0, gaps: 0 });
    });
  });
});
