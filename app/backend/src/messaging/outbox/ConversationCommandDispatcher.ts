import { randomUUID } from "crypto";
import { Op } from "sequelize";

import sequelize from "../../database";
import Ticket from "../../models/Ticket";
import TicketTraking from "../../models/TicketTraking";
import ConversationAutomationState from "../persistence/models/ConversationAutomationState";
import ConversationCommand from "../persistence/models/ConversationCommand";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";

interface ConversationCommandSource {
  id: string;
  companyId: number;
  conversationId: string;
  externalTicketId: string;
  automationEpoch: number;
  action: string;
  queueId?: string | null;
  userId?: string | null;
  attemptCount: number;
  requestPayload: {
    ticketId: number;
    contactId?: number | string;
    whatsappId?: number;
  };
}

interface ClaimedConversationCommand {
  eventId: string;
  leaseToken: string;
  command: ConversationCommandSource;
}

type ExecutionResult = "completed" | "fenced";

interface ConversationCommandDispatcherDependencies {
  claimNext(): Promise<ClaimedConversationCommand | null>;
  executeAndComplete(
    claim: ClaimedConversationCommand
  ): Promise<ExecutionResult>;
  retry(
    claim: ClaimedConversationCommand,
    availableAt: Date,
    errorCode: string
  ): Promise<void>;
  fail(claim: ClaimedConversationCommand, errorCode: string): Promise<void>;
  now(): Date;
}

export const buildConversationResultEvent = (
  command: ConversationCommandSource
):
  | {
      companyId: number;
      eventType: string;
      aggregateId: string;
      payload: Record<string, unknown>;
      status: string;
      attemptCount: number;
    }
  | undefined => {
  const eventType =
    command.action === "release_automation"
      ? "handoff.released"
      : ["pause_automation", "takeover"].includes(command.action)
      ? "handoff.paused"
      : undefined;
  if (!eventType) return undefined;
  return {
    companyId: command.companyId,
    eventType,
    aggregateId: command.conversationId,
    payload: {
      commandId: command.id,
      conversationId: command.conversationId,
      contactId:
        command.requestPayload.contactId === undefined
          ? undefined
          : String(command.requestPayload.contactId),
      whatsappId: command.requestPayload.whatsappId,
      externalTicketId: command.externalTicketId,
      automationEpoch: command.automationEpoch,
      actorType: "system",
      origin: "api"
    },
    status: "ready",
    attemptCount: 0
  };
};

export const buildConversationUpdatedEvent = (
  command: ConversationCommandSource
) => ({
  companyId: command.companyId,
  eventType: "conversation.updated",
  aggregateId: command.conversationId,
  payload: {
    commandId: command.id,
    conversationId: command.conversationId,
    contactId:
      command.requestPayload.contactId === undefined
        ? undefined
        : String(command.requestPayload.contactId),
    whatsappId: command.requestPayload.whatsappId,
    externalTicketId: command.externalTicketId,
    automationEpoch: command.automationEpoch,
    action: command.action,
    actorType: "system",
    origin: "api"
  },
  status: "ready",
  attemptCount: 0
});

const claimNext = () =>
  sequelize.transaction(async transaction => {
    const event = await MessagingOutboxEvent.findOne({
      where: {
        eventType: "conversation.command.requested",
        status: "ready",
        availableAt: { [Op.lte]: new Date() }
      },
      order: [["createdAt", "ASC"]],
      transaction,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true
    });
    if (!event) return null;
    const command = await ConversationCommand.findOne({
      where: { id: event.aggregateId, status: "queued" },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!command) {
      await event.update({ status: "completed" }, { transaction });
      return null;
    }
    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(Date.now() + 120_000);
    await command.update(
      {
        status: "processing",
        attemptCount: command.attemptCount + 1,
        leaseToken,
        leaseExpiresAt
      },
      { transaction }
    );
    await event.update(
      {
        status: "processing",
        attemptCount: event.attemptCount + 1,
        leaseToken,
        leaseExpiresAt
      },
      { transaction }
    );
    return {
      eventId: event.id,
      leaseToken,
      command: command.toJSON() as unknown as ConversationCommandSource
    };
  });

const applyCommandEffect = async (
  command: ConversationCommandSource,
  ticket: Ticket,
  state: ConversationAutomationState,
  transaction: any
) => {
  if (command.action === "finalize") {
    await ticket.update(
      {
        status: "closed",
        promptId: null,
        integrationId: null,
        useIntegration: false,
        typebotStatus: false,
        typebotSessionId: null
      },
      { transaction }
    );
    const tracking = await TicketTraking.findOne({
      where: { ticketId: ticket.id },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (tracking) {
      await tracking.update(
        {
          finishedAt: new Date(),
          whatsappId: ticket.whatsappId,
          userId: ticket.userId,
          rated: false
        },
        { transaction }
      );
    }
    return;
  }

  const queueId = Number(command.queueId);
  if (!Number.isInteger(queueId) || queueId < 1) {
    throw new Error("INVALID_HANDOFF_QUEUE");
  }
  if (command.action === "release_automation") {
    if (state.state !== "release_pending") {
      throw new Error("STALE_AUTOMATION_EPOCH");
    }
    await ticket.update(
      { queueId, userId: null, status: "pending", chatbot: false },
      { transaction }
    );
    await state.update({ state: "automation" }, { transaction });
    return;
  }
  if (state.state !== "pause_pending") {
    throw new Error("STALE_AUTOMATION_EPOCH");
  }
  const userId = command.userId ? Number(command.userId) : null;
  await ticket.update(
    {
      queueId,
      userId,
      status: userId ? "open" : "pending",
      chatbot: false,
      useIntegration: false
    },
    { transaction }
  );
  await state.update({ state: "human_controlled" }, { transaction });
};

export const executeConversationCommandAndComplete = (
  claim: ClaimedConversationCommand
) =>
  sequelize.transaction(async transaction => {
    // Global lock order for conversation commands:
    // Ticket -> automation state -> outbox event -> command.
    // Creation follows Ticket -> state, while claim/recovery follows event ->
    // command, so no worker ever acquires the same rows in reverse order.
    const ticket = await Ticket.findOne({
      where: {
        id: claim.command.requestPayload.ticketId,
        companyId: claim.command.companyId,
        uuid: claim.command.conversationId
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const state = await ConversationAutomationState.findOne({
      where: {
        companyId: claim.command.companyId,
        externalTicketId: claim.command.externalTicketId
      },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const event = await MessagingOutboxEvent.findOne({
      where: { id: claim.eventId },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const persistentCommand = await ConversationCommand.findOne({
      where: { id: claim.command.id },
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    const leaseValid =
      persistentCommand?.status === "processing" &&
      persistentCommand.leaseToken === claim.leaseToken &&
      persistentCommand.leaseExpiresAt?.getTime() > Date.now() &&
      event?.status === "processing" &&
      event.leaseToken === claim.leaseToken;
    if (!leaseValid) return "fenced" as const;
    if (
      !state ||
      !ticket ||
      state.automationEpoch !== claim.command.automationEpoch
    ) {
      throw new Error("STALE_AUTOMATION_EPOCH");
    }

    await applyCommandEffect(claim.command, ticket, state, transaction);
    await persistentCommand.update(
      {
        status: "completed",
        completedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null
      },
      { transaction }
    );
    await event.update(
      {
        status: "completed",
        leaseToken: null,
        leaseExpiresAt: null
      },
      { transaction }
    );
    const resultEvent = buildConversationResultEvent(claim.command);
    if (resultEvent) {
      await MessagingOutboxEvent.create(resultEvent as any, { transaction });
    }
    await MessagingOutboxEvent.create(
      buildConversationUpdatedEvent(claim.command) as any,
      { transaction }
    );
    return "completed" as const;
  });

export const retryConversationCommand = (
  claim: ClaimedConversationCommand,
  availableAt: Date,
  errorCode: string
) =>
  sequelize.transaction(async transaction => {
    const [eventUpdated] = await MessagingOutboxEvent.update(
      {
        status: "ready",
        availableAt,
        lastError: errorCode,
        leaseToken: null,
        leaseExpiresAt: null
      },
      {
        where: {
          id: claim.eventId,
          status: "processing",
          leaseToken: claim.leaseToken
        },
        transaction
      }
    );
    if (eventUpdated !== 1) return;
    const [commandUpdated] = await ConversationCommand.update(
      {
        status: "queued",
        errorCode,
        errorDetails: null,
        leaseToken: null,
        leaseExpiresAt: null
      },
      {
        where: {
          id: claim.command.id,
          status: "processing",
          leaseToken: claim.leaseToken
        },
        transaction
      }
    );
    if (commandUpdated !== 1) throw new Error("LEASE_PAIR_MISMATCH");
  });

export const failConversationCommand = (
  claim: ClaimedConversationCommand,
  errorCode: string
) =>
  sequelize.transaction(async transaction => {
    const [eventUpdated] = await MessagingOutboxEvent.update(
      {
        status: "dead_letter",
        lastError: errorCode,
        leaseToken: null,
        leaseExpiresAt: null
      },
      {
        where: {
          id: claim.eventId,
          status: "processing",
          leaseToken: claim.leaseToken
        },
        transaction
      }
    );
    if (eventUpdated !== 1) return;
    const [commandUpdated] = await ConversationCommand.update(
      {
        status: "failed",
        errorCode,
        errorDetails: null,
        completedAt: new Date(),
        leaseToken: null,
        leaseExpiresAt: null
      },
      {
        where: {
          id: claim.command.id,
          status: "processing",
          leaseToken: claim.leaseToken
        },
        transaction
      }
    );
    if (commandUpdated !== 1) throw new Error("LEASE_PAIR_MISMATCH");
  });

const defaultDependencies: ConversationCommandDispatcherDependencies = {
  claimNext,
  executeAndComplete: executeConversationCommandAndComplete,
  retry: retryConversationCommand,
  fail: failConversationCommand,
  now: () => new Date()
};

const permanentErrors = new Set([
  "STALE_AUTOMATION_EPOCH",
  "INVALID_HANDOFF_QUEUE"
]);
const retryScheduleSeconds = [5, 15, 30, 60, 120];

class ConversationCommandDispatcher {
  // Parameter property keeps the transactional worker replaceable in tests.
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly dependencies: ConversationCommandDispatcherDependencies = defaultDependencies
  ) {}

  async dispatchOne(): Promise<{
    status: "idle" | "completed" | "retry" | "failed" | "fenced";
  }> {
    const claim = await this.dependencies.claimNext();
    if (!claim) return { status: "idle" };
    try {
      const result = await this.dependencies.executeAndComplete(claim);
      return { status: result };
    } catch (error) {
      const errorCode =
        error instanceof Error && permanentErrors.has(error.message)
          ? error.message
          : "CONVERSATION_COMMAND_RETRYABLE";
      if (
        !permanentErrors.has(errorCode) &&
        Number(claim.command.attemptCount) < 6
      ) {
        const delay =
          retryScheduleSeconds[
            Math.min(
              Math.max(Number(claim.command.attemptCount) - 1, 0),
              retryScheduleSeconds.length - 1
            )
          ];
        await this.dependencies.retry(
          claim,
          new Date(this.dependencies.now().getTime() + delay * 1000),
          errorCode
        );
        return { status: "retry" };
      }
      await this.dependencies.fail(claim, errorCode);
      return { status: "failed" };
    }
  }
}

export default ConversationCommandDispatcher;
