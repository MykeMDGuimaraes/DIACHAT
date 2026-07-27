import { randomUUID } from "crypto";
import { Op } from "sequelize";
import sequelize from "../../database";
import {
  DispatchableMessageCommand,
  MessagingProvider
} from "../contracts/MessagingProvider";
import {
  isProviderSendError,
  PermanentSendError,
  ProviderSendError,
  UnknownSendError
} from "../contracts/ProviderSendError";
import {
  computeRetryDelayMs,
  MAX_SEND_ATTEMPTS,
  MESSAGE_COMMAND_ERROR_CODE,
  MESSAGE_COMMAND_STATUS,
  OUTBOX_EVENT_STATUS,
  OUTBOX_EVENT_TYPE,
  SEND_LEASE_MS
} from "../domain/MessagingStates";
import MessageCommand from "../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import { logger } from "../../utils/logger";

export interface MessageCommandEventSource {
  id: string;
  companyId: number;
  whatsappId: number;
  messageId?: string | null;
  messageKind: string;
}

export interface MessageOutboxEventDto {
  companyId: number;
  eventType: string;
  aggregateId: string;
  payload: {
    commandId: string;
    messageId?: string | null;
    whatsappId: number;
    providerMessageId?: string | null;
    kind: string;
    origin: "api";
    status?: string;
    errorCode?: string | null;
    errorMessage?: string | null;
  };
  status: string;
  attemptCount: number;
}

export const buildMessageSentEvent = (
  command: MessageCommandEventSource,
  providerMessageId?: string
): MessageOutboxEventDto => ({
  companyId: command.companyId,
  eventType: OUTBOX_EVENT_TYPE.MESSAGE_SENT,
  aggregateId: command.messageId || command.id,
  payload: {
    commandId: command.id,
    messageId: command.messageId,
    whatsappId: command.whatsappId,
    providerMessageId: providerMessageId || null,
    kind: command.messageKind,
    origin: "api"
  },
  status: OUTBOX_EVENT_STATUS.READY,
  attemptCount: 0
});

export const buildMessageFailedEvent = (
  command: MessageCommandEventSource,
  errorCode: string,
  errorMessage: string
): MessageOutboxEventDto => ({
  companyId: command.companyId,
  eventType: OUTBOX_EVENT_TYPE.MESSAGE_FAILED,
  aggregateId: command.messageId || command.id,
  payload: {
    commandId: command.id,
    messageId: command.messageId,
    whatsappId: command.whatsappId,
    kind: command.messageKind,
    origin: "api",
    status: MESSAGE_COMMAND_STATUS.FAILED,
    errorCode,
    errorMessage: errorMessage.slice(0, 500)
  },
  status: OUTBOX_EVENT_STATUS.READY,
  attemptCount: 0
});

export const buildMessageUnknownEvent = (
  command: MessageCommandEventSource,
  errorMessage: string
): MessageOutboxEventDto => ({
  companyId: command.companyId,
  eventType: OUTBOX_EVENT_TYPE.MESSAGE_STATUS_UPDATED,
  aggregateId: command.messageId || command.id,
  payload: {
    commandId: command.id,
    messageId: command.messageId,
    whatsappId: command.whatsappId,
    kind: command.messageKind,
    origin: "api",
    status: MESSAGE_COMMAND_STATUS.UNKNOWN,
    errorCode: MESSAGE_COMMAND_ERROR_CODE.SEND_OUTCOME_UNKNOWN,
    errorMessage: errorMessage.slice(0, 500)
  },
  status: OUTBOX_EVENT_STATUS.READY,
  attemptCount: 0
});

interface ClaimedDispatch {
  eventId: string;
  leaseToken: string;
  attemptCount: number;
  command: DispatchableMessageCommand & MessageCommandEventSource;
}

export interface MessageCommandDispatcherDependencies {
  claimNext: (now: Date) => Promise<ClaimedDispatch | null>;
  send: (
    command: DispatchableMessageCommand
  ) => Promise<{ providerMessageId?: string }>;
  markSent: (
    claim: ClaimedDispatch,
    providerMessageId?: string
  ) => Promise<boolean>;
  scheduleRetry: (
    claim: ClaimedDispatch,
    error: ProviderSendError,
    availableAt: Date
  ) => Promise<boolean>;
  markFailed: (
    claim: ClaimedDispatch,
    error: ProviderSendError
  ) => Promise<boolean>;
  markDeadLetter: (
    claim: ClaimedDispatch,
    error: ProviderSendError
  ) => Promise<boolean>;
  markUnknown: (claim: ClaimedDispatch, reason: string) => Promise<boolean>;
  random?: () => number;
}

class OutboundPairFencedError extends Error {
  constructor() {
    super("outbound pair lease diverged");
    this.name = "OutboundPairFencedError";
  }
}

const finalizePair = async (
  claim: ClaimedDispatch,
  commandValues: Record<string, unknown>,
  eventValues: Record<string, unknown>,
  followUpEvent?: MessageOutboxEventDto
): Promise<boolean> => {
  try {
    return await sequelize.transaction(async transaction => {
      const [commandUpdated] = await MessageCommand.update(
        { ...commandValues, leaseToken: null },
        {
          where: {
            id: claim.command.id,
            status: MESSAGE_COMMAND_STATUS.SENDING,
            leaseToken: claim.leaseToken
          },
          transaction
        }
      );
      if (commandUpdated !== 1) {
        throw new OutboundPairFencedError();
      }
      const [eventUpdated] = await MessagingOutboxEvent.update(
        { ...eventValues, leaseToken: null },
        {
          where: {
            id: claim.eventId,
            status: OUTBOX_EVENT_STATUS.PROCESSING,
            leaseToken: claim.leaseToken
          },
          transaction
        }
      );
      if (eventUpdated !== 1) {
        // Lançar dentro da transação reverte também a atualização do comando.
        throw new OutboundPairFencedError();
      }
      if (followUpEvent) {
        await MessagingOutboxEvent.create(followUpEvent as any, {
          transaction
        });
      }
      return true;
    });
  } catch (error) {
    if (error instanceof OutboundPairFencedError) {
      return false;
    }
    throw error;
  }
};

const createDefaultDependencies = (
  providers: MessagingProvider[]
): MessageCommandDispatcherDependencies => ({
  claimNext: now =>
    sequelize.transaction(async transaction => {
      const event = await MessagingOutboxEvent.findOne({
        where: {
          eventType: OUTBOX_EVENT_TYPE.MESSAGE_DISPATCH_REQUESTED,
          status: OUTBOX_EVENT_STATUS.READY,
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
        where: { id: event.aggregateId, status: MESSAGE_COMMAND_STATUS.QUEUED },
        transaction,
        lock: transaction.LOCK.UPDATE
      });

      if (!command) {
        await event.update(
          {
            status: OUTBOX_EVENT_STATUS.COMPLETED,
            leaseExpiresAt: null,
            leaseToken: null
          },
          { transaction }
        );
        return null;
      }

      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(now.getTime() + SEND_LEASE_MS);
      const attemptCount = command.attemptCount + 1;
      await command.update(
        {
          status: MESSAGE_COMMAND_STATUS.SENDING,
          attemptCount,
          leaseExpiresAt,
          leaseToken
        },
        { transaction }
      );
      await event.update(
        {
          status: OUTBOX_EVENT_STATUS.PROCESSING,
          attemptCount: event.attemptCount + 1,
          leaseExpiresAt,
          leaseToken
        },
        { transaction }
      );

      return {
        eventId: event.id,
        leaseToken,
        attemptCount,
        command: command.toJSON() as DispatchableMessageCommand &
          MessageCommandEventSource
      };
    }),
  send: async command => {
    const provider = providers.find(item => item.provider === command.provider);
    if (!provider) {
      throw new PermanentSendError({
        code: "PROVIDER_NOT_SUPPORTED",
        message: `Provider de mensageria nao suportado: ${command.provider}`
      });
    }
    return provider.send(command);
  },
  markSent: (claim, providerMessageId) =>
    finalizePair(
      claim,
      {
        status: MESSAGE_COMMAND_STATUS.SENT,
        providerMessageId: providerMessageId || null,
        completedAt: new Date(),
        leaseExpiresAt: null
      },
      { status: OUTBOX_EVENT_STATUS.COMPLETED, leaseExpiresAt: null },
      buildMessageSentEvent(claim.command, providerMessageId)
    ),
  scheduleRetry: (claim, error, availableAt) =>
    finalizePair(
      claim,
      {
        status: MESSAGE_COMMAND_STATUS.QUEUED,
        errorCode: error.code,
        errorDetails: {
          classification: error.classification,
          providerStatus: error.providerStatus ?? null,
          message: error.message.slice(0, 500),
          ...(error.details || {})
        },
        leaseExpiresAt: null
      },
      {
        status: OUTBOX_EVENT_STATUS.READY,
        availableAt,
        lastError: error.message.slice(0, 500),
        leaseExpiresAt: null
      }
    ),
  markFailed: (claim, error) =>
    finalizePair(
      claim,
      {
        status: MESSAGE_COMMAND_STATUS.FAILED,
        errorCode: error.code,
        errorDetails: {
          classification: error.classification,
          providerStatus: error.providerStatus ?? null,
          message: error.message.slice(0, 500),
          ...(error.details || {})
        },
        completedAt: new Date(),
        leaseExpiresAt: null
      },
      {
        status: OUTBOX_EVENT_STATUS.COMPLETED,
        lastError: error.message.slice(0, 500),
        leaseExpiresAt: null
      },
      buildMessageFailedEvent(claim.command, error.code, error.message)
    ),
  markDeadLetter: (claim, error) =>
    finalizePair(
      claim,
      {
        status: MESSAGE_COMMAND_STATUS.FAILED,
        errorCode: MESSAGE_COMMAND_ERROR_CODE.SEND_RETRY_EXHAUSTED,
        errorDetails: {
          classification: error.classification,
          providerStatus: error.providerStatus ?? null,
          message: error.message.slice(0, 500),
          attempts: claim.attemptCount,
          ...(error.details || {})
        },
        completedAt: new Date(),
        leaseExpiresAt: null
      },
      {
        status: OUTBOX_EVENT_STATUS.DEAD_LETTER,
        lastError: error.message.slice(0, 500),
        leaseExpiresAt: null
      },
      buildMessageFailedEvent(
        claim.command,
        MESSAGE_COMMAND_ERROR_CODE.SEND_RETRY_EXHAUSTED,
        error.message
      )
    ),
  markUnknown: (claim, reason) =>
    finalizePair(
      claim,
      {
        status: MESSAGE_COMMAND_STATUS.UNKNOWN,
        errorCode: MESSAGE_COMMAND_ERROR_CODE.SEND_OUTCOME_UNKNOWN,
        errorDetails: { reason: reason.slice(0, 500) },
        completedAt: new Date(),
        leaseExpiresAt: null
      },
      {
        status: OUTBOX_EVENT_STATUS.COMPLETED,
        lastError: reason.slice(0, 500),
        leaseExpiresAt: null
      },
      buildMessageUnknownEvent(claim.command, reason)
    )
});

export type DispatchOutcome =
  | "idle"
  | "sent"
  | "retry_scheduled"
  | "failed"
  | "dead_letter"
  | "unknown"
  | "fenced";

class MessageCommandDispatcher {
  private readonly dependencies: MessageCommandDispatcherDependencies;

  constructor(
    dependencies?: MessageCommandDispatcherDependencies,
    providers: MessagingProvider[] = []
  ) {
    this.dependencies = dependencies || createDefaultDependencies(providers);
  }

  async dispatchOne(now = new Date()): Promise<{ status: DispatchOutcome }> {
    const claimed = await this.dependencies.claimNext(now);
    if (!claimed) {
      return { status: "idle" };
    }

    let delivery: { providerMessageId?: string };
    try {
      delivery = await this.dependencies.send(claimed.command);
    } catch (error) {
      return { status: await this.handleSendError(claimed, error, now) };
    }

    const finalized = await this.dependencies.markSent(
      claimed,
      delivery.providerMessageId
    );
    if (!finalized) {
      logger.warn(
        {
          commandId: claimed.command.id,
          eventId: claimed.eventId,
          leaseToken: claimed.leaseToken
        },
        "messaging: lease antigo tentou publicar sucesso e foi bloqueado (fencing)"
      );
      return { status: "fenced" };
    }
    return { status: "sent" };
  }

  private async handleSendError(
    claimed: ClaimedDispatch,
    error: unknown,
    now: Date
  ): Promise<DispatchOutcome> {
    const sendError: ProviderSendError = isProviderSendError(error)
      ? error
      : new UnknownSendError({
          code: "UNCLASSIFIED_PROVIDER_ERROR",
          message:
            error instanceof Error ? error.message : "unknown provider error"
        });

    if (sendError.classification === "retryable") {
      if (claimed.attemptCount >= MAX_SEND_ATTEMPTS) {
        const finalized = await this.dependencies.markDeadLetter(
          claimed,
          sendError
        );
        if (finalized) {
          logger.error(
            {
              commandId: claimed.command.id,
              eventId: claimed.eventId,
              companyId: claimed.command.companyId,
              attempts: claimed.attemptCount,
              errorCode: sendError.code,
              providerStatus: sendError.providerStatus ?? null
            },
            "messaging: comando esgotou tentativas de envio e foi para dead-letter"
          );
        }
        return finalized ? "dead_letter" : "fenced";
      }

      const delayMs = computeRetryDelayMs({
        attempt: claimed.attemptCount,
        retryAfterMs: sendError.retryAfterMs,
        random: this.dependencies.random
      });
      const availableAt = new Date(now.getTime() + delayMs);
      const finalized = await this.dependencies.scheduleRetry(
        claimed,
        sendError,
        availableAt
      );
      return finalized ? "retry_scheduled" : "fenced";
    }

    if (sendError.classification === "permanent") {
      const finalized = await this.dependencies.markFailed(claimed, sendError);
      return finalized ? "failed" : "fenced";
    }

    const finalized = await this.dependencies.markUnknown(
      claimed,
      sendError.message
    );
    return finalized ? "unknown" : "fenced";
  }
}

export default MessageCommandDispatcher;
