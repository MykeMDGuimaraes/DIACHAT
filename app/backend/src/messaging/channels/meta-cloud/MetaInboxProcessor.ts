import sequelize from "../../../database";
import Message from "../../../models/Message";
import Contact from "../../../models/Contact";
import Ticket from "../../../models/Ticket";
import MessageCommand from "../../persistence/models/MessageCommand";
import MessagingInboxEvent from "../../persistence/models/MessagingInboxEvent";
import MessagingOutboxEvent from "../../persistence/models/MessagingOutboxEvent";
import {
  NormalizedMetaMessage,
  NormalizedMetaStatus,
  parseMetaCallback
} from "./MetaCallbackParser";
import MetaMediaService from "./MetaMediaService";
import { Op } from "sequelize";

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
  resolveMedia?(
    companyId: number,
    whatsappId: number,
    message: NormalizedMetaMessage
  ): Promise<{ fileName: string; mimeType?: string } | undefined>;
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
    await inbox.update(
      {
        status: "processing",
        attemptCount: inbox.attemptCount + 1,
        leaseExpiresAt: new Date(Date.now() + 120_000),
        lastError: null
      },
      { transaction }
    );
    return inbox.toJSON() as ClaimedInbox;
  }),
  persistMessage: async (companyId, whatsappId, incoming) => {
    await sequelize.transaction(async transaction => {
      if (await Message.findByPk(incoming.providerMessageId, { transaction })) return;
      let contact = await Contact.findOne({
        where: { companyId, number: incoming.sender },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!contact) {
        contact = await Contact.create({
          name: incoming.senderName || incoming.sender,
          number: incoming.sender,
          isGroup: false,
          companyId,
          whatsappId
        } as any, { transaction });
      }
      let ticket = await Ticket.findOne({
        where: {
          companyId,
          whatsappId,
          contactId: contact.id,
          status: { [Op.in]: ["open", "pending"] }
        },
        order: [["id", "DESC"]],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!ticket) {
        ticket = await Ticket.create({
          companyId,
          whatsappId,
          contactId: contact.id,
          status: "pending",
          unreadMessages: 0,
          lastMessage: incoming.body || `[${incoming.kind}]`,
          isGroup: false
        } as any, { transaction });
      }
      await Message.create({
        id: incoming.providerMessageId,
        ticketId: ticket.id,
        contactId: contact.id,
        body: incoming.body,
        fromMe: false,
        read: false,
        ack: 0,
        mediaType: incoming.kind === "text" ? undefined : incoming.kind,
        mediaUrl: (incoming as any).mediaUrl
      } as any, { transaction });
      await ticket.update(
        {
          lastMessage: incoming.body || `[${incoming.kind}]`,
          unreadMessages: Number(ticket.unreadMessages || 0) + 1
        },
        { transaction }
      );
      await MessagingOutboxEvent.create({
        companyId,
        eventType: "message.received",
        aggregateId: incoming.providerMessageId,
        payload: {
          messageId: incoming.providerMessageId,
          whatsappId,
          kind: incoming.kind,
          origin: "provider"
        },
        status: "ready",
        attemptCount: 0
      } as any, { transaction });
    });
  },
  persistStatus: async (companyId, whatsappId, incoming) => {
    await sequelize.transaction(async transaction => {
      const command = await MessageCommand.findOne({
        where: {
          companyId,
          whatsappId,
          providerMessageId: incoming.providerMessageId
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!command || command.status === incoming.status) return;
      await command.update(
        {
          status: incoming.status,
          completedAt: incoming.timestamp || new Date()
        },
        { transaction }
      );
      if (command.messageId) {
        await Message.update(
          { ack: incoming.ack },
          { where: { id: command.messageId, companyId }, transaction }
        );
      }
      await MessagingOutboxEvent.create({
        companyId,
        eventType: "message.status.updated",
        aggregateId: command.id,
        payload: {
          commandId: command.id,
          providerMessageId: incoming.providerMessageId,
          status: incoming.status,
          whatsappId,
          origin: "provider"
        },
        status: "ready",
        attemptCount: 0
      } as any, { transaction });
    });
  },
  complete: id => sequelize.transaction(async transaction => {
    await MessagingInboxEvent.update(
      {
        status: "processed",
        processedAt: new Date(),
        leaseExpiresAt: null,
        lastError: null
      },
      { where: { id, status: "processing" }, transaction }
    );
    await MessagingOutboxEvent.update(
      { status: "completed", leaseExpiresAt: null },
      {
        where: {
          eventType: "meta.callback.received",
          aggregateId: id,
          status: "ready"
        },
        transaction
      }
    );
  }),
  resolveMedia: (companyId, whatsappId, message) =>
    new MetaMediaService().download(companyId, whatsappId, message),
  release: (id, reason) => MessagingInboxEvent.update(
    {
      status: "received",
      leaseExpiresAt: null,
      lastError: reason.slice(0, 2000)
    },
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
        const media = await this.dependencies.resolveMedia?.(
          inbox.companyId,
          inbox.whatsappId,
          message
        );
        if (media) {
          (message as any).mediaUrl = media.fileName;
          message.mimeType = media.mimeType;
        }
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
