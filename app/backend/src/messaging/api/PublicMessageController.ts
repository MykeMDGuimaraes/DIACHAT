import { Request, Response } from "express";
import AppError from "../../errors/AppError";
import PublicTextMessageService from "../application/PublicTextMessageService";

interface PublicTextMessageCreator {
  create: (input: {
    companyId: number;
    whatsappId: number;
    idempotencyScope: string;
    idempotencyKey: string;
    recipient: string;
    text?: string;
    kind?: "text" | "image" | "audio" | "video" | "document" | "template";
    payload?: Record<string, any>;
  }) => Promise<{ command: any; message: any; replayed: boolean }>;
}

export const createPublicTextMessageHandler = (
  service: PublicTextMessageCreator = new PublicTextMessageService()
) => async (req: Request, res: Response): Promise<Response> => {
  const credential = req.apiCredential;
  const connectionId = Number(req.body.connectionId);
  const idempotencyKey = req.header("Idempotency-Key");

  if (!credential) {
    throw new AppError("Credencial de API invalida", 401);
  }
  if (!idempotencyKey) {
    throw new AppError("Idempotency-Key e obrigatoria", 400);
  }
  if (!Number.isInteger(connectionId) || !credential.connectionIds.includes(connectionId)) {
    throw new AppError("Canal de WhatsApp nao autorizado", 403);
  }

  const messageType = req.body.type || "text";
  const result = await service.create({
    companyId: credential.companyId,
    whatsappId: connectionId,
    idempotencyScope: credential.id,
    idempotencyKey,
    recipient: req.body.to,
    text: req.body.text,
    ...(messageType === "text"
      ? {}
      : {
          kind: messageType,
          payload: messageType === "template" ? req.body.template : req.body.media
        })
  });

  if (result.replayed) {
    res.set("Idempotent-Replayed", "true");
  }

  return res.status(result.replayed ? 200 : 202).json({
    id: result.command.id,
    status: result.command.status,
    messageId: result.message?.id || result.command.messageId
  });
};
