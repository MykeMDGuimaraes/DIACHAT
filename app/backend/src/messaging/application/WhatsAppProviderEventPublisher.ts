import { randomUUID } from "crypto";
import sequelize from "../../database";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import WhatsAppChatState from "../persistence/models/WhatsAppChatState";
import {
  WhatsAppChatStateUpdate,
  WhatsAppProviderEvent
} from "../domain/WhatsAppProviderEvent";
import {
  loadMessagingKeyring,
  MessagingKeyring
} from "../security/MessagingSecretCipher";
import { encryptWhatsAppOutboxBody } from "../webhooks/WhatsAppOutboxBodyCipher";

type PersistableProviderEvent = Omit<WhatsAppProviderEvent, "payload"> & {
  payload: Record<string, string | number | null>;
  id: string;
  bodyCiphertext: string;
  bodyKeyVersion: string;
  bodySha256: string;
  bodyExpiresAt: null;
  bodyPurgedAt: null;
};

interface PublisherDependencies {
  mirrorEnabled(): boolean;
  transaction<T>(callback: (transaction: any) => Promise<T>): Promise<T>;
  findOrCreateEvent(
    event: PersistableProviderEvent,
    transaction: any
  ): Promise<[unknown, boolean]>;
  upsertChatState(
    state: WhatsAppChatStateUpdate,
    transaction: any
  ): Promise<void>;
  newId(): string;
  getKeyring(): MessagingKeyring;
}

const mutableChatStateFields = [
  "lid",
  "isGroup",
  "archived",
  "pinned",
  "mutedUntil",
  "unreadCount",
  "lastMessageId",
  "lastMessageAt",
  "lastMessagePreview"
] as const;

export const buildWhatsAppChatStatePatch = (
  state: WhatsAppChatStateUpdate
): Record<string, unknown> => {
  const patch: Record<string, unknown> = { revision: state.revision };
  mutableChatStateFields.forEach(field => {
    if (Object.prototype.hasOwnProperty.call(state, field)) {
      patch[field] = state[field];
    }
  });
  return patch;
};

export const shouldApplyChatStateRevision = (
  persistedRevision: string | number | bigint,
  incomingRevision: string | number | bigint
): boolean =>
  BigInt(String(persistedRevision || 0)) <=
  BigInt(String(incomingRevision || 0));

export const outboxCorrelationPayload = (
  payload: Record<string, unknown>
): Record<string, string | number | null> => ({
  messageId:
    payload.messageId === null || payload.messageId === undefined
      ? null
      : String(payload.messageId),
  whatsappId:
    payload.whatsappId === null || payload.whatsappId === undefined
      ? null
      : Number(payload.whatsappId),
  conversationId:
    payload.conversationId === null || payload.conversationId === undefined
      ? null
      : String(payload.conversationId),
  contactId:
    payload.contactId === null || payload.contactId === undefined
      ? null
      : String(payload.contactId),
  externalTicketId:
    payload.externalTicketId === null || payload.externalTicketId === undefined
      ? null
      : String(payload.externalTicketId),
  automationEpoch:
    payload.automationEpoch === null || payload.automationEpoch === undefined
      ? null
      : Number(payload.automationEpoch)
});

const defaultDependencies: PublisherDependencies = {
  mirrorEnabled: () =>
    process.env.MESSAGING_WEBHOOK_MIRROR_V1_ENABLED === "true",
  transaction: callback => sequelize.transaction(callback),
  findOrCreateEvent: (event, transaction) =>
    MessagingOutboxEvent.findOrCreate({
      where: {
        companyId: event.companyId,
        eventType: event.eventType,
        aggregateId: event.aggregateId
      },
      defaults: {
        id: event.id,
        companyId: event.companyId,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        bodyCiphertext: event.bodyCiphertext,
        bodyKeyVersion: event.bodyKeyVersion,
        bodySha256: event.bodySha256,
        bodyExpiresAt: event.bodyExpiresAt,
        bodyPurgedAt: event.bodyPurgedAt,
        status: "ready",
        attemptCount: 0,
        availableAt: event.occurredAt
      } as any,
      transaction
    }),
  newId: randomUUID,
  getKeyring: loadMessagingKeyring,
  upsertChatState: async (state, transaction) => {
    const patch = buildWhatsAppChatStatePatch(state);
    const [persisted, created] = await WhatsAppChatState.findOrCreate({
      where: {
        companyId: state.companyId,
        whatsappId: state.whatsappId,
        jid: state.jid
      },
      defaults: {
        companyId: state.companyId,
        whatsappId: state.whatsappId,
        jid: state.jid,
        ...patch
      } as any,
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (
      !created &&
      shouldApplyChatStateRevision(persisted.revision || 0, state.revision)
    ) {
      await persisted.update(patch, { transaction });
    }
  }
};

class WhatsAppProviderEventPublisher {
  private readonly dependencies: PublisherDependencies;

  constructor(dependencies: Partial<PublisherDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async persist(
    events: readonly WhatsAppProviderEvent[],
    transaction: any
  ): Promise<void> {
    for (const event of events) {
      const id = this.dependencies.newId();
      const encrypted = encryptWhatsAppOutboxBody(
        event.payload as unknown as Record<string, unknown>,
        event.companyId,
        id,
        this.dependencies.getKeyring()
      );
      const persistableEvent: PersistableProviderEvent = {
        ...event,
        id,
        payload: outboxCorrelationPayload(
          event.payload as unknown as Record<string, unknown>
        ),
        ...encrypted,
        bodyExpiresAt: null,
        bodyPurgedAt: null
      };
      const [, created] = await this.dependencies.findOrCreateEvent(
        persistableEvent,
        transaction
      );
      if (created && event.chatState) {
        await this.dependencies.upsertChatState(event.chatState, transaction);
      }
    }
  }

  async publish(events: readonly WhatsAppProviderEvent[]): Promise<void> {
    if (!this.dependencies.mirrorEnabled() || events.length === 0) return;
    await this.dependencies.transaction(transaction =>
      this.persist(events, transaction)
    );
  }
}

export default WhatsAppProviderEventPublisher;
