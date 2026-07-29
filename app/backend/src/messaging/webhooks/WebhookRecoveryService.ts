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

export const WEBHOOK_RECOVERABLE_EVENT_TYPES = [
  "message.received",
  "message.reaction",
  "message.edited",
  "message.deleted",
  "chat.updated",
  "connection.updated",
  "message.sent",
  "message.failed",
  "message.status.updated",
  "button.clicked",
  "handoff.paused",
  "handoff.released",
  "conversation.created",
  "conversation.updated",
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
        leaseToken: null,
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
        leaseToken: null,
        availableAt: now
      },
      {
        where: {
          eventType: { [Op.in]: WEBHOOK_RECOVERABLE_EVENT_TYPES },
          status: OUTBOX_EVENT_STATUS.PROCESSING,
          leaseExpiresAt: { [Op.lte]: now }
        }
      }
    ) as any
};

class WebhookRecoveryService {
  // Parameter property keeps recovery repositories replaceable in tests.
  // eslint-disable-next-line no-useless-constructor
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
