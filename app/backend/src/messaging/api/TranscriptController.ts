import { promises as fs } from "fs";
import path from "path";
import { Request, Response } from "express";
import uploadConfig from "../../config/upload";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import TranscriptService from "../application/TranscriptService";
import { verifyTranscriptAttachment } from "../application/TranscriptAttachmentSigner";

interface TranscriptReader {
  list(input: {
    companyId: number;
    allowedConnectionIds: number[];
    conversationId: string;
    cursor?: string;
    limit?: number;
  }): Promise<unknown>;
}

export const createTranscriptHandler =
  (service: TranscriptReader = new TranscriptService()) =>
  async (req: Request, res: Response): Promise<Response> => {
    const credential = req.apiCredential;
    if (!credential) throw new AppError("Credencial de API inválida", 401);
    const result = await service.list({
      companyId: credential.companyId,
      allowedConnectionIds: credential.connectionIds,
      conversationId: req.params.conversationId,
      cursor:
        typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      limit: req.query.limit === undefined ? undefined : Number(req.query.limit)
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

  const root = path.resolve(uploadConfig.directory);
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
