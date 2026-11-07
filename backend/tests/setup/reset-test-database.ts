import { Client } from "pg";
import { assertConnectedToTestDatabase, getVerifiedTestDatabaseUrl } from "./test-db-guard.js";

/**
 * Truncates only application-owned tables in the public schema. Tables
 * belonging to any extension (PostGIS's spatial_ref_sys, and the tiger/
 * topology schemas are never touched since this only looks at `public`)
 * are excluded via a pg_depend check, not by hardcoding names — so this
 * stays correct even if PostGIS's own table set changes. Prisma's own
 * migration-tracking table is excluded by name, since it isn't
 * extension-owned but also isn't application data.
 *
 * Connects independently via DATABASE_URL_TEST directly — never reads
 * DATABASE_URL, so there is no path by which this could fall back to the
 * development or production database.
 *
 * With no application tables yet (as of M00-T05), this safely does nothing.
 */
export async function resetTestDatabase(): Promise<void> {
  const testUrl = getVerifiedTestDatabaseUrl();
  await assertConnectedToTestDatabase(testUrl);

  const client = new Client({ connectionString: testUrl });
  await client.connect();
  try {
    const { rows } = await client.query<{ table_name: string }>(`
      SELECT c.relname AS table_name
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND c.relname <> '_prisma_migrations'
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.deptype = 'e'
        )
    `);

    for (const row of rows) {
      await client.query(`TRUNCATE TABLE "public"."${row.table_name}" RESTART IDENTITY CASCADE`);
    }
  } finally {
    await client.end();
  }
}
