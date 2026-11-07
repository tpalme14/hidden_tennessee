import { Router } from "express";
import { prisma } from "../db/prisma.js";

const HEALTH_CHECK_TIMEOUT_MS = 2000;

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_resolve, reject) =>
        setTimeout(() => reject(new Error("health check timed out")), HEALTH_CHECK_TIMEOUT_MS),
      ),
    ]);
    res.status(200).json({ status: "ok" });
  } catch {
    // Intentionally generic: never disclose connection strings, SQL, or
    // internal error details in the response body (per Specification 7 §8).
    res.status(503).json({ status: "unavailable" });
  }
});
