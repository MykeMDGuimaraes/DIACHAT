import { Op } from "sequelize";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import WebhookDelivery from "../persistence/models/WebhookDelivery";

interface WebhookRecoveryDependencies {
  requeueDeliveries(now: Date): Promise<[number, unknown[]?]>;
  requeueEvents(now: Date): Promise<[number, unknown[]?]>;
}

const eventTypes = ["message.received", "message.sent", "message.status.updated", "ticket.created", "ticket.updated", "contact.updated"];

const defaults: WebhookRecoveryDependencies = {
  requeueDeliveries: now => WebhookDelivery.update(
    { status: "ready", leaseExpiresAt: null, availableAt: now },
    { where: { status: "processing", leaseExpiresAt: { [Op.lte]: now } } }
  ) as any,
  requeueEvents: now => MessagingOutboxEvent.update(
    { status: "ready", leaseExpiresAt: null, availableAt: now },
    { where: { eventType: { [Op.in]: eventTypes }, status: "processing", leaseExpiresAt: { [Op.lte]: now } } }
  ) as any
};

class WebhookRecoveryService {
  constructor(private readonly dependencies: WebhookRecoveryDependencies = defaults) {}

  async recover(now = new Date()): Promise<{ deliveries: number; events: number }> {
    const [deliveryResult, eventResult] = await Promise.all([
      this.dependencies.requeueDeliveries(now),
      this.dependencies.requeueEvents(now)
    ]);
    return { deliveries: deliveryResult[0], events: eventResult[0] };
  }
}

export default WebhookRecoveryService;
