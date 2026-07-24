import { Op } from "sequelize";
import MessageCommand from "../persistence/models/MessageCommand";

interface MessageCommandRecoveryDependencies {
  findExpiredSendingCommands: (now: Date) => Promise<Array<{ id: string }>>;
  markUnknown: (id: string, now: Date) => Promise<unknown>;
}

const defaultDependencies: MessageCommandRecoveryDependencies = {
  findExpiredSendingCommands: now =>
    MessageCommand.findAll({
      attributes: ["id"],
      where: {
        status: "sending",
        leaseExpiresAt: { [Op.lte]: now }
      }
    }),
  markUnknown: (id, now) =>
    MessageCommand.update(
      {
        status: "unknown",
        errorCode: "SEND_OUTCOME_UNKNOWN",
        leaseExpiresAt: null,
        completedAt: now
      },
      {
        where: {
          id,
          status: "sending",
          leaseExpiresAt: { [Op.lte]: now }
        }
      }
    )
};

class MessageCommandRecoveryService {
  constructor(private readonly dependencies = defaultDependencies) {}

  async recover(now = new Date()): Promise<{ recovered: number }> {
    const commands = await this.dependencies.findExpiredSendingCommands(now);

    for (const command of commands) {
      await this.dependencies.markUnknown(command.id, now);
    }

    return { recovered: commands.length };
  }
}

export default MessageCommandRecoveryService;
