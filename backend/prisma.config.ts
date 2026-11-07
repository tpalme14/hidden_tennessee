import "dotenv/config";
import { defineConfig, env } from "prisma/config";

// Prisma ORM 7: the CLI (generate/migrate) reads the connection URL from
// here, not from schema.prisma. The running application configures its own
// connection separately via a driver adapter (see src/db/prisma.ts) — per
// Prisma's documented v7 setup, the two are configured independently.
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: env("DATABASE_URL"),
  },
});
