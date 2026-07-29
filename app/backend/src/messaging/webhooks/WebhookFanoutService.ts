import { Op } from "sequelize";
import { randomUUID } from "crypto";
import sequelize from "../../database";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import WebhookDelivery from "../persistence/models/WebhookDelivery";
import WebhookSubscription from "../persistence/models/WebhookSubscription";
import {
  encryptWebhookBody,
  EncryptedWebhookBody,
  WebhookBodyBinding
} from "./WebhookBodyCipher";
import {
  loadMessagingKeyring,
  MessagingKeyring
} from "../security/MessagingSecretCipher";
import WhatsAppMirrorProjectionService, {
  WhatsAppMirrorSourceEvent
} from "./WhatsAppMirrorProjectionService";
import { WhatsAppMirrorSerializedSnapshot } from "./WhatsAppMirrorPayloadBuilder";
import { recordWhatsAppMirrorMetric } from "../operations/WhatsAppMirrorMetrics";

type DomainEvent = WhatsAppMirrorSourceEvent;

interface WebhookFanoutDependencies {
  transaction<T>(callback: (transaction: any) => Promise<T>): Promise<T>;
  claimEvent(eventTypes: readonly string[]): Promise<DomainEvent | null>;
  findSubscriptions(companyId: number, transaction?: any): Promise<any[]>;
  createDelivery(
    data: Record<string, unknown>,
    transaction: any
  ): Promise<unknown>;
  completeEvent(
    id: string,
    leaseToken: string,
    transaction: any
  ): Promise<unknown>;
  releaseEvent(
    id: string,
    leaseToken: string,
    failureCode: string
  ): Promise<unknown>;
  buildSnapshot(
    event: DomainEvent
  ): Promise<Pick<WhatsAppMirrorSerializedSnapshot, "rawBody" | "bodySha256">>;
  buildLegacySnapshot(
    event: DomainEvent
  ): Promise<Pick<WhatsAppMirrorSerializedSnapshot, "rawBody" | "bodySha256">>;
  encryptBody(
    rawBody: Buffer,
    binding: WebhookBodyBinding,
    keyring: MessagingKeyring
  ): EncryptedWebhookBody;
  getKeyring(): MessagingKeyring;
  newId(): string;
  mirrorEnabled(): boolean;
}

const legacyDeliverableEvents = [
  "message.received",
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
];

const specializedMirrorEvents = [
  "message.reaction",
  "message.edited",
  "message.deleted",
  "chat.updated",
  "connection.updated"
];

const defaultDependencies: WebhookFanoutDependencies = {
  transaction: callback => sequelize.transaction(callback),
  claimEvent: eventTypes =>
    sequelize.transaction(async transaction => {
      const leaseToken = randomUUID();
      const event = await MessagingOutboxEvent.findOne({
        where: {
          eventType: { [Op.in]: eventTypes },
          status: "ready",
          availableAt: { [Op.lte]: new Date() }
        },
        order: [["createdAt", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
      });
      if (!event) return null;
      await event.update(
        {
          status: "processing",
          leaseExpiresAt: new Date(Date.now() + 120000),
          leaseToken
        },
        { transaction }
      );
      return event.toJSON() as DomainEvent;
    }),
  findSubscriptions: (companyId, transaction) =>
    WebhookSubscription.findAll({
      where: { companyId, enabled: true, pausedAt: null },
      transaction
    }),
  createDelivery: (data, transaction) =>
    WebhookDelivery.create(data as any, { transaction }),
  completeEvent: (id, leaseToken, transaction) =>
    MessagingOutboxEvent.update(
      { status: "completed", leaseExpiresAt: null, leaseToken: null },
      { where: { id, status: "processing", leaseToken }, transaction }
    ),
  releaseEvent: (id, leaseToken, failureCode) =>
    MessagingOutboxEvent.update(
      {
        status: "ready",
        leaseExpiresAt: null,
        leaseToken: null,
        lastError: failureCode,
        availableAt: new Date(Date.now() + 1000)
      },
      { where: { id, status: "processing", leaseToken } }
    ),
  buildSnapshot: event =>
    new WhatsAppMirrorProjectionService().buildSnapshot(event),
  buildLegacySnapshot: event =>
    new WhatsAppMirrorProjectionService().buildLegacySnapshot(event),
  encryptBody: encryptWebhookBody,
  getKeyring: loadMessagingKeyring,
  newId: randomUUID,
  mirrorEnabled: () =>
    process.env.MESSAGING_WEBHOOK_MIRROR_V1_ENABLED === "true"
};

const matches = (subscription: any, event: DomainEvent): boolean => {
  if (!subscription.events?.includes(event.eventType)) return false;
  if (event.payload.origin === "api" && !subscription.includeApiOrigin)
    return false;
  if (
    subscription.connectionIds?.length &&
    !subscription.connectionIds.includes(event.payload.whatsappId)
  )
    return false;
  if (
    subscription.messageKinds?.length &&
    !subscription.messageKinds.includes(event.payload.kind)
  )
    return false;
  return true;
};

const correlationOnlyPayload = (
  event: DomainEvent
): Record<string, string | number | null> => ({
  messageId:
    event.payload.messageId === null || event.payload.messageId === undefined
      ? null
      : String(event.payload.messageId),
  whatsappId:
    event.payload.whatsappId === null || event.payload.whatsappId === undefined
      ? null
      : Number(event.payload.whatsappId),
  conversationId: event.payload.conversationId ?? null,
  contactId:
    event.payload.contactId === null || event.payload.contactId === undefined
      ? null
      : String(event.payload.contactId),
  externalTicketId: event.payload.externalTicketId ?? null,
  automationEpoch:
    event.payload.automationEpoch === null ||
    event.payload.automationEpoch === undefined
      ? null
      : Number(event.payload.automationEpoch)
});

class WebhookFanoutService {
  private readonly dependencies: WebhookFanoutDependencies;

  constructor(dependencies: Partial<WebhookFanoutDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async fanoutOne(): Promise<{
    status: "idle" | "created";
    deliveries: number;
  }> {
    const mirrorEnabled = this.dependencies.mirrorEnabled();
    const event = await this.dependencies.claimEvent(
      mirrorEnabled
        ? [...legacyDeliverableEvents, ...specializedMirrorEvents]
        : legacyDeliverableEvents
    );
    if (!event) return { status: "idle", deliveries: 0 };
    const subscriptions = (
      await this.dependencies.findSubscriptions(event.companyId)
    ).filter(item => matches(item, event));
    const prepared: Array<Record<string, unknown>> = [];
    if (subscriptions.length) {
      let snapshot;
      try {
        snapshot = mirrorEnabled
          ? await this.dependencies.buildSnapshot(event)
          : await this.dependencies.buildLegacySnapshot(event);
      } catch (error) {
        recordWhatsAppMirrorMetric("projectionFailure");
        await this.dependencies.releaseEvent(
          event.id,
          event.leaseToken,
          "WHATSAPP_MIRROR_PROJECTION_FAILED"
        );
        throw error;
      }
      const keyring = this.dependencies.getKeyring();
      for (const subscription of subscriptions) {
        const id = this.dependencies.newId();
        let encrypted;
        try {
          encrypted = this.dependencies.encryptBody(
            Buffer.from(snapshot.rawBody, "utf8"),
            {
              companyId: event.companyId,
              subscriptionId: subscription.id,
              deliveryId: id,
              eventId: event.id
            },
            keyring
          );
        } catch (error) {
          recordWhatsAppMirrorMetric("cryptoFailure");
          await this.dependencies.releaseEvent(
            event.id,
            event.leaseToken,
            "WHATSAPP_MIRROR_CRYPTO_FAILED"
          );
          throw error;
        }
        if (encrypted.bodySha256 !== snapshot.bodySha256) {
          throw new Error("Digest do snapshot de webhook divergente");
        }
        prepared.push({
          id,
          subscriptionId: subscription.id,
          companyId: event.companyId,
          eventId: event.id,
          eventType: event.eventType,
          urlSnapshot: subscription.url,
          methodSnapshot: subscription.method || "POST",
          secretCiphertextSnapshot: subscription.secretCiphertext,
          keyVersion: subscription.keyVersion,
          ...encrypted,
          bodyExpiresAt: null,
          bodyPurgedAt: null,
          payload: correlationOnlyPayload(event),
          status: "ready",
          attemptCount: 0,
          availableAt: new Date(),
          leaseToken: null
        });
      }
    }
    const deliveries = await this.dependencies.transaction(
      async transaction => {
        let created = 0;
        for (const delivery of prepared) {
          await this.dependencies.createDelivery(delivery, transaction);
          created += 1;
        }
        const completion = await this.dependencies.completeEvent(
          event.id,
          event.leaseToken,
          transaction
        );
        if (
          completion === 0 ||
          (Array.isArray(completion) && completion[0] === 0)
        ) {
          throw new Error("Lease do fanout de webhook perdida");
        }
        return created;
      }
    );
    return { status: "created", deliveries };
  }
}

export default WebhookFanoutService;
