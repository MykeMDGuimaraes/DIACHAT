import { Op } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import sequelize from "../../database";
import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import {
  createRequestFingerprint,
  validateIdempotencyKey
} from "../domain/IdempotencyKey";
import MessageCommand from "../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import CapabilityResolver from "./CapabilityResolver";
import brazilianNinthDigitVariants from "../../helpers/brazilianNinthDigitVariants";

export type OutboundMessageKind =
  | "text"
  | "image"
  | "audio"
  | "video"
  | "document";
export type OutboundMessageOrigin = "screen" | "api" | "automation";

export interface CreateOutboundMessageInput {
  companyId: number;
  // Canal explicito so e exigido na resolucao por recipient (automacoes);
  // no caminho por ticketId o canal vem do proprio ticket.
  whatsappId?: number;
  ticketId?: number;
  recipient?: string;
  idempotencyScope: string;
  idempotencyKey: string;
  kind?: OutboundMessageKind;
  text?: string;
  payload?: Record<string, any>;
  quotedMessageId?: string;
  origin: OutboundMessageOrigin;
}

interface OutboundMessageDependencies {
  transaction: <T>(callback: (transaction: any) => Promise<T>) => Promise<T>;
  findCommand: (
    input: CreateOutboundMessageInput,
    transaction: any
  ) => Promise<any>;
  findTicketById: (
    ticketId: number,
    companyId: number,
    transaction: any
  ) => Promise<any>;
  findWhatsapp: (
    id: number,
    companyId: number,
    transaction: any
  ) => Promise<any>;
  findContact: (
    number: string,
    companyId: number,
    transaction: any
  ) => Promise<any>;
  createContact: (
    data: Record<string, unknown>,
    transaction: any
  ) => Promise<any>;
  findOpenTicket: (
    contactId: number,
    whatsappId: number,
    companyId: number,
    transaction: any
  ) => Promise<any>;
  createTicket: (
    data: Record<string, unknown>,
    transaction: any
  ) => Promise<any>;
  updateTicket: (
    ticket: any,
    data: Record<string, unknown>,
    transaction: any
  ) => Promise<any>;
  findQuotedMessage: (
    messageId: string,
    ticketId: number,
    companyId: number,
    transaction: any
  ) => Promise<any>;
  createMessage: (
    data: Record<string, unknown>,
    transaction: any
  ) => Promise<any>;
  createCommand: (
    data: Record<string, unknown>,
    transaction: any
  ) => Promise<any>;
  createOutboxEvent: (
    data: Record<string, unknown>,
    transaction: any
  ) => Promise<any>;
}

const defaultDependencies: OutboundMessageDependencies = {
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
  findTicketById: (ticketId, companyId, transaction) =>
    Ticket.findOne({
      where: { id: ticketId, companyId },
      include: [Contact],
      transaction,
      lock: transaction.LOCK.UPDATE
    }),
  findWhatsapp: (id, companyId, transaction) =>
    Whatsapp.findOne({ where: { id, companyId }, transaction }),
  findContact: (number, companyId, transaction) =>
    Contact.findOne({
      where: { number: brazilianNinthDigitVariants(number), companyId },
      transaction
    }),
  createContact: (data, transaction) =>
    Contact.create(data as any, { transaction }),
  findOpenTicket: (contactId, whatsappId, companyId, transaction) =>
    Ticket.findOne({
      where: {
        contactId,
        whatsappId,
        companyId,
        status: { [Op.in]: ["open", "pending"] }
      },
      order: [["id", "DESC"]],
      include: [Contact],
      transaction,
      lock: transaction.LOCK.UPDATE
    }),
  createTicket: async (data, transaction) => {
    const ticket = await Ticket.create(data as any, { transaction });
    ticket.contact = await Contact.findByPk(ticket.contactId, { transaction });
    return ticket;
  },
  updateTicket: (ticket, data, transaction) =>
    ticket.update(data, { transaction }),
  findQuotedMessage: (messageId, ticketId, companyId, transaction) =>
    Message.findOne({
      where: { id: messageId, ticketId, companyId },
      transaction
    }),
  createMessage: (data, transaction) =>
    Message.create(data as any, { transaction }),
  createCommand: (data, transaction) =>
    MessageCommand.create(data as any, { transaction }),
  createOutboxEvent: (data, transaction) =>
    MessagingOutboxEvent.create(data as any, { transaction })
};

const SUPPORTED_KINDS: OutboundMessageKind[] = [
  "text",
  "image",
  "audio",
  "video",
  "document"
];
const MEDIA_KINDS: OutboundMessageKind[] = [
  "image",
  "audio",
  "video",
  "document"
];

/**
 * Nucleo unico de aceitacao de envios internos (Task 4 do hardening):
 * Message + MessageCommand + evento de outbox na MESMA transacao, com o
 * MessageCommand como autoridade unica de idempotencia (fingerprint do
 * dominio compartilhado). A resposta ao chamador e aceitacao duravel
 * (202/queued) — a entrega acontece no dispatcher, e o eco fromMe se
 * correlaciona porque o provider envia com messageId = commandId.
 */
class OutboundMessageService {
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
    input: CreateOutboundMessageInput & { ticketId: number },
    recipient: string,
    provider: string
  ): string {
    const kind = input.kind || "text";
    // localPath e artefato de storage gerado no staging (nome aleatorio):
    // fora do fingerprint, senao todo retry de midia diverge e vira 409
    // em vez de replay. link permanece (e conteudo informado pelo cliente).
    const fingerprintablePayload = { ...(input.payload || {}) };
    delete fingerprintablePayload.localPath;
    return createRequestFingerprint({
      provider,
      messageKind: kind,
      recipient,
      requestPayload: {
        ticketId: input.ticketId,
        ...fingerprintablePayload,
        ...(kind === "text" ? { text: input.text } : {}),
        quotedMessageId: input.quotedMessageId,
        origin: input.origin
      }
    });
  }

  /**
   * Resolucao de replay ANTES do staging de upload: se a chave ja tem
   * comando aceito, o retry responde com o snapshot original (que guarda
   * o localPath duravel correto) sem tocar no arquivo nem regravar nada.
   */
  async findReplay(
    input: CreateOutboundMessageInput
  ): Promise<{ command: any; ticket: any } | null> {
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const normalizedInput = {
      ...input,
      idempotencyKey,
      kind: input.kind || ("text" as const)
    };
    const existing = await this.dependencies.findCommand(normalizedInput, null);
    if (!existing) {
      return null;
    }
    const ticket = await this.dependencies.findTicketById(
      Number(existing.requestPayload?.ticketId) ||
        normalizedInput.ticketId ||
        0,
      normalizedInput.companyId,
      null
    );
    this.assertReplayable(existing, normalizedInput, ticket);
    return { command: existing, ticket };
  }

  async create(input: CreateOutboundMessageInput): Promise<{
    command: any;
    message: any;
    ticket: any;
    replayed: boolean;
  }> {
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    const kind = input.kind || "text";
    const payload: Record<string, any> = input.payload || {};
    const validText =
      kind !== "text" ||
      (typeof input.text === "string" && input.text.trim().length > 0);
    const validMedia =
      !MEDIA_KINDS.includes(kind) ||
      (typeof payload.link === "string" && /^https:\/\//i.test(payload.link)) ||
      (typeof payload.localPath === "string" &&
        /^messaging\/[A-Za-z0-9._-]+$/.test(payload.localPath));
    if (!SUPPORTED_KINDS.includes(kind) || !validText || !validMedia) {
      throw new AppError("Mensagem invalida", 400);
    }
    if (!input.ticketId && !(input.recipient && input.whatsappId)) {
      throw new AppError("Ticket ou destinatario obrigatorios", 400);
    }

    const normalizedInput = { ...input, idempotencyKey, kind };

    try {
      return await this.dependencies.transaction(async transaction => {
        const existing = await this.dependencies.findCommand(
          normalizedInput,
          transaction
        );
        if (existing) {
          const existingTicket = await this.dependencies.findTicketById(
            Number(existing.requestPayload?.ticketId) ||
              normalizedInput.ticketId ||
              0,
            normalizedInput.companyId,
            transaction
          );
          this.assertReplayable(existing, normalizedInput, existingTicket);
          return {
            command: existing,
            message: null,
            ticket: existingTicket,
            replayed: true
          };
        }

        let ticket: any;
        let contact: any;
        if (normalizedInput.ticketId) {
          ticket = await this.dependencies.findTicketById(
            normalizedInput.ticketId,
            normalizedInput.companyId,
            transaction
          );
          if (!ticket) {
            throw new AppError("Ticket nao encontrado", 404);
          }
          contact = ticket.contact;
        } else {
          const recipientDigits = String(normalizedInput.recipient).replace(
            /\D/g,
            ""
          );
          if (recipientDigits.length < 10 || recipientDigits.length > 15) {
            throw new AppError("Destinatario invalido", 400);
          }
          contact = await this.dependencies.findContact(
            recipientDigits,
            normalizedInput.companyId,
            transaction
          );
          if (!contact) {
            contact = await this.dependencies.createContact(
              {
                name: recipientDigits,
                number: recipientDigits,
                companyId: normalizedInput.companyId,
                whatsappId: normalizedInput.whatsappId,
                isGroup: false
              },
              transaction
            );
          }
          ticket = await this.dependencies.findOpenTicket(
            contact.id,
            normalizedInput.whatsappId as number,
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
                isGroup: false
              },
              transaction
            );
            if (!ticket.contact) ticket.contact = contact;
          }
        }
        if (!contact) {
          throw new AppError("Contato do ticket nao encontrado", 404);
        }

        const whatsappId = ticket.whatsappId || normalizedInput.whatsappId;
        const whatsapp = await this.dependencies.findWhatsapp(
          whatsappId,
          normalizedInput.companyId,
          transaction
        );
        if (!whatsapp) {
          throw new AppError("Canal de WhatsApp nao encontrado", 404);
        }
        const { provider } = this.capabilities.resolve(whatsapp.channelType);
        this.capabilities.require(
          whatsapp.channelType,
          MEDIA_KINDS.includes(kind) ? "media" : "text"
        );

        if (normalizedInput.quotedMessageId) {
          const quoted = await this.dependencies.findQuotedMessage(
            normalizedInput.quotedMessageId,
            ticket.id,
            normalizedInput.companyId,
            transaction
          );
          if (!quoted) {
            throw new AppError("Mensagem citada invalida", 400);
          }
        }

        const recipient = String(contact.number).replace(/\D/g, "");
        const preview =
          kind === "text"
            ? String(input.text)
            : String(payload.caption || `[${kind}]`);
        await this.dependencies.updateTicket(
          ticket,
          { lastMessage: preview },
          transaction
        );

        const commandInput = { ...normalizedInput, ticketId: ticket.id };
        const requestFingerprint = this.fingerprint(
          commandInput,
          recipient,
          provider
        );
        const commandId = this.createCommandId();
        const message = await this.dependencies.createMessage(
          {
            id: commandId,
            remoteJid: `${recipient}@s.whatsapp.net`,
            dataJson: JSON.stringify({
              kind,
              ...payload,
              ...(kind === "text" ? { text: input.text } : {}),
              quotedMessageId: normalizedInput.quotedMessageId,
              origin: normalizedInput.origin
            }),
            ack: 0,
            read: true,
            fromMe: true,
            body: preview,
            mediaType: kind === "text" ? undefined : kind,
            mediaUrl: payload.localPath || payload.link,
            quotedMsgId: normalizedInput.quotedMessageId,
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
            whatsappId,
            provider,
            messageKind: kind,
            recipient,
            idempotencyScope: normalizedInput.idempotencyScope,
            idempotencyKey,
            requestFingerprint,
            status: "queued",
            attemptCount: 0,
            messageId: message.id,
            conversationId: ticket.uuid,
            contactId: String(contact.id),
            requestPayload: {
              ticketId: ticket.id,
              ...(kind === "text" ? { text: input.text } : {}),
              ...payload,
              quotedMessageId: normalizedInput.quotedMessageId
            },
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

        return { command, message, ticket, replayed: false };
      });
    } catch (error: any) {
      const isIdempotencyRace =
        error?.name === "SequelizeUniqueConstraintError" ||
        error?.original?.code === "23505";
      if (!isIdempotencyRace) {
        throw error;
      }

      const winningCommand = await this.dependencies.findCommand(
        normalizedInput,
        null
      );
      if (!winningCommand) {
        throw error;
      }
      const winningTicket = await this.dependencies.findTicketById(
        Number(winningCommand.requestPayload?.ticketId) ||
          normalizedInput.ticketId ||
          0,
        normalizedInput.companyId,
        null
      );
      this.assertReplayable(winningCommand, normalizedInput, winningTicket);
      return {
        command: winningCommand,
        message: null,
        ticket: winningTicket,
        replayed: true
      };
    }
  }

  private assertReplayable(
    existing: any,
    input: CreateOutboundMessageInput,
    ticket: any
  ): void {
    const whatsappChannelType = ticket?.whatsapp?.channelType;
    const { provider } = this.capabilities.resolve(whatsappChannelType);
    const expected = this.fingerprint(
      {
        ...input,
        ticketId:
          Number(existing.requestPayload?.ticketId) || input.ticketId || 0
      },
      String(existing.recipient),
      existing.provider || provider
    );
    if (existing.requestFingerprint !== expected) {
      throw new AppError("IDEMPOTENCY_CONFLICT", 409);
    }
    if (!existing.responseSnapshot) {
      throw new AppError("REQUEST_IN_PROGRESS", 409);
    }
  }
}

export default OutboundMessageService;
