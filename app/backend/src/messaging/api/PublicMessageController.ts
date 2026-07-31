import { randomUUID } from "crypto";
import { promises as fs } from "fs";
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
  try {
  const credential = req.apiCredential;
  const connectionId = Number(req.body.connectionId);
  const idempotencyKey = `server:${randomUUID()}`;

  if (!credential) {
    throw new AppError("Credencial de API invalida", 401);
  }
  if (!Number.isInteger(connectionId) || !credential.connectionIds.includes(connectionId)) {
    throw new AppError("Canal de WhatsApp nao autorizado", 403);
  }

  const parseObject = (value: unknown, field: string): Record<string, unknown> | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed;
      } catch { /* handled below */ }
    }
    throw new AppError(`${field} invalido`, 400);
  };
  const parseArray = (value: unknown, field: string): unknown[] | undefined => {
    if (value === undefined || value === null || value === "") return undefined;
    if (Array.isArray(value)) return value;
    if (typeof value === "string") {
      try { const parsed = JSON.parse(value); if (Array.isArray(parsed)) return parsed; } catch { /* handled below */ }
    }
    throw new AppError(`${field} invalido`, 400);
  };
  const messageType = req.body.type || "text";
  if (req.file && process.env.MESSAGING_MEDIA_UPLOAD_V1_ENABLED !== "true") {
    throw new AppError("FEATURE_NOT_ENABLED", 404);
  }
  let text = req.body.text;
  if (req.body.internalTemplateId) {
    const rendered = await new InternalTemplateService().render(
      credential.companyId,
      req.body.internalTemplateId,
      parseObject(req.body.variables, "variables") || {}
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
                ? { buttons: parseArray(req.body.buttons, "buttons") }
                : req.file
                  ? {
                      localPath: privateMediaRelativePath(req.file.path),
                      fileName: req.file.originalname,
                      mimeType: req.file.mimetype,
                      size: req.file.size,
                      caption: req.body.caption
                    }
                  : (() => {
                      const media = parseObject(req.body.media, "media");
                      if (!media) throw new AppError("media invalida", 400);
                      const link = typeof media.link === "string" ? media.link : media.url;
                      if (typeof link !== "string") throw new AppError("media invalida", 400);
                      return { ...media, link };
                    })()
        }),
    ...(req.body.externalTicketId !== undefined
      ? {
          externalTicketId: req.body.externalTicketId,
          automationEpoch: req.body.automationEpoch
        }
      : {})
  });

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
  return res.status(202).json(body);
  } catch (error) {
    if (req.file?.path) await fs.unlink(req.file.path).catch(() => undefined);
    throw error;
  }
};
