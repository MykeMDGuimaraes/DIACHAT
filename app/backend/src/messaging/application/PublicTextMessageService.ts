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
import ConversationAutomationService from "./ConversationAutomationService";
import CapabilityResolver from "./CapabilityResolver";
import brazilianNinthDigitVariants from "../../helpers/brazilianNinthDigitVariants";

export interface CreatePublicTextMessageInput {
  companyId: number;
  whatsappId: number;
  idempotencyScope: string;
  idempotencyKey: string;
  recipient: string;
  text?: string;
  kind?: "text" | "buttons" | "image" | "audio" | "video" | "document" | "template";
  payload?: Record<string, any>;
  externalTicketId?: string;
  automationEpoch?: number;
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
  reserveAutomatedMessage?: (input: {
    companyId: number;
    conversationId: string;
    externalTicketId: string;
    automationEpoch: number;
    transaction: any;
  }) => Promise<unknown>;
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
  // O recipient pode vir com ou sem o nono dígito brasileiro; a forma
  // armazenada no contato depende de como ele chegou (senderPn do WhatsApp
  // pode omitir o 9). Buscar ambas as formas evita contato duplicado.
  findContact: (number, companyId, transaction) =>
    Contact.findOne({
      where: { number: brazilianNinthDigitVariants(number), companyId },
      transaction
    }),
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
      transaction,
      lock: transaction.LOCK.UPDATE
    }),
  createTicket: (data, transaction) => Ticket.create(data as any, { transaction }),
  updateTicket: (ticket, data, transaction) => ticket.update(data, { transaction }),
  createMessage: (data, transaction) => Message.create(data as any, { transaction }),
  createCommand: (data, transaction) => MessageCommand.create(data as any, { transaction }),
  createOutboxEvent: (data, transaction) =>
    MessagingOutboxEvent.create(data as any, { transaction }),
  reserveAutomatedMessage: input =>
    new ConversationAutomationService().reserveAutomatedMessage(input)
};

class PublicTextMessageService {
  // Parameter property keeps the transactional repository replaceable in tests.
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly dependencies = defaultDependencies,
    private readonly capabilities = new CapabilityResolver()
  ) {}

  // eslint-disable-next-line class-methods-use-this
  createCommandId(): string {
    return uuidv4();
  }

  // eslint-disable-next-line class-methods-use-this
  fingerprint(
    input: CreatePublicTextMessageInput,
    recipient: string
  ): string {
    const kind = input.kind || "text";
    const payload =
      kind === "text"
        ? { text: input.text }
        : {
            ...(input.payload || {}),
            ...(kind === "buttons" ? { text: input.text } : {})
          };
    return createRequestFingerprint({
      provider: "dia_chat",
      messageKind: kind,
      recipient,
      requestPayload: {
        ...payload,
        externalTicketId: input.externalTicketId,
        automationEpoch: input.automationEpoch
      }
    });
  }

  async create(input: CreatePublicTextMessageInput): Promise<{
    command: any;
    message: any;
    replayed: boolean;
  }> {
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const recipient = input.recipient.replace(/\D/g, "");
    const kind = input.kind || "text";
    const payload: Record<string, any> =
      kind === "text"
        ? { text: input.text }
        : {
            ...(input.payload || {}),
            ...(kind === "buttons" ? { text: input.text } : {})
          };
    const supportedKinds = ["text", "buttons", "image", "audio", "video", "document", "template"];
    const validText = !["text", "buttons"].includes(kind) ||
      (typeof input.text === "string" && input.text.trim().length > 0);
    const validMedia = !["image", "audio", "video", "document"].includes(kind) ||
      ((typeof payload.link === "string" && /^https:\/\//i.test(payload.link)) ||
        (typeof payload.localPath === "string" && /^messaging\/[A-Za-z0-9._-]+$/.test(payload.localPath)));
    const validTemplate = kind !== "template" ||
      (typeof payload.name === "string" && typeof payload.language === "string");
    const buttons = Array.isArray(payload.buttons) ? payload.buttons : [];
    const validButtons =
      kind !== "buttons" ||
      (buttons.length >= 1 &&
        buttons.length <= 3 &&
        buttons.every(
          button =>
            button &&
            typeof button.id === "string" &&
            Buffer.byteLength(button.id, "utf8") >= 1 &&
            Buffer.byteLength(button.id, "utf8") <= 256 &&
            typeof button.title === "string" &&
            button.title.length >= 1 &&
            button.title.length <= 20
        ));
    const validRouterContext =
      input.externalTicketId === undefined ||
      (typeof input.externalTicketId === "string" &&
        input.externalTicketId.trim().length > 0 &&
        Number.isInteger(input.automationEpoch) &&
        (input.automationEpoch as number) >= 0);
    if (
      recipient.length < 10 ||
      recipient.length > 15 ||
      !supportedKinds.includes(kind) ||
      !validText ||
      !validMedia ||
      !validTemplate ||
      !validButtons ||
      !validRouterContext
    ) {
      throw new AppError("Mensagem ou destinatario invalidos", 400);
    }
    const preview = ["text", "buttons"].includes(kind)
      ? String(input.text)
      : String(payload.caption || `[${kind}]`);

    const normalizedInput = { ...input, idempotencyKey };
    const requestFingerprint = this.fingerprint(normalizedInput, recipient);

    try {
      return await this.dependencies.transaction(async transaction => {
      const existing = await this.dependencies.findCommand(normalizedInput, transaction);
      if (existing) {
        if (existing.requestFingerprint !== requestFingerprint) {
          throw new AppError("IDEMPOTENCY_CONFLICT", 409);
        }
        if (!existing.responseSnapshot) {
          throw new AppError("REQUEST_IN_PROGRESS", 409);
        }
        return { command: existing, message: null, replayed: true };
      }

      const whatsapp = await this.dependencies.findWhatsapp(
        normalizedInput.whatsappId,
        normalizedInput.companyId,
        transaction
      );
      if (!whatsapp) {
        throw new AppError("Canal de WhatsApp nao encontrado", 404);
      }
      const { provider } = this.capabilities.resolve(whatsapp.channelType);
      const capability = kind === "buttons" ? "buttons" :
        ["image", "audio", "video", "document"].includes(kind) ? "media" :
        kind === "template" ? "officialTemplate" : "text";
      this.capabilities.require(whatsapp.channelType, capability);
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
      let conversationCreated = false;
      if (!ticket) {
        ticket = await this.dependencies.createTicket(
          {
            contactId: contact.id,
            companyId: normalizedInput.companyId,
            whatsappId: normalizedInput.whatsappId,
            status: "pending",
            unreadMessages: 0,
            lastMessage: preview,
            isGroup: false
          },
          transaction
        );
        conversationCreated = true;
      } else {
        await this.dependencies.updateTicket(
          ticket,
          { lastMessage: preview },
          transaction
        );
      }

      if (
        normalizedInput.externalTicketId !== undefined &&
        normalizedInput.automationEpoch !== undefined
      ) {
        await (
          this.dependencies.reserveAutomatedMessage ||
          defaultDependencies.reserveAutomatedMessage!
        )({
          companyId: normalizedInput.companyId,
          conversationId: ticket.uuid,
          externalTicketId: normalizedInput.externalTicketId,
          automationEpoch: normalizedInput.automationEpoch,
          transaction
        });
      }

      const commandId = this.createCommandId();
      const message = await this.dependencies.createMessage(
        {
          id: commandId,
          remoteJid: `${recipient}@s.whatsapp.net`,
          dataJson: JSON.stringify({ kind, ...payload, origin: "api" }),
          ack: 0,
          read: false,
          fromMe: true,
          body: preview,
          mediaType: kind === "text" || kind === "template" ? undefined : kind,
          mediaUrl: payload.localPath || payload.link,
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
          messageKind: kind,
          recipient,
          idempotencyScope: normalizedInput.idempotencyScope,
          idempotencyKey,
          requestFingerprint,
          status: "queued",
          attemptCount: 0,
          messageId: message.id,
          externalTicketId: normalizedInput.externalTicketId,
          automationEpoch: normalizedInput.automationEpoch,
          conversationId: ticket.uuid,
          contactId: String(contact.id),
          requestPayload: { ticketId: ticket.id, ...payload },
          responseSnapshot: {
            id: commandId,
            status: "accepted",
            messageId: message.id,
            conversationId: ticket.uuid,
            contactId: String(contact.id)
          }
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
      if (conversationCreated) {
        await this.dependencies.createOutboxEvent(
          {
            companyId: normalizedInput.companyId,
            eventType: "conversation.created",
            aggregateId: ticket.uuid,
            payload: {
              conversationId: ticket.uuid,
              contactId: String(contact.id),
              whatsappId: normalizedInput.whatsappId,
              externalTicketId: normalizedInput.externalTicketId || null,
              automationEpoch: normalizedInput.automationEpoch ?? null,
              actorType: "system",
              origin: "api"
            },
            status: "ready",
            attemptCount: 0
          },
          transaction
        );
      }

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
      if (!winningCommand.responseSnapshot) {
        throw new AppError("REQUEST_IN_PROGRESS", 409);
      }
      return { command: winningCommand, message: null, replayed: true };
    }
  }
}

export default PublicTextMessageService;
