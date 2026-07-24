import sequelize from "../../../database";
import Message from "../../../models/Message";
import MessageCommand from "../../persistence/models/MessageCommand";
import MessagingInboxEvent from "../../persistence/models/MessagingInboxEvent";
import MessagingOutboxEvent from "../../persistence/models/MessagingOutboxEvent";
import {
  NormalizedMetaMessage,
  NormalizedMetaStatus,
  parseMetaCallback
} from "./MetaCallbackParser";

interface ClaimedInbox {
  id: string;
  companyId: number;
  whatsappId: number;
  payload: Record<string, any>;
}

interface MetaInboxProcessorDependencies {
  claimNext(): Promise<ClaimedInbox | null>;
  persistMessage(companyId: number, whatsappId: number, message: NormalizedMetaMessage): Promise<void>;
  persistStatus(companyId: number, whatsappId: number, status: NormalizedMetaStatus): Promise<void>;
  complete(id: string): Promise<unknown>;
  release(id: string, reason: string): Promise<unknown>;
}

const defaultDependencies: MetaInboxProcessorDependencies = {
  claimNext: () => sequelize.transaction(async transaction => {
    const inbox = await MessagingInboxEvent.findOne({
      where: { status: "received" },
      order: [["createdAt", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true
    });
    if (!inbox) return null;
    await inbox.update({ status: "processing", lastError: null }, { transaction });
    return inbox.toJSON() as ClaimedInbox;
  }),
  persistMessage: async (companyId, whatsappId, incoming) => {
    if (await Message.findByPk(incoming.providerMessageId)) return;
    const [contactModule, messageModule, ticketModule] = await Promise.all([
      import("../../../services/ContactServices/CreateOrUpdateContactService"),
      import("../../../services/MessageServices/CreateMessageService"),
      import("../../../services/TicketServices/FindOrCreateTicketService")
    ]);
    const CreateOrUpdateContactService = contactModule.default;
    const CreateMessageService = messageModule.default;
    const FindOrCreateTicketService = ticketModule.default;
    const contact = await CreateOrUpdateContactService({
      name: incoming.senderName || incoming.sender,
      number: incoming.sender,
      isGroup: false,
      companyId,
      whatsappId
    });
    const ticket = await FindOrCreateTicketService(contact, whatsappId, 1, companyId);
    await CreateMessageService({
      companyId,
      messageData: {
        id: incoming.providerMessageId,
        ticketId: ticket.id,
        contactId: contact.id,
        body: incoming.body,
        fromMe: false,
        read: false,
        ack: 0,
        mediaType: incoming.kind === "text" ? undefined : incoming.kind
      }
    });
    await ticket.update({ lastMessage: incoming.body || `[${incoming.kind}]` });
    await MessagingOutboxEvent.create({
      companyId,
      eventType: "message.received",
      aggregateId: incoming.providerMessageId,
      payload: { messageId: incoming.providerMessageId, whatsappId, origin: "provider" },
      status: "ready",
      attemptCount: 0
    } as any);
  },
  persistStatus: async (companyId, whatsappId, incoming) => {
    const command = await MessageCommand.findOne({
      where: { companyId, whatsappId, providerMessageId: incoming.providerMessageId }
    });
    if (!command) return;
    await command.update({ status: incoming.status, completedAt: incoming.timestamp || new Date() });
    if (command.messageId) {
      await Message.update({ ack: incoming.ack }, { where: { id: command.messageId, companyId } });
    }
    await MessagingOutboxEvent.create({
      companyId,
      eventType: "message.status.updated",
      aggregateId: command.id,
      payload: { commandId: command.id, providerMessageId: incoming.providerMessageId, status: incoming.status, origin: "provider" },
      status: "ready",
      attemptCount: 0
    } as any);
  },
  complete: id => MessagingInboxEvent.update(
    { status: "processed", processedAt: new Date(), lastError: null },
    { where: { id, status: "processing" } }
  ),
  release: (id, reason) => MessagingInboxEvent.update(
    { status: "received", lastError: reason.slice(0, 2000) },
    { where: { id, status: "processing" } }
  )
};

class MetaInboxProcessor {
  constructor(private readonly dependencies: MetaInboxProcessorDependencies = defaultDependencies) {}

  parse(payload: Record<string, any>) {
    return parseMetaCallback(payload);
  }

  async processOne(): Promise<{ status: "idle" | "processed" | "retry" }> {
    const inbox = await this.dependencies.claimNext();
    if (!inbox) return { status: "idle" };
    try {
      const parsed = this.parse(inbox.payload);
      for (const message of parsed.messages) {
        await this.dependencies.persistMessage(inbox.companyId, inbox.whatsappId, message);
      }
      for (const status of parsed.statuses) {
        await this.dependencies.persistStatus(inbox.companyId, inbox.whatsappId, status);
      }
      await this.dependencies.complete(inbox.id);
      return { status: "processed" };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Erro ao processar callback Meta";
      await this.dependencies.release(inbox.id, reason);
      return { status: "retry" };
    }
  }
}

export default MetaInboxProcessor;
