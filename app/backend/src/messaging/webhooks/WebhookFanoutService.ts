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
import { decryptWhatsAppOutboxBody } from "./WhatsAppOutboxBodyCipher";

type DomainEvent = WhatsAppMirrorSourceEvent;
const FANOUT_MAX_ATTEMPTS = 6;
const OUTBOX_DEAD_LETTER_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const FANOUT_BACKOFF_SECONDS = [5, 15, 30, 60, 120] as const;

interface FanoutFailureState {
  status: "ready" | "dead_letter";
  availableAt: Date;
  attemptCount: number;
  lastError: string;
  bodyExpiresAt?: Date;
}

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
  failEvent(
    id: string,
    leaseToken: string,
    state: FanoutFailureState
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
  now(): Date;
  decryptOutboxPayload(
    event: DomainEvent,
    keyring: MessagingKeyring
  ): Record<string, unknown>;
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

export const buildFanoutClaimState = (
  currentAttemptCount: number,
  leaseToken: string,
  now: Date
) => ({
  status: "processing" as const,
  attemptCount: Math.max(0, Number(currentAttemptCount) || 0) + 1,
  leaseToken,
  leaseExpiresAt: new Date(now.getTime() + 120_000)
});

const defaultDependencies: WebhookFanoutDependencies = {
  transaction: callback => sequelize.transaction(callback),
  claimEvent: eventTypes =>
    sequelize.transaction(async transaction => {
      const leaseToken = randomUUID();
      const now = new Date();
      const event = await MessagingOutboxEvent.findOne({
        where: {
          eventType: { [Op.in]: eventTypes },
          status: "ready",
          availableAt: { [Op.lte]: now }
        },
        order: [["createdAt", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
      });
      if (!event) return null;
      await event.update(
        buildFanoutClaimState(event.attemptCount, leaseToken, now),
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
      {
        status: "completed",
        leaseExpiresAt: null,
        leaseToken: null,
        bodyCiphertext: null,
        bodyKeyVersion: null,
        bodyExpiresAt: null,
        bodyPurgedAt: new Date()
      },
      { where: { id, status: "processing", leaseToken }, transaction }
    ),
  failEvent: (id, leaseToken, state) =>
    MessagingOutboxEvent.update(
      {
        ...state,
        leaseExpiresAt: null,
        leaseToken: null
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
    process.env.MESSAGING_WEBHOOK_MIRROR_V1_ENABLED === "true",
  now: () => new Date(),
  decryptOutboxPayload: (event, keyring) => {
    if (!event.bodyCiphertext || !event.bodyKeyVersion || !event.bodySha256) {
      return event.payload;
    }
    return decryptWhatsAppOutboxBody(
      {
        bodyCiphertext: event.bodyCiphertext,
        bodyKeyVersion: event.bodyKeyVersion,
        bodySha256: event.bodySha256
      },
      event.companyId,
      event.id,
      keyring
    );
  }
};

export const buildFanoutFailureState = (
  attemptCount: number,
  failureCode: string,
  now: Date
): FanoutFailureState => {
  const durableAttemptCount = Math.max(1, Number(attemptCount) || 1);
  if (durableAttemptCount >= FANOUT_MAX_ATTEMPTS) {
    return {
      status: "dead_letter",
      availableAt: now,
      attemptCount: durableAttemptCount,
      lastError: failureCode,
      bodyExpiresAt: new Date(now.getTime() + OUTBOX_DEAD_LETTER_RETENTION_MS)
    };
  }
  const delaySeconds =
    FANOUT_BACKOFF_SECONDS[
      Math.min(durableAttemptCount - 1, FANOUT_BACKOFF_SECONDS.length - 1)
    ];
  return {
    status: "ready",
    availableAt: new Date(now.getTime() + delaySeconds * 1000),
    attemptCount: durableAttemptCount,
    lastError: failureCode
  };
};

const matches = (subscription: any, event: DomainEvent): boolean => {
  if (!subscription.events?.includes(event.eventType)) return false;
  const exclusions = new Set(subscription.excludeFilters || []);
  if (exclusions.has("fromMe") && event.payload.fromMe === true) return false;
  if (exclusions.has("group") && event.payload.isGroup === true) return false;
  if (exclusions.has("apiOriginated") && event.payload.origin === "api")
    return false;
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
    let failureCode = "WHATSAPP_MIRROR_FANOUT_FAILED";
    try {
      failureCode = "WHATSAPP_MIRROR_CRYPTO_FAILED";
      const hydratedEvent: DomainEvent = {
        ...event,
        payload: event.bodyCiphertext
          ? this.dependencies.decryptOutboxPayload(
              event,
              this.dependencies.getKeyring()
            )
          : event.payload
      };
      const subscriptions = (
        await this.dependencies.findSubscriptions(hydratedEvent.companyId)
      ).filter(item => matches(item, hydratedEvent));
      const prepared: Array<Record<string, unknown>> = [];
      if (subscriptions.length) {
        failureCode = "WHATSAPP_MIRROR_PROJECTION_FAILED";
        const snapshot = mirrorEnabled
          ? await this.dependencies.buildSnapshot(hydratedEvent)
          : await this.dependencies.buildLegacySnapshot(hydratedEvent);
        failureCode = "WHATSAPP_MIRROR_CRYPTO_FAILED";
        const keyring = this.dependencies.getKeyring();
        for (const subscription of subscriptions) {
          const id = this.dependencies.newId();
          const encrypted = this.dependencies.encryptBody(
            Buffer.from(snapshot.rawBody, "utf8"),
            {
              companyId: hydratedEvent.companyId,
              subscriptionId: subscription.id,
              deliveryId: id,
              eventId: event.id
            },
            keyring
          );
          if (encrypted.bodySha256 !== snapshot.bodySha256) {
            failureCode = "WHATSAPP_MIRROR_DIGEST_MISMATCH";
            throw new Error("Digest do snapshot de webhook divergente");
          }
          prepared.push({
            id,
            subscriptionId: subscription.id,
            companyId: hydratedEvent.companyId,
            eventId: event.id,
            eventType: event.eventType,
            urlSnapshot: subscription.url,
            methodSnapshot: subscription.method || "POST",
            secretCiphertextSnapshot: subscription.secretCiphertext,
            keyVersion: subscription.keyVersion,
            ...encrypted,
            bodyExpiresAt: null,
            bodyPurgedAt: null,
            payload: correlationOnlyPayload(hydratedEvent),
            status: "ready",
            attemptCount: 0,
            availableAt: new Date(),
            leaseToken: null
          });
        }
      }
      failureCode = "WHATSAPP_MIRROR_FANOUT_FAILED";
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
    } catch (error) {
      if (failureCode === "WHATSAPP_MIRROR_PROJECTION_FAILED") {
        recordWhatsAppMirrorMetric("projectionFailure");
      } else if (
        failureCode === "WHATSAPP_MIRROR_CRYPTO_FAILED" ||
        failureCode === "WHATSAPP_MIRROR_DIGEST_MISMATCH"
      ) {
        recordWhatsAppMirrorMetric("cryptoFailure");
      }
      await this.dependencies.failEvent(
        event.id,
        event.leaseToken,
        buildFanoutFailureState(
          event.attemptCount ?? 1,
          failureCode,
          this.dependencies.now()
        )
      );
      throw error;
    }
  }
}

export default WebhookFanoutService;
