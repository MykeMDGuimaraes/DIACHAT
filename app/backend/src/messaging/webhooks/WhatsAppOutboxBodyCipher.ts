import {
  decryptWebhookBody,
  encryptWebhookBody,
  EncryptedWebhookBody,
  WebhookBodyBinding
} from "./WebhookBodyCipher";
import { MessagingKeyring } from "../security/MessagingSecretCipher";

const OUTBOX_SUBSCRIPTION_BINDING = "messaging-outbox";

export const whatsAppOutboxBodyBinding = (
  companyId: number,
  eventId: string
): WebhookBodyBinding => ({
  companyId,
  subscriptionId: OUTBOX_SUBSCRIPTION_BINDING,
  deliveryId: eventId,
  eventId
});

export const encryptWhatsAppOutboxBody = (
  payload: Record<string, unknown>,
  companyId: number,
  eventId: string,
  keyring: MessagingKeyring
): EncryptedWebhookBody =>
  encryptWebhookBody(
    Buffer.from(JSON.stringify(payload), "utf8"),
    whatsAppOutboxBodyBinding(companyId, eventId),
    keyring
  );

export const decryptWhatsAppOutboxBody = (
  encrypted: EncryptedWebhookBody,
  companyId: number,
  eventId: string,
  keyring: MessagingKeyring
): Record<string, unknown> =>
  JSON.parse(
    decryptWebhookBody(
      encrypted,
      whatsAppOutboxBodyBinding(companyId, eventId),
      keyring
    ).toString("utf8")
  );
