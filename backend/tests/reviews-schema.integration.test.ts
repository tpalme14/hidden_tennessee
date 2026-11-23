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
 * M04-T02 Increment 1b — proves the `reviews` table's database-level rules
 * against the REAL landmarks_test database (ADR-009), exactly as designed in
 * M04-T01 / ADR-013 decisions 1–3 and specs/RATINGS_REVIEWS_SPEC.md v1.1:
 * columns and defaults, the composite unique (user_id, landmark_id), RESTRICT
 * foreign keys, the (landmark_id, created_at DESC, id DESC) index, and the two
 * hand-written CHECK constraints (rating 1–5; body NULL or 1–2,000 code points).
 *
 * ISOLATION: unlike the older schema suites, this file never calls
 * resetTestDatabase(). Every behavioural test runs inside its own transaction
 * that is ALWAYS rolled back, with synthetic fixtures created inside it, so
 * the suite leaves no rows behind and never truncates existing data.
 *
 * Also proves the ADR-010 safeguard that the migration left `landmarks`
 * untouched (generated `location` column and its GiST index).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_NAME = "20261121000000_reviews";
const MIGRATION_SQL_BYTES = readFileSync(
  path.resolve(__dirname, `../prisma/migrations/${MIGRATION_NAME}/migration.sql`),
);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

const CHECK_VIOLATION = "23514";
const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";
/** PostgreSQL character_not_in_repertoire — raised for a NUL byte in UTF-8 text. */
const NUL_REJECTED = "22021";

/** A supplementary-plane character: one code point, two UTF-16 code units. */
const NON_BMP = "\u{1F332}"; // 🌲

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
  landmarkId: string;
  otherLandmarkId: string;
}

let sequence = 0;

async function createUser(label: string): Promise<string> {
  sequence += 1;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO users (name, email, updated_at) VALUES ('', $1, CURRENT_TIMESTAMP) RETURNING id`,
    [`reviews-schema-${label}-${sequence}-${Date.now()}@example.com`],
  );
  return rows[0]!.id;
}

async function createLandmark(): Promise<string> {
  sequence += 1;
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO landmarks (source_code, source_file, category, display_name, latitude, longitude, updated_at)
     VALUES ($1, 'TNARCHES', 'ARCH', 'Reviews schema fixture', 35.1869, -85.6103, CURRENT_TIMESTAMP)
     RETURNING id`,
    [`ZRV${String(sequence % 1000).padStart(3, "0")}`],
  );
  return rows[0]!.id;
}

/**
 * Runs `body` inside a transaction that is always rolled back, with fresh
 * synthetic users and landmarks created inside it.
 */
async function inRolledBackTransaction(body: (f: Fixture) => Promise<void>): Promise<void> {
  await client.query("BEGIN");
  try {
    const fixture: Fixture = {
      userId: await createUser("a"),
      otherUserId: await createUser("b"),
      landmarkId: await createLandmark(),
      otherLandmarkId: await createLandmark(),
    };
    await body(fixture);
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

const INSERT_REVIEW =
  "INSERT INTO reviews (user_id, landmark_id, rating, body) VALUES ($1::uuid, $2::uuid, $3, $4)";

describe("reviews schema (integration, M04-T02 Increment 1b)", () => {
  describe("migration and catalog", () => {
    it("records the reviews migration as applied, finished, not rolled back, with the file's checksum", async () => {
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

    it("has exactly the approved columns, types, nullability, and defaults", async () => {
      const { rows } = await client.query(
        `SELECT column_name, data_type, is_nullable, column_default, datetime_precision
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = 'reviews'
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
          column_name: "user_id",
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
          column_name: "rating",
          data_type: "integer",
          is_nullable: "NO",
          column_default: null,
          datetime_precision: null,
        },
        {
          column_name: "body",
          data_type: "text",
          is_nullable: "YES",
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
        {
          column_name: "updated_at",
          data_type: "timestamp without time zone",
          is_nullable: "NO",
          column_default: "CURRENT_TIMESTAMP",
          datetime_precision: 3,
        },
      ]);
    });

    it("has exactly the primary key, the composite unique index, and the public-list index", async () => {
      const { rows } = await client.query(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE schemaname = 'public' AND tablename = 'reviews' ORDER BY indexname`,
      );
      expect(rows).toEqual([
        {
          indexname: "reviews_landmark_id_created_at_id_idx",
          indexdef:
            "CREATE INDEX reviews_landmark_id_created_at_id_idx ON public.reviews USING btree (landmark_id, created_at DESC, id DESC)",
        },
        {
          indexname: "reviews_pkey",
          indexdef: "CREATE UNIQUE INDEX reviews_pkey ON public.reviews USING btree (id)",
        },
        {
          indexname: "reviews_user_id_landmark_id_key",
          indexdef:
            "CREATE UNIQUE INDEX reviews_user_id_landmark_id_key ON public.reviews USING btree (user_id, landmark_id)",
        },
      ]);
    });

    it("has exactly the approved constraints: PK, two RESTRICT/CASCADE foreign keys, and both CHECKs", async () => {
      const { rows } = await client.query(
        `SELECT conname, contype, pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conrelid = 'public.reviews'::regclass ORDER BY conname`,
      );
      expect(rows).toEqual([
        {
          conname: "reviews_body_length_check",
          contype: "c",
          def: "CHECK (((body IS NULL) OR ((char_length(body) >= 1) AND (char_length(body) <= 2000))))",
        },
        {
          conname: "reviews_landmark_id_fkey",
          contype: "f",
          def: "FOREIGN KEY (landmark_id) REFERENCES landmarks(id) ON UPDATE CASCADE ON DELETE RESTRICT",
        },
        { conname: "reviews_pkey", contype: "p", def: "PRIMARY KEY (id)" },
        {
          conname: "reviews_rating_range_check",
          contype: "c",
          def: "CHECK (((rating >= 1) AND (rating <= 5)))",
        },
        {
          conname: "reviews_user_id_fkey",
          contype: "f",
          def: "FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT",
        },
      ]);
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

  describe("rating CHECK (1–5)", () => {
    it("rejects 0 and 6 and accepts 1 and 5", async () => {
      await inRolledBackTransaction(async (f) => {
        expect(await attempt(INSERT_REVIEW, [f.userId, f.landmarkId, 0, null])).toEqual({
          code: CHECK_VIOLATION,
          constraint: "reviews_rating_range_check",
        });
        expect(await attempt(INSERT_REVIEW, [f.userId, f.landmarkId, 6, null])).toEqual({
          code: CHECK_VIOLATION,
          constraint: "reviews_rating_range_check",
        });
        expect(await attempt(INSERT_REVIEW, [f.userId, f.landmarkId, 1, null])).toBeNull();
        expect(await attempt(INSERT_REVIEW, [f.otherUserId, f.landmarkId, 5, null])).toBeNull();
      });
    });
  });

  describe("body CHECK (NULL or 1–2,000 code points)", () => {
    it("accepts NULL and rejects the empty string", async () => {
      await inRolledBackTransaction(async (f) => {
        expect(await attempt(INSERT_REVIEW, [f.userId, f.landmarkId, 3, null])).toBeNull();
        expect(await attempt(INSERT_REVIEW, [f.otherUserId, f.landmarkId, 3, ""])).toEqual({
          code: CHECK_VIOLATION,
          constraint: "reviews_body_length_check",
        });
      });
    });

    it("accepts 1 and 2,000 code points and rejects 2,001 (ASCII)", async () => {
      await inRolledBackTransaction(async (f) => {
        expect(await attempt(INSERT_REVIEW, [f.userId, f.landmarkId, 3, "a"])).toBeNull();
        expect(
          await attempt(INSERT_REVIEW, [f.otherUserId, f.landmarkId, 3, "a".repeat(2000)]),
        ).toBeNull();
        expect(
          await attempt(INSERT_REVIEW, [f.userId, f.otherLandmarkId, 3, "a".repeat(2001)]),
        ).toEqual({
          code: CHECK_VIOLATION,
          constraint: "reviews_body_length_check",
        });
      });
    });

    it("counts a non-BMP character as ONE: 1 and 2,000 accepted, 2,001 rejected", async () => {
      const twoThousand = NON_BMP.repeat(2000);
      expect(twoThousand.length).toBe(4000); // UTF-16 code units — NOT the unit the database counts
      expect([...twoThousand].length).toBe(2000); // code points
      await inRolledBackTransaction(async (f) => {
        expect(await attempt(INSERT_REVIEW, [f.userId, f.landmarkId, 4, NON_BMP])).toBeNull();
        expect(
          await attempt(INSERT_REVIEW, [f.otherUserId, f.landmarkId, 4, twoThousand]),
        ).toBeNull();
        expect(
          await attempt(INSERT_REVIEW, [f.userId, f.otherLandmarkId, 4, NON_BMP.repeat(2001)]),
        ).toEqual({ code: CHECK_VIOLATION, constraint: "reviews_body_length_check" });

        const { rows } = await client.query(
          `SELECT char_length(body) AS cp, octet_length(body) AS bytes FROM reviews
           WHERE user_id = $1::uuid AND landmark_id = $2::uuid`,
          [f.otherUserId, f.landmarkId],
        );
        expect(rows[0]).toEqual({ cp: 2000, bytes: 8000 });
      });
    });

    it("rejects a NUL character in the body (PostgreSQL text cannot store U+0000)", async () => {
      await inRolledBackTransaction(async (f) => {
        const result = await attempt(INSERT_REVIEW, [
          f.userId,
          f.landmarkId,
          3,
          "before\u0000after",
        ]);
        expect(result?.code).toBe(NUL_REJECTED);
        const { rows } = await client.query(
          "SELECT count(*)::int AS n FROM reviews WHERE user_id = $1::uuid",
          [f.userId],
        );
        expect(rows[0].n).toBe(0);
      });
    });
  });

  describe("one review per user per landmark", () => {
    it("rejects a second review by the same user for the same landmark; allows other pairs", async () => {
      await inRolledBackTransaction(async (f) => {
        expect(await attempt(INSERT_REVIEW, [f.userId, f.landmarkId, 4, null])).toBeNull();
        expect(await attempt(INSERT_REVIEW, [f.userId, f.landmarkId, 2, "second"])).toEqual({
          code: UNIQUE_VIOLATION,
          constraint: "reviews_user_id_landmark_id_key",
        });
        expect(await attempt(INSERT_REVIEW, [f.userId, f.otherLandmarkId, 4, null])).toBeNull();
        expect(await attempt(INSERT_REVIEW, [f.otherUserId, f.landmarkId, 4, null])).toBeNull();
      });
    });
  });

  describe("foreign keys (ON DELETE RESTRICT)", () => {
    it("refuses to delete a user who has a review", async () => {
      await inRolledBackTransaction(async (f) => {
        await client.query(INSERT_REVIEW, [f.userId, f.landmarkId, 5, null]);
        expect(await attempt("DELETE FROM users WHERE id = $1::uuid", [f.userId])).toEqual({
          code: FOREIGN_KEY_VIOLATION,
          constraint: "reviews_user_id_fkey",
        });
      });
    });

    it("refuses to delete a landmark that has a review", async () => {
      await inRolledBackTransaction(async (f) => {
        await client.query(INSERT_REVIEW, [f.userId, f.landmarkId, 5, null]);
        expect(await attempt("DELETE FROM landmarks WHERE id = $1::uuid", [f.landmarkId])).toEqual({
          code: FOREIGN_KEY_VIOLATION,
          constraint: "reviews_landmark_id_fkey",
        });
      });
    });

    it("rejects a review for an unknown user or an unknown landmark", async () => {
      await inRolledBackTransaction(async (f) => {
        expect(await attempt(INSERT_REVIEW, [UNKNOWN_UUID, f.landmarkId, 3, null])).toEqual({
          code: FOREIGN_KEY_VIOLATION,
          constraint: "reviews_user_id_fkey",
        });
        expect(await attempt(INSERT_REVIEW, [f.userId, UNKNOWN_UUID, 3, null])).toEqual({
          code: FOREIGN_KEY_VIOLATION,
          constraint: "reviews_landmark_id_fkey",
        });
      });
    });
  });

  describe("defaults and timestamps (ADR-013 decision 3)", () => {
    it("generates a UUID and sets created_at and updated_at from the database defaults on insert", async () => {
      await inRolledBackTransaction(async (f) => {
        const { rows } = await client.query(
          `INSERT INTO reviews (user_id, landmark_id, rating) VALUES ($1::uuid, $2::uuid, 4)
           RETURNING id, created_at = updated_at AS equal,
                     updated_at = now()::timestamp(3) AS at_transaction_time, body`,
          [f.userId, f.landmarkId],
        );
        expect(rows[0].id).toMatch(UUID_V4);
        expect(rows[0].equal).toBe(true);
        expect(rows[0].at_transaction_time).toBe(true);
        expect(rows[0].body).toBeNull();
      });
    });

    it("does NOT change updated_at by itself on UPDATE — writers must set it explicitly", async () => {
      await inRolledBackTransaction(async (f) => {
        await client.query(
          `INSERT INTO reviews (user_id, landmark_id, rating, created_at, updated_at)
           VALUES ($1::uuid, $2::uuid, 4, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
          [f.userId, f.landmarkId],
        );
        const { rows } = await client.query(
          `UPDATE reviews SET rating = 2 WHERE user_id = $1::uuid RETURNING updated_at::text AS updated_at`,
          [f.userId],
        );
        expect(rows[0].updated_at).toBe("2026-01-01 00:00:00");
      });
    });
  });

  describe("isolation", () => {
    it("leaves no review rows behind", async () => {
      const { rows } = await client.query("SELECT count(*)::int AS n FROM reviews");
      expect(rows[0].n).toBe(0);
    });
  });
});
