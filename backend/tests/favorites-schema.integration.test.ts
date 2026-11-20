import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T05 Increment 1 — proves the favorites table's database-level rules
 * against the REAL landmarks_test database (ADR-009), exactly as designed in
 * M03-T01 / ADR-011 decision 8: database-generated UUIDs, a creation
 * timestamp, a composite unique (user_id, landmark_id), RESTRICT foreign keys
 * to users and landmarks, and the (user_id, created_at DESC, id) listing index.
 *
 * Also proves the ADR-010 safeguard that the migration left `landmarks`
 * untouched: the GENERATED `location` column and its GiST index must still be
 * exactly as M01-T03 created them.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.resolve(__dirname, "../prisma/migrations/20261120000000_favorites");
const MIGRATION_SQL = readFileSync(path.join(MIGRATION_DIR, "migration.sql"), "utf8");
const DOWN_SQL = readFileSync(path.join(MIGRATION_DIR, "down.sql"), "utf8");

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000";

/** Postgres unique_violation (23505), surfaced by Prisma as P2002. */
const UNIQUE_VIOLATION = expect.objectContaining({ code: "P2002" });
/** Postgres foreign_key_violation (23503), surfaced by Prisma as P2003. */
const FOREIGN_KEY_VIOLATION = expect.objectContaining({ code: "P2003" });

/** SQL with comment lines removed, so checks apply to statements only. */
function statementsOf(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

let sequence = 0;

async function createUser(label: string) {
  sequence += 1;
  return prisma.user.create({ data: { name: "", email: `${label}-${sequence}@example.com` } });
}

async function createLandmark(displayName: string) {
  sequence += 1;
  return prisma.landmark.create({
    data: {
      sourceCode: `ARC${String(sequence).padStart(3, "0")}`,
      sourceFile: "TNARCHES",
      category: "ARCH",
      displayName,
      latitude: 35.1869,
      longitude: -85.6103,
    },
  });
}

describe("favorites schema (integration, M03-T05 Increment 1)", () => {
  afterEach(async () => {
    await resetTestDatabase();
  });

  describe("table definition (catalog)", () => {
    it("has exactly id, user_id, landmark_id, created_at with the approved types, nullability, and defaults", async () => {
      const columns = await prisma.$queryRaw<
        {
          column_name: string;
          data_type: string;
          is_nullable: string;
          column_default: string | null;
          datetime_precision: number | null;
        }[]
      >`
        SELECT column_name, data_type, is_nullable, column_default, datetime_precision
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'favorites'
        ORDER BY ordinal_position
      `;
      expect(columns).toEqual([
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
          column_name: "created_at",
          data_type: "timestamp without time zone",
          is_nullable: "NO",
          column_default: "CURRENT_TIMESTAMP",
          datetime_precision: 3,
        },
      ]);
    });

    it("has exactly the primary key, the composite unique index, and the newest-first listing index", async () => {
      const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'favorites'
        ORDER BY indexname
      `;
      expect(indexes).toEqual([
        {
          indexname: "favorites_pkey",
          indexdef: "CREATE UNIQUE INDEX favorites_pkey ON public.favorites USING btree (id)",
        },
        {
          indexname: "favorites_user_id_created_at_id_idx",
          indexdef:
            "CREATE INDEX favorites_user_id_created_at_id_idx ON public.favorites USING btree (user_id, created_at DESC, id)",
        },
        {
          indexname: "favorites_user_id_landmark_id_key",
          indexdef:
            "CREATE UNIQUE INDEX favorites_user_id_landmark_id_key ON public.favorites USING btree (user_id, landmark_id)",
        },
      ]);
    });

    it("has exactly two foreign keys, both ON DELETE RESTRICT, to users(id) and landmarks(id)", async () => {
      const constraints = await prisma.$queryRaw<{ conname: string; def: string }[]>`
        SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conrelid = 'public.favorites'::regclass AND contype = 'f'
        ORDER BY conname
      `;
      expect(constraints).toEqual([
        {
          conname: "favorites_landmark_id_fkey",
          def: "FOREIGN KEY (landmark_id) REFERENCES landmarks(id) ON UPDATE CASCADE ON DELETE RESTRICT",
        },
        {
          conname: "favorites_user_id_fkey",
          def: "FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE RESTRICT",
        },
      ]);
    });
  });

  describe("row behaviour", () => {
    it("generates the favorite ID (UUID) and created_at in the database", async () => {
      const user = await createUser("gen");
      const landmark = await createLandmark("Generated Arch");
      const before = Date.now();
      const favorite = await prisma.favorite.create({
        data: { userId: user.id, landmarkId: landmark.id },
      });
      expect(favorite.id).toMatch(UUID_V4);
      expect(favorite.userId).toBe(user.id);
      expect(favorite.landmarkId).toBe(landmark.id);
      expect(favorite.createdAt).toBeInstanceOf(Date);
      // Database clock vs test clock on the same host: allow generous skew.
      expect(Math.abs(favorite.createdAt.getTime() - before)).toBeLessThan(60_000);
    });

    it("rejects a duplicate (user_id, landmark_id) pair", async () => {
      const user = await createUser("dupe");
      const landmark = await createLandmark("Duplicate Arch");
      await prisma.favorite.create({ data: { userId: user.id, landmarkId: landmark.id } });
      await expect(
        prisma.favorite.create({ data: { userId: user.id, landmarkId: landmark.id } }),
      ).rejects.toEqual(UNIQUE_VIOLATION);
      expect(await prisma.favorite.count()).toBe(1);
    });

    it("allows one user to save several landmarks and several users to save one landmark", async () => {
      const [a, b] = [await createUser("a"), await createUser("b")];
      const [one, two] = [await createLandmark("One"), await createLandmark("Two")];
      await prisma.favorite.createMany({
        data: [
          { userId: a.id, landmarkId: one.id },
          { userId: a.id, landmarkId: two.id },
          { userId: b.id, landmarkId: one.id },
        ],
      });
      expect(await prisma.favorite.count()).toBe(3);
    });

    it("rejects a favorite for an unknown user or an unknown landmark", async () => {
      const user = await createUser("orphan");
      const landmark = await createLandmark("Orphan Arch");
      await expect(
        prisma.favorite.create({ data: { userId: UNKNOWN_UUID, landmarkId: landmark.id } }),
      ).rejects.toEqual(FOREIGN_KEY_VIOLATION);
      await expect(
        prisma.favorite.create({ data: { userId: user.id, landmarkId: UNKNOWN_UUID } }),
      ).rejects.toEqual(FOREIGN_KEY_VIOLATION);
      expect(await prisma.favorite.count()).toBe(0);
    });

    it("rejects a malformed UUID at the database (uuid-typed columns)", async () => {
      const landmark = await createLandmark("Typed Arch");
      await expect(
        prisma.$executeRaw`INSERT INTO favorites (user_id, landmark_id) VALUES (${"not-a-uuid"}::uuid, ${landmark.id}::uuid)`,
      ).rejects.toThrow();
      expect(await prisma.favorite.count()).toBe(0);
    });

    it("RESTRICT: a user with favorites cannot be deleted, and nothing is removed", async () => {
      const user = await createUser("restrict-user");
      const landmark = await createLandmark("Restrict User Arch");
      await prisma.favorite.create({ data: { userId: user.id, landmarkId: landmark.id } });
      await expect(prisma.user.delete({ where: { id: user.id } })).rejects.toThrow();
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
      expect(await prisma.favorite.count()).toBe(1);
    });

    it("RESTRICT: a landmark with favorites cannot be deleted, and nothing is removed", async () => {
      const user = await createUser("restrict-landmark");
      const landmark = await createLandmark("Restrict Landmark Arch");
      await prisma.favorite.create({ data: { userId: user.id, landmarkId: landmark.id } });
      await expect(prisma.landmark.delete({ where: { id: landmark.id } })).rejects.toThrow();
      expect(await prisma.landmark.count({ where: { id: landmark.id } })).toBe(1);
      expect(await prisma.favorite.count()).toBe(1);
    });

    it("RESTRICT holds for raw SQL deletes too (enforced by PostgreSQL, not the client)", async () => {
      const user = await createUser("raw");
      const landmark = await createLandmark("Raw Arch");
      await prisma.favorite.create({ data: { userId: user.id, landmarkId: landmark.id } });
      await expect(
        prisma.$executeRaw`DELETE FROM users WHERE id = ${user.id}::uuid`,
      ).rejects.toThrow(/favorites_user_id_fkey|foreign key/i);
      await expect(
        prisma.$executeRaw`DELETE FROM landmarks WHERE id = ${landmark.id}::uuid`,
      ).rejects.toThrow(/favorites_landmark_id_fkey|foreign key/i);
      expect(await prisma.favorite.count()).toBe(1);
    });

    it("retiring and reactivating a landmark keeps its favorites (spec §6.1)", async () => {
      const user = await createUser("retire");
      const landmark = await createLandmark("Retired Arch");
      const favorite = await prisma.favorite.create({
        data: { userId: user.id, landmarkId: landmark.id },
      });
      await prisma.landmark.update({ where: { id: landmark.id }, data: { isActive: false } });
      expect(await prisma.favorite.findUnique({ where: { id: favorite.id } })).toEqual(favorite);
      await prisma.landmark.update({ where: { id: landmark.id }, data: { isActive: true } });
      expect(await prisma.favorite.findUnique({ where: { id: favorite.id } })).toEqual(favorite);
    });

    it("deleting a favorite leaves its user and landmark untouched", async () => {
      const user = await createUser("remove");
      const landmark = await createLandmark("Removed Arch");
      const favorite = await prisma.favorite.create({
        data: { userId: user.id, landmarkId: landmark.id },
      });
      await prisma.favorite.delete({ where: { id: favorite.id } });
      expect(await prisma.user.count({ where: { id: user.id } })).toBe(1);
      expect(await prisma.landmark.count({ where: { id: landmark.id } })).toBe(1);
    });
  });

  describe("ADR-010 safeguards", () => {
    it("left the landmarks table untouched: GENERATED location column, NOT NULL, GiST index all intact", async () => {
      const [column] = await prisma.$queryRaw<
        {
          is_nullable: string;
          is_generated: string;
          udt_name: string;
          generation_expression: string;
        }[]
      >`
        SELECT is_nullable, is_generated, udt_name, generation_expression
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'landmarks' AND column_name = 'location'
      `;
      expect(column).toMatchObject({
        is_nullable: "NO",
        is_generated: "ALWAYS",
        udt_name: "geography",
      });
      expect(column?.generation_expression).toMatch(/st_makepoint\(longitude, latitude\)/i);

      const indexes = await prisma.$queryRaw<{ indexname: string; indexdef: string }[]>`
        SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'landmarks' ORDER BY indexname
      `;
      expect(indexes.map((i) => i.indexname)).toEqual([
        "landmarks_category_active_idx",
        "landmarks_location_gist_idx",
        "landmarks_pkey",
        "landmarks_source_code_key",
      ]);
      expect(indexes.find((i) => i.indexname === "landmarks_location_gist_idx")?.indexdef).toBe(
        "CREATE INDEX landmarks_location_gist_idx ON public.landmarks USING gist (location)",
      );
    });

    it("migration SQL only creates objects on favorites; landmarks is referenced only as a foreign-key target", () => {
      const statements = statementsOf(MIGRATION_SQL);
      // No statement starts with a destructive or data-changing keyword
      // (`ON DELETE RESTRICT` / `ON UPDATE CASCADE` inside the FKs are fine).
      expect(statements).not.toMatch(/^\s*(DROP|TRUNCATE|DELETE|UPDATE|INSERT)\b/im);
      expect(statements).not.toMatch(/\bDROP\b/i);
      expect(statements).not.toMatch(/ALTER TABLE "(landmarks|users)"/i);
      expect(statements).not.toMatch(/"location"/i);
      expect(statements).not.toMatch(/\bgist\b/i);
      // Every mention of landmarks/users is a REFERENCES target.
      expect(statements.match(/"landmarks"/g)).toHaveLength(1);
      expect(statements).toMatch(/REFERENCES "landmarks"\("id"\) ON DELETE RESTRICT/);
      expect(statements.match(/"users"/g)).toHaveLength(1);
      expect(statements).toMatch(/REFERENCES "users"\("id"\) ON DELETE RESTRICT/);
    });

    it("down.sql is guarded: it refuses to run when favorites holds rows, and drops only favorites", () => {
      const statements = statementsOf(DOWN_SQL);
      const guard = statements.indexOf("RAISE EXCEPTION");
      const drop = statements.indexOf('DROP TABLE IF EXISTS "favorites"');
      expect(guard).toBeGreaterThan(-1);
      expect(drop).toBeGreaterThan(guard);
      expect(statements).toMatch(/SELECT count\(\*\) INTO n_favorites FROM "favorites"/);
      expect(statements.match(/\bDROP\b/g)).toHaveLength(1);
      expect(statements).not.toMatch(/"landmarks"|"users"/);
    });
  });
});
