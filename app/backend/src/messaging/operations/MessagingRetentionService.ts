import { Op } from "sequelize";
import MessageCommand from "../persistence/models/MessageCommand";
import MessagingInboxEvent from "../persistence/models/MessagingInboxEvent";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import WebhookDelivery from "../persistence/models/WebhookDelivery";
import MessagingCapacitySample from "../persistence/models/MessagingCapacitySample";

interface RetentionRepositories {
  commands: typeof MessageCommand;
  outbox: typeof MessagingOutboxEvent;
  inbox: typeof MessagingInboxEvent;
  deliveries: typeof WebhookDelivery;
  capacity?: typeof MessagingCapacitySample;
}

export interface RetentionResult {
  redacted: number;
  deleted: number;
  ranAt: string;
}

const repositories: RetentionRepositories = {
  commands: MessageCommand,
  outbox: MessagingOutboxEvent,
  inbox: MessagingInboxEvent,
  deliveries: WebhookDelivery,
  capacity: MessagingCapacitySample
};

export let lastRetentionResult: RetentionResult | null = null;
export let lastRetentionError: { message: string; failedAt: string } | null = null;

export const recordRetentionFailure = (error: unknown): void => {
  lastRetentionError = {
    message: error instanceof Error ? error.message : "Falha desconhecida",
    failedAt: new Date().toISOString()
  };
};

class MessagingRetentionService {
  constructor(
    private readonly models: RetentionRepositories = repositories,
    private readonly clock: () => Date = () => new Date()
  ) {}

  async purge(): Promise<RetentionResult> {
    const now = this.clock();
    const redactBefore = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const deleteBefore = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);

    const deletedCounts = await Promise.all([
      this.models.commands.destroy({
        where: {
          status: { [Op.in]: ["sent", "failed", "unknown"] },
          createdAt: { [Op.lt]: deleteBefore }
        }
      }),
      this.models.outbox.destroy({
        where: { status: "completed", createdAt: { [Op.lt]: deleteBefore } }
      }),
      this.models.inbox.destroy({
        where: { status: "processed", createdAt: { [Op.lt]: deleteBefore } }
      }),
      this.models.deliveries.destroy({
        where: {
          status: { [Op.in]: ["delivered", "dead_letter"] },
          createdAt: { [Op.lt]: deleteBefore }
        }
      }),
      ...(this.models.capacity
        ? [
            this.models.capacity.destroy({
              where: {
                createdAt: {
                  [Op.lt]: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
                }
              }
            })
          ]
        : [])
    ]);

    const redactedCounts = await Promise.all([
      this.models.commands.update(
        { requestPayload: { purged: true } },
        {
          where: {
            status: { [Op.in]: ["sent", "failed", "unknown"] },
            createdAt: { [Op.lt]: redactBefore }
          },
          silent: true
        }
      ),
      this.models.outbox.update(
        { payload: { purged: true } },
        {
          where: {
            status: "completed",
            createdAt: { [Op.lt]: redactBefore }
          },
          silent: true
        }
      ),
      this.models.inbox.update(
        { payload: { purged: true } },
        {
          where: {
            status: "processed",
            createdAt: { [Op.lt]: redactBefore }
          },
          silent: true
        }
      ),
      this.models.deliveries.update(
        { payload: { purged: true }, responseBody: null },
        {
          where: {
            status: { [Op.in]: ["delivered", "dead_letter"] },
            createdAt: { [Op.lt]: redactBefore }
          },
          silent: true
        }
      )
    ]);

    lastRetentionResult = {
      redacted: redactedCounts.reduce((sum, [count]) => sum + count, 0),
      deleted: deletedCounts.reduce((sum, count) => sum + count, 0),
      ranAt: now.toISOString()
    };
    lastRetentionError = null;
    return lastRetentionResult;
  }
}

export default MessagingRetentionService;
