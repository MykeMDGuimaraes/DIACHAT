import { Op, Transaction } from "sequelize";
import sequelize from "../../database";
import {
  MESSAGE_COMMAND_ERROR_CODE,
  MESSAGE_COMMAND_STATUS,
  OUTBOX_EVENT_STATUS,
  OUTBOX_EVENT_TYPE
} from "../domain/MessagingStates";
import MessageCommand from "../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import { buildMessageUnknownEvent } from "./MessageCommandDispatcher";
import { logger } from "../../utils/logger";

const TERMINAL_COMMAND_STATUSES = [
  MESSAGE_COMMAND_STATUS.SENT,
  MESSAGE_COMMAND_STATUS.DELIVERED,
  MESSAGE_COMMAND_STATUS.READ,
  MESSAGE_COMMAND_STATUS.FAILED,
  MESSAGE_COMMAND_STATUS.UNKNOWN
];

/**
 * Recovery transacional do par comando/evento outbound.
 *
 * Regras:
 * - lease expirado com comando `sending` => comando `unknown`, evento `completed`
 *   (nunca retry automatico de resultado ambiguo) + evento publico de status;
 * - evento `processing` expirado com comando ainda `queued` => evento reaberto (`ready`);
 * - comando terminal com evento `processing` orfao => evento `completed`;
 * - o token de lease e sempre limpo, entao um worker atrasado com token antigo
 *   nao consegue finalizar nem publicar `message.sent` (fencing).
 */
class OutboundPairRecoveryService {
  async recover(now = new Date()): Promise<{ recovered: number }> {
    let recovered = 0;

    const expiredEvents = await MessagingOutboxEvent.findAll({
      attributes: ["id", "aggregateId"],
      where: {
        eventType: OUTBOX_EVENT_TYPE.MESSAGE_DISPATCH_REQUESTED,
        status: OUTBOX_EVENT_STATUS.PROCESSING,
        leaseExpiresAt: { [Op.lte]: now }
      }
    });

    for (const expired of expiredEvents) {
      recovered += await this.recoverPair(expired.id, expired.aggregateId, now);
    }

    // Comandos sending expirados cujo evento ja nao esta em processing
    const strandedCommands = await MessageCommand.findAll({
      attributes: ["id"],
      where: {
        status: MESSAGE_COMMAND_STATUS.SENDING,
        leaseExpiresAt: { [Op.lte]: now }
      }
    });
    for (const stranded of strandedCommands) {
      recovered += await this.recoverPair(null, stranded.id, now);
    }

    return { recovered };
  }

  private async recoverPair(
    eventId: string | null,
    commandId: string,
    now: Date
  ): Promise<number> {
    return sequelize.transaction(async transaction => {
      const command = await MessageCommand.findOne({
        where: { id: commandId },
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
      });

      const event = await this.lockEvent(eventId, commandId, transaction);

      if (!command) {
        if (event) {
          await event.update(
            {
              status: OUTBOX_EVENT_STATUS.COMPLETED,
              leaseExpiresAt: null,
              leaseToken: null
            },
            { transaction }
          );
          return 1;
        }
        return 0;
      }

      if (
        command.status === MESSAGE_COMMAND_STATUS.SENDING &&
        command.leaseExpiresAt &&
        command.leaseExpiresAt <= now
      ) {
        await command.update(
          {
            status: MESSAGE_COMMAND_STATUS.UNKNOWN,
            errorCode: MESSAGE_COMMAND_ERROR_CODE.SEND_OUTCOME_UNKNOWN,
            leaseExpiresAt: null,
            leaseToken: null,
            completedAt: now
          },
          { transaction }
        );
        if (event) {
          await event.update(
            {
              status: OUTBOX_EVENT_STATUS.COMPLETED,
              lastError: "lease expirado durante envio",
              leaseExpiresAt: null,
              leaseToken: null
            },
            { transaction }
          );
        }
        await MessagingOutboxEvent.create(
          buildMessageUnknownEvent(
            command.toJSON() as any,
            "lease expirado durante envio"
          ) as any,
          { transaction }
        );
        logger.warn(
          { commandId: command.id, eventId: event?.id || null },
          "messaging: lease expirado; comando marcado como unknown pelo recovery"
        );
        return 1;
      }

      if (!event) {
        return 0;
      }

      if (command.status === MESSAGE_COMMAND_STATUS.QUEUED) {
        await event.update(
          {
            status: OUTBOX_EVENT_STATUS.READY,
            availableAt: now,
            leaseExpiresAt: null,
            leaseToken: null
          },
          { transaction }
        );
        return 1;
      }

      if (TERMINAL_COMMAND_STATUSES.includes(command.status as any)) {
        await event.update(
          {
            status: OUTBOX_EVENT_STATUS.COMPLETED,
            leaseExpiresAt: null,
            leaseToken: null
          },
          { transaction }
        );
        return 1;
      }

      return 0;
    });
  }

  private async lockEvent(
    eventId: string | null,
    commandId: string,
    transaction: Transaction
  ): Promise<MessagingOutboxEvent | null> {
    if (eventId) {
      return MessagingOutboxEvent.findOne({
        where: { id: eventId, status: OUTBOX_EVENT_STATUS.PROCESSING },
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
      });
    }
    return MessagingOutboxEvent.findOne({
      where: {
        eventType: OUTBOX_EVENT_TYPE.MESSAGE_DISPATCH_REQUESTED,
        aggregateId: commandId,
        status: OUTBOX_EVENT_STATUS.PROCESSING
      },
      transaction,
      lock: transaction.LOCK.UPDATE,
      skipLocked: true
    });
  }
}

export default OutboundPairRecoveryService;
