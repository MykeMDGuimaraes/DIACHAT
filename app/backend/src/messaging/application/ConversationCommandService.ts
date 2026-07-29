import { Op } from "sequelize";
import { v4 as uuidv4 } from "uuid";

import AppError from "../../errors/AppError";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import User from "../../models/User";
import sequelize from "../../database";
import {
  createRequestFingerprint,
  validateIdempotencyKey
} from "../domain/IdempotencyKey";
import ConversationAutomationState from "../persistence/models/ConversationAutomationState";
import ConversationCommand from "../persistence/models/ConversationCommand";
import MessageCommand from "../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";

export type ConversationAction =
  | "pause_automation"
  | "takeover"
  | "release_automation"
  | "finalize";

export interface CreateConversationCommandInput {
  companyId: number;
  allowedConnectionIds: number[];
  idempotencyScope: string;
  idempotencyKey: string;
  conversationId: string;
  externalTicketId: string;
  automationEpoch: number;
  action: ConversationAction;
  queueId?: string;
  userId?: string;
  sendNativeSurvey?: boolean;
}

interface ConversationCommandDependencies {
  transaction<T>(callback: (transaction: any) => Promise<T>): Promise<T>;
  findCommand(
    input: CreateConversationCommandInput,
    transaction: any
  ): Promise<any>;
  findTicket(
    companyId: number,
    conversationId: string,
    transaction: any
  ): Promise<any | null>;
  findQueue(
    companyId: number,
    queueId: number,
    transaction: any
  ): Promise<any | null>;
  findUser(
    companyId: number,
    userId: number,
    transaction: any
  ): Promise<any | null>;
  findState(
    companyId: number,
    externalTicketId: string,
    transaction: any
  ): Promise<any | null>;
  createState(data: Record<string, unknown>, transaction: any): Promise<any>;
  updateState(
    state: any,
    data: Record<string, unknown>,
    transaction: any
  ): Promise<any>;
  cancelOlderMessages(
    companyId: number,
    externalTicketId: string,
    automationEpoch: number,
    transaction: any
  ): Promise<unknown>;
  createCommand(data: Record<string, unknown>, transaction: any): Promise<any>;
  createOutboxEvent(
    data: Record<string, unknown>,
    transaction: any
  ): Promise<any>;
}

const defaultDependencies: ConversationCommandDependencies = {
  transaction: callback => sequelize.transaction(callback),
  findCommand: (input, transaction) =>
    ConversationCommand.findOne({
      where: {
        companyId: input.companyId,
        idempotencyScope: input.idempotencyScope,
        idempotencyKey: input.idempotencyKey
      },
      transaction
    }),
  findTicket: (companyId, conversationId, transaction) =>
    Ticket.findOne({
      where: { companyId, uuid: conversationId },
      transaction,
      lock: transaction.LOCK.UPDATE
    }),
  findQueue: (companyId, queueId, transaction) =>
    Queue.findOne({ where: { companyId, id: queueId }, transaction }),
  findUser: (companyId, userId, transaction) =>
    User.findOne({ where: { companyId, id: userId }, transaction }),
  findState: (companyId, externalTicketId, transaction) =>
    ConversationAutomationState.findOne({
      where: { companyId, externalTicketId },
      transaction,
      lock: transaction.LOCK.UPDATE
    }),
  createState: (data, transaction) =>
    ConversationAutomationState.create(data as any, { transaction }),
  updateState: (state, data, transaction) =>
    state.update(data, { transaction }),
  cancelOlderMessages: (
    companyId,
    externalTicketId,
    automationEpoch,
    transaction
  ) =>
    MessageCommand.update(
      {
        status: "cancelled",
        errorCode: "STALE_AUTOMATION_EPOCH",
        cancelledAt: new Date(),
        completedAt: new Date()
      },
      {
        where: {
          companyId,
          externalTicketId,
          automationEpoch: { [Op.lt]: automationEpoch },
          status: "queued"
        },
        transaction
      }
    ),
  createCommand: (data, transaction) =>
    ConversationCommand.create(data as any, { transaction }),
  createOutboxEvent: (data, transaction) =>
    MessagingOutboxEvent.create(data as any, { transaction })
};

const positiveInteger = (value?: string): number | undefined => {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new AppError("INVALID_CONVERSATION_COMMAND", 422);
  }
  return Number(value);
};

class ConversationCommandService {
  // Parameter property keeps the transactional repository replaceable in tests.
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly dependencies: ConversationCommandDependencies = defaultDependencies
  ) {}

  // eslint-disable-next-line class-methods-use-this
  fingerprint(input: CreateConversationCommandInput): string {
    return createRequestFingerprint({
      provider: "dia_chat",
      messageKind: `conversation:${input.action}`,
      recipient: input.conversationId,
      requestPayload: {
        externalTicketId: input.externalTicketId,
        automationEpoch: input.automationEpoch,
        queueId: input.queueId,
        userId: input.userId,
        sendNativeSurvey: input.sendNativeSurvey
      }
    });
  }

  // eslint-disable-next-line class-methods-use-this
  createCommandId(): string {
    return uuidv4();
  }

  async create(input: CreateConversationCommandInput): Promise<{
    command: any;
    replayed: boolean;
  }> {
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    if (
      !input.conversationId?.trim() ||
      !input.externalTicketId?.trim() ||
      !Number.isInteger(input.automationEpoch) ||
      input.automationEpoch < 0
    ) {
      throw new AppError("INVALID_CONVERSATION_COMMAND", 422);
    }
    if (input.action === "finalize" && input.sendNativeSurvey !== false) {
      throw new AppError("NATIVE_SURVEY_NOT_ALLOWED", 422);
    }
    const queueId =
      input.action === "finalize" ? undefined : positiveInteger(input.queueId);
    const userId = positiveInteger(input.userId);
    const normalized = { ...input, idempotencyKey };
    const requestFingerprint = this.fingerprint(normalized);

    try {
      return await this.dependencies.transaction(async transaction => {
        const existing = await this.dependencies.findCommand(
          normalized,
          transaction
        );
        if (existing) {
          if (existing.requestFingerprint !== requestFingerprint) {
            throw new AppError("IDEMPOTENCY_CONFLICT", 409);
          }
          if (!existing.responseSnapshot) {
            throw new AppError("REQUEST_IN_PROGRESS", 409);
          }
          return { command: existing, replayed: true };
        }

        const ticket = await this.dependencies.findTicket(
          input.companyId,
          input.conversationId,
          transaction
        );
        if (!ticket) throw new AppError("Conversa nao encontrada", 404);
        if (!input.allowedConnectionIds.includes(ticket.whatsappId)) {
          throw new AppError("Canal de WhatsApp nao autorizado", 403);
        }
        if (
          queueId !== undefined &&
          !(await this.dependencies.findQueue(
            input.companyId,
            queueId,
            transaction
          ))
        ) {
          throw new AppError("Fila nao encontrada", 404);
        }
        if (
          userId !== undefined &&
          !(await this.dependencies.findUser(
            input.companyId,
            userId,
            transaction
          ))
        ) {
          throw new AppError("Usuario nao encontrado", 404);
        }

        let state = await this.dependencies.findState(
          input.companyId,
          input.externalTicketId,
          transaction
        );
        if (!state) {
          try {
            state = await this.dependencies.createState(
              {
                companyId: input.companyId,
                externalTicketId: input.externalTicketId,
                conversationId: input.conversationId,
                automationEpoch: input.automationEpoch,
                state: "automation"
              },
              transaction
            );
          } catch (error: any) {
            if (
              error?.name === "SequelizeUniqueConstraintError" ||
              error?.original?.code === "23505"
            ) {
              throw new AppError("CONVERSATION_STATE_CONFLICT", 409);
            }
            throw error;
          }
        }
        if (
          input.automationEpoch < state.automationEpoch ||
          state.conversationId !== input.conversationId
        ) {
          throw new AppError("STALE_AUTOMATION_EPOCH", 409);
        }

        if (input.action === "release_automation") {
          if (!["human_controlled", "pause_pending"].includes(state.state)) {
            throw new AppError("HANDOFF_STATE_CONFLICT", 409);
          }
        } else if (
          ["pause_automation", "takeover"].includes(input.action) &&
          !["automation", "pause_pending"].includes(state.state)
        ) {
          throw new AppError("HANDOFF_STATE_CONFLICT", 409);
        }

        const nextState =
          input.action === "release_automation"
            ? "release_pending"
            : ["pause_automation", "takeover"].includes(input.action)
            ? "pause_pending"
            : state.state;
        if (
          nextState !== state.state ||
          input.automationEpoch !== state.automationEpoch
        ) {
          state = await this.dependencies.updateState(
            state,
            {
              automationEpoch: input.automationEpoch,
              conversationId: input.conversationId,
              state: nextState
            },
            transaction
          );
        }
        if (["pause_automation", "takeover"].includes(input.action)) {
          await this.dependencies.cancelOlderMessages(
            input.companyId,
            input.externalTicketId,
            input.automationEpoch,
            transaction
          );
        }

        const commandId = this.createCommandId();
        const command = await this.dependencies.createCommand(
          {
            id: commandId,
            companyId: input.companyId,
            conversationId: input.conversationId,
            externalTicketId: input.externalTicketId,
            automationEpoch: input.automationEpoch,
            action: input.action,
            queueId: input.queueId,
            userId: input.userId,
            sendNativeSurvey: input.sendNativeSurvey === true,
            idempotencyScope: input.idempotencyScope,
            idempotencyKey,
            requestFingerprint,
            requestPayload: {
              ticketId: ticket.id,
              whatsappId: ticket.whatsappId,
              contactId: ticket.contactId,
              queueId: input.queueId,
              userId: input.userId
            },
            responseSnapshot: {
              id: commandId,
              status: "accepted",
              conversationId: input.conversationId
            },
            status: "queued",
            attemptCount: 0
          },
          transaction
        );
        await this.dependencies.createOutboxEvent(
          {
            companyId: input.companyId,
            eventType: "conversation.command.requested",
            aggregateId: command.id,
            payload: { commandId: command.id },
            status: "ready",
            attemptCount: 0
          },
          transaction
        );
        return { command, replayed: false };
      });
    } catch (error: any) {
      const isIdempotencyRace =
        error?.name === "SequelizeUniqueConstraintError" ||
        error?.original?.code === "23505";
      if (!isIdempotencyRace) throw error;
      const winner = await this.dependencies.findCommand(normalized, null);
      if (!winner) throw error;
      if (winner.requestFingerprint !== requestFingerprint) {
        throw new AppError("IDEMPOTENCY_CONFLICT", 409);
      }
      if (!winner.responseSnapshot) {
        throw new AppError("REQUEST_IN_PROGRESS", 409);
      }
      return { command: winner, replayed: true };
    }
  }
}

export default ConversationCommandService;
