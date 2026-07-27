import { createHash } from "crypto";

import sequelize from "../../../database";
import AppError from "../../../errors/AppError";
import MetaCloudCredential from "../../persistence/models/MetaCloudCredential";
import MessagingInboxEvent from "../../persistence/models/MessagingInboxEvent";
import MessagingOutboxEvent from "../../persistence/models/MessagingOutboxEvent";
import {
  decryptMessagingSecret,
  loadMessagingKeyring,
  MessagingKeyring
} from "../../security/MessagingSecretCipher";
import { verifyMetaWebhookSignature } from "./MetaWebhookSignature";

export interface IngestMetaWebhookInput {
  credentialPublicId: string;
  rawBody: string;
  signature?: string;
  payload: Record<string, unknown>;
}

interface IngestMetaWebhookDependencies {
  transaction<T>(callback: (transaction: any) => Promise<T>): Promise<T>;
  findCredential(publicId: string): Promise<any>;
  decryptSecret(secret: string, keyring: MessagingKeyring): string;
  getKeyring(): MessagingKeyring;
  findInbox(dedupeKey: string, transaction: any): Promise<any>;
  createInbox(data: Record<string, unknown>, transaction: any): Promise<any>;
  createOutbox(data: Record<string, unknown>, transaction: any): Promise<any>;
}

const defaultDependencies: IngestMetaWebhookDependencies = {
  transaction: callback => sequelize.transaction(callback),
  findCredential: publicId =>
    MetaCloudCredential.findOne({ where: { publicId } }),
  decryptSecret: decryptMessagingSecret,
  getKeyring: loadMessagingKeyring,
  findInbox: (dedupeKey, transaction) =>
    MessagingInboxEvent.findOne({ where: { dedupeKey }, transaction }),
  createInbox: (data, transaction) =>
    MessagingInboxEvent.create(data as any, { transaction }),
  createOutbox: (data, transaction) =>
    MessagingOutboxEvent.create(data as any, { transaction })
};

export const ingestMetaWebhook = async (
  input: IngestMetaWebhookInput,
  dependencies: IngestMetaWebhookDependencies = defaultDependencies
): Promise<{ accepted: true; duplicate: boolean }> => {
  const credential = await dependencies.findCredential(
    input.credentialPublicId
  );
  if (!credential) {
    throw new AppError("Canal Meta não encontrado", 404);
  }

  const appSecret = dependencies.decryptSecret(
    credential.appSecretCiphertext,
    dependencies.getKeyring()
  );
  if (!verifyMetaWebhookSignature(appSecret, input.rawBody, input.signature)) {
    throw new AppError("Assinatura Meta inválida", 403);
  }

  const dedupeKey = createHash("sha256")
    .update(`${credential.id || input.credentialPublicId}.${input.rawBody}`)
    .digest("hex");

  return dependencies.transaction(async transaction => {
    const existing = await dependencies.findInbox(dedupeKey, transaction);
    if (existing) {
      return { accepted: true, duplicate: true };
    }

    const inbox = await dependencies.createInbox(
      {
        companyId: credential.companyId,
        whatsappId: credential.whatsappId,
        provider: "meta_cloud",
        dedupeKey,
        payload: input.payload,
        status: "received"
      },
      transaction
    );
    await dependencies.createOutbox(
      {
        companyId: credential.companyId,
        eventType: "meta.callback.received",
        aggregateId: inbox.id,
        payload: { inboxEventId: inbox.id, whatsappId: credential.whatsappId },
        status: "ready",
        attemptCount: 0
      },
      transaction
    );
    return { accepted: true, duplicate: false };
  });
};
