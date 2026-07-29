import sequelize from "../../database";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import ConversationAutomationState from "../persistence/models/ConversationAutomationState";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import MessageCommand from "../persistence/models/MessageCommand";

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
}

const defaultDependencies: Dependencies = {
  transaction: callback => sequelize.transaction(callback),
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
    })
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
  // Parameter property keeps the injectable test seam explicit.
  // eslint-disable-next-line no-useless-constructor
  constructor(private readonly dependencies = defaultDependencies) {}

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
  }): Promise<any | null> {
    const message = await this.dependencies.transaction(async transaction => {
      const command = await this.dependencies.findCommandByProviderMessageId(
        input.companyId,
        input.providerMessageId,
        transaction
      );
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
      return persisted;
    });
    if (!message) return null;
    await this.publishStatus({
      companyId: input.companyId,
      messageId: String(message.id),
      ack: input.ack
    });
    return message;
  }
}

export default BaileysDomainEventService;
