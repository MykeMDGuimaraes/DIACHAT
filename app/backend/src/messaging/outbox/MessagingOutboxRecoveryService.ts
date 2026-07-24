import { Op } from "sequelize";
import MessageCommand from "../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";

interface MessagingOutboxRecoveryDependencies {
  findExpiredProcessingEvents: (now: Date) => Promise<Array<{ id: string; aggregateId: string }>>;
  findCommandStatus: (commandId: string) => Promise<string | null>;
  complete: (eventId: string) => Promise<unknown>;
  resetReady: (eventId: string) => Promise<unknown>;
}

const defaultDependencies: MessagingOutboxRecoveryDependencies = {
  findExpiredProcessingEvents: now =>
    MessagingOutboxEvent.findAll({
      attributes: ["id", "aggregateId"],
      where: {
        eventType: "message.dispatch.requested",
        status: "processing",
        leaseExpiresAt: { [Op.lte]: now }
      }
    }),
  findCommandStatus: async commandId => {
    const command = await MessageCommand.findByPk(commandId, { attributes: ["status"] });
    return command?.status || null;
  },
  complete: eventId =>
    MessagingOutboxEvent.update(
      { status: "completed", leaseExpiresAt: null },
      { where: { id: eventId, status: "processing" } }
    ),
  resetReady: eventId =>
    MessagingOutboxEvent.update(
      { status: "ready", leaseExpiresAt: null, availableAt: new Date() },
      { where: { id: eventId, status: "processing" } }
    )
};

class MessagingOutboxRecoveryService {
  constructor(private readonly dependencies = defaultDependencies) {}

  async recover(now = new Date()): Promise<{ completed: number; requeued: number }> {
    const events = await this.dependencies.findExpiredProcessingEvents(now);
    let completed = 0;
    let requeued = 0;

    for (const event of events) {
      const commandStatus = await this.dependencies.findCommandStatus(event.aggregateId);
      if (commandStatus === "queued") {
        await this.dependencies.resetReady(event.id);
        requeued += 1;
      } else {
        await this.dependencies.complete(event.id);
        completed += 1;
      }
    }

    return { completed, requeued };
  }
}

export default MessagingOutboxRecoveryService;
