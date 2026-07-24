import { Op } from "sequelize";
import sequelize from "../../database";
import { DispatchableMessageCommand, MessagingProvider } from "../contracts/MessagingProvider";
import MessageCommand from "../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";

interface ClaimedDispatch {
  eventId: string;
  command: DispatchableMessageCommand;
}

interface MessageCommandDispatcherDependencies {
  claimNext: (now: Date) => Promise<ClaimedDispatch | null>;
  send: (command: DispatchableMessageCommand) => Promise<{ providerMessageId?: string }>;
  markSent: (
    commandId: string,
    eventId: string,
    providerMessageId?: string
  ) => Promise<unknown>;
  markUnknown: (
    commandId: string,
    eventId: string,
    reason: string
  ) => Promise<unknown>;
}

export const buildMessageSentEvent = (
  command: any,
  providerMessageId?: string
): Record<string, unknown> => ({
  companyId: command.companyId,
  eventType: "message.sent",
  aggregateId: command.messageId || command.id,
  payload: {
    commandId: command.id,
    messageId: command.messageId,
    whatsappId: command.whatsappId,
    providerMessageId,
    kind: command.messageKind,
    origin: "api"
  },
  status: "ready",
  attemptCount: 0
});

const createDefaultDependencies = (
  providers: MessagingProvider[]
): MessageCommandDispatcherDependencies => ({
  claimNext: now =>
    sequelize.transaction(async transaction => {
      const event = await MessagingOutboxEvent.findOne({
        where: {
          eventType: "message.dispatch.requested",
          status: "ready",
          availableAt: { [Op.lte]: now }
        },
        order: [["createdAt", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
      });

      if (!event) {
        return null;
      }

      const command = await MessageCommand.findOne({
        where: { id: event.aggregateId, status: "queued" },
        transaction,
        lock: transaction.LOCK.UPDATE
      });

      if (!command) {
        await event.update({ status: "completed", leaseExpiresAt: null }, { transaction });
        return null;
      }

      const leaseExpiresAt = new Date(now.getTime() + 120_000);
      await command.update(
        {
          status: "sending",
          attemptCount: command.attemptCount + 1,
          leaseExpiresAt
        },
        { transaction }
      );
      await event.update(
        {
          status: "processing",
          leaseExpiresAt
        },
        { transaction }
      );

      return {
        eventId: event.id,
        command: command.toJSON() as DispatchableMessageCommand
      };
    }),
  send: async command => {
    const provider = providers.find(item => item.provider === command.provider);
    if (!provider) {
      throw new Error(`Provider de mensageria nÃ£o suportado: ${command.provider}`);
    }
    return provider.send(command);
  },
  markSent: (commandId, eventId, providerMessageId) =>
    sequelize.transaction(async transaction => {
      const completedAt = new Date();
      const command = await MessageCommand.findByPk(commandId, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      await MessageCommand.update(
        {
          status: "sent",
          providerMessageId: providerMessageId || null,
          leaseExpiresAt: null,
          completedAt
        },
        { where: { id: commandId, status: "sending" }, transaction }
      );
      await MessagingOutboxEvent.update(
        { status: "completed", leaseExpiresAt: null },
        { where: { id: eventId, status: "processing" }, transaction }
      );
      if (command) {
        await MessagingOutboxEvent.create(
          buildMessageSentEvent(command, providerMessageId) as any,
          { transaction }
        );
      }
    }),
  markUnknown: (commandId, eventId, reason) =>
    sequelize.transaction(async transaction => {
      const completedAt = new Date();
      await MessageCommand.update(
        {
          status: "unknown",
          errorCode: "SEND_OUTCOME_UNKNOWN",
          errorDetails: { reason },
          leaseExpiresAt: null,
          completedAt
        },
        { where: { id: commandId, status: "sending" }, transaction }
      );
      await MessagingOutboxEvent.update(
        { status: "completed", leaseExpiresAt: null, lastError: reason },
        { where: { id: eventId, status: "processing" }, transaction }
      );
    })
});

class MessageCommandDispatcher {
  private readonly dependencies: MessageCommandDispatcherDependencies;

  constructor(
    dependencies?: MessageCommandDispatcherDependencies,
    providers: MessagingProvider[] = []
  ) {
    this.dependencies = dependencies || createDefaultDependencies(providers);
  }

  async dispatchOne(now = new Date()): Promise<{ status: "idle" | "sent" | "unknown" }> {
    const claimed = await this.dependencies.claimNext(now);
    if (!claimed) {
      return { status: "idle" };
    }

    try {
      const delivery = await this.dependencies.send(claimed.command);
      await this.dependencies.markSent(
        claimed.command.id,
        claimed.eventId,
        delivery.providerMessageId
      );
      return { status: "sent" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "unknown provider error";
      await this.dependencies.markUnknown(claimed.command.id, claimed.eventId, reason);
      return { status: "unknown" };
    }
  }
}

export default MessageCommandDispatcher;
