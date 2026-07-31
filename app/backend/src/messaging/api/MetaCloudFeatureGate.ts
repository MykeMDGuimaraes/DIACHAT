import { Request, Response, NextFunction } from "express";
import AppError from "../../errors/AppError";

/** Meta Cloud is intentionally unavailable until the Phase 2 rollout. */
export const requireMetaCloudPhase2 = (
  _req: Request,
  _res: Response,
  next: NextFunction
): void => {
  if (process.env.MESSAGING_META_CLOUD_ENABLED !== "true") {
    throw new AppError("FEATURE_NOT_ENABLED", 404);
  }
  next();
};

export default requireMetaCloudPhase2;
