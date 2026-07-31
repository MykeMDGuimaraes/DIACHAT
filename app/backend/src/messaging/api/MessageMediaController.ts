import { Request, Response } from "express";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import { signTranscriptAttachment } from "../application/TranscriptAttachmentSigner";

export const getMessageMediaHandler = async (req: Request, res: Response): Promise<Response> => {
  const credential = req.apiCredential;
  if (!credential) throw new AppError("Credencial de API invalida", 401);
  const message = await Message.findOne({ where: { id: req.params.messageId, companyId: credential.companyId }, attributes: ["id", "mediaUrl"] });
  if (!message || !message.getDataValue("mediaUrl")) throw new AppError("Anexo nao encontrado", 404);
  return res.json({ messageId: String(message.id), url: signTranscriptAttachment(String(message.id), credential.companyId) });
};
