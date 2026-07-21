import { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "crypto";
import AppError from "../errors/AppError";
import ServiceCredential from "../models/ServiceCredential";

export const hashSecret = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

const isServiceAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    throw new AppError("ERR_SERVICE_CREDENTIAL_REQUIRED", 401);
  }

  const [scheme, token] = authHeader.split(" ");
  if (!token || scheme.toLowerCase() !== "bearer") {
    throw new AppError("ERR_SERVICE_CREDENTIAL_REQUIRED", 401);
  }

  const [tokenId, secret] = token.split(".");
  if (!tokenId || !secret) {
    throw new AppError("ERR_INVALID_SERVICE_CREDENTIAL", 401);
  }

  const credential = await ServiceCredential.findOne({
    where: { tokenId }
  });

  if (!credential || credential.revokedAt) {
    throw new AppError("ERR_INVALID_SERVICE_CREDENTIAL", 401);
  }

  const expected = Buffer.from(credential.secretHash, "hex");
  const provided = Buffer.from(hashSecret(secret), "hex");
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    throw new AppError("ERR_INVALID_SERVICE_CREDENTIAL", 401);
  }

  req.user = {
    id: `service:${credential.id}`,
    profile: "service",
    companyId: credential.companyId
  };

  credential
    .update({ lastUsedAt: new Date() })
    .catch(() => undefined);

  return next();
};

export default isServiceAuth;
