import { Op } from "sequelize";
import {
  OUTBOX_EVENT_STATUS,
  WEBHOOK_DELIVERY_STATUS
} from "../domain/MessagingStates";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import WebhookDelivery from "../persistence/models/WebhookDelivery";

interface WebhookRecoveryDependencies {
  requeueDeliveries(now: Date): Promise<[number, unknown[]?]>;
  requeueEvents(now: Date): Promise<[number, unknown[]?]>;
}

const eventTypes = [
  "message.received",
  "message.sent",
  "message.status.updated",
  "ticket.created",
  "ticket.updated",
  "contact.updated"
];

const defaults: WebhookRecoveryDependencies = {
  requeueDeliveries: now =>
    WebhookDelivery.update(
      {
        status: WEBHOOK_DELIVERY_STATUS.READY,
        leaseExpiresAt: null,
        availableAt: now
      },
      {
        where: {
          status: WEBHOOK_DELIVERY_STATUS.PROCESSING,
          leaseExpiresAt: { [Op.lte]: now }
        }
      }
    ) as any,
  requeueEvents: now =>
    MessagingOutboxEvent.update(
      {
        status: OUTBOX_EVENT_STATUS.READY,
        leaseExpiresAt: null,
        availableAt: now
      },
      {
        where: {
          eventType: { [Op.in]: eventTypes },
          status: OUTBOX_EVENT_STATUS.PROCESSING,
          leaseExpiresAt: { [Op.lte]: now }
        }
      }
    ) as any
};

class WebhookRecoveryService {
  constructor(
    private readonly dependencies: WebhookRecoveryDependencies = defaults
  ) {}

  async recover(
    now = new Date()
  ): Promise<{ deliveries: number; events: number }> {
    const [deliveryResult, eventResult] = await Promise.all([
      this.dependencies.requeueDeliveries(now),
      this.dependencies.requeueEvents(now)
    ]);
    return { deliveries: deliveryResult[0], events: eventResult[0] };
  }
}

export default WebhookRecoveryService;
