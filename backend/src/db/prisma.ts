import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { env } from "../config/env.js";

// Prisma ORM 7 requires an explicit driver adapter rather than reading the
// connection URL implicitly (verified against current Prisma docs).
const adapter = new PrismaPg({ connectionString: env.databaseUrl });

// Single shared Prisma client instance for the process.
export const prisma = new PrismaClient({ adapter });
