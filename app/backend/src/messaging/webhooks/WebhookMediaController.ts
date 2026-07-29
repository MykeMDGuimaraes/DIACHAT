import { Request, Response } from "express";

import AppError from "../../errors/AppError";
import {
  loadMessagingKeyring,
  MessagingKeyring
} from "../security/MessagingSecretCipher";
import WebhookMediaService from "./WebhookMediaService";
import { verifyWebhookMediaToken } from "./WebhookMediaToken";

interface WebhookMediaReader {
  open(
    companyId: number,
    messageId: string
  ): Promise<{ absolutePath: string; mimeType: string | null }>;
}

export const createWebhookMediaHandler =
  (
    service: WebhookMediaReader = new WebhookMediaService(),
    getKeyring: () => MessagingKeyring = loadMessagingKeyring
  ) =>
  async (req: Request, res: Response): Promise<void> => {
    const companyId = Number(req.query.companyId);
    const expires = Number(req.query.expires);
    const keyVersion =
      typeof req.query.keyVersion === "string" ? req.query.keyVersion : "";
    const token = typeof req.query.token === "string" ? req.query.token : "";
    const messageId = req.params.messageId;
    if (
      !verifyWebhookMediaToken({
        messageId,
        companyId,
        expires,
        keyVersion,
        token,
        keyring: getKeyring()
      })
    ) {
      throw new AppError("Token de mídia de webhook inválido ou expirado", 401);
    }
    const media = await service.open(companyId, messageId);
    if (media.mimeType) res.type(media.mimeType);
    res.sendFile(media.absolutePath);
  };

export const webhookMediaHandler = createWebhookMediaHandler();
