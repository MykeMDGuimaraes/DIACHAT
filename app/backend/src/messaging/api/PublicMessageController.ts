import { Request, Response } from "express";
import AppError from "../../errors/AppError";
import PublicTextMessageService from "../application/PublicTextMessageService";
import InternalTemplateService from "../application/InternalTemplateService";
import { privateMediaRelativePath } from "./PublicMediaUpload";

interface PublicTextMessageCreator {
  create: (input: {
    companyId: number;
    whatsappId: number;
    idempotencyScope: string;
    idempotencyKey: string;
    recipient: string;
    text?: string;
    kind?: "text" | "buttons" | "image" | "audio" | "video" | "document" | "template";
    payload?: Record<string, any>;
    externalTicketId?: string;
    automationEpoch?: number;
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
  if (req.file && process.env.MESSAGING_MEDIA_UPLOAD_V1_ENABLED !== "true") {
    throw new AppError("FEATURE_NOT_ENABLED", 404);
  }
  let text = req.body.text;
  if (req.body.internalTemplateId) {
    const rendered = await new InternalTemplateService().render(
      credential.companyId,
      req.body.internalTemplateId,
      req.body.variables || {}
    );
    text = rendered.text;
  }
  const result = await service.create({
    companyId: credential.companyId,
    whatsappId: connectionId,
    idempotencyScope: credential.id,
    idempotencyKey,
    recipient: req.body.to,
    text,
    ...(messageType === "text"
      ? {}
      : {
          kind: messageType,
          payload:
            messageType === "template"
              ? req.body.template
              : messageType === "buttons"
                ? { buttons: req.body.buttons }
                : req.file
                  ? {
                      localPath: privateMediaRelativePath(req.file.path),
                      fileName: req.file.originalname,
                      mimeType: req.file.mimetype,
                      size: req.file.size,
                      caption: req.body.caption
                    }
                  : req.body.media
        }),
    ...(req.body.externalTicketId !== undefined
      ? {
          externalTicketId: req.body.externalTicketId,
          automationEpoch: req.body.automationEpoch
        }
      : {})
  });

  if (result.replayed) {
    res.set("Idempotent-Replayed", "true");
  }

  const body =
    result.command.responseSnapshot ||
    {
      id: result.command.id,
      status: "accepted",
      messageId: result.message?.id || result.command.messageId,
      ...(result.command.conversationId
        ? { conversationId: result.command.conversationId }
        : {}),
      ...(result.command.contactId
        ? { contactId: String(result.command.contactId) }
        : {})
    };
  return res.status(result.replayed ? 200 : 202).json(body);
};
