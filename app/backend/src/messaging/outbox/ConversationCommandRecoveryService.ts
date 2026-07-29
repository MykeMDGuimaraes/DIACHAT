import { Op } from "sequelize";

import sequelize from "../../database";
import ConversationCommand from "../persistence/models/ConversationCommand";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";

interface Dependencies {
  recoverExpired(now: Date): Promise<number>;
}

const defaultDependencies: Dependencies = {
  recoverExpired: now =>
    sequelize.transaction(async transaction => {
      const events = await MessagingOutboxEvent.findAll({
        where: {
          eventType: "conversation.command.requested",
          status: "processing",
          leaseExpiresAt: { [Op.lte]: now }
        },
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
      });
      let recovered = 0;
      for (const event of events) {
        const command = await ConversationCommand.findOne({
          where: {
            id: event.aggregateId,
            status: "processing",
            leaseToken: event.leaseToken
          },
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        if (!command) {
          await event.update(
            {
              status: "completed",
              leaseToken: null,
              leaseExpiresAt: null
            },
            { transaction }
          );
        } else {
          await command.update(
            {
              status: "queued",
              leaseToken: null,
              leaseExpiresAt: null
            },
            { transaction }
          );
          await event.update(
            {
              status: "ready",
              availableAt: now,
              leaseToken: null,
              leaseExpiresAt: null
            },
            { transaction }
          );
          recovered += 1;
        }
      }
      return recovered;
    })
};

class ConversationCommandRecoveryService {
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly dependencies: Dependencies = defaultDependencies
  ) {}

  async recover(now = new Date()): Promise<{ recovered: number }> {
    return { recovered: await this.dependencies.recoverExpired(now) };
  }
}

export default ConversationCommandRecoveryService;
