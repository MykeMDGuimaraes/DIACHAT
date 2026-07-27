import { Request, Response } from "express";

import { ingestMetaWebhook } from "./IngestMetaWebhookService";
import { verifyMetaWebhookChallenge } from "./MetaWebhookVerificationService";

const queryValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

export const verifyMetaWebhookHandler = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const challenge = await verifyMetaWebhookChallenge({
    credentialPublicId: req.params.credentialPublicId,
    mode: queryValue(req.query["hub.mode"]),
    verifyToken: queryValue(req.query["hub.verify_token"]),
    challenge: queryValue(req.query["hub.challenge"])
  });
  return res.send(challenge);
};

export const receiveMetaWebhookHandler = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
  await ingestMetaWebhook({
    credentialPublicId: req.params.credentialPublicId,
    rawBody: rawBody ? rawBody.toString("utf8") : JSON.stringify(req.body),
    signature: req.get("X-Hub-Signature-256") || undefined,
    payload: req.body
  });
  return res.sendStatus(200);
};
