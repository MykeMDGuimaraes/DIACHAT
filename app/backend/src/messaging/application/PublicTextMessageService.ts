import { Op } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../database";
import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { createRequestFingerprint, validateIdempotencyKey } from "../domain/IdempotencyKey";
import MessageCommand from "../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";

export interface CreatePublicTextMessageInput {
  companyId: number;
  whatsappId: number;
  idempotencyScope: string;
  idempotencyKey: string;
  recipient: string;
  text: string;
}

interface PublicTextMessageDependencies {
  transaction: <T>(callback: (transaction: any) => Promise<T>) => Promise<T>;
  findCommand: (input: CreatePublicTextMessageInput, transaction: any) => Promise<any>;
  findWhatsapp: (id: number, companyId: number, transaction: any) => Promise<any>;
  findContact: (number: string, companyId: number, transaction: any) => Promise<any>;
  createContact: (data: Record<string, unknown>, transaction: any) => Promise<any>;
  findTicket: (
    contactId: number,
    whatsappId: number,
    companyId: number,
    transaction: any
  ) => Promise<any>;
  createTicket: (data: Record<string, unknown>, transaction: any) => Promise<any>;
  updateTicket: (ticket: any, data: Record<string, unknown>, transaction: any) => Promise<any>;
  createMessage: (data: Record<string, unknown>, transaction: any) => Promise<any>;
  createCommand: (data: Record<string, unknown>, transaction: any) => Promise<any>;
  createOutboxEvent: (data: Record<string, unknown>, transaction: any) => Promise<any>;
}

const defaultDependencies: PublicTextMessageDependencies = {
  transaction: callback => sequelize.transaction(callback),
  findCommand: (input, transaction) =>
    MessageCommand.findOne({
      where: {
        companyId: input.companyId,
        idempotencyScope: input.idempotencyScope,
        idempotencyKey: input.idempotencyKey
      },
      transaction
    }),
  findWhatsapp: (id, companyId, transaction) =>
    Whatsapp.findOne({ where: { id, companyId }, transaction }),
  findContact: (number, companyId, transaction) =>
    Contact.findOne({ where: { number, companyId }, transaction }),
  createContact: (data, transaction) => Contact.create(data as any, { transaction }),
  findTicket: (contactId, whatsappId, companyId, transaction) =>
    Ticket.findOne({
      where: {
        contactId,
        whatsappId,
        companyId,
        status: { [Op.in]: ["open", "pending"] }
      },
      order: [["id", "DESC"]],
      transaction
    }),
  createTicket: (data, transaction) => Ticket.create(data as any, { transaction }),
  updateTicket: (ticket, data, transaction) => ticket.update(data, { transaction }),
  createMessage: (data, transaction) => Message.create(data as any, { transaction }),
  createCommand: (data, transaction) => MessageCommand.create(data as any, { transaction }),
  createOutboxEvent: (data, transaction) =>
    MessagingOutboxEvent.create(data as any, { transaction })
};

class PublicTextMessageService {
  constructor(private readonly dependencies = defaultDependencies) {}

  createCommandId(): string {
    return uuidv4();
  }

  fingerprint(
    input: CreatePublicTextMessageInput,
    recipient: string,
    provider = "baileys"
  ): string {
    return createRequestFingerprint({
      provider,
      messageKind: "text",
      recipient,
      requestPayload: { text: input.text }
    });
  }

  async create(input: CreatePublicTextMessageInput): Promise<{
    command: any;
    message: any;
    replayed: boolean;
  }> {
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const recipient = input.recipient.replace(/\D/g, "");
    if (recipient.length < 10 || recipient.length > 15 || !input.text.trim()) {
      throw new AppError("Mensagem ou destinatario invalidos", 400);
    }

    const normalizedInput = { ...input, idempotencyKey };
    let requestFingerprint = "";

    try {
      return await this.dependencies.transaction(async transaction => {
      const whatsapp = await this.dependencies.findWhatsapp(
        normalizedInput.whatsappId,
        normalizedInput.companyId,
        transaction
      );
      if (!whatsapp) {
        throw new AppError("Canal de WhatsApp nao encontrado", 404);
      }
      const provider = whatsapp.channelType === "meta_cloud" ? "meta_cloud" : "baileys";
      requestFingerprint = this.fingerprint(normalizedInput, recipient, provider);

      const existing = await this.dependencies.findCommand(normalizedInput, transaction);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new AppError("IDEMPOTENCY_CONFLICT", 409);
        }
        return { command: existing, message: null, replayed: true };
      }

      let contact = await this.dependencies.findContact(
        recipient,
        normalizedInput.companyId,
        transaction
      );
      if (!contact) {
        contact = await this.dependencies.createContact(
          {
            name: recipient,
            number: recipient,
            companyId: normalizedInput.companyId,
            whatsappId: normalizedInput.whatsappId,
            isGroup: false
          },
          transaction
        );
      }

      let ticket = await this.dependencies.findTicket(
        contact.id,
        normalizedInput.whatsappId,
        normalizedInput.companyId,
        transaction
      );
      if (!ticket) {
        ticket = await this.dependencies.createTicket(
          {
            contactId: contact.id,
            companyId: normalizedInput.companyId,
            whatsappId: normalizedInput.whatsappId,
            status: "pending",
            unreadMessages: 0,
            lastMessage: normalizedInput.text,
            isGroup: false
          },
          transaction
        );
      } else {
        await this.dependencies.updateTicket(
          ticket,
          { lastMessage: normalizedInput.text },
          transaction
        );
      }

      const commandId = this.createCommandId();
      const message = await this.dependencies.createMessage(
        {
          id: commandId,
          remoteJid: `${recipient}@s.whatsapp.net`,
          dataJson: JSON.stringify({ text: normalizedInput.text, origin: "api" }),
          ack: 0,
          read: false,
          fromMe: true,
          body: normalizedInput.text,
          ticketId: ticket.id,
          contactId: contact.id,
          companyId: normalizedInput.companyId
        },
        transaction
      );
      const command = await this.dependencies.createCommand(
        {
          id: commandId,
          companyId: normalizedInput.companyId,
          whatsappId: normalizedInput.whatsappId,
          provider,
          messageKind: "text",
          recipient,
          idempotencyScope: normalizedInput.idempotencyScope,
          idempotencyKey,
          requestFingerprint,
          status: "queued",
          attemptCount: 0,
          messageId: message.id,
          requestPayload: { ticketId: ticket.id, text: normalizedInput.text }
        },
        transaction
      );
      await this.dependencies.createOutboxEvent(
        {
          companyId: normalizedInput.companyId,
          eventType: "message.dispatch.requested",
          aggregateId: command.id,
          payload: { commandId: command.id },
          status: "ready",
          attemptCount: 0
        },
        transaction
      );

        return { command, message, replayed: false };
      });
    } catch (error: any) {
      const isIdempotencyRace =
        error?.name === "SequelizeUniqueConstraintError" || error?.original?.code === "23505";
      if (!isIdempotencyRace) {
        throw error;
      }

      const winningCommand = await this.dependencies.findCommand(normalizedInput, null);
      if (!winningCommand) {
        throw error;
      }
      if (winningCommand.requestFingerprint !== requestFingerprint) {
        throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      }
      return { command: winningCommand, message: null, replayed: true };
    }
  }
}

export default PublicTextMessageService;
