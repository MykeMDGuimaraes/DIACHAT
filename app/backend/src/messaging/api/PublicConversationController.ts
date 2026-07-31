import { Request, Response } from "express";
import AppError from "../../errors/AppError";
import PublicConversationService from "../application/PublicConversationService";
export const listPublicConversationsHandler = (service = new PublicConversationService()) => async (req: Request, res: Response): Promise<Response> => {
  const credential = req.apiCredential; if (!credential) throw new AppError("Credencial de API invalida", 401);
  return res.json(await service.list({ companyId: credential.companyId, connectionIds: credential.connectionIds, connectionId: req.query.connectionId === undefined ? undefined : Number(req.query.connectionId), cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined, limit: req.query.limit === undefined ? undefined : Number(req.query.limit) }));
};
export const getPublicConversationHandler = (service = new PublicConversationService()) => async (req: Request, res: Response): Promise<Response> => {
  const credential = req.apiCredential; if (!credential) throw new AppError("Credencial de API invalida", 401);
  return res.json(await service.get({ companyId: credential.companyId, connectionIds: credential.connectionIds, id: req.params.conversationId }));
};
