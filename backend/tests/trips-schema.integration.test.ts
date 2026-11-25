import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertConnectedToTestDatabase,
  getVerifiedTestDatabaseUrl,
} from "./setup/test-db-guard.js";

/**
 * M05-T02 Increment 1b — proves the `trips` and `trip_stops` tables'
 * database-level rules against the REAL landmarks_test database (ADR-009),
 * exactly as designed in M05-T01 / ADR-014 decision 14 and
 * specs/TRIP_PLANNING_SPEC.md v1.1 §§3, 6.4, 10.3: columns and defaults,
 * indexes, RESTRICT/CASCADE foreign keys, the hand-written CHECK constraints,
 * the ORDINARY unique (trip_id, landmark_id) index, and the
 * DEFERRABLE INITIALLY IMMEDIATE unique (trip_id, position) constraint that
 * makes single-statement reorders and removal shifts possible.
 *
 * ISOLATION: like reviews-schema, this file never calls resetTestDatabase().
 * Every behavioural test runs inside its own transaction that is ALWAYS rolled
 * back, with synthetic fixtures created inside it, so the suite leaves no rows
 * behind and never truncates existing data.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_NAME = "20261123000000_trips";
const MIGRATION_DIR = path.resolve(__dirname, `../prisma/migrations/${MIGRATION_NAME}`);
const MIGRATION_SQL_BYTES = readFileSync(path.join(MIGRATION_DIR, "migration.sql"));
const MIGRATION_SQL = MIGRATION_SQL_BYTES.toString("utf8");
const DOWN_SQL = readFileSync(path.join(MIGRATION_DIR, "down.sql"), "utf8");

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

/** A supplementary-plane character: one code point, two UTF-16 code units. */
const NON_BMP = String.fromCodePoint(0x1f3de);

/** SHA-256 hex digests, as the service will store them (spec §10.3). */
const HASH_A = createHash("sha256").update("token-a").digest("hex");
const HASH_B = createHash("sha256").update("token-b").digest("hex");

let client: Client;

beforeAll(async () => {
  const url = getVerifiedTestDatabaseUrl();
  await assertConnectedToTestDatabase(url);
  client = new Client({ connectionString: url });
  await client.connect();
});

afterAll(async () => {
  await client?.end();
});

interface Fixture {
  userId: string;
  otherUserId: string;
  landmarkIds: string[];
}

let sequence = 0;

async function createUser(label: string): Promise<string> {
  sequence += 1;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (name, email, updated_at) VALUES ('', $1, CURRENT_TIMESTAMP) RETURNING id`,
    [`trips-schema-${label}-${sequence}-${Date.now()}@example.com`],
  );
  return rows[0]!.id;
}

async function createLandmark(): Promise<string> {
  sequence += 1;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO landmarks (source_code, source_file, category, display_name, latitude, longitude, updated_at)
     VALUES ($1, 'TNARCHES', 'ARCH', 'Trips schema fixture', 35.1869, -85.6103, CURRENT_TIMESTAMP)
     RETURNING id`,
    [`ZTS${String(sequence % 1000).padStart(3, "0")}`],
  );
  return rows[0]!.id;
}

/**
 * Runs `body` inside a transaction that is always rolled back, with fresh
 * synthetic users and `landmarkCount` landmarks created inside it.
 */
async function inRolledBackTransaction(
  body: (f: Fixture) => Promise<void>,
  landmarkCount = 3,
): Promise<void> {
  await client.query("BEGIN");
  try {
    const landmarkIds: string[] = [];
    for (let i = 0; i < landmarkCount; i += 1) landmarkIds.push(await createLandmark());
    await body({
      userId: await createUser("a"),
      otherUserId: await createUser("b"),
      landmarkIds,
    });
  } finally {
    await client.query("ROLLBACK");
  }
}

/** Runs one statement under a savepoint; returns the SQLSTATE and constraint, or null on success. */
async function attempt(
  sql: string,
  params: unknown[],
): Promise<{ code: string; constraint?: string } | null> {
  await client.query("SAVEPOINT attempt");
  try {
    await client.query(sql, params);
    await client.query("RELEASE SAVEPOINT attempt");
    return null;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT attempt");
    const e = error as { code?: string; constraint?: string };
    return { code: e.code ?? "unknown", constraint: e.constraint };
  }
}

const INSERT_TRIP = "INSERT INTO trips (user_id, name) VALUES ($1::uuid, $2)";
const INSERT_STOP =
  "INSERT INTO trip_stops (trip_id, landmark_id, position) VALUES ($1::uuid, $2::uuid, $3)";

async function createTrip(userId: string, name = "Weekend Waterfalls"): Promise<string> {
  const { rows } = await client.query<{ id: string }>(`${INSERT_TRIP} RETURNING id`, [
    userId,
    name,
  ]);
  return rows[0]!.id;
}

/** Landmark IDs of a trip's stops, in position order, with their positions. */
async function stopOrder(tripId: string): Promise<{ landmark_id: string; position: number }[]> {
  const { rows } = await client.query<{ landmark_id: string; position: number }>(
    "SELECT landmark_id, position FROM trip_stops WHERE trip_id = $1::uuid ORDER BY position",
    [tripId],
  );
  return rows;
}

/** Rewrites every listed stop's position in ONE statement (the spec §6.4 reorder form). */
const REWRITE_POSITIONS = `
  UPDATE trip_stops s SET position = v.position
  FROM unnest($2::uuid[], $3::int[]) AS v(landmark_id, position)
  WHERE s.trip_id = $1::uuid AND s.landmark_id = v.landmark_id`;

describe("trips schema (integration, M05-T02 Increment 1b)", () => {
  describe("migration and catalog", () => {
    it("records the trips migration as applied, finished, not rolled back, with the file's checksum", async () => {
      const { rows } = await client.query<{
        checksum: string;
        finished: boolean;
        rolled_back: boolean;
      }>(
        `SELECT checksum, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back
         FROM _prisma_migrations WHERE migration_name = $1`,
        [MIGRATION_NAME],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({
        checksum: createHash("sha256").update(MIGRATION_SQL_BYTES).digest("hex"),
        finished: true,
        rolled_back: false,
      });
    });

    it("trips has exactly the approved columns, types, nullability, and defaults", async () => {
      const { rows } = await client.query(
        `SELECT column_name, data_type, is_nullable, column_default, datetime_precision
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'trips'
         ORDER BY ordinal_position`,
      );
      const column = (
        name: string,
        type: string,
        nullable: "YES" | "NO",
        def: string | null,
        precision: number | null = null,
      ) => ({
        column_name: name,
        data_type: type,
        is_nullable: nullable,
        column_default: def,
        datetime_precision: precision,
      });
      expect(rows).toEqual([
        column("id", "uuid", "NO", "gen_random_uuid()"),
        column("user_id", "uuid", "NO", null),
        column("name", "text", "NO", null),
        column("version", "integer", "NO", "0"),
        column("share_token_hash", "text", "YES", null),
        column("created_at", "timestamp without time zone", "NO", "CURRENT_TIMESTAMP", 3),
        column("updated_at", "timestamp without time zone", "NO", "CURRENT_TIMESTAMP", 3),
      ]);
    });

    it("trip_stops has exactly the approved columns, types, nullability, and defaults", async () => {
      const { rows } = await client.query(
        `SELECT column_name, data_type, is_nullable, column_default, datetime_precision
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'trip_stops'
         ORDER BY ordinal_position`,
      );
      expect(rows).toEqual([
        {
          column_name: "id",
          data_type: "uuid",
          is_nullable: "NO",
          column_default: "gen_random_uuid()",
          datetime_precision: null,
        },
        {
          column_name: "trip_id",
          data_type: "uuid",
          is_nullable: "NO",
          column_default: null,
          datetime_precision: null,
        },
        {
          column_name: "landmark_id",
          data_type: "uuid",
          is_nullable: "NO",
          column_default: null,
          datetime_precision: null,
        },
        {
          column_name: "position",
          data_type: "integer",
          is_nullable: "NO",
          column_default: null,
          datetime_precision: null,
        },
        {
          column_name: "created_at",
          data_type: "timestamp without time zone",
          is_nullable: "NO",
          column_default: "CURRENT_TIMESTAMP",
          datetime_precision: 3,
        },
      ]);
    });

    it("has exactly the approved indexes on both tables", async () => {
      const { rows } = await client.query(
        `SELECT tablename, indexname, indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND tablename IN ('trips', 'trip_stops')
         ORDER BY tablename, indexname`,
      );
      expect(rows).toEqual([
        {
          tablename: "trip_stops",
          indexname: "trip_stops_pkey",
          indexdef: "CREATE UNIQUE INDEX trip_stops_pkey ON public.trip_stops USING btree (id)",
        },
        {
          tablename: "trip_stops",
          indexname: "trip_stops_trip_id_landmark_id_key",
          indexdef:
            "CREATE UNIQUE INDEX trip_stops_trip_id_landmark_id_key ON public.trip_stops USING btree (trip_id, landmark_id)",
        },
        {
          tablename: "trip_stops",
          indexname: "trip_stops_trip_id_position_key",
          indexdef:
            'CREATE UNIQUE INDEX trip_stops_trip_id_position_key ON public.trip_stops USING btree (trip_id, "position")',
        },
        {
          tablename: "trips",
          indexname: "trips_pkey",
          indexdef: "CREATE UNIQUE INDEX trips_pkey ON public.trips USING btree (id)",
        },
        {
          tablename: "trips",
          indexname: "trips_share_token_hash_key",
          indexdef:
            "CREATE UNIQUE INDEX trips_share_token_hash_key ON public.trips USING btree (share_token_hash)",
        },
        {
          tablename: "trips",
          indexname: "trips_user_id_updated_at_id_idx",
          indexdef:
            "CREATE INDEX trips_user_id_updated_at_id_idx ON public.trips USING btree (user_id, updated_at DESC, id DESC)",
        },
      ]);
    });

    it("trips has exactly the approved constraints: PK, the RESTRICT user foreign key, and three CHECKs", async () => {
      const { rows } = await client.query(
        `SELECT conname, contype, pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conrelid = 'public.trips'::regclass ORDER BY conname`,
      );
      expect(rows).toEqual([
        {
          conname: "trips_name_length_check",
          contype: "c",
          def: "CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100)))",
        },
        { conname: "trips_pkey", contype: "p", def: "PRIMARY KEY (id)" },
        {
          conname: "trips_share_token_hash_format_check",
          contype: "c",
          def: "CHECK (((share_token_hash IS NULL) OR (share_token_hash ~ '^[0-9a-f]{64}$'::text)))",
        },
        {
          conname: "trips_user_id_fkey",
          contype: "f",
          def: "FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT",
        },
        { conname: "trips_version_check", contype: "c", def: "CHECK ((version >= 0))" },
      ]);
    });

    it("trip_stops has exactly the approved constraints: PK, CASCADE/RESTRICT foreign keys, the position CHECK, and the position unique", async () => {
      const { rows } = await client.query(
        `SELECT conname, contype, pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conrelid = 'public.trip_stops'::regclass ORDER BY conname`,
      );
      expect(rows).toEqual([
        {
          conname: "trip_stops_landmark_id_fkey",
          contype: "f",
          def: "FOREIGN KEY (landmark_id) REFERENCES landmarks(id) ON UPDATE CASCADE ON DELETE RESTRICT",
        },
        { conname: "trip_stops_pkey", contype: "p", def: "PRIMARY KEY (id)" },
        {
          conname: "trip_stops_position_check",
          contype: "c",
          def: 'CHECK ((("position" >= 0) AND ("position" <= 24)))',
        },
        {
          conname: "trip_stops_trip_id_fkey",
          contype: "f",
          def: "FOREIGN KEY (trip_id) REFERENCES trips(id) ON UPDATE CASCADE ON DELETE CASCADE",
        },
        {
          conname: "trip_stops_trip_id_position_key",
          contype: "u",
          def: 'UNIQUE (trip_id, "position") DEFERRABLE',
        },
      ]);
    });

    it("the (trip_id, position) unique is DEFERRABLE INITIALLY IMMEDIATE; the (trip_id, landmark_id) unique is ordinary (checked immediately, not deferrable)", async () => {
      // ADR-014 decision 14 / spec v1.1 §3.2. This catalog test is the
      // permanent guard against a future migration (including Prisma output)
      // silently recreating the position key as an ordinary unique index.
      const { rows: constraints } = await client.query(
        `SELECT conname, condeferrable, condeferred FROM pg_constraint
         WHERE conrelid = 'public.trip_stops'::regclass AND contype = 'u'`,
      );
      expect(constraints).toEqual([
        { conname: "trip_stops_trip_id_position_key", condeferrable: true, condeferred: false },
      ]);

      // pg_index.indimmediate: true = uniqueness enforced immediately (an
      // ordinary unique index); false = the index backs a deferrable constraint.
      const { rows: indexes } = await client.query(
        `SELECT c.relname AS indexname, i.indisunique, i.indimmediate
         FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
         WHERE i.indrelid = 'public.trip_stops'::regclass AND i.indisunique AND NOT i.indisprimary
         ORDER BY c.relname`,
      );
      expect(indexes).toEqual([
        { indexname: "trip_stops_trip_id_landmark_id_key", indisunique: true, indimmediate: true },
        { indexname: "trip_stops_trip_id_position_key", indisunique: true, indimmediate: false },
      ]);
    });

    it("the migration file declares the deferrable constraint exactly once and never INITIALLY DEFERRED; down.sql is guarded", () => {
      const statements = MIGRATION_SQL.split(/\r?\n/)
        .filter((line) => !line.trimStart().startsWith("--"))
        .join("\n");
      expect(statements.match(/DEFERRABLE INITIALLY IMMEDIATE/g)).toHaveLength(1);
      expect(statements).not.toMatch(/INITIALLY DEFERRED/);
      expect(statements).toMatch(
        /ADD CONSTRAINT "trip_stops_trip_id_position_key" UNIQUE \("trip_id", "position"\) DEFERRABLE INITIALLY IMMEDIATE;/,
      );
      // Nothing outside the two new tables is altered.
      expect(
        statements.match(/ALTER TABLE "(\w+)"/g)?.every((s) => /"trips?(_stops)?"/.test(s)),
      ).toBe(true);

      expect(DOWN_SQL).toMatch(/RAISE EXCEPTION 'Refusing destructive rollback/);
      expect(DOWN_SQL.indexOf('DROP TABLE IF EXISTS "trip_stops"')).toBeGreaterThan(-1);
      expect(DOWN_SQL.indexOf('DROP TABLE IF EXISTS "trip_stops"')).toBeLessThan(
        DOWN_SQL.indexOf('DROP TABLE IF EXISTS "trips"'),
      );
    });

    it("left the landmarks `location` generated column and its GiST index untouched (ADR-010)", async () => {
      const { rows: column } = await client.query(
        `SELECT is_generated, generation_expression FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'landmarks' AND column_name = 'location'`,
      );
      expect(column).toHaveLength(1);
      expect(column[0].is_generated).toBe("ALWAYS");
      expect(column[0].generation_expression).toMatch(/st_makepoint\(longitude, latitude\)/i);
      const { rows: index } = await client.query(
        `SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'landmarks_location_gist_idx'`,
      );
      expect(index).toHaveLength(1);
      expect(index[0].indexdef).toMatch(/USING gist \(location\)/);
    });

    it("runs on a UTF-8 database in UTC, so char_length counts code points and defaults store UTC", async () => {
      const { rows } = await client.query(
        `SELECT current_setting('server_encoding') AS enc, current_setting('TimeZone') AS tz`,
      );
      expect(rows[0].enc).toBe("UTF8");
      expect(["UTC", "Etc/UTC"]).toContain(rows[0].tz);
    });
  });

  describe("trip name CHECK (1–100 code points; backstop only)", () => {
    it("rejects the empty string and 101 characters; accepts 1 and 100 (ASCII)", async () => {
      await inRolledBackTransaction(async (f) => {
        expect(await attempt(INSERT_TRIP, [f.userId, ""])).toEqual({
          code: CHECK_VIOLATION,
          constraint: "trips_name_length_check",
        });
        expect(await attempt(INSERT_TRIP, [f.userId, "a".repeat(101)])).toEqual({
          code: CHECK_VIOLATION,
          constraint: "trips_name_length_check",
        });
        expect(await attempt(INSERT_TRIP, [f.userId, "a"])).toBeNull();
        expect(await attempt(INSERT_TRIP, [f.userId, "a".repeat(100)])).toBeNull();
      });
    });

    it("counts a non-BMP character as ONE: 100 accepted, 101 rejected", async () => {
      const hundred = NON_BMP.repeat(100);
      expect(hundred.length).toBe(200); // UTF-16 code units — NOT the unit the database counts
      expect([...hundred].length).toBe(100); // code points
      await inRolledBackTransaction(async (f) => {
        expect(await attempt(INSERT_TRIP, [f.userId, hundred])).toBeNull();
        expect(await attempt(INSERT_TRIP, [f.userId, NON_BMP.repeat(101)])).toEqual({
          code: CHECK_VIOLATION,
          constraint: "trips_name_length_check",
        });
      });
    });

    it("does not re-implement the service's rules: whitespace-only and control characters pass the length backstop", async () => {
      // The control-character and visible-character rules (spec §5.1.1) are
      // enforced by the service only (M05-T02 decision D5).
      await inRolledBackTransaction(async (f) => {
        expect(await attempt(INSERT_TRIP, [f.userId, " "])).toBeNull();
        expect(await attempt(INSERT_TRIP, [f.userId, "Day 1\tFalls"])).toBeNull();
      });
    });
  });

  describe("version and share-token-hash CHECKs", () => {
    it("version defaults to 0, accepts 0 and positive values, and rejects -1", async () => {
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId);
        const { rows } = await client.query("SELECT version FROM trips WHERE id = $1::uuid", [
          tripId,
        ]);
        expect(rows[0].version).toBe(0);
        expect(
          await attempt("UPDATE trips SET version = version + 1 WHERE id = $1::uuid", [tripId]),
        ).toBeNull();
        expect(
          await attempt("UPDATE trips SET version = -1 WHERE id = $1::uuid", [tripId]),
        ).toEqual({ code: CHECK_VIOLATION, constraint: "trips_version_check" });
      });
    });

    it("share_token_hash accepts NULL and a lowercase 64-hex digest; rejects uppercase, wrong length, and a raw base64url token", async () => {
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId);
        const set = (value: string | null) =>
          attempt("UPDATE trips SET share_token_hash = $2 WHERE id = $1::uuid", [tripId, value]);
        expect(await set(HASH_A)).toBeNull();
        expect(await set(null)).toBeNull();
        for (const invalid of [
          HASH_A.toUpperCase(),
          HASH_A.slice(0, 63),
          `${HASH_A}0`,
          "q0Vn3Jx8l1oM2b7cZp4sR9tY6uW5eA3dF8gH1jK2lM0", // 43 base64url characters
          "",
        ]) {
          expect(await set(invalid), invalid).toEqual({
            code: CHECK_VIOLATION,
            constraint: "trips_share_token_hash_format_check",
          });
        }
      });
    });

    it("a share-token hash is unique across trips, while any number of trips may be private (NULL)", async () => {
      await inRolledBackTransaction(async (f) => {
        const first = await createTrip(f.userId, "First");
        const second = await createTrip(f.otherUserId, "Second");
        await createTrip(f.userId, "Third, also private");
        await client.query("UPDATE trips SET share_token_hash = $2 WHERE id = $1::uuid", [
          first,
          HASH_A,
        ]);
        expect(
          await attempt("UPDATE trips SET share_token_hash = $2 WHERE id = $1::uuid", [
            second,
            HASH_A,
          ]),
        ).toEqual({ code: UNIQUE_VIOLATION, constraint: "trips_share_token_hash_key" });
        expect(
          await attempt("UPDATE trips SET share_token_hash = $2 WHERE id = $1::uuid", [
            second,
            HASH_B,
          ]),
        ).toBeNull();
        const { rows } = await client.query(
          "SELECT count(*)::int AS n FROM trips WHERE user_id = $1::uuid AND share_token_hash IS NULL",
          [f.userId],
        );
        expect(rows[0].n).toBe(1);
      });
    });
  });

  describe("stop positions and uniqueness", () => {
    it("accepts positions 0 and 24 and rejects -1 and 25", async () => {
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId);
        const [a, b, c] = f.landmarkIds as [string, string, string];
        expect(await attempt(INSERT_STOP, [tripId, a, -1])).toEqual({
          code: CHECK_VIOLATION,
          constraint: "trip_stops_position_check",
        });
        expect(await attempt(INSERT_STOP, [tripId, a, 25])).toEqual({
          code: CHECK_VIOLATION,
          constraint: "trip_stops_position_check",
        });
        expect(await attempt(INSERT_STOP, [tripId, b, 0])).toBeNull();
        expect(await attempt(INSERT_STOP, [tripId, c, 24])).toBeNull();
      });
    });

    it("limits a trip to 25 stops: positions 0–24 fill it, and no 26th stop can be stored", async () => {
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId);
        for (let position = 0; position < 25; position += 1) {
          await client.query(INSERT_STOP, [tripId, f.landmarkIds[position], position]);
        }
        const extra = f.landmarkIds[25]!;
        expect(await attempt(INSERT_STOP, [tripId, extra, 25])).toEqual({
          code: CHECK_VIOLATION,
          constraint: "trip_stops_position_check",
        });
        expect(await attempt(INSERT_STOP, [tripId, extra, 0])).toEqual({
          code: UNIQUE_VIOLATION,
          constraint: "trip_stops_trip_id_position_key",
        });
        const { rows } = await client.query(
          "SELECT count(*)::int AS n FROM trip_stops WHERE trip_id = $1::uuid",
          [tripId],
        );
        expect(rows[0].n).toBe(25);
      }, 26);
    });

    it("does NOT enforce contiguous positions: a gap (0 and 7) is accepted — contiguity is the service's job (decision D2)", async () => {
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId);
        expect(await attempt(INSERT_STOP, [tripId, f.landmarkIds[0], 0])).toBeNull();
        expect(await attempt(INSERT_STOP, [tripId, f.landmarkIds[1], 7])).toBeNull();
      });
    });

    it("rejects a duplicate position in one trip and a duplicate landmark in one trip; allows both across trips", async () => {
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId, "One");
        const otherTripId = await createTrip(f.userId, "Two");
        const [a, b] = f.landmarkIds as [string, string];
        expect(await attempt(INSERT_STOP, [tripId, a, 0])).toBeNull();
        expect(await attempt(INSERT_STOP, [tripId, b, 0])).toEqual({
          code: UNIQUE_VIOLATION,
          constraint: "trip_stops_trip_id_position_key",
        });
        expect(await attempt(INSERT_STOP, [tripId, a, 1])).toEqual({
          code: UNIQUE_VIOLATION,
          constraint: "trip_stops_trip_id_landmark_id_key",
        });
        expect(await attempt(INSERT_STOP, [otherTripId, a, 0])).toBeNull();
      });
    });
  });

  describe("single-statement position rewrites (the reason for DEFERRABLE INITIALLY IMMEDIATE)", () => {
    it("reverses three stops in ONE statement (a reorder)", async () => {
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId);
        const [a, b, c] = f.landmarkIds as [string, string, string];
        for (const [position, id] of [a, b, c].entries()) {
          await client.query(INSERT_STOP, [tripId, id, position]);
        }
        expect(await attempt(REWRITE_POSITIONS, [tripId, [a, b, c], [2, 1, 0]])).toBeNull();
        expect(await stopOrder(tripId)).toEqual([
          { landmark_id: c, position: 0 },
          { landmark_id: b, position: 1 },
          { landmark_id: a, position: 2 },
        ]);
      });
    });

    it("swaps two adjacent stops in ONE statement", async () => {
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId);
        const [a, b] = f.landmarkIds as [string, string];
        await client.query(INSERT_STOP, [tripId, a, 0]);
        await client.query(INSERT_STOP, [tripId, b, 1]);
        expect(await attempt(REWRITE_POSITIONS, [tripId, [a, b], [1, 0]])).toBeNull();
        expect((await stopOrder(tripId)).map((s) => s.landmark_id)).toEqual([b, a]);
      });
    });

    it("closes the gap after removing the first stop with ONE shift statement (a removal)", async () => {
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId);
        const [a, b, c] = f.landmarkIds as [string, string, string];
        for (const [position, id] of [a, b, c].entries()) {
          await client.query(INSERT_STOP, [tripId, id, position]);
        }
        await client.query("DELETE FROM trip_stops WHERE trip_id = $1::uuid AND position = 0", [
          tripId,
        ]);
        expect(
          await attempt(
            "UPDATE trip_stops SET position = position - 1 WHERE trip_id = $1::uuid AND position > 0",
            [tripId],
          ),
        ).toBeNull();
        expect(await stopOrder(tripId)).toEqual([
          { landmark_id: b, position: 0 },
          { landmark_id: c, position: 1 },
        ]);
      });
    });

    it("still rejects a statement whose FINAL positions collide, and leaves the order unchanged", async () => {
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId);
        const [a, b, c] = f.landmarkIds as [string, string, string];
        for (const [position, id] of [a, b, c].entries()) {
          await client.query(INSERT_STOP, [tripId, id, position]);
        }
        const before = await stopOrder(tripId);
        expect(await attempt(REWRITE_POSITIONS, [tripId, [a, b, c], [1, 1, 0]])).toEqual({
          code: UNIQUE_VIOLATION,
          constraint: "trip_stops_trip_id_position_key",
        });
        expect(
          await attempt("UPDATE trip_stops SET position = 0 WHERE trip_id = $1::uuid", [tripId]),
        ).toEqual({ code: UNIQUE_VIOLATION, constraint: "trip_stops_trip_id_position_key" });
        expect(await stopOrder(tripId)).toEqual(before);
      });
    });
  });

  describe("ON CONFLICT compatibility", () => {
    it("ON CONFLICT (trip_id, landmark_id) DO NOTHING inserts once and then reports no row (the add-stop arbiter)", async () => {
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId);
        const [a] = f.landmarkIds as [string];
        const add = (position: number) =>
          client.query(
            `${INSERT_STOP} ON CONFLICT (trip_id, landmark_id) DO NOTHING RETURNING id`,
            [tripId, a, position],
          );
        expect((await add(0)).rowCount).toBe(1);
        expect((await add(1)).rowCount).toBe(0);
        expect(await stopOrder(tripId)).toEqual([{ landmark_id: a, position: 0 }]);
      });
    });

    it("PostgreSQL refuses the deferrable (trip_id, position) constraint as an ON CONFLICT arbiter", async () => {
      // Documents why the landmark unique must stay ordinary (ADR-014 decision 14).
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId);
        await client.query("SAVEPOINT arbiter");
        let message = "";
        try {
          await client.query(`${INSERT_STOP} ON CONFLICT (trip_id, position) DO NOTHING`, [
            tripId,
            f.landmarkIds[0],
            0,
          ]);
        } catch (error) {
          message = (error as Error).message;
        } finally {
          await client.query("ROLLBACK TO SAVEPOINT arbiter");
        }
        expect(message).toMatch(/ON CONFLICT does not support deferrable unique constraints/);
      });
    });
  });

  describe("foreign keys (RESTRICT and CASCADE)", () => {
    it("refuses to delete a user who owns a trip", async () => {
      await inRolledBackTransaction(async (f) => {
        await createTrip(f.userId);
        expect(await attempt("DELETE FROM users WHERE id = $1::uuid", [f.userId])).toEqual({
          code: FOREIGN_KEY_VIOLATION,
          constraint: "trips_user_id_fkey",
        });
      });
    });

    it("refuses to delete a landmark that is a stop", async () => {
      await inRolledBackTransaction(async (f) => {
        const tripId = await createTrip(f.userId);
        await client.query(INSERT_STOP, [tripId, f.landmarkIds[0], 0]);
        expect(
          await attempt("DELETE FROM landmarks WHERE id = $1::uuid", [f.landmarkIds[0]]),
        ).toEqual({ code: FOREIGN_KEY_VIOLATION, constraint: "trip_stops_landmark_id_fkey" });
      });
    });

    it("deleting a trip deletes its stops and nothing else (landmarks, user, other trips, reviews, favorites remain)", async () => {
      await inRolledBackTransaction(async (f) => {
        const [a, b] = f.landmarkIds as [string, string];
        const tripId = await createTrip(f.userId, "Deleted");
        const keptTripId = await createTrip(f.userId, "Kept");
        await client.query(INSERT_STOP, [tripId, a, 0]);
        await client.query(INSERT_STOP, [tripId, b, 1]);
        await client.query(INSERT_STOP, [keptTripId, a, 0]);
        await client.query(
          "INSERT INTO reviews (user_id, landmark_id, rating) VALUES ($1::uuid, $2::uuid, 4)",
          [f.userId, a],
        );
        await client.query(
          "INSERT INTO favorites (user_id, landmark_id) VALUES ($1::uuid, $2::uuid)",
          [f.userId, a],
        );

        await client.query("DELETE FROM trips WHERE id = $1::uuid", [tripId]);

        const { rows } = await client.query(
          `SELECT
             (SELECT count(*)::int FROM trip_stops WHERE trip_id = $1::uuid) AS deleted_trip_stops,
             (SELECT count(*)::int FROM trip_stops WHERE trip_id = $2::uuid) AS kept_trip_stops,
             (SELECT count(*)::int FROM landmarks WHERE id = ANY($3::uuid[])) AS landmarks,
             (SELECT count(*)::int FROM users WHERE id = $4::uuid) AS users,
             (SELECT count(*)::int FROM reviews WHERE user_id = $4::uuid) AS reviews,
             (SELECT count(*)::int FROM favorites WHERE user_id = $4::uuid) AS favorites`,
          [tripId, keptTripId, [a, b], f.userId],
        );
        expect(rows[0]).toEqual({
          deleted_trip_stops: 0,
          kept_trip_stops: 1,
          landmarks: 2,
          users: 1,
          reviews: 1,
          favorites: 1,
        });
      });
    });

    it("rejects a trip for an unknown user and a stop for an unknown trip or landmark", async () => {
      await inRolledBackTransaction(async (f) => {
        expect(await attempt(INSERT_TRIP, [UNKNOWN_UUID, "Orphan"])).toEqual({
          code: FOREIGN_KEY_VIOLATION,
          constraint: "trips_user_id_fkey",
        });
        const tripId = await createTrip(f.userId);
        expect(await attempt(INSERT_STOP, [UNKNOWN_UUID, f.landmarkIds[0], 0])).toEqual({
          code: FOREIGN_KEY_VIOLATION,
          constraint: "trip_stops_trip_id_fkey",
        });
        expect(await attempt(INSERT_STOP, [tripId, UNKNOWN_UUID, 0])).toEqual({
          code: FOREIGN_KEY_VIOLATION,
          constraint: "trip_stops_landmark_id_fkey",
        });
      });
    });
  });

  describe("defaults and timestamps", () => {
    it("generates UUIDs and sets timestamps, version 0, and a NULL share hash from the database defaults", async () => {
      await inRolledBackTransaction(async (f) => {
        const { rows: trip } = await client.query(
          `INSERT INTO trips (user_id, name) VALUES ($1::uuid, 'Defaults')
           RETURNING id, version, share_token_hash, created_at = updated_at AS equal,
                     updated_at = now()::timestamp(3) AS at_transaction_time`,
          [f.userId],
        );
        expect(trip[0].id).toMatch(UUID_V4);
        expect(trip[0]).toMatchObject({
          version: 0,
          share_token_hash: null,
          equal: true,
          at_transaction_time: true,
        });

        const { rows: stop } = await client.query(
          `INSERT INTO trip_stops (trip_id, landmark_id, position) VALUES ($1::uuid, $2::uuid, 0)
           RETURNING id, created_at = now()::timestamp(3) AS at_transaction_time`,
          [trip[0].id, f.landmarkIds[0]],
        );
        expect(stop[0].id).toMatch(UUID_V4);
        expect(stop[0].at_transaction_time).toBe(true);
      });
    });

    it("does NOT change updated_at or version by itself on UPDATE — writers must set both explicitly", async () => {
      await inRolledBackTransaction(async (f) => {
        await client.query(
          `INSERT INTO trips (user_id, name, created_at, updated_at)
           VALUES ($1::uuid, 'Fixed time', '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
          [f.userId],
        );
        const { rows } = await client.query(
          `UPDATE trips SET name = 'Renamed' WHERE user_id = $1::uuid
           RETURNING updated_at::text AS updated_at, version`,
          [f.userId],
        );
        expect(rows[0]).toEqual({ updated_at: "2026-01-01 00:00:00", version: 0 });
      });
    });
  });

  describe("isolation", () => {
    it("leaves no trip or stop rows behind", async () => {
      const { rows } = await client.query(
        `SELECT (SELECT count(*)::int FROM trips) AS trips,
                (SELECT count(*)::int FROM trip_stops) AS trip_stops`,
      );
      expect(rows[0]).toEqual({ trips: 0, trip_stops: 0 });
    });
  });
});
