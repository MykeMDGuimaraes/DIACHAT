import { Request, Response } from "express";
import ApiCredentialService from "../application/ApiCredentialService";
import AppError from "../../errors/AppError";
import ApiCredential from "../persistence/models/ApiCredential";
import { requireMessagingAdmin } from "./MessagingAdminGuard";

interface ApiCredentialIssuer {
  issue: (input: {
    companyId: number;
    name: string;
    scopes: string[];
    connectionIds: number[];
  }) => Promise<{ credential: any; apiKey: string }>;
}

export const createIssueApiCredentialHandler =
  (service: ApiCredentialIssuer = new ApiCredentialService()) =>
  async (req: Request, res: Response): Promise<Response> => {
    requireMessagingAdmin(req);

    const result = await service.issue({
      companyId: req.user.companyId,
      name: req.body.name,
      scopes: req.body.scopes,
      connectionIds: req.body.connectionIds
    });

    return res.status(201).json({
      id: result.credential.id,
      name: result.credential.name,
      apiKey: result.apiKey
    });
  };

export const listApiCredentialsHandler = async (
  req: Request,
  res: Response
): Promise<Response> => {
  requireMessagingAdmin(req);
  const credentials = await ApiCredential.findAll({
    where: { companyId: req.user.companyId },
    attributes: { exclude: ["secretHash"] },
    order: [["createdAt", "DESC"]]
  });
  return res.json(credentials);
};

export const revokeApiCredentialHandler = async (
  req: Request,
  res: Response
): Promise<Response> => {
  requireMessagingAdmin(req);
  const credential = await ApiCredential.findOne({
    where: { id: req.params.credentialId, companyId: req.user.companyId }
  });
  if (!credential) throw new AppError("Credencial de API nao encontrada", 404);
  if (!credential.revokedAt) await credential.update({ revokedAt: new Date() });
  return res.status(204).send();
};
