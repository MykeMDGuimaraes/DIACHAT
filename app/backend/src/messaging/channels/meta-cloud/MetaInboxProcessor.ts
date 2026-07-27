import sequelize from "../../../database";
import Message from "../../../models/Message";
import Contact from "../../../models/Contact";
import Ticket from "../../../models/Ticket";
import Whatsapp from "../../../models/Whatsapp";
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
  attemptCount: number;
  payload: Record<string, any>;
}

interface MetaInboxProcessorDependencies {
  claimNext(): Promise<ClaimedInbox | null>;
  persistMessage(
    companyId: number,
    whatsappId: number,
    message: NormalizedMetaMessage
  ): Promise<void>;
  persistStatus(
    companyId: number,
    whatsappId: number,
    status: NormalizedMetaStatus
  ): Promise<void>;
  resolveMedia?(
    companyId: number,
    whatsappId: number,
    message: NormalizedMetaMessage
  ): Promise<{ fileName: string; mimeType?: string } | undefined>;
  complete(id: string): Promise<unknown>;
  release(
    id: string,
    reason: string,
    availableAt: Date,
    deadLetter: boolean
  ): Promise<unknown>;
}

const MAX_INBOX_ATTEMPTS = 8;
const INBOX_BACKOFF_BASE_MS = 5_000;
const INBOX_BACKOFF_MAX_MS = 15 * 60_000;

export const computeMetaInboxRetryAt = (
  attemptCount: number,
  now = new Date(),
  random = Math.random
): Date => {
  const exponential = Math.min(
    INBOX_BACKOFF_MAX_MS,
    INBOX_BACKOFF_BASE_MS * 2 ** Math.max(0, attemptCount - 1)
  );
  const jitter = 0.5 + random();
  return new Date(now.getTime() + Math.round(exponential * jitter));
};

export interface MetaMessagePersistenceDependencies {
  transaction<T>(callback: (transaction: any) => Promise<T>): Promise<T>;
  findMessage(id: string, transaction: any): Promise<any>;
  findContact(
    companyId: number,
    number: string,
    transaction: any
  ): Promise<any>;
  createContact(data: Record<string, unknown>, transaction: any): Promise<any>;
  findTicket(
    companyId: number,
    whatsappId: number,
    contactId: number,
    transaction: any
  ): Promise<any>;
  createTicket(data: Record<string, unknown>, transaction: any): Promise<any>;
  createMessage(data: Record<string, unknown>, transaction: any): Promise<any>;
  createOutbox(data: Record<string, unknown>, transaction: any): Promise<any>;
  loadMessage(id: string): Promise<any>;
  notifyMessage(message: Message, companyId: number): Promise<void> | void;
}

const metaMessagePersistenceDependencies: MetaMessagePersistenceDependencies = {
  transaction: callback => sequelize.transaction(callback),
  findMessage: (id, transaction) => Message.findByPk(id, { transaction }),
  findContact: (companyId, number, transaction) =>
    Contact.findOne({
      where: { companyId, number },
      transaction,
      lock: transaction.LOCK.UPDATE
    }),
  createContact: (data, transaction) =>
    Contact.create(data as any, { transaction }),
  findTicket: (companyId, whatsappId, contactId, transaction) =>
    Ticket.findOne({
      where: {
        companyId,
        whatsappId,
        contactId,
        status: { [Op.in]: ["open", "pending"] }
      },
      order: [["id", "DESC"]],
      transaction,
      lock: transaction.LOCK.UPDATE
    }),
  createTicket: (data, transaction) =>
    Ticket.create(data as any, { transaction }),
  createMessage: (data, transaction) =>
    Message.create(data as any, { transaction }),
  createOutbox: (data, transaction) =>
    MessagingOutboxEvent.create(data as any, { transaction }),
  loadMessage: id =>
    Message.findByPk(id, {
      include: [
        "contact",
        {
          model: Ticket,
          as: "ticket",
          include: [
            "contact",
            "queue",
            {
              model: Whatsapp,
              as: "whatsapp",
              attributes: ["name"]
            }
          ]
        },
        {
          model: Message,
          as: "quotedMsg",
          include: ["contact"]
        }
      ]
    }),
  notifyMessage: async (message, companyId) => {
    const { notifyCreatedMessage } =
      await import("../../../services/MessageServices/CreateMessageService");
    notifyCreatedMessage(message, companyId);
  }
};

export const persistMetaMessage = async (
  companyId: number,
  whatsappId: number,
  incoming: NormalizedMetaMessage,
  dependencies: MetaMessagePersistenceDependencies = metaMessagePersistenceDependencies
): Promise<void> => {
  await dependencies.transaction(async transaction => {
    const existing = await dependencies.findMessage(
      incoming.providerMessageId,
      transaction
    );
    if (existing) return;

    let contact = await dependencies.findContact(
      companyId,
      incoming.sender,
      transaction
    );
    if (!contact) {
      contact = await dependencies.createContact(
        {
          name: incoming.senderName || incoming.sender,
          number: incoming.sender,
          isGroup: false,
          companyId,
          whatsappId
        },
        transaction
      );
    }

    let ticket = await dependencies.findTicket(
      companyId,
      whatsappId,
      contact.id,
      transaction
    );
    if (!ticket) {
      ticket = await dependencies.createTicket(
        {
          companyId,
          whatsappId,
          contactId: contact.id,
          status: "pending",
          unreadMessages: 0,
          lastMessage: incoming.body || `[${incoming.kind}]`,
          isGroup: false
        },
        transaction
      );
    }

    const remoteJid = incoming.sender.includes("@")
      ? incoming.sender
      : `${incoming.sender}@s.whatsapp.net`;
    await dependencies.createMessage(
      {
        id: incoming.providerMessageId,
        companyId,
        ticketId: ticket.id,
        contactId: contact.id,
        body: incoming.body,
        fromMe: false,
        read: false,
        ack: 0,
        remoteJid,
        dataJson: JSON.stringify(incoming.raw),
        mediaType: incoming.kind === "text" ? undefined : incoming.kind,
        mediaUrl: (incoming as any).mediaUrl
      },
      transaction
    );
    await ticket.update(
      {
        lastMessage: incoming.body || `[${incoming.kind}]`,
        unreadMessages: Number(ticket.unreadMessages || 0) + 1
      },
      { transaction }
    );
    await dependencies.createOutbox(
      {
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
      },
      transaction
    );
  });

  const persisted = await dependencies.loadMessage(incoming.providerMessageId);
  if (!persisted) throw new Error("ERR_CREATING_MESSAGE");
  await dependencies.notifyMessage(persisted, companyId);
};

export const shouldApplyMetaStatusUpdate = (
  currentStatus: string,
  incomingStatus: string
): boolean => {
  if (currentStatus === incomingStatus) return false;
  if (incomingStatus === "failed") {
    return !["delivered", "read", "failed"].includes(currentStatus);
  }
  if (incomingStatus === "read") return currentStatus !== "read";
  if (incomingStatus === "delivered") {
    return !["delivered", "read"].includes(currentStatus);
  }
  if (incomingStatus === "sent") {
    return ["queued", "persisted", "sending", "unknown"].includes(
      currentStatus
    );
  }
  return false;
};

const defaultDependencies: MetaInboxProcessorDependencies = {
  claimNext: () =>
    sequelize.transaction(async transaction => {
      const inbox = await MessagingInboxEvent.findOne({
        where: {
          provider: "meta_cloud",
          status: "received",
          availableAt: { [Op.lte]: new Date() }
        },
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
  persistMessage: persistMetaMessage,
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
      if (
        !command ||
        !shouldApplyMetaStatusUpdate(command.status, incoming.status)
      ) {
        return;
      }
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
      await MessagingOutboxEvent.create(
        {
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
        } as any,
        { transaction }
      );
    });
  },
  complete: id =>
    sequelize.transaction(async transaction => {
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
  release: (id, reason, availableAt, deadLetter) =>
    sequelize.transaction(async transaction => {
      const lastError = reason.slice(0, 2000);
      await MessagingInboxEvent.update(
        {
          status: deadLetter ? "dead_letter" : "received",
          availableAt,
          leaseExpiresAt: null,
          lastError
        },
        { where: { id, status: "processing" }, transaction }
      );
      if (deadLetter) {
        await MessagingOutboxEvent.update(
          {
            status: "dead_letter",
            leaseExpiresAt: null,
            lastError
          },
          {
            where: {
              eventType: "meta.callback.received",
              aggregateId: id,
              status: "ready"
            },
            transaction
          }
        );
      }
    })
};

class MetaInboxProcessor {
  constructor(
    private readonly dependencies: MetaInboxProcessorDependencies = defaultDependencies
  ) {}

  parse(payload: Record<string, any>) {
    return parseMetaCallback(payload);
  }

  async processOne(): Promise<{
    status: "idle" | "processed" | "retry" | "dead_letter";
  }> {
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
        await this.dependencies.persistMessage(
          inbox.companyId,
          inbox.whatsappId,
          message
        );
      }
      for (const status of parsed.statuses) {
        await this.dependencies.persistStatus(
          inbox.companyId,
          inbox.whatsappId,
          status
        );
      }
      await this.dependencies.complete(inbox.id);
      return { status: "processed" };
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Erro ao processar callback Meta";
      const deadLetter = inbox.attemptCount >= MAX_INBOX_ATTEMPTS;
      await this.dependencies.release(
        inbox.id,
        reason,
        computeMetaInboxRetryAt(inbox.attemptCount),
        deadLetter
      );
      return { status: deadLetter ? "dead_letter" : "retry" };
    }
  }
}

export default MetaInboxProcessor;
