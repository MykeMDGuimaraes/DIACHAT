import { Request, Response } from "express";
import ApiCredentialService from "../application/ApiCredentialService";
import AppError from "../../errors/AppError";

interface ApiCredentialIssuer {
  issue: (input: {
    companyId: number;
    name: string;
    scopes: string[];
    connectionIds: number[];
  }) => Promise<{ credential: any; apiKey: string }>;
}

export const createIssueApiCredentialHandler = (
  service: ApiCredentialIssuer = new ApiCredentialService()
) => async (req: Request, res: Response): Promise<Response> => {
  if (req.user.profile !== "admin") {
    throw new AppError("Somente administradores podem emitir credenciais", 403);
  }

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
