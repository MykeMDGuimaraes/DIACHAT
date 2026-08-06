/* eslint-disable max-classes-per-file */
import { randomUUID } from "crypto";
import { Op, QueryTypes, Transaction } from "sequelize";
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
import ConversationAutomationState from "../persistence/models/ConversationAutomationState";
import {
  observeSendPipelineLatencyMs,
  SEND_PIPELINE_STAGE
} from "../telemetry/DeliveryObservability";
import { logger } from "../../utils/logger";

export interface MessageCommandEventSource {
  id: string;
  companyId: number;
  whatsappId: number;
  messageId?: string | null;
  messageKind: string;
  externalTicketId?: string | null;
  automationEpoch?: number | null;
  conversationId?: string | null;
  contactId?: string | null;
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
    externalTicketId?: string | null;
    automationEpoch?: number | null;
    conversationId?: string | null;
    contactId?: string | null;
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
    externalTicketId: command.externalTicketId,
    automationEpoch: command.automationEpoch,
    conversationId: command.conversationId,
    contactId: command.contactId,
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
    externalTicketId: command.externalTicketId,
    automationEpoch: command.automationEpoch,
    conversationId: command.conversationId,
    contactId: command.contactId,
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
  errorMessage: string,
  errorCode: string = MESSAGE_COMMAND_ERROR_CODE.SEND_OUTCOME_UNKNOWN
): MessageOutboxEventDto => ({
  companyId: command.companyId,
  eventType: OUTBOX_EVENT_TYPE.MESSAGE_STATUS_UPDATED,
  aggregateId: command.messageId || command.id,
  payload: {
    commandId: command.id,
    messageId: command.messageId,
    whatsappId: command.whatsappId,
    kind: command.messageKind,
    externalTicketId: command.externalTicketId,
    automationEpoch: command.automationEpoch,
    conversationId: command.conversationId,
    contactId: command.contactId,
    origin: "api",
    status: MESSAGE_COMMAND_STATUS.UNKNOWN,
    errorCode,
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

export const automationCommandIsCurrent = (
  command: MessageCommandEventSource,
  state?: {
    state: string;
    automationEpoch: number;
    conversationId: string;
  } | null
): boolean => {
  if (!command.externalTicketId) return true;
  return Boolean(
    state &&
      state.state === "automation" &&
      state.automationEpoch === command.automationEpoch &&
      state.conversationId === command.conversationId
  );
};

export interface MessageCommandDispatcherDependencies {
  claimNext: (now: Date) => Promise<ClaimedDispatch | null>;
  // Lanes por canal (T8): até `maxChannels` claims, um por canal, sempre o
  // comando mais antigo da fila de cada canal. Opcional para manter testes
  // legados que injetam apenas claimNext.
  claimNextPerChannel?: (
    now: Date,
    maxChannels: number
  ) => Promise<ClaimedDispatch[]>;
  send: (
    command: DispatchableMessageCommand
  ) => Promise<{ providerMessageId?: string }>;
  withSendPermit?: (
    claim: ClaimedDispatch,
    send: () => Promise<{ providerMessageId?: string }>
  ) => Promise<{
    status: "permitted" | "cancelled" | "fenced";
    delivery?: { providerMessageId?: string };
  }>;
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
        throw new OutboundPairFencedError();
      }
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
        // Lançar dentro da transação reverte também a atualização do evento.
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

const refreshLeasePair = async (
  claim: ClaimedDispatch,
  leaseExpiresAt: Date
): Promise<boolean> => {
  try {
    return await sequelize.transaction(async transaction => {
      const [eventUpdated] = await MessagingOutboxEvent.update(
        { leaseExpiresAt },
        {
          where: {
            id: claim.eventId,
            status: OUTBOX_EVENT_STATUS.PROCESSING,
            leaseToken: claim.leaseToken
          },
          transaction
        }
      );
      if (eventUpdated !== 1) throw new OutboundPairFencedError();
      const [commandUpdated] = await MessageCommand.update(
        { leaseExpiresAt },
        {
          where: {
            id: claim.command.id,
            status: MESSAGE_COMMAND_STATUS.SENDING,
            leaseToken: claim.leaseToken
          },
          transaction
        }
      );
      if (commandUpdated !== 1) throw new OutboundPairFencedError();
      return true;
    });
  } catch (error) {
    if (error instanceof OutboundPairFencedError) return false;
    throw error;
  }
};

// Classe do advisory lock transacional das lanes (T8): serializa o claim por
// canal entre workers/processos. Não há outro usuário de advisory lock no app.
const LANE_CLAIM_ADVISORY_LOCK_CLASS = 732701;

// Corpo compartilhado do claim (T8): dado um evento READY já travado na
// transação, valida comando e automação e marca o lease do par comando+evento.
const claimEventCommand = async (
  event: MessagingOutboxEvent,
  now: Date,
  transaction: Transaction
): Promise<ClaimedDispatch | null> => {
  const commandCandidate = await MessageCommand.findOne({
    where: {
      id: event.aggregateId,
      status: MESSAGE_COMMAND_STATUS.QUEUED
    },
    transaction
  });

  if (!commandCandidate) {
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

  // Global order: event -> automation state -> command. Handoff locks
  // state before cancelling queued commands, so claim must never hold the
  // command row while waiting for that state.
  const state = commandCandidate.externalTicketId
    ? await ConversationAutomationState.findOne({
        where: {
          companyId: commandCandidate.companyId,
          externalTicketId: commandCandidate.externalTicketId
        },
        transaction,
        lock: transaction.LOCK.UPDATE
      })
    : null;
  const command = await MessageCommand.findOne({
    where: {
      id: event.aggregateId,
      status: MESSAGE_COMMAND_STATUS.QUEUED
    },
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

  if (command.externalTicketId) {
    if (
      !automationCommandIsCurrent(
        command.toJSON() as unknown as MessageCommandEventSource,
        state?.toJSON() as any
      )
    ) {
      await command.update(
        {
          status: MESSAGE_COMMAND_STATUS.CANCELLED,
          errorCode: "STALE_AUTOMATION_EPOCH",
          cancelledAt: now,
          completedAt: now
        },
        { transaction }
      );
      await event.update(
        {
          status: OUTBOX_EVENT_STATUS.COMPLETED,
          leaseExpiresAt: null,
          leaseToken: null
        },
        { transaction }
      );
      await MessagingOutboxEvent.create(
        buildMessageFailedEvent(
          command.toJSON() as unknown as MessageCommandEventSource,
          "STALE_AUTOMATION_EPOCH",
          "Comando cancelado antes do envio"
        ) as any,
        { transaction }
      );
      return null;
    }
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
};

const createDefaultDependencies = (
  providers: MessagingProvider[]
): MessageCommandDispatcherDependencies => {
  const send = async (command: DispatchableMessageCommand) => {
    const provider = providers.find(item => item.provider === command.provider);
    if (!provider) {
      throw new PermanentSendError({
        code: "PROVIDER_NOT_SUPPORTED",
        message: `Provider de mensageria nao suportado: ${command.provider}`
      });
    }
    return provider.send(command);
  };
  return {
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

        return claimEventCommand(event, now, transaction);
      }),
    // Lanes por canal (T8): seleciona o evento READY mais antigo por canal
    // (canais com envio em andamento ficam fora desta rodada) e revalida cada
    // candidato com lock na própria transação. DISTINCT ON não aceita FOR
    // UPDATE, por isso a seleção não trava — a corrida resolve no lock abaixo.
    claimNextPerChannel: async (now, maxChannels) => {
      const candidates = await sequelize.query<{
        id: string;
        whatsappId: number;
      }>(
        `SELECT DISTINCT ON (command."whatsappId") event.id, command."whatsappId"
           FROM messaging."MessagingOutboxEvents" AS event
           JOIN messaging."MessageCommands" AS command
             ON command.id = event."aggregateId"::uuid
          WHERE event."eventType" = :eventType
            AND event.status = :ready
            AND event."availableAt" <= :now
            AND command.status = :queued
            AND NOT EXISTS (
              SELECT 1
                FROM messaging."MessageCommands" AS inflight
               WHERE inflight."whatsappId" = command."whatsappId"
                 AND inflight.status = :sending
                 AND inflight."leaseExpiresAt" > :now
            )
          ORDER BY command."whatsappId", event."createdAt" ASC, event.id ASC
          LIMIT :maxChannels`,
        {
          replacements: {
            eventType: OUTBOX_EVENT_TYPE.MESSAGE_DISPATCH_REQUESTED,
            ready: OUTBOX_EVENT_STATUS.READY,
            queued: MESSAGE_COMMAND_STATUS.QUEUED,
            sending: MESSAGE_COMMAND_STATUS.SENDING,
            now,
            maxChannels
          },
          type: QueryTypes.SELECT
        }
      );
      const claimed: ClaimedDispatch[] = [];
      for (const candidate of candidates) {
        // eslint-disable-next-line no-await-in-loop
        const claim = await sequelize.transaction(async transaction => {
          const event = await MessagingOutboxEvent.findOne({
            where: {
              id: candidate.id,
              eventType: OUTBOX_EVENT_TYPE.MESSAGE_DISPATCH_REQUESTED,
              status: OUTBOX_EVENT_STATUS.READY,
              availableAt: { [Op.lte]: now }
            },
            transaction,
            lock: transaction.LOCK.UPDATE,
            skipLocked: true
          });
          if (!event) return null;
          // Claim atômico por canal (T8): o advisory lock transacional
          // serializa workers concorrentes do MESMO canal; só depois dele a
          // revalidação de in-flight é confiável (sem ela, dois workers
          // podiam claimear comandos diferentes do mesmo canal ao mesmo
          // tempo, quebrando a ordem serial da lane).
          await sequelize.query(
            "SELECT pg_advisory_xact_lock(:lockClass, :whatsappId)",
            {
              replacements: {
                lockClass: LANE_CLAIM_ADVISORY_LOCK_CLASS,
                whatsappId: candidate.whatsappId
              },
              transaction
            }
          );
          const busy = await sequelize.query<{ busy: number }>(
            `SELECT 1 AS busy
               FROM messaging."MessageCommands"
              WHERE "whatsappId" = :whatsappId
                AND status = :sending
                AND "leaseExpiresAt" > :now
              LIMIT 1`,
            {
              replacements: {
                whatsappId: candidate.whatsappId,
                sending: MESSAGE_COMMAND_STATUS.SENDING,
                now
              },
              transaction,
              type: QueryTypes.SELECT
            }
          );
          // Outro worker claimeou este canal entre a seleção e o lock: o
          // evento segue READY para a próxima rodada.
          if (busy.length > 0) return null;
          return claimEventCommand(event, now, transaction);
        });
        if (claim) claimed.push(claim);
      }
      return claimed;
    },
    send,
    withSendPermit: async (claim, sendOperation) => {
      const refreshedLeaseExpiresAt = new Date(Date.now() + SEND_LEASE_MS);
      if (!(await refreshLeasePair(claim, refreshedLeaseExpiresAt))) {
        return { status: "fenced" as const };
      }
      if (!claim.command.externalTicketId) {
        return {
          status: "permitted" as const,
          delivery: await sendOperation()
        };
      }
      try {
        return await sequelize.transaction(async transaction => {
          const state = await ConversationAutomationState.findOne({
            where: {
              companyId: claim.command.companyId,
              externalTicketId: claim.command.externalTicketId
            },
            transaction,
            lock: transaction.LOCK.UPDATE
          });
          const command = await MessageCommand.findOne({
            where: { id: claim.command.id },
            transaction
          });
          const event = await MessagingOutboxEvent.findOne({
            where: { id: claim.eventId },
            transaction
          });
          const leaseValid =
            command?.status === MESSAGE_COMMAND_STATUS.SENDING &&
            command.leaseToken === claim.leaseToken &&
            command.leaseExpiresAt?.getTime() > Date.now() &&
            event?.status === OUTBOX_EVENT_STATUS.PROCESSING &&
            event.leaseToken === claim.leaseToken;
          if (!leaseValid) return { status: "fenced" as const };
          if (
            !automationCommandIsCurrent(claim.command, state?.toJSON() as any)
          ) {
            const now = new Date();
            const [eventUpdated] = await MessagingOutboxEvent.update(
              {
                status: OUTBOX_EVENT_STATUS.COMPLETED,
                leaseToken: null,
                leaseExpiresAt: null
              },
              {
                where: {
                  id: claim.eventId,
                  status: OUTBOX_EVENT_STATUS.PROCESSING,
                  leaseToken: claim.leaseToken
                },
                transaction
              }
            );
            if (eventUpdated !== 1) throw new OutboundPairFencedError();
            const [commandUpdated] = await MessageCommand.update(
              {
                status: MESSAGE_COMMAND_STATUS.CANCELLED,
                errorCode: "STALE_AUTOMATION_EPOCH",
                cancelledAt: now,
                completedAt: now,
                leaseToken: null,
                leaseExpiresAt: null
              },
              {
                where: {
                  id: claim.command.id,
                  status: MESSAGE_COMMAND_STATUS.SENDING,
                  leaseToken: claim.leaseToken
                },
                transaction
              }
            );
            if (commandUpdated !== 1) throw new OutboundPairFencedError();
            await MessagingOutboxEvent.create(
              buildMessageFailedEvent(
                claim.command,
                "STALE_AUTOMATION_EPOCH",
                "Comando cancelado imediatamente antes do envio"
              ) as any,
              { transaction }
            );
            return { status: "cancelled" as const };
          }
          const delivery = await sendOperation();
          return { status: "permitted" as const, delivery };
        });
      } catch (error) {
        if (error instanceof OutboundPairFencedError) {
          return { status: "fenced" as const };
        }
        throw error;
      }
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
          ...(error.code === "BAILEYS_SOCKET_UNAVAILABLE"
            ? { attemptCount: Math.max(0, claim.attemptCount - 1) }
            : {}),
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
  };
};

export type DispatchOutcome =
  | "idle"
  | "sent"
  | "retry_scheduled"
  | "failed"
  | "dead_letter"
  | "unknown"
  | "cancelled"
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
    return { status: await this.dispatchClaimed(claimed, now) };
  }

  // Lanes por canal (T8): despacha até `maxChannels` comandos em paralelo —
  // um por canal, sempre o mais antigo da fila. Um canal lento ou
  // desconectado ocupa apenas a própria lane; os demais progridem.
  async dispatchChannelLaneBatch(
    maxChannels: number,
    now = new Date()
  ): Promise<{
    status: "idle" | "dispatched";
    dispatched: number;
    outcomes: DispatchOutcome[];
  }> {
    const claimed = this.dependencies.claimNextPerChannel
      ? await this.dependencies.claimNextPerChannel(now, maxChannels)
      : [];
    if (claimed.length === 0) {
      return { status: "idle", dispatched: 0, outcomes: [] };
    }
    const settled = await Promise.allSettled(
      claimed.map(claim => this.dispatchClaimed(claim, now))
    );
    const outcomes: DispatchOutcome[] = [];
    let failedLanes = 0;
    settled.forEach(result => {
      if (result.status === "fulfilled") {
        outcomes.push(result.value);
      } else {
        failedLanes += 1;
      }
    });
    if (failedLanes > 0) {
      logger.error(
        { failedLanes },
        "messaging: lanes de dispatch falharam com erro nao tratado"
      );
    }
    return { status: "dispatched", dispatched: outcomes.length, outcomes };
  }

  private async dispatchClaimed(
    claimed: ClaimedDispatch,
    now: Date
  ): Promise<DispatchOutcome> {
    // Latência commit → dispatch (T8): o createdAt do comando é o commit
    // transacional do outbox; o claim acabou de acontecer.
    observeSendPipelineLatencyMs(
      SEND_PIPELINE_STAGE.COMMIT_TO_DISPATCH,
      now.getTime() -
        new Date(
          (claimed.command as { createdAt?: Date | string }).createdAt ?? now
        ).getTime()
    );
    const sendStartedAt = Date.now();

    let delivery: { providerMessageId?: string };
    try {
      if (this.dependencies.withSendPermit) {
        const permit = await this.dependencies.withSendPermit(claimed, () =>
          this.dependencies.send(claimed.command)
        );
        if (permit.status !== "permitted") {
          return permit.status;
        }
        delivery = permit.delivery || {};
      } else {
        delivery = await this.dependencies.send(claimed.command);
      }
    } catch (error) {
      return this.handleSendError(claimed, error, now);
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
      return "fenced";
    }
    // Latência dispatch → providerMessageId (T8): do início do send ao SENT
    // confirmado com fencing válido.
    observeSendPipelineLatencyMs(
      SEND_PIPELINE_STAGE.DISPATCH_TO_PROVIDER_ID,
      Date.now() - sendStartedAt
    );
    return "sent";
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
      const waitingForBaileysConnection =
        sendError.code === "BAILEYS_SOCKET_UNAVAILABLE";

      if (
        claimed.attemptCount >= MAX_SEND_ATTEMPTS &&
        !waitingForBaileysConnection
      ) {
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

      const delayMs = waitingForBaileysConnection
        ? 30_000
        : computeRetryDelayMs({
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
