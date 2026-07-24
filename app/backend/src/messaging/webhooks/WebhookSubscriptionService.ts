import { randomBytes } from "crypto";

import AppError from "../../errors/AppError";
import WebhookSubscription from "../persistence/models/WebhookSubscription";
import { encryptMessagingSecret, loadMessagingKeyring, MessagingKeyring } from "../security/MessagingSecretCipher";
import { validateWebhookUrl } from "./WebhookUrlPolicy";

const supportedEvents = new Set([
  "message.received",
  "message.sent",
  "message.status.updated",
  "ticket.created",
  "ticket.updated",
  "contact.updated"
]);

export interface CreateWebhookSubscriptionInput {
  companyId: number;
  name: string;
  url: string;
  events: string[];
  connectionIds?: number[];
  messageKinds?: string[];
  includeApiOrigin?: boolean;
}

interface CreateWebhookSubscriptionDependencies {
  create(data: Record<string, unknown>): Promise<any>;
  generateSecret(): string;
  encryptSecret(secret: string, keyring: MessagingKeyring): string;
  keyring: MessagingKeyring;
}

const defaultDependencies = (): CreateWebhookSubscriptionDependencies => ({
  create: data => WebhookSubscription.create(data as any),
  generateSecret: () => `dchwhsec_${randomBytes(32).toString("base64url")}`,
  encryptSecret: encryptMessagingSecret,
  keyring: loadMessagingKeyring()
});

export const createWebhookSubscription = async (
  input: CreateWebhookSubscriptionInput,
  dependencies: CreateWebhookSubscriptionDependencies = defaultDependencies()
): Promise<{ id: string; signingSecret: string }> => {
  validateWebhookUrl(input.url);
  if (!input.name?.trim() || !input.events?.length || input.events.some(event => !supportedEvents.has(event))) {
    throw new AppError("ConfiguraÃ§Ã£o de webhook invÃ¡lida", 400);
  }

  const signingSecret = dependencies.generateSecret();
  const subscription = await dependencies.create({
    companyId: input.companyId,
    name: input.name.trim(),
    url: input.url,
    enabled: true,
    events: [...new Set(input.events)],
    connectionIds: [...new Set(input.connectionIds || [])],
    messageKinds: [...new Set(input.messageKinds || [])],
    includeApiOrigin: input.includeApiOrigin === true,
    secretCiphertext: dependencies.encryptSecret(signingSecret, dependencies.keyring),
    keyVersion: dependencies.keyring.activeKeyId,
    consecutiveFailures: 0
  });
  return { id: subscription.id, signingSecret };
};

export interface UpdateWebhookSubscriptionInput {
  companyId: number;
  id: string;
  name?: string;
  url?: string;
  enabled?: boolean;
  events?: string[];
  connectionIds?: number[];
  messageKinds?: string[];
  includeApiOrigin?: boolean;
  rotateSecret?: boolean;
}

interface UpdateWebhookSubscriptionDependencies {
  find(companyId: number, id: string): Promise<any>;
  generateSecret(): string;
  encryptSecret(secret: string, keyring: MessagingKeyring): string;
  keyring: MessagingKeyring;
}

const defaultUpdateDependencies = (): UpdateWebhookSubscriptionDependencies => ({
  find: (companyId, id) => WebhookSubscription.findOne({ where: { id, companyId } }),
  generateSecret: () => `dchwhsec_${randomBytes(32).toString("base64url")}`,
  encryptSecret: encryptMessagingSecret,
  keyring: loadMessagingKeyring()
});

export const updateWebhookSubscription = async (
  input: UpdateWebhookSubscriptionInput,
  dependencies: UpdateWebhookSubscriptionDependencies = defaultUpdateDependencies()
): Promise<{ id: string; signingSecret?: string }> => {
  const subscription = await dependencies.find(input.companyId, input.id);
  if (!subscription) throw new AppError("Webhook nÃ£o encontrado", 404);
  if (input.url) validateWebhookUrl(input.url);
  if (input.events?.some(event => !supportedEvents.has(event))) {
    throw new AppError("Evento de webhook invÃ¡lido", 400);
  }

  const changes: Record<string, unknown> = {};
  for (const key of ["name", "url", "enabled", "includeApiOrigin"] as const) {
    if (input[key] !== undefined) changes[key] = input[key];
  }
  if (input.events) changes.events = [...new Set(input.events)];
  if (input.connectionIds) changes.connectionIds = [...new Set(input.connectionIds)];
  if (input.messageKinds) changes.messageKinds = [...new Set(input.messageKinds)];
  let signingSecret: string | undefined;
  if (input.rotateSecret) {
    signingSecret = dependencies.generateSecret();
    changes.secretCiphertext = dependencies.encryptSecret(signingSecret, dependencies.keyring);
    changes.keyVersion = dependencies.keyring.activeKeyId;
  }
  await subscription.update(changes);
  return signingSecret ? { id: input.id, signingSecret } : { id: input.id };
};
