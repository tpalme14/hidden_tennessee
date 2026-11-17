import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db/prisma.js";
import { resetTestDatabase } from "./setup/reset-test-database.js";

/**
 * M03-T02 Increment 1 — proves the identity schema's database-level rules
 * against the REAL landmarks_test database (ADR-009), exactly as designed in
 * M03-T01 / ADR-011. No Better Auth code is involved yet: these are the
 * constraints the library will later run on top of, verified independently
 * of it so a library change can never silently weaken them.
 *
 * Also proves the Increment 1 safeguard that the migration left `landmarks`
 * untouched: the GENERATED `location` column and its GiST index must still
 * be exactly as M01-T03 created them.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_SQL = readFileSync(
  path.resolve(__dirname, "../prisma/migrations/20261107230000_identity_schema/migration.sql"),
  "utf8",
);

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Postgres unique_violation (23505) — Prisma surfaces it as P2002 for declarative AND hand-written unique indexes alike. */
const UNIQUE_VIOLATION = expect.objectContaining({ code: "P2002" });

async function createUser(email: string) {
  return prisma.user.create({ data: { name: "", email } });
}

describe("identity schema (integration, M03-T02 Increment 1)", () => {
  afterEach(async () => {
    await resetTestDatabase();
  });

  it("generates user IDs in the database as UUIDs (no application-supplied id)", async () => {
    const user = await createUser("first@example.com");
    expect(user.id).toMatch(UUID_V4);
    expect(user.name).toBe("");
    expect(user.emailVerified).toBe(false);
    expect(user.image).toBeNull();
  });

  it("rejects an exact duplicate email (declarative unique)", async () => {
    await createUser("dupe@example.com");
    await expect(createUser("dupe@example.com")).rejects.toEqual(UNIQUE_VIOLATION);
  });

  it("rejects an email that differs only by case (hand-written lower(email) unique index)", async () => {
    await createUser("Person@Example.com");
    await expect(createUser("person@example.com")).rejects.toEqual(UNIQUE_VIOLATION);
    await expect(createUser("PERSON@EXAMPLE.COM")).rejects.toEqual(UNIQUE_VIOLATION);
    // Sanity: a genuinely different address is still fine.
    await expect(createUser("person2@example.com")).resolves.toMatchObject({
      email: "person2@example.com",
    });
  });

  it("allows at most one credential account per user (hand-written partial unique index)", async () => {
    const user = await createUser("cred@example.com");
    await prisma.account.create({
      data: { userId: user.id, providerId: "credential", accountId: user.id, password: "hash-1" },
    });
    // A second credential row with a DIFFERENT account_id dodges the composite
    // (provider_id, account_id) unique — only the partial index can stop it.
    await expect(
      prisma.account.create({
        data: {
          userId: user.id,
          providerId: "credential",
          accountId: "something-else",
          password: "hash-2",
        },
      }),
    ).rejects.toEqual(UNIQUE_VIOLATION);
    // The partial index is scoped to credential accounts only: other providers
    // may hold several rows for one user.
    await prisma.account.create({ data: { userId: user.id, providerId: "other", accountId: "a" } });
    await expect(
      prisma.account.create({ data: { userId: user.id, providerId: "other", accountId: "b" } }),
    ).resolves.toMatchObject({ providerId: "other", accountId: "b" });
  });

  it("rejects a duplicate (provider_id, account_id) pair across users (composite unique)", async () => {
    const a = await createUser("a@example.com");
    const b = await createUser("b@example.com");
    await prisma.account.create({
      data: { userId: a.id, providerId: "credential", accountId: "shared" },
    });
    await expect(
      prisma.account.create({
        data: { userId: b.id, providerId: "credential", accountId: "shared" },
      }),
    ).rejects.toEqual(UNIQUE_VIOLATION);
  });

  it("cascades a user deletion to its sessions and accounts only (Better Auth's own identity tables)", async () => {
    const user = await createUser("cascade@example.com");
    await prisma.session.create({
      data: { userId: user.id, token: "tok-1", expiresAt: new Date(Date.now() + 60_000) },
    });
    await prisma.account.create({
      data: { userId: user.id, providerId: "credential", accountId: user.id },
    });
    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.session.count()).toBe(0);
    expect(await prisma.account.count()).toBe(0);
  });

  it("enforces unique session tokens and rejects sessions for unknown users", async () => {
    const user = await createUser("sess@example.com");
    const expiresAt = new Date(Date.now() + 60_000);
    await prisma.session.create({ data: { userId: user.id, token: "same-token", expiresAt } });
    await expect(
      prisma.session.create({ data: { userId: user.id, token: "same-token", expiresAt } }),
    ).rejects.toEqual(UNIQUE_VIOLATION);
    await expect(
      prisma.session.create({
        data: { userId: "00000000-0000-4000-8000-000000000000", token: "orphan", expiresAt },
      }),
    ).rejects.toEqual(expect.objectContaining({ code: "P2003" })); // foreign_key_violation
  });

  it("stores verification rows and enforces unique rate-limit keys with epoch-ms BigInt values", async () => {
    const verification = await prisma.verification.create({
      data: {
        identifier: "reset-password:abc",
        value: "user-id",
        expiresAt: new Date(Date.now() + 1800_000),
      },
    });
    expect(verification.id).toMatch(UUID_V4);

    const lastRequest = BigInt(Date.now());
    const row = await prisma.rateLimit.create({
      data: { key: "/sign-in/email:127.0.0.1", count: 1, lastRequest },
    });
    expect(row.id).toMatch(UUID_V4);
    expect(row.lastRequest).toBe(lastRequest);
    await expect(
      prisma.rateLimit.create({ data: { key: "/sign-in/email:127.0.0.1", count: 2, lastRequest } }),
    ).rejects.toEqual(UNIQUE_VIOLATION);
  });

  it("left the landmarks table untouched: GENERATED location column, NOT NULL, GiST index all intact", async () => {
    const [column] = await prisma.$queryRaw<
      { is_nullable: string; is_generated: string; udt_name: string }[]
    >`
      SELECT is_nullable, is_generated, udt_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'landmarks' AND column_name = 'location'
    `;
    expect(column).toMatchObject({
      is_nullable: "NO",
      is_generated: "ALWAYS",
      udt_name: "geography",
    });

    const indexes = await prisma.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'landmarks' ORDER BY indexname
    `;
    expect(indexes.map((i) => i.indexname)).toEqual([
      "landmarks_category_active_idx",
      "landmarks_location_gist_idx",
      "landmarks_pkey",
      "landmarks_source_code_key",
    ]);
  });

  it("migration SQL contains no statement against landmarks or its location column (ADR-010 review check)", () => {
    const statements = MIGRATION_SQL.split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    expect(statements).not.toMatch(/landmarks/i);
    expect(statements).not.toMatch(/"location"/i);
    expect(statements).not.toMatch(/\bgist\b/i);
  });
});
