import { randomBytes } from "crypto";

import AppError from "../../errors/AppError";
import WebhookSubscription from "../persistence/models/WebhookSubscription";
import {
  encryptMessagingSecret,
  loadMessagingKeyring,
  MessagingKeyring
} from "../security/MessagingSecretCipher";
import { validateWebhookUrl } from "./WebhookUrlPolicy";

const supportedEvents = new Set([
  "message.received",
  "message.reaction",
  "message.edited",
  "message.deleted",
  "chat.updated",
  "connection.updated",
  "message.sent",
  "message.failed",
  "message.status.updated",
  "button.clicked",
  "handoff.paused",
  "handoff.released",
  "conversation.created",
  "conversation.updated",
  "ticket.created",
  "ticket.updated",
  "contact.updated"
]);

const receivedMirrorEvents = [
  "message.received",
  "message.reaction",
  "message.edited",
  "message.deleted",
  "chat.updated",
  "connection.updated"
];

const expandMirrorEvents = (events: string[]): string[] =>
  events.includes("message.received")
    ? [...new Set([...events, ...receivedMirrorEvents])]
    : [...new Set(events)];

const supportedMethods = new Set(["POST", "PUT", "PATCH"]);

const normalizeWebhookMethod = (method?: string): string => {
  const normalized = (method || "POST").trim().toUpperCase();
  if (!supportedMethods.has(normalized)) {
    throw new AppError(
      "Método HTTP de webhook inválido (use POST, PUT ou PATCH)",
      400
    );
  }
  return normalized;
};

// IDs de conexão começam em 1; valores inválidos (ex.: 0 gerado por campo
// vazio na UI) fariam o filtro nunca casar e silenciariam as entregas.
const sanitizeConnectionIds = (ids?: number[]): number[] => [
  ...new Set((ids || []).filter(id => Number.isInteger(id) && id > 0))
];

export interface CreateWebhookSubscriptionInput {
  companyId: number;
  name: string;
  url: string;
  method?: string;
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
  if (
    !input.name?.trim() ||
    !input.events?.length ||
    input.events.some(event => !supportedEvents.has(event))
  ) {
    throw new AppError("Configuração de webhook inválida", 400);
  }
  const method = normalizeWebhookMethod(input.method);

  const signingSecret = dependencies.generateSecret();
  const subscription = await dependencies.create({
    companyId: input.companyId,
    name: input.name.trim(),
    url: input.url,
    method,
    enabled: true,
    events: expandMirrorEvents(input.events),
    connectionIds: sanitizeConnectionIds(input.connectionIds),
    messageKinds: [...new Set(input.messageKinds || [])],
    includeApiOrigin: input.includeApiOrigin === true,
    secretCiphertext: dependencies.encryptSecret(
      signingSecret,
      dependencies.keyring
    ),
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
  method?: string;
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

const defaultUpdateDependencies =
  (): UpdateWebhookSubscriptionDependencies => ({
    find: (companyId, id) =>
      WebhookSubscription.findOne({ where: { id, companyId } }),
    generateSecret: () => `dchwhsec_${randomBytes(32).toString("base64url")}`,
    encryptSecret: encryptMessagingSecret,
    keyring: loadMessagingKeyring()
  });

export const updateWebhookSubscription = async (
  input: UpdateWebhookSubscriptionInput,
  dependencies: UpdateWebhookSubscriptionDependencies = defaultUpdateDependencies()
): Promise<{ id: string; signingSecret?: string }> => {
  const subscription = await dependencies.find(input.companyId, input.id);
  if (!subscription) throw new AppError("Webhook não encontrado", 404);
  if (input.url) validateWebhookUrl(input.url);
  if (input.events?.some(event => !supportedEvents.has(event))) {
    throw new AppError("Evento de webhook inválido", 400);
  }

  const changes: Record<string, unknown> = {};
  for (const key of ["name", "url", "enabled", "includeApiOrigin"] as const) {
    if (input[key] !== undefined) changes[key] = input[key];
  }
  if (input.method !== undefined)
    changes.method = normalizeWebhookMethod(input.method);
  if (input.events) changes.events = expandMirrorEvents(input.events);
  if (input.connectionIds)
    changes.connectionIds = sanitizeConnectionIds(input.connectionIds);
  if (input.messageKinds)
    changes.messageKinds = [...new Set(input.messageKinds)];
  let signingSecret: string | undefined;
  if (input.rotateSecret) {
    signingSecret = dependencies.generateSecret();
    changes.secretCiphertext = dependencies.encryptSecret(
      signingSecret,
      dependencies.keyring
    );
    changes.keyVersion = dependencies.keyring.activeKeyId;
  }
  await subscription.update(changes);
  return signingSecret ? { id: input.id, signingSecret } : { id: input.id };
};
