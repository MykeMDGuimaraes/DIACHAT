import { promises as fs } from "fs";
import path from "path";
import { Request, Response } from "express";
import uploadConfig from "../../config/upload";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import TranscriptService from "../application/TranscriptService";
import { verifyTranscriptAttachment } from "../application/TranscriptAttachmentSigner";
import { privateMediaDirectory } from "./PublicMediaUpload";

interface TranscriptReader {
  list(input: {
    companyId: number;
    allowedConnectionIds: number[];
    conversationId: string;
    cursor?: string;
    limit?: number;
      filters?: {
      from?: string;
      to?: string;
      type?: string;
      fromMe?: boolean;
        mediaOnly?: boolean;
        status?: "accepted" | "sent" | "delivered" | "read" | "failed" | "received";
        providerMessageId?: string;
    };
  }): Promise<unknown>;
}

export const createTranscriptHandler =
  (service: TranscriptReader = new TranscriptService()) =>
  async (req: Request, res: Response): Promise<Response> => {
    const credential = req.apiCredential;
    if (!credential) throw new AppError("Credencial de API inválida", 401);
    const from = typeof req.query.from === "string" ? req.query.from : undefined;
    const to = typeof req.query.to === "string" ? req.query.to : undefined;
    if ((from && Number.isNaN(new Date(from).getTime())) || (to && Number.isNaN(new Date(to).getTime())) || (from && to && new Date(from) > new Date(to))) throw new AppError("Periodo do transcript invalido", 400);
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    if (status && !["accepted", "sent", "delivered", "read", "failed", "received"].includes(status)) throw new AppError("Status do transcript invalido", 400);
    const fromMe = req.query.fromMe === undefined ? undefined : req.query.fromMe === "true" ? true : req.query.fromMe === "false" ? false : undefined;
    if (req.query.fromMe !== undefined && fromMe === undefined) throw new AppError("Filtro fromMe invalido", 400);
    const result = await service.list({
      companyId: credential.companyId,
      allowedConnectionIds: credential.connectionIds,
      conversationId: req.params.conversationId,
      cursor:
        typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      limit: req.query.limit === undefined ? undefined : Number(req.query.limit),
      filters: {
        from,
        to,
        type: typeof req.query.type === "string" ? req.query.type : undefined,
        fromMe,
        mediaOnly: req.query.mediaOnly === "true",
        ...(status ? { status: status as "accepted" | "sent" | "delivered" | "read" | "failed" | "received" } : {}),
        providerMessageId: typeof req.query.providerMessageId === "string" ? req.query.providerMessageId : undefined
      }
    });
    return res.json(result);
  };

export const transcriptMediaHandler = async (
  req: Request,
  res: Response
): Promise<Response | void> => {
  const companyId = Number(req.query.companyId);
  const expires = Number(req.query.expires);
  const signature =
    typeof req.query.signature === "string" ? req.query.signature : "";
  const messageId = req.params.messageId;

  if (
    !verifyTranscriptAttachment({
      messageId,
      companyId,
      expires,
      signature
    })
  ) {
    throw new AppError("URL de anexo inválida ou expirada", 401);
  }

  const message = await Message.findOne({
    where: { id: messageId, companyId },
    attributes: ["id", "mediaUrl"]
  });
  const storedPath = message?.getDataValue("mediaUrl");
  if (!storedPath) throw new AppError("Anexo não encontrado", 404);

  const isPrivate = storedPath.startsWith("messaging/");
  const root = path.resolve(isPrivate ? path.dirname(privateMediaDirectory) : uploadConfig.directory);
  const target = path.resolve(root, storedPath);
  const relative = path.relative(root, target);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError("Anexo não encontrado", 404);
  }
  try {
    await fs.access(target);
  } catch {
    throw new AppError("Anexo não encontrado", 404);
  }
  return res.sendFile(target);
};
