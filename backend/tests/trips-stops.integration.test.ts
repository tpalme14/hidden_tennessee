import { Client } from "pg";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import * as repository from "../src/trips/repository.js";
import {
  addTripStop,
  createTrip,
  getTrip,
  removeTripStop,
  reorderTripStops,
  type OwnerTripRepresentation,
} from "../src/trips/service.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";
import {
  assertConnectedToTestDatabase,
  getVerifiedTestDatabaseUrl,
} from "./setup/test-db-guard.js";

/**
 * M05-T03 Increment 3 — stop mutations (add, remove, reorder) through the
 * service and repository against the REAL landmarks_test database: the
 * amended add-stop precedence (spec v1.1 §6.4, 2026-11-23), the 25-stop limit,
 * gap-closing removal, exact-set reorder with the required version, version
 * and updated_at, rollback, privacy for unavailable landmarks, distance
 * recalculation, and concurrency — both uncontrolled races (asserting only
 * invariants, since either request may win the lock) and controlled lock
 * orders on separate connections (`pg_blocking_pids`). Every test ends with
 * the guarded resetTestDatabase().
 */

type Status = "UNREVIEWED" | "PUBLIC" | "SENSITIVE";

const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";
const ON = { sharingEnabled: true };

let sequence = 0;

async function createUser(label = "user"): Promise<string> {
  sequence += 1;
  const user = await prisma.user.create({
    data: { name: "", email: `trip-stops-${label}-${sequence}@example.com` },
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
      sourceCode: `TSP${String(sequence % 1000).padStart(3, "0")}`,
      sourceFile: "TNARCHES",
      category: "ARCH",
      displayName: options.name ?? `Stop Arch ${sequence}`,
      latitude: options.latitude ?? 35.0 + (sequence % 50) / 100,
      longitude: options.longitude ?? -85.0 + (sequence % 50) / 100,
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

async function seedTrip(userId: string, name = "Stops"): Promise<string> {
  return (await createTrip(prisma, userId, name, ON)).trip.id;
}

/** Adds through the service and returns the new stop's ID (fails the test otherwise). */
async function add(userId: string, tripId: string, landmarkId: string): Promise<string> {
  const outcome = await addTripStop(prisma, userId, tripId, landmarkId);
  if (outcome.kind !== "added") throw new Error(`add failed: ${outcome.kind}`);
  return outcome.stop.id;
}

/** Fills a trip by inserting stops directly (fixture; fast). */
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

/** Stops in position order as `[stopId, landmarkId, position]`. */
async function stored(tripId: string) {
  return prisma.tripStop.findMany({
    where: { tripId },
    orderBy: { position: "asc" },
    select: { id: true, landmarkId: true, position: true },
  });
}

async function tripState(tripId: string) {
  return prisma.trip.findUniqueOrThrow({
    where: { id: tripId },
    select: { name: true, version: true, updatedAt: true },
  });
}

async function ownerTrip(userId: string, tripId: string): Promise<OwnerTripRepresentation> {
  const outcome = await getTrip(prisma, userId, tripId, ON);
  if (outcome.kind !== "found") throw new Error("expected the trip to be found");
  return outcome.trip;
}

/** Asserts positions are exactly 0 … n-1 for the trip. */
async function expectContiguous(tripId: string) {
  const positions = (await stored(tripId)).map((s) => s.position);
  expect(positions).toEqual(positions.map((_, i) => i));
}

async function makeOld(tripId: string) {
  await prisma.$executeRaw`UPDATE trips SET updated_at = '2026-01-01 00:00:00' WHERE id = ${tripId}::uuid`;
}

async function expectedMiles(a: string, b: string): Promise<number> {
  const [row] = await prisma.$queryRaw<{ meters: number }[]>`
    SELECT ST_Distance(x.location, y.location) AS meters
    FROM landmarks x, landmarks y WHERE x.id = ${a}::uuid AND y.id = ${b}::uuid`;
  return row!.meters / 1609.344;
}

// ---------------------------------------------------------------------------
// Controlled lock order (same approach as the reviews and trips suites)
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

/**
 * Locks the trip row in a separate transaction (exactly as the service does
 * first), runs `scenario` while it is held, and always releases it.
 */
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

const UNAVAILABLE: [string, { status?: Status; active?: boolean }][] = [
  ["SENSITIVE", { status: "SENSITIVE" }],
  ["UNREVIEWED", { status: "UNREVIEWED" }],
  ["inactive (PUBLIC)", { status: "PUBLIC", active: false }],
  ["inactive (SENSITIVE)", { status: "SENSITIVE", active: false }],
];

describe("trip stop mutations (integration, M05-T03 Increment 3)", () => {
  afterEach(async () => {
    await resetTestDatabase();
  });

  describe("add stop", () => {
    it("appends at position = count with the exact add-stop shape (no distance), version + 1, updated_at set", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const first = await createLandmark({ name: "First Arch", latitude: 35.5, longitude: -84.5 });
      const second = await createLandmark({
        name: "Second Arch",
        latitude: 35.6,
        longitude: -84.4,
      });
      await add(userId, tripId, first);
      await makeOld(tripId);

      const outcome = await addTripStop(prisma, userId, tripId, second);
      expect(outcome.kind).toBe("added");
      if (outcome.kind !== "added") return;
      expect(Object.keys(outcome.stop)).toEqual(["id", "position", "is_available", "landmark"]);
      expect(outcome.stop).toEqual({
        id: outcome.stop.id,
        position: 1,
        is_available: true,
        landmark: {
          id: second,
          display_name: "Second Arch",
          category: "arch",
          latitude: 35.6,
          longitude: -84.4,
        },
      });
      const state = await tripState(tripId);
      expect(state.version).toBe(2);
      expect(state.updatedAt.toISOString()).not.toBe("2026-01-01T00:00:00.000Z");
      expect((await stored(tripId)).map((s) => s.landmarkId)).toEqual([first, second]);
      await expectContiguous(tripId);
    });

    it("another user's trip and an unknown trip give the identical not_found, and nothing changes", async () => {
      const owner = await createUser("owner");
      const other = await createUser("other");
      const tripId = await seedTrip(owner);
      const landmark = await createLandmark();
      const asOther = await addTripStop(prisma, other, tripId, landmark);
      const unknown = await addTripStop(prisma, owner, UNKNOWN_UUID, landmark);
      expect(asOther).toEqual({ kind: "not_found" });
      expect(unknown).toEqual(asOther);
      expect(await stored(tripId)).toEqual([]);
      expect((await tripState(tripId)).version).toBe(0);
    });

    it.each(UNAVAILABLE)(
      "a %s landmark gives the same not_found as a nonexistent landmark, with no data and no change",
      async (_label, state) => {
        const userId = await createUser();
        const tripId = await seedTrip(userId);
        const hidden = await createLandmark({ ...state, name: "Secret Arch" });
        const unavailable = await addTripStop(prisma, userId, tripId, hidden);
        const nonexistent = await addTripStop(prisma, userId, tripId, UNKNOWN_UUID);
        expect(unavailable).toEqual({ kind: "not_found" });
        expect(nonexistent).toEqual(unavailable);
        expect(JSON.stringify(unavailable)).not.toContain("Secret");
        expect(await stored(tripId)).toEqual([]);
        expect((await tripState(tripId)).version).toBe(0);
      },
    );

    it("a visible landmark already in the trip → already_exists, nothing changes", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const landmark = await createLandmark();
      await add(userId, tripId, landmark);
      const before = await tripState(tripId);
      expect(await addTripStop(prisma, userId, tripId, landmark)).toEqual({
        kind: "already_exists",
      });
      expect(await tripState(tripId)).toEqual(before);
      expect(await stored(tripId)).toHaveLength(1);
    });

    it("the same landmark may be a stop of different trips", async () => {
      const userId = await createUser();
      const landmark = await createLandmark();
      const one = await seedTrip(userId, "One");
      const two = await seedTrip(userId, "Two");
      await add(userId, one, landmark);
      expect((await addTripStop(prisma, userId, two, landmark)).kind).toBe("added");
    });

    it("an unavailable landmark that is ALREADY a stop gives not_found (visibility is checked before duplicates)", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const landmark = await createLandmark();
      await add(userId, tripId, landmark);
      await setLandmark(landmark, { status: "SENSITIVE" });
      expect(await addTripStop(prisma, userId, tripId, landmark)).toEqual({ kind: "not_found" });
      expect(await stored(tripId)).toHaveLength(1);
    });

    it("allows exactly 25 stops; a 26th new visible landmark → limit_reached", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const landmarks = await createLandmarks(26);
      for (const id of landmarks.slice(0, 25)) await add(userId, tripId, id);
      expect((await tripState(tripId)).version).toBe(25);
      expect(await addTripStop(prisma, userId, tripId, landmarks[25]!)).toEqual({
        kind: "limit_reached",
      });
      expect((await tripState(tripId)).version).toBe(25);
      expect(await stored(tripId)).toHaveLength(25);
      await expectContiguous(tripId);
    });

    it("on a FULL trip, the amended precedence holds: unknown/unavailable → not_found, existing → already_exists, new → limit_reached", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const landmarks = await createLandmarks(25);
      await fillDirectly(tripId, landmarks);
      const existingVisible = landmarks[3]!;
      const existingNowHidden = landmarks[7]!;
      await setLandmark(existingNowHidden, { active: false });
      const newVisible = await createLandmark();
      const newHidden = await createLandmark({ status: "UNREVIEWED" });
      const before = await tripState(tripId);

      expect(await addTripStop(prisma, userId, tripId, UNKNOWN_UUID)).toEqual({
        kind: "not_found",
      });
      expect(await addTripStop(prisma, userId, tripId, newHidden)).toEqual({ kind: "not_found" });
      expect(await addTripStop(prisma, userId, tripId, existingNowHidden)).toEqual({
        kind: "not_found",
      });
      expect(await addTripStop(prisma, userId, tripId, existingVisible)).toEqual({
        kind: "already_exists",
      });
      expect(await addTripStop(prisma, userId, tripId, newVisible)).toEqual({
        kind: "limit_reached",
      });
      expect(await tripState(tripId)).toEqual(before);
      expect(await stored(tripId)).toHaveLength(25);
    });

    it("rolls back completely when the transaction fails after the insert", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const landmark = await createLandmark();
      await expect(
        prisma.$transaction(async (tx) => {
          await repository.lockOwnedTrip(tx, userId, tripId);
          expect(await repository.insertVisibleStop(tx, tripId, landmark, 0)).not.toBeNull();
          await repository.bumpLockedTripVersion(tx, userId, tripId);
          throw new Error("sentinel");
        }),
      ).rejects.toThrow("sentinel");
      expect(await stored(tripId)).toEqual([]);
      expect((await tripState(tripId)).version).toBe(0);
    });

    it("the insert backstop inserts nothing for a duplicate or a no-longer-visible landmark", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const landmark = await createLandmark();
      await add(userId, tripId, landmark);
      expect(await repository.insertVisibleStop(prisma, tripId, landmark, 1)).toBeNull();
      const hidden = await createLandmark({ status: "SENSITIVE" });
      expect(await repository.insertVisibleStop(prisma, tripId, hidden, 1)).toBeNull();
      expect(await stored(tripId)).toHaveLength(1);
    });
  });

  describe("remove stop", () => {
    it.each([
      ["first", 0],
      ["middle", 2],
      ["last", 4],
    ])(
      "removes the %s stop, closes the gap, keeps the order, version + 1",
      async (_label, index) => {
        const userId = await createUser();
        const tripId = await seedTrip(userId);
        const landmarks = await createLandmarks(5);
        const stopIds = await fillDirectly(tripId, landmarks);
        await makeOld(tripId);

        expect(await removeTripStop(prisma, userId, tripId, stopIds[index]!)).toEqual({
          kind: "removed",
        });
        const expected = landmarks.filter((_, i) => i !== index);
        expect((await stored(tripId)).map((s) => s.landmarkId)).toEqual(expected);
        await expectContiguous(tripId);
        const state = await tripState(tripId);
        expect(state.version).toBe(1);
        expect(state.updatedAt.toISOString()).not.toBe("2026-01-01T00:00:00.000Z");
      },
    );

    it("an unknown stop, a stop of another trip, and another user's trip → not_found, version unchanged", async () => {
      const owner = await createUser("owner");
      const other = await createUser("other");
      const tripId = await seedTrip(owner, "Mine");
      const otherTripId = await seedTrip(owner, "Also mine");
      const [stop] = await fillDirectly(tripId, [await createLandmark()]);
      const [foreignStop] = await fillDirectly(otherTripId, [await createLandmark()]);

      expect(await removeTripStop(prisma, owner, tripId, UNKNOWN_UUID)).toEqual({
        kind: "not_found",
      });
      expect(await removeTripStop(prisma, owner, tripId, foreignStop!)).toEqual({
        kind: "not_found",
      });
      expect(await removeTripStop(prisma, other, tripId, stop!)).toEqual({ kind: "not_found" });
      expect(await stored(tripId)).toHaveLength(1);
      expect(await stored(otherTripId)).toHaveLength(1);
      expect((await tripState(tripId)).version).toBe(0);
      expect((await tripState(otherTripId)).version).toBe(0);
    });

    it("removes a stop whose landmark is no longer available, and the last remaining stop", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const landmark = await createLandmark();
      const [stop] = await fillDirectly(tripId, [landmark]);
      await setLandmark(landmark, { status: "SENSITIVE" });
      expect(await removeTripStop(prisma, userId, tripId, stop!)).toEqual({ kind: "removed" });
      expect(await stored(tripId)).toEqual([]);
      expect((await ownerTrip(userId, tripId)).distance_summary).toEqual({
        total_miles: null,
        measured_legs: 0,
        total_legs: 0,
      });
    });

    it("existing stops stay when their landmark becomes unavailable (never silently deleted)", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const landmark = await createLandmark();
      await add(userId, tripId, landmark);
      await setLandmark(landmark, { status: "UNREVIEWED", active: false });
      expect(await stored(tripId)).toHaveLength(1);
      expect((await ownerTrip(userId, tripId)).stops[0]!.is_available).toBe(false);
    });

    it("recalculates distances: removing an unavailable middle stop makes its neighbours adjacent and measured", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const a = await createLandmark({ latitude: 35.61, longitude: -83.52 });
      const hidden = await createLandmark({ status: "SENSITIVE" });
      const c = await createLandmark({ latitude: 35.7, longitude: -83.4 });
      const [, hiddenStop] = await fillDirectly(tripId, [a, hidden, c]);
      expect((await ownerTrip(userId, tripId)).distance_summary).toEqual({
        total_miles: null,
        measured_legs: 0,
        total_legs: 2,
      });
      await removeTripStop(prisma, userId, tripId, hiddenStop!);
      const ac = await expectedMiles(a, c);
      expect((await ownerTrip(userId, tripId)).distance_summary).toEqual({
        total_miles: ac,
        measured_legs: 1,
        total_legs: 1,
      });
    });
  });

  describe("reorder", () => {
    it("persists the exact requested order, version + 1, and returns the committed trip with recalculated distances", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const [a, b, c] = [
        await createLandmark({ latitude: 35.61, longitude: -83.52 }),
        await createLandmark({ latitude: 35.66, longitude: -83.45 }),
        await createLandmark({ latitude: 35.7, longitude: -83.4 }),
      ];
      const [sa, sb, sc] = await fillDirectly(tripId, [a, b, c]);
      await makeOld(tripId);

      const outcome = await reorderTripStops(
        prisma,
        userId,
        tripId,
        { stopIds: [sc!, sa!, sb!], version: 0 },
        ON,
      );
      expect(outcome.kind).toBe("reordered");
      if (outcome.kind !== "reordered") return;
      expect(outcome.trip.version).toBe(1);
      expect(outcome.trip.updated_at).not.toBe("2026-01-01T00:00:00.000Z");
      expect(outcome.trip.stops.map((s) => s.id)).toEqual([sc, sa, sb]);
      expect(outcome.trip.stops.map((s) => s.position)).toEqual([0, 1, 2]);
      const ca = await expectedMiles(c, a);
      const ab = await expectedMiles(a, b);
      expect(outcome.trip.stops.map((s) => s.distance_from_previous_miles)).toEqual([null, ca, ab]);
      expect(outcome.trip).toEqual(await ownerTrip(userId, tripId));
    });

    it("reverses 25 stops in one call (the deferrable position constraint at full size)", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const stopIds = await fillDirectly(tripId, await createLandmarks(25));
      const reversed = [...stopIds].reverse();
      const outcome = await reorderTripStops(
        prisma,
        userId,
        tripId,
        { stopIds: reversed, version: 0 },
        ON,
      );
      expect(outcome.kind).toBe("reordered");
      expect((await stored(tripId)).map((s) => s.id)).toEqual(reversed);
      await expectContiguous(tripId);
    });

    it("an unchanged order still succeeds and increments version", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const stopIds = await fillDirectly(tripId, await createLandmarks(3));
      const outcome = await reorderTripStops(prisma, userId, tripId, { stopIds, version: 0 }, ON);
      expect(outcome.kind === "reordered" && outcome.trip.version).toBe(1);
    });

    it("a stale version → version_conflict and nothing changes (checked before the stop set)", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const stopIds = await fillDirectly(tripId, await createLandmarks(3));
      const before = await stored(tripId);
      const state = await tripState(tripId);
      for (const version of [1, 5]) {
        expect(
          await reorderTripStops(
            prisma,
            userId,
            tripId,
            { stopIds: [...stopIds].reverse(), version },
            ON,
          ),
        ).toEqual({ kind: "version_conflict" });
      }
      // A stale version AND an invalid list: the version check wins.
      expect(
        await reorderTripStops(prisma, userId, tripId, { stopIds: [UNKNOWN_UUID], version: 9 }, ON),
      ).toEqual({ kind: "version_conflict" });
      expect(await stored(tripId)).toEqual(before);
      expect(await tripState(tripId)).toEqual(state);
    });

    it("an incomplete, extra, unknown, foreign, or duplicated list → invalid_stop_ids and nothing changes", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const otherTripId = await seedTrip(userId, "Other");
      const [s1, s2, s3] = await fillDirectly(tripId, await createLandmarks(3));
      const [foreign] = await fillDirectly(otherTripId, [await createLandmark()]);
      const before = await stored(tripId);
      for (const stopIds of [
        [s1!, s2!],
        [s1!, s2!, s3!, foreign!],
        [s1!, s2!, UNKNOWN_UUID],
        [s1!, s2!, foreign!],
        [s1!, s1!, s2!],
      ]) {
        expect(await reorderTripStops(prisma, userId, tripId, { stopIds, version: 0 }, ON)).toEqual(
          {
            kind: "invalid_stop_ids",
          },
        );
      }
      expect(await stored(tripId)).toEqual(before);
      expect((await tripState(tripId)).version).toBe(0);
      expect((await tripState(otherTripId)).version).toBe(0);
    });

    it("another user's trip and an unknown trip → not_found", async () => {
      const owner = await createUser("owner");
      const other = await createUser("other");
      const tripId = await seedTrip(owner);
      const stopIds = await fillDirectly(tripId, await createLandmarks(2));
      expect(await reorderTripStops(prisma, other, tripId, { stopIds, version: 0 }, ON)).toEqual({
        kind: "not_found",
      });
      expect(
        await reorderTripStops(prisma, owner, UNKNOWN_UUID, { stopIds, version: 0 }, ON),
      ).toEqual({ kind: "not_found" });
      expect((await tripState(tripId)).version).toBe(0);
    });

    it("a position rewrite whose final positions collide fails at the database and rolls back the whole transaction", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const [s1, s2] = await fillDirectly(tripId, await createLandmarks(2));
      const before = await stored(tripId);
      await expect(
        prisma.$transaction(async (tx) => {
          await repository.lockOwnedTrip(tx, userId, tripId);
          await repository.bumpLockedTripVersion(tx, userId, tripId);
          // Only s2 is moved, to position 0, which s1 still holds: a real duplicate.
          await repository.rewriteStopPositions(tx, tripId, [s2!]);
        }),
      ).rejects.toThrow();
      expect(await stored(tripId)).toEqual(before);
      expect((await tripState(tripId)).version).toBe(0);
      expect(s1).toBeDefined();
    });
  });

  describe("concurrency — uncontrolled races (either request may win; invariants only)", () => {
    it("30 concurrent adds of different landmarks → exactly 25 added, 5 limit_reached, positions 0–24, version 25", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const landmarks = await createLandmarks(30);
      const outcomes = await Promise.all(
        landmarks.map((id) => addTripStop(prisma, userId, tripId, id)),
      );
      const kinds = outcomes.map((o) => o.kind);
      expect(kinds.filter((k) => k === "added")).toHaveLength(25);
      expect(kinds.filter((k) => k === "limit_reached")).toHaveLength(5);
      const positions = outcomes.flatMap((o) => (o.kind === "added" ? [o.stop.position] : []));
      expect([...positions].sort((x, y) => x - y)).toEqual(Array.from({ length: 25 }, (_, i) => i));
      await expectContiguous(tripId);
      expect((await tripState(tripId)).version).toBe(25);
    });

    it("10 concurrent adds of the SAME landmark → exactly one added, nine already_exists, version 1", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const landmark = await createLandmark();
      const outcomes = await Promise.all(
        Array.from({ length: 10 }, () => addTripStop(prisma, userId, tripId, landmark)),
      );
      expect(outcomes.filter((o) => o.kind === "added")).toHaveLength(1);
      expect(outcomes.filter((o) => o.kind === "already_exists")).toHaveLength(9);
      expect(await stored(tripId)).toHaveLength(1);
      expect((await tripState(tripId)).version).toBe(1);
    });

    it("concurrent removes of different stops all succeed; positions stay contiguous and the order is kept", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const landmarks = await createLandmarks(8);
      const stopIds = await fillDirectly(tripId, landmarks);
      const removed = [0, 2, 5, 7];
      const outcomes = await Promise.all(
        removed.map((i) => removeTripStop(prisma, userId, tripId, stopIds[i]!)),
      );
      expect(outcomes.every((o) => o.kind === "removed")).toBe(true);
      expect((await stored(tripId)).map((s) => s.landmarkId)).toEqual(
        landmarks.filter((_, i) => !removed.includes(i)),
      );
      await expectContiguous(tripId);
      expect((await tripState(tripId)).version).toBe(4);
    });

    it("concurrent removes of the SAME stop → exactly one removed, the rest not_found, version 1", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const stopIds = await fillDirectly(tripId, await createLandmarks(3));
      const outcomes = await Promise.all(
        Array.from({ length: 6 }, () => removeTripStop(prisma, userId, tripId, stopIds[1]!)),
      );
      expect(outcomes.filter((o) => o.kind === "removed")).toHaveLength(1);
      expect(outcomes.filter((o) => o.kind === "not_found")).toHaveLength(5);
      await expectContiguous(tripId);
      expect((await tripState(tripId)).version).toBe(1);
    });

    it("a reorder racing an add: one of the two valid serializations, never a lost or duplicated stop (5 rounds)", async () => {
      for (let round = 0; round < 5; round += 1) {
        const userId = await createUser();
        const tripId = await seedTrip(userId);
        const stopIds = await fillDirectly(tripId, await createLandmarks(3));
        const extra = await createLandmark();
        const reversed = [...stopIds].reverse();

        const [reorder, added] = await Promise.all([
          reorderTripStops(prisma, userId, tripId, { stopIds: reversed, version: 0 }, ON),
          addTripStop(prisma, userId, tripId, extra),
        ]);
        expect(added.kind).toBe("added");
        const finalIds = (await stored(tripId)).map((s) => s.id);
        const addedId = added.kind === "added" ? added.stop.id : "";
        if (reorder.kind === "reordered") {
          // Reorder first: the add appended after the reversed order.
          expect(finalIds).toEqual([...reversed, addedId]);
          expect((await tripState(tripId)).version).toBe(2);
        } else {
          // Add first: the reorder's version 0 was stale.
          expect(reorder).toEqual({ kind: "version_conflict" });
          expect(finalIds).toEqual([...stopIds, addedId]);
          expect((await tripState(tripId)).version).toBe(1);
        }
        await expectContiguous(tripId);
      }
    });

    it("a mixed burst of adds, removes, and reorders leaves a consistent trip", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const stopIds = await fillDirectly(tripId, await createLandmarks(6));
      const newLandmarks = await createLandmarks(6);
      const outcomes = await Promise.all([
        ...newLandmarks.map((id) => addTripStop(prisma, userId, tripId, id)),
        ...stopIds.slice(0, 3).map((id) => removeTripStop(prisma, userId, tripId, id)),
        reorderTripStops(
          prisma,
          userId,
          tripId,
          { stopIds: [...stopIds].reverse(), version: 0 },
          ON,
        ),
      ]);
      const successes = outcomes.filter((o) =>
        ["added", "removed", "reordered"].includes(o.kind),
      ).length;
      await expectContiguous(tripId);
      const finalStops = await stored(tripId);
      expect(finalStops).toHaveLength(6 + 6 - 3);
      expect(new Set(finalStops.map((s) => s.landmarkId)).size).toBe(finalStops.length);
      expect((await tripState(tripId)).version).toBe(successes);
    });
  });

  describe("concurrency — controlled lock order", () => {
    it("a reorder waiting behind a committed add sees the new version → version_conflict; the add is kept", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const stopIds = await fillDirectly(tripId, await createLandmarks(3));
      const extra = await createLandmark();
      await withTripRowLocked(tripId, async ({ blocker, blockerPid, observer, finish }) => {
        const pending = reorderTripStops(
          prisma,
          userId,
          tripId,
          { stopIds: [...stopIds].reverse(), version: 0 },
          ON,
        );
        expect(await waitUntilBlockedBy(observer, blockerPid)).toMatch(/FOR UPDATE/);
        // The holder performs an add, as the service would, and commits.
        await blocker.query(
          "INSERT INTO trip_stops (trip_id, landmark_id, position) VALUES ($1, $2, 3)",
          [tripId, extra],
        );
        await blocker.query(
          "UPDATE trips SET version = version + 1, updated_at = now() WHERE id = $1",
          [tripId],
        );
        await finish("COMMIT");
        expect(await pending).toEqual({ kind: "version_conflict" });
      });
      expect((await stored(tripId)).map((s) => s.landmarkId).at(-1)).toBe(extra);
      expect((await stored(tripId)).slice(0, 3).map((s) => s.id)).toEqual(stopIds);
      expect((await tripState(tripId)).version).toBe(1);
    });

    it("a reorder waiting behind a lock holder that changes nothing succeeds once the lock is released", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const stopIds = await fillDirectly(tripId, await createLandmarks(3));
      const reversed = [...stopIds].reverse();
      await withTripRowLocked(tripId, async ({ blockerPid, observer, finish }) => {
        const pending = reorderTripStops(
          prisma,
          userId,
          tripId,
          { stopIds: reversed, version: 0 },
          ON,
        );
        await waitUntilBlockedBy(observer, blockerPid);
        await finish("ROLLBACK");
        const outcome = await pending;
        expect(outcome.kind === "reordered" && outcome.trip.version).toBe(1);
      });
      expect((await stored(tripId)).map((s) => s.id)).toEqual(reversed);
    });

    it("an add waiting behind a holder that fills the 25th slot → limit_reached", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const landmarks = await createLandmarks(26);
      await fillDirectly(tripId, landmarks.slice(0, 24));
      await withTripRowLocked(tripId, async ({ blocker, blockerPid, observer, finish }) => {
        const pending = addTripStop(prisma, userId, tripId, landmarks[25]!);
        await waitUntilBlockedBy(observer, blockerPid);
        await blocker.query(
          "INSERT INTO trip_stops (trip_id, landmark_id, position) VALUES ($1, $2, 24)",
          [tripId, landmarks[24]],
        );
        await blocker.query("UPDATE trips SET version = version + 1 WHERE id = $1", [tripId]);
        await finish("COMMIT");
        expect(await pending).toEqual({ kind: "limit_reached" });
      });
      expect(await stored(tripId)).toHaveLength(25);
      expect((await tripState(tripId)).version).toBe(1);
    });

    it("a remove waiting behind a holder that already removed the same stop → not_found, version changed only once", async () => {
      const userId = await createUser();
      const tripId = await seedTrip(userId);
      const stopIds = await fillDirectly(tripId, await createLandmarks(3));
      await withTripRowLocked(tripId, async ({ blocker, blockerPid, observer, finish }) => {
        const pending = removeTripStop(prisma, userId, tripId, stopIds[0]!);
        await waitUntilBlockedBy(observer, blockerPid);
        await blocker.query("DELETE FROM trip_stops WHERE id = $1", [stopIds[0]]);
        await blocker.query(
          "UPDATE trip_stops SET position = position - 1 WHERE trip_id = $1 AND position > 0",
          [tripId],
        );
        await blocker.query("UPDATE trips SET version = version + 1 WHERE id = $1", [tripId]);
        await finish("COMMIT");
        expect(await pending).toEqual({ kind: "not_found" });
      });
      await expectContiguous(tripId);
      expect((await tripState(tripId)).version).toBe(1);
    });
  });
});
