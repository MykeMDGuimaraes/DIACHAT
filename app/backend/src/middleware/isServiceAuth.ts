import { Request, Response, NextFunction } from "express";
import { createHash, timingSafeEqual } from "crypto";
import AppError from "../errors/AppError";
import ServiceCredential from "../models/ServiceCredential";
import { audit, requestIp } from "../libs/auditLog";

export const hashSecret = (secret: string): string =>
  createHash("sha256").update(secret).digest("hex");

// Valida um token "tokenId.secret" e retorna a credencial ativa
// correspondente, ou null se inválido/revogado. Não lança nem audita —
// quem chama decide como registrar o resultado.
export const verifyServiceToken = async (
  token: string
): Promise<ServiceCredential | null> => {
  const [tokenId, secret] = token.split(".");
  if (!tokenId || !secret) {
    return null;
  }

  const credential = await ServiceCredential.findOne({ where: { tokenId } });
  if (!credential || credential.revokedAt) {
    return null;
  }

  const expected = Buffer.from(credential.secretHash, "hex");
  const provided = Buffer.from(hashSecret(secret), "hex");
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    return null;
  }

  return credential;
};

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
    audit({
      companyId: credential ? credential.companyId : null,
      actorType: "anonymous",
      action: "service.auth",
      outcome: "denied",
      ip: requestIp(req),
      metadata: { tokenId, reason: credential ? "revoked" : "unknown" }
    });
    throw new AppError("ERR_INVALID_SERVICE_CREDENTIAL", 401);
  }

  const expected = Buffer.from(credential.secretHash, "hex");
  const provided = Buffer.from(hashSecret(secret), "hex");
  if (
    expected.length !== provided.length ||
    !timingSafeEqual(expected, provided)
  ) {
    audit({
      companyId: credential.companyId,
      actorType: "anonymous",
      action: "service.auth",
      outcome: "denied",
      ip: requestIp(req),
      metadata: { tokenId, reason: "bad_secret" }
    });
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

  audit({
    companyId: credential.companyId,
    actorType: "service",
    actorId: `service:${credential.id}`,
    action: "service.auth",
    ip: requestIp(req),
    metadata: { tokenId, method: req.method, path: req.originalUrl.split("?")[0] }
  });

  return next();
};

export default isServiceAuth;
