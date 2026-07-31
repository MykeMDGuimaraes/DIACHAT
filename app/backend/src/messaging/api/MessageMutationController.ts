import { randomUUID } from "crypto";
import { Request, Response } from "express";

import AppError from "../../errors/AppError";
import MessageMutationService, {
  MessageMutationKind
} from "../application/MessageMutationService";

const handler = (
  kind: MessageMutationKind,
  emojiOverride?: string,
  service = new MessageMutationService()
) =>
  async (req: Request, res: Response): Promise<Response> => {
    const credential = req.apiCredential;
    if (!credential) throw new AppError("Credencial de API invalida", 401);
    if (process.env.MESSAGING_REACTIONS_V1_ENABLED !== "true") {
      throw new AppError("FEATURE_NOT_ENABLED", 404);
    }
    const result = await service.create({
      companyId: credential.companyId,
      allowedConnectionIds: credential.connectionIds,
      idempotencyScope: credential.id,
      idempotencyKey: `server:${randomUUID()}`,
      messageId: req.params.messageId,
      kind,
      emoji:
        emojiOverride === undefined ? req.body.emoji : emojiOverride,
      text: req.body.text
    });
    return res.status(202).json(result.command.responseSnapshot);
  };

export const createReactionHandler = (
  service = new MessageMutationService()
) => handler("reaction", undefined, service);
export const deleteReactionHandler = (
  service = new MessageMutationService()
) => handler("reaction", "", service);
export const editMessageHandler = (
  service = new MessageMutationService()
) => handler("edit", undefined, service);
export const deleteMessageHandler = (
  service = new MessageMutationService()
) => handler("delete", undefined, service);
