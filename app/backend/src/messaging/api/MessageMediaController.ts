import { Request, Response } from "express";
import AppError from "../../errors/AppError";
import MessageMediaService, { MessageMediaFormat } from "../application/MessageMediaService";

interface MessageMediaReader {
  resolve(input: { companyId: number; allowedConnectionIds: number[]; messageId: string }): Promise<any>;
  json(media: any, options: { includeUrl: boolean; includeBase64: boolean; companyId: number }): Promise<Record<string, unknown>>;
}

const parseBoolean = (value: unknown, field: string): boolean => {
  if (value === undefined) return false;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new AppError(`${field} invalido`, 400);
};

export const createMessageMediaHandler = (
  service: MessageMediaReader = new MessageMediaService()
) => async (req: Request, res: Response): Promise<Response | void> => {
  const credential = req.apiCredential;
  if (!credential) throw new AppError("Credencial de API invalida", 401);

  const format = String(req.query.format || "url") as MessageMediaFormat;
  if (!(["url", "download", "base64"] as string[]).includes(format)) {
    throw new AppError("format invalido", 400);
  }
  const includeBase64 = parseBoolean(req.query.includeBase64, "includeBase64");
  if (format === "download" && includeBase64) {
    throw new AppError("includeBase64 nao pode ser usado com format=download", 400);
  }

  const media = await service.resolve({
    companyId: credential.companyId,
    allowedConnectionIds: credential.connectionIds,
    messageId: req.params.messageId
  });
  res.set("Cache-Control", "private, no-store");
  res.set("X-Content-Type-Options", "nosniff");

  if (format === "download") {
    if (media.mimeType) res.type(media.mimeType);
    res.set("Content-Length", String(media.sizeBytes));
    return res.download(media.absolutePath, media.fileName);
  }

  return res.json(await service.json(media, {
    companyId: credential.companyId,
    includeUrl: format === "url",
    includeBase64: format === "base64" || includeBase64
  }));
};

export const getMessageMediaHandler = createMessageMediaHandler();
