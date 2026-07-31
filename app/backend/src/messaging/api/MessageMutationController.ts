import { Request, Response } from "express";
import AppError from "../../errors/AppError";
import MessageMutationService, { MessageMutationKind } from "../application/MessageMutationService";
const handler = (kind: MessageMutationKind, service = new MessageMutationService()) => async (req: Request, res: Response): Promise<Response> => {
  const credential = req.apiCredential; const key = req.header("Idempotency-Key");
  if (!credential) throw new AppError("Credencial de API invalida", 401);
  if (process.env.MESSAGING_REACTIONS_V1_ENABLED !== "true") throw new AppError("FEATURE_NOT_ENABLED", 404);
  if (!key) throw new AppError("Idempotency-Key e obrigatoria", 400);
  const result = await service.create({ companyId: credential.companyId, allowedConnectionIds: credential.connectionIds, idempotencyScope: credential.id, idempotencyKey: key, messageId: req.params.messageId, kind, emoji: req.body.emoji, text: req.body.text });
  if (result.replayed) res.set("Idempotent-Replayed", "true");
  return res.status(result.replayed ? 200 : 202).json(result.command.responseSnapshot);
};
export const createReactionHandler = () => handler("reaction");
export const deleteReactionHandler = () => handler("reaction");
export const editMessageHandler = () => handler("edit");
export const deleteMessageHandler = () => handler("delete");
