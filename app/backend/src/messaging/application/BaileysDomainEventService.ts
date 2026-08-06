import { Op } from "sequelize";
import sequelize from "../../database";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import ConversationAutomationState from "../persistence/models/ConversationAutomationState";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import MessageCommand from "../persistence/models/MessageCommand";
import {
  MESSAGE_COMMAND_ERROR_CODE,
  MESSAGE_COMMAND_STATUS
} from "../domain/MessagingStates";
import { adaptBaileysMessageEvents } from "../adapters/baileys/BaileysProviderEventAdapter";
import { WhatsAppProviderEvent } from "../domain/WhatsAppProviderEvent";
import WhatsAppProviderEventPublisher from "./WhatsAppProviderEventPublisher";
import { observeAckLatencyMs } from "../telemetry/DeliveryObservability";
import ChannelDeliveryHealthService from "./ChannelDeliveryHealthService";

const validOpaqueButtonId = (value: unknown): value is string =>
  typeof value === "string" &&
  value.length > 0 &&
  Buffer.byteLength(value, "utf8") <= 256;

const nativeFlowButtonId = (raw: any): string | null => {
  const params =
    raw?.message?.interactiveResponseMessage?.nativeFlowResponseMessage
      ?.paramsJson;
  if (typeof params !== "string") return null;
  try {
    const parsed = JSON.parse(params);
    return validOpaqueButtonId(parsed?.id) ? parsed.id : null;
  } catch {
    return null;
  }
};

export const extractSelectedButtonId = (raw: any): string | null => {
  const selected =
    raw?.message?.buttonsResponseMessage?.selectedButtonId ??
    raw?.message?.templateButtonReplyMessage?.selectedId ??
    raw?.message?.listResponseMessage?.singleSelectReply?.selectedRowId ??
    nativeFlowButtonId(raw);
  return validOpaqueButtonId(selected) ? selected : null;
};

interface Dependencies {
  transaction<T>(callback: (transaction: any) => Promise<T>): Promise<T>;
  findAutomationState(
    companyId: number,
    conversationId: string,
    transaction: any
  ): Promise<any>;
  findCommandByMessageId(
    companyId: number,
    messageId: string,
    transaction: any
  ): Promise<any>;
  findCommandByProviderMessageId(
    companyId: number,
    providerMessageId: string,
    transaction: any
  ): Promise<any>;
  advanceCommandStatus(
    commandId: string,
    target: string,
    transaction: any
  ): Promise<void>;
  findMessage(
    companyId: number,
    messageId: string,
    transaction: any
  ): Promise<any>;
  updateMessage(
    message: any,
    values: Record<string, unknown>,
    transaction: any
  ): Promise<any>;
  findOrCreateEvent(
    event: Record<string, unknown>,
    transaction: any
  ): Promise<unknown>;
  mirrorEnabled(): boolean;
  persistProviderEvents(
    events: readonly WhatsAppProviderEvent[],
    transaction: any
  ): Promise<void>;
  recordConfirmedDelivery(
    whatsappId: number,
    transaction: any
  ): Promise<unknown>;
}

const providerEventPublisher = new WhatsAppProviderEventPublisher();
const channelDeliveryHealth = new ChannelDeliveryHealthService();

const defaultDependencies: Dependencies = {
  transaction: callback => sequelize.transaction(callback),
  // Promoção atômica e só para frente: sent/delivered avançam, e um
  // "unknown" de DELIVERY_UNCONFIRMED se autocorrige quando o ack chega
  // atrasado. O WHERE condicional fecha a corrida com o recovery watchdog.
  advanceCommandStatus: async (commandId, target, transaction) => {
    await MessageCommand.update(
      { status: target, errorCode: null },
      {
        where: {
          id: commandId,
          [Op.or]: [
            { status: MESSAGE_COMMAND_STATUS.SENT },
            { status: MESSAGE_COMMAND_STATUS.DELIVERED },
            {
              status: MESSAGE_COMMAND_STATUS.UNKNOWN,
              errorCode: MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED
            }
          ]
        },
        transaction
      }
    );
  },
  findAutomationState: (companyId, conversationId, transaction) =>
    ConversationAutomationState.findOne({
      where: { companyId, conversationId },
      transaction
    }),
  findCommandByMessageId: (companyId, messageId, transaction) =>
    MessageCommand.findOne({
      where: { companyId, messageId },
      transaction
    }),
  findCommandByProviderMessageId: (companyId, providerMessageId, transaction) =>
    MessageCommand.findOne({
      where: { companyId, providerMessageId },
      transaction
    }),
  findMessage: (companyId, messageId, transaction) =>
    Message.findOne({
      where: { companyId, id: messageId },
      include: [
        "contact",
        {
          model: Message,
          as: "quotedMsg",
          include: ["contact"]
        }
      ],
      transaction
    }),
  updateMessage: (message, values, transaction) =>
    message.update(values, { transaction }),
  findOrCreateEvent: (event, transaction) =>
    MessagingOutboxEvent.findOrCreate({
      where: {
        companyId: event.companyId,
        eventType: event.eventType,
        aggregateId: event.aggregateId
      },
      defaults: event as any,
      transaction
    }),
  mirrorEnabled: () =>
    process.env.MESSAGING_WEBHOOK_MIRROR_V1_ENABLED === "true",
  persistProviderEvents: (events, transaction) =>
    providerEventPublisher.persist(events, transaction),
  recordConfirmedDelivery: (whatsappId, transaction) =>
    channelDeliveryHealth.recordConfirmedDelivery(whatsappId, transaction)
};

const parseData = (dataJson: unknown): any => {
  if (typeof dataJson !== "string") return dataJson || {};
  try {
    return JSON.parse(dataJson);
  } catch {
    return {};
  }
};

class BaileysDomainEventService {
  private readonly dependencies: Dependencies;

  constructor(dependencies: Partial<Dependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async publish(input: {
    companyId: number;
    message: Message;
    ticket: Ticket;
  }): Promise<void> {
    const raw = parseData(input.message.dataJson);
    if (input.message.fromMe && raw?.origin === "api") return;
    if (input.message.fromMe && !input.ticket.userId) return;

    const actorType = input.message.fromMe ? "human" : "contact";
    await this.dependencies.transaction(async transaction => {
      const state = await this.dependencies.findAutomationState(
        input.companyId,
        input.ticket.uuid,
        transaction
      );
      const correlation = {
        messageId: String(input.message.id),
        whatsappId: Number(input.ticket.whatsappId),
        conversationId: input.ticket.uuid,
        contactId:
          input.ticket.contactId === null ||
          input.ticket.contactId === undefined
            ? null
            : String(input.ticket.contactId),
        externalTicketId: state?.externalTicketId || null,
        automationEpoch:
          state?.automationEpoch === undefined
            ? null
            : Number(state.automationEpoch)
      };

      if (this.dependencies.mirrorEnabled()) {
        const events = adaptBaileysMessageEvents({
          companyId: input.companyId,
          whatsappId: Number(input.ticket.whatsappId),
          conversationId: input.ticket.uuid,
          contactId: correlation.contactId,
          externalTicketId: correlation.externalTicketId,
          automationEpoch: correlation.automationEpoch,
          raw
        });
        await this.dependencies.persistProviderEvents(events, transaction);
        return;
      }

      await this.dependencies.findOrCreateEvent(
        {
          companyId: input.companyId,
          eventType: "message.received",
          aggregateId: String(input.message.id),
          payload: {
            ...correlation,
            actorType,
            kind: input.message.mediaType || "text",
            origin: input.message.fromMe ? "human" : "provider"
          },
          status: "ready",
          attemptCount: 0
        },
        transaction
      );

      const selectedId = input.message.fromMe
        ? null
        : extractSelectedButtonId(raw);
      if (selectedId !== null) {
        await this.dependencies.findOrCreateEvent(
          {
            companyId: input.companyId,
            eventType: "button.clicked",
            aggregateId: String(input.message.id),
            payload: {
              ...correlation,
              actorType: "contact",
              buttonId: selectedId,
              selectedId,
              origin: "provider"
            },
            status: "ready",
            attemptCount: 0
          },
          transaction
        );
      }
    });
  }

  async publishConversationCreated(input: {
    companyId: number;
    ticket: Ticket;
    actorType?: "contact" | "system";
    origin?: "provider" | "api";
  }): Promise<void> {
    await this.dependencies.transaction(async transaction => {
      await this.persistConversationCreated(input, transaction);
    });
  }

  async persistConversationCreated(
    input: {
      companyId: number;
      ticket: Ticket;
      actorType?: "contact" | "system";
      origin?: "provider" | "api";
    },
    transaction: any
  ): Promise<void> {
    const state = await this.dependencies.findAutomationState(
      input.companyId,
      input.ticket.uuid,
      transaction
    );
    await this.dependencies.findOrCreateEvent(
      {
        companyId: input.companyId,
        eventType: "conversation.created",
        aggregateId: input.ticket.uuid,
        payload: {
          conversationId: input.ticket.uuid,
          contactId:
            input.ticket.contactId === null ||
            input.ticket.contactId === undefined
              ? null
              : String(input.ticket.contactId),
          whatsappId: Number(input.ticket.whatsappId),
          externalTicketId: state?.externalTicketId || null,
          automationEpoch: state?.automationEpoch ?? null,
          actorType: input.actorType || "contact",
          origin: input.origin || "provider"
        },
        status: "ready",
        attemptCount: 0
      },
      transaction
    );
  }

  async publishStatus(input: {
    companyId: number;
    messageId: string;
    ack: number | null | undefined;
  }): Promise<void> {
    const status =
      Number(input.ack) >= 4
        ? "read"
        : Number(input.ack) >= 3
        ? "delivered"
        : Number(input.ack) >= 1
        ? "sent"
        : null;
    if (!status) return;

    await this.dependencies.transaction(async transaction => {
      const command = await this.dependencies.findCommandByMessageId(
        input.companyId,
        input.messageId,
        transaction
      );
      if (!command) return;
      await this.dependencies.findOrCreateEvent(
        {
          companyId: input.companyId,
          eventType: "message.status.updated",
          aggregateId: `${input.messageId}:${status}`,
          payload: {
            commandId: command.id,
            messageId: input.messageId,
            whatsappId: command.whatsappId,
            conversationId: command.conversationId,
            contactId: command.contactId,
            externalTicketId: command.externalTicketId,
            automationEpoch: command.automationEpoch,
            status,
            origin: "provider"
          },
          status: "ready",
          attemptCount: 0
        },
        transaction
      );
    });
  }

  async isApiProviderMessage(
    companyId: number,
    providerMessageId: string
  ): Promise<boolean> {
    return this.dependencies.transaction(async transaction =>
      Boolean(
        await this.dependencies.findCommandByProviderMessageId(
          companyId,
          providerMessageId,
          transaction
        )
      )
    );
  }

  async acknowledgeProviderMessage(input: {
    companyId: number;
    providerMessageId: string;
    ack: number | null | undefined;
  }): Promise<{ message: any; healthChangedChannel: unknown | null } | null> {
    let healthChangedChannel: unknown | null = null;
    const message = await this.dependencies.transaction(async transaction => {
      const command = await this.dependencies.findCommandByProviderMessageId(
        input.companyId,
        input.providerMessageId,
        transaction
      );
      // O ack do WhatsApp tambem faz o comando avancar: sent -> delivered -> read.
      // Sem isso o comando ficava "sent" para sempre mesmo com entrega confirmada.
      if (command) {
        const rank: Record<string, number> = {
          [MESSAGE_COMMAND_STATUS.SENT]: 1,
          [MESSAGE_COMMAND_STATUS.DELIVERED]: 2,
          [MESSAGE_COMMAND_STATUS.READ]: 3
        };
        // Mesma escala do publishStatus/Baileys: 2 = servidor, 3 = entregue,
        // 4 = lida. O comando so avanca para delivered/read, nunca retrocede.
        const target =
          typeof input.ack === "number" && input.ack >= 4
            ? MESSAGE_COMMAND_STATUS.READ
            : typeof input.ack === "number" && input.ack >= 3
              ? MESSAGE_COMMAND_STATUS.DELIVERED
              : null;
        // ACK tardio (T5): um unknown por DELIVERY_UNCONFIRMED se cura com
        // ack >= 2 — volta a constar como sent/delivered/read e a entrega
        // confirmada zera o contador de falhas e restaura a saúde do canal.
        const isUnconfirmedUnknown =
          command.status === MESSAGE_COMMAND_STATUS.UNKNOWN &&
          command.errorCode === MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED;
        let advanced = false;
        if (
          target &&
          (isUnconfirmedUnknown ||
            (rank[command.status] && rank[target] > rank[command.status]))
        ) {
          await this.dependencies.advanceCommandStatus(
            command.id,
            target,
            transaction
          );
          advanced = true;
        } else if (
          !target &&
          isUnconfirmedUnknown &&
          typeof input.ack === "number" &&
          input.ack >= 2
        ) {
          await this.dependencies.advanceCommandStatus(
            command.id,
            MESSAGE_COMMAND_STATUS.SENT,
            transaction
          );
          advanced = true;
        }
        if (advanced) {
          healthChangedChannel =
            await this.dependencies.recordConfirmedDelivery(
              command.whatsappId,
              transaction
            );
        }
      }
      const localMessageId = command?.messageId || input.providerMessageId;
      const persisted = await this.dependencies.findMessage(
        input.companyId,
        localMessageId,
        transaction
      );
      if (!persisted) return null;
      await this.dependencies.updateMessage(
        persisted,
        { ack: input.ack },
        transaction
      );
      // Latência do ACK (T7): criação da mensagem local até o ack do servidor.
      if (persisted.createdAt) {
        observeAckLatencyMs(
          Date.now() - new Date(persisted.createdAt).getTime(),
          { whatsappId: command?.whatsappId }
        );
      }
      return persisted;
    });
    if (!message) return null;
    await this.publishStatus({
      companyId: input.companyId,
      messageId: String(message.id),
      ack: input.ack
    });
    return { message, healthChangedChannel };
  }
}

export default BaileysDomainEventService;
