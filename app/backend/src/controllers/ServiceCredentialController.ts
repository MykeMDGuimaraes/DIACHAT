import { Request, Response } from "express";
import { randomBytes } from "crypto";
import AppError from "../errors/AppError";
import ServiceCredential from "../models/ServiceCredential";
import Company from "../models/Company";
import { hashSecret } from "../middleware/isServiceAuth";

export const index = async (req: Request, res: Response): Promise<Response> => {
  const credentials = await ServiceCredential.findAll({
    attributes: [
      "id",
      "name",
      "tokenId",
      "companyId",
      "revokedAt",
      "lastUsedAt",
      "createdAt"
    ],
    include: [{ model: Company, attributes: ["id", "name"] }],
    order: [["id", "ASC"]]
  });
  return res.json(credentials);
};

export const store = async (req: Request, res: Response): Promise<Response> => {
  const { name, companyId } = req.body as { name?: string; companyId?: number };

  if (!name || !companyId) {
    throw new AppError("ERR_NAME_AND_COMPANY_REQUIRED", 400);
  }

  const company = await Company.findByPk(companyId);
  if (!company) {
    throw new AppError("ERR_NO_COMPANY_FOUND", 404);
  }

  const tokenId = `svc_${randomBytes(12).toString("hex")}`;
  const secret = randomBytes(32).toString("hex");

  const credential = await ServiceCredential.create({
    name,
    companyId,
    tokenId,
    secretHash: hashSecret(secret)
  } as any);

  return res.status(201).json({
    id: credential.id,
    name: credential.name,
    tokenId,
    companyId,
    // Mostrado uma única vez; armazenamos apenas o hash.
    token: `${tokenId}.${secret}`
  });
};

export const revoke = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { id } = req.params;

  const credential = await ServiceCredential.findByPk(id);
  if (!credential) {
    throw new AppError("ERR_NO_CREDENTIAL_FOUND", 404);
  }
  if (!credential.revokedAt) {
    await credential.update({ revokedAt: new Date() });
  }

  return res.json({
    id: credential.id,
    tokenId: credential.tokenId,
    revokedAt: credential.revokedAt
  });
};

export const me = async (req: Request, res: Response): Promise<Response> => {
  return res.json({
    id: req.user.id,
    profile: req.user.profile,
    companyId: req.user.companyId
  });
};
