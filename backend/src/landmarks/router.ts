import { Router, type Request, type Response, type NextFunction } from "express";
import { prisma } from "../db/prisma.js";
import { invalidQueryEnvelope, notFoundEnvelope } from "../http/error-envelope.js";
import { InvalidQueryError, getCategories, getLandmarkCollection, getLandmarkDetail } from "./service.js";

export const landmarksRouter = Router();

landmarksRouter.get("/landmarks", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await getLandmarkCollection(prisma, req.query as Record<string, unknown>);
    res.status(200).json(result);
  } catch (err) {
    if (err instanceof InvalidQueryError) {
      res.status(400).json(invalidQueryEnvelope(err.message));
      return;
    }
    next(err);
  }
});

landmarksRouter.get("/landmarks/:id", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const outcome = await getLandmarkDetail(prisma, req.params.id ?? "");
    if (outcome.status === 404) {
      res.status(404).json(notFoundEnvelope());
      return;
    }
    res.status(200).json(outcome.body);
  } catch (err) {
    next(err);
  }
});

landmarksRouter.get("/categories", (_req: Request, res: Response) => {
  res.status(200).json(getCategories());
});
