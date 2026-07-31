import { Request, Response } from "express";
import AppError from "../../errors/AppError";
import MessageMutationService, { MessageMutationKind } from "../application/MessageMutationService";
const handler = (kind: MessageMutationKind, service = new MessageMutationService(), emojiOverride?: string) => async (req: Request, res: Response): Promise<Response> => {
  const credential = req.apiCredential; const key = req.header("Idempotency-Key");
  if (!credential) throw new AppError("Credencial de API invalida", 401);
  if (process.env.MESSAGING_REACTIONS_V1_ENABLED !== "true") throw new AppError("FEATURE_NOT_ENABLED", 404);
  if (!key) throw new AppError("Idempotency-Key e obrigatoria", 400);
  const result = await service.create({ companyId: credential.companyId, allowedConnectionIds: credential.connectionIds, idempotencyScope: credential.id, idempotencyKey: key, messageId: req.params.messageId, kind, emoji: emojiOverride === undefined ? req.body.emoji : emojiOverride, text: req.body.text });
  if (result.replayed) res.set("Idempotent-Replayed", "true");
  return res.status(result.replayed ? 200 : 202).json(result.command.responseSnapshot);
};
export const createReactionHandler = (service = new MessageMutationService()) => handler("reaction", service);
export const deleteReactionHandler = (service = new MessageMutationService()) => handler("reaction", service, "");
export const editMessageHandler = (service = new MessageMutationService()) => handler("edit", service);
export const deleteMessageHandler = (service = new MessageMutationService()) => handler("delete", service);
