import sequelize from "../../database";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import WhatsAppChatState from "../persistence/models/WhatsAppChatState";
import {
  WhatsAppChatStateUpdate,
  WhatsAppProviderEvent
} from "../domain/WhatsAppProviderEvent";

interface PublisherDependencies {
  mirrorEnabled(): boolean;
  transaction<T>(callback: (transaction: any) => Promise<T>): Promise<T>;
  findOrCreateEvent(
    event: WhatsAppProviderEvent,
    transaction: any
  ): Promise<[unknown, boolean]>;
  upsertChatState(
    state: WhatsAppChatStateUpdate,
    transaction: any
  ): Promise<void>;
}

const chatStateValues = (state: WhatsAppChatStateUpdate) => ({
  lid: state.lid,
  isGroup: state.isGroup,
  archived: state.archived,
  pinned: state.pinned,
  mutedUntil: state.mutedUntil,
  unreadCount: state.unreadCount,
  lastMessageId: state.lastMessageId,
  lastMessageAt: state.lastMessageAt,
  lastMessagePreview: state.lastMessagePreview,
  revision: state.revision
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
        companyId: event.companyId,
        eventType: event.eventType,
        aggregateId: event.aggregateId,
        payload: event.payload,
        status: "ready",
        attemptCount: 0,
        availableAt: event.occurredAt
      } as any,
      transaction
    }),
  upsertChatState: async (state, transaction) => {
    const [persisted, created] = await WhatsAppChatState.findOrCreate({
      where: {
        companyId: state.companyId,
        whatsappId: state.whatsappId,
        jid: state.jid
      },
      defaults: {
        ...state,
        ...chatStateValues(state)
      } as any,
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (
      !created &&
      BigInt(String(persisted.revision || 0)) < BigInt(state.revision)
    ) {
      await persisted.update(chatStateValues(state), { transaction });
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
      const [, created] = await this.dependencies.findOrCreateEvent(
        event,
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
