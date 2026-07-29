import { randomUUID } from "crypto";
import { Op } from "sequelize";

import sequelize from "../../database";
import WebhookDelivery from "../persistence/models/WebhookDelivery";
import {
  loadMessagingKeyring,
  MessagingKeyring
} from "../security/MessagingSecretCipher";
import {
  encryptWebhookBody,
  EncryptedWebhookBody,
  WebhookBodyBinding
} from "./WebhookBodyCipher";
import { WEBHOOK_DEAD_LETTER_RETENTION_MS } from "./WebhookDeliveryDispatcher";
import WhatsAppMirrorProjectionService, {
  WhatsAppMirrorSourceEvent
} from "./WhatsAppMirrorProjectionService";
import { WhatsAppMirrorSerializedSnapshot } from "./WhatsAppMirrorPayloadBuilder";

interface LegacyDelivery {
  id: string;
  companyId: number;
  subscriptionId: string;
  eventId: string;
  eventType: string;
  status: string;
  payload: Record<string, any>;
  createdAt: Date;
  leaseToken: string;
}

interface WebhookDeliveryBackfillDependencies {
  claimLegacy(): Promise<LegacyDelivery | null>;
  buildLegacySnapshot(
    event: WhatsAppMirrorSourceEvent,
    persistedEnvelope: Record<string, any>
  ): Promise<Pick<WhatsAppMirrorSerializedSnapshot, "rawBody" | "bodySha256">>;
  encryptBody(
    rawBody: Buffer,
    binding: WebhookBodyBinding,
    keyring: MessagingKeyring
  ): EncryptedWebhookBody;
  getKeyring(): MessagingKeyring;
  persistEncrypted(
    id: string,
    leaseToken: string,
    values: Record<string, unknown>
  ): Promise<unknown>;
  scrubDelivered(
    id: string,
    leaseToken: string,
    payload: Record<string, unknown>,
    now: Date
  ): Promise<unknown>;
  releaseClaim(id: string, leaseToken: string): Promise<unknown>;
  countActivePlaintext(): Promise<number>;
  now(): Date;
}

const claimableLease = (now: Date) => ({
  [Op.or]: [
    { leaseToken: null },
    { leaseExpiresAt: null },
    { leaseExpiresAt: { [Op.lte]: now } }
  ]
});

const defaults: WebhookDeliveryBackfillDependencies = {
  claimLegacy: () =>
    sequelize.transaction(async transaction => {
      const now = new Date();
      const baseWhere = {
        bodyCiphertext: null,
        bodyPurgedAt: null,
        ...claimableLease(now)
      };
      const options = {
        order: [["createdAt", "ASC"]] as any,
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
      };
      const delivery =
        (await WebhookDelivery.findOne({
          where: {
            ...baseWhere,
            status: { [Op.in]: ["ready", "processing"] }
          },
          ...options
        })) ||
        (await WebhookDelivery.findOne({
          where: {
            ...baseWhere,
            status: { [Op.in]: ["dead_letter", "delivered"] }
          },
          ...options
        }));
      if (!delivery) return null;
      const leaseToken = randomUUID();
      await delivery.update(
        {
          leaseToken,
          leaseExpiresAt: new Date(now.getTime() + 120000)
        },
        { transaction }
      );
      return delivery.toJSON() as LegacyDelivery;
    }),
  buildLegacySnapshot: (event, persistedEnvelope) =>
    new WhatsAppMirrorProjectionService().buildLegacySnapshot(
      event,
      persistedEnvelope
    ),
  encryptBody: encryptWebhookBody,
  getKeyring: loadMessagingKeyring,
  persistEncrypted: (id, leaseToken, values) =>
    WebhookDelivery.update(
      {
        ...values,
        bodyPurgedAt: null,
        leaseToken: null,
        leaseExpiresAt: null
      },
      { where: { id, leaseToken, bodyCiphertext: null } }
    ),
  scrubDelivered: (id, leaseToken, payload, now) =>
    WebhookDelivery.update(
      {
        payload,
        bodyCiphertext: null,
        bodyKeyVersion: null,
        bodyExpiresAt: null,
        bodyPurgedAt: now,
        leaseToken: null,
        leaseExpiresAt: null
      },
      { where: { id, leaseToken, status: "delivered" } }
    ),
  releaseClaim: (id, leaseToken) =>
    WebhookDelivery.update(
      { leaseToken: null, leaseExpiresAt: null },
      { where: { id, leaseToken } }
    ),
  countActivePlaintext: () =>
    WebhookDelivery.count({
      where: {
        status: { [Op.in]: ["ready", "processing"] },
        bodyCiphertext: null,
        bodyPurgedAt: null
      }
    }),
  now: () => new Date()
};

const sourcePayload = (delivery: LegacyDelivery): Record<string, any> => {
  const payload = delivery.payload || {};
  return payload.data && typeof payload.data === "object"
    ? payload.data
    : payload;
};

const correlationOnlyPayload = (
  delivery: LegacyDelivery
): Record<string, string | number | null> => {
  const payload = sourcePayload(delivery);
  return {
    messageId:
      payload.messageId === null || payload.messageId === undefined
        ? null
        : String(payload.messageId),
    whatsappId:
      payload.whatsappId === null || payload.whatsappId === undefined
        ? null
        : Number(payload.whatsappId),
    conversationId: payload.conversationId ?? null,
    contactId:
      payload.contactId === null || payload.contactId === undefined
        ? null
        : String(payload.contactId),
    externalTicketId: payload.externalTicketId ?? null,
    automationEpoch:
      payload.automationEpoch === null || payload.automationEpoch === undefined
        ? null
        : Number(payload.automationEpoch)
  };
};

const wasFenced = (result: unknown): boolean =>
  !(
    result === 0 ||
    result === false ||
    (Array.isArray(result) && result[0] === 0)
  );

class WebhookDeliveryBackfillService {
  private readonly dependencies: WebhookDeliveryBackfillDependencies;

  constructor(
    dependencies: Partial<WebhookDeliveryBackfillDependencies> = {}
  ) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async processOne(): Promise<{
    status: "idle" | "encrypted" | "scrubbed";
  }> {
    const delivery = await this.dependencies.claimLegacy();
    if (!delivery) return { status: "idle" };
    const payload = correlationOnlyPayload(delivery);
    try {
      if (delivery.status === "delivered") {
        const scrubbed = await this.dependencies.scrubDelivered(
          delivery.id,
          delivery.leaseToken,
          payload,
          this.dependencies.now()
        );
        if (!wasFenced(scrubbed)) throw new Error("Backfill lease lost");
        return { status: "scrubbed" };
      }
      const legacyPayload = delivery.payload || {};
      const occurredAt =
        legacyPayload.createdAt || delivery.createdAt || this.dependencies.now();
      const snapshot = await this.dependencies.buildLegacySnapshot(
        {
          id: delivery.eventId,
          companyId: delivery.companyId,
          eventType: delivery.eventType,
          aggregateId: String(payload.messageId || delivery.eventId),
          payload: sourcePayload(delivery),
          createdAt: new Date(occurredAt),
          leaseToken: delivery.leaseToken
        },
        legacyPayload
      );
      const encrypted = this.dependencies.encryptBody(
        Buffer.from(snapshot.rawBody, "utf8"),
        {
          companyId: delivery.companyId,
          subscriptionId: delivery.subscriptionId,
          deliveryId: delivery.id,
          eventId: delivery.eventId
        },
        this.dependencies.getKeyring()
      );
      if (encrypted.bodySha256 !== snapshot.bodySha256) {
        throw new Error("Backfill snapshot digest mismatch");
      }
      const bodyExpiresAt =
        delivery.status === "dead_letter"
          ? new Date(
              this.dependencies.now().getTime() +
                WEBHOOK_DEAD_LETTER_RETENTION_MS
            )
          : null;
      const persisted = await this.dependencies.persistEncrypted(
        delivery.id,
        delivery.leaseToken,
        {
          ...encrypted,
          bodyExpiresAt,
          payload
        }
      );
      if (!wasFenced(persisted)) throw new Error("Backfill lease lost");
      return { status: "encrypted" };
    } catch (error) {
      await this.dependencies.releaseClaim(delivery.id, delivery.leaseToken);
      throw error;
    }
  }

  async runBatch(
    limit = 100
  ): Promise<{ processed: number; safeToDispatch: boolean }> {
    let processed = 0;
    while (processed < limit) {
      const result = await this.processOne();
      if (result.status === "idle") break;
      processed += 1;
    }
    return {
      processed,
      safeToDispatch: (await this.dependencies.countActivePlaintext()) === 0
    };
  }
}

export default WebhookDeliveryBackfillService;
