import { Op } from "sequelize";
import sequelize from "../../database";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import WebhookDelivery from "../persistence/models/WebhookDelivery";
import WebhookSubscription from "../persistence/models/WebhookSubscription";

interface DomainEvent {
  id: string;
  companyId: number;
  eventType: string;
  aggregateId: string;
  payload: Record<string, any>;
}

interface WebhookFanoutDependencies {
  transaction<T>(callback: (transaction: any) => Promise<T>): Promise<T>;
  claimEvent(): Promise<DomainEvent | null>;
  findSubscriptions(companyId: number, transaction: any): Promise<any[]>;
  createDelivery(
    data: Record<string, unknown>,
    transaction: any
  ): Promise<unknown>;
  completeEvent(id: string, transaction: any): Promise<unknown>;
}

const deliverableEvents = [
  "message.received",
  "message.sent",
  "message.failed",
  "message.status.updated",
  "ticket.created",
  "ticket.updated",
  "contact.updated"
];

const defaultDependencies: WebhookFanoutDependencies = {
  transaction: callback => sequelize.transaction(callback),
  claimEvent: () =>
    sequelize.transaction(async transaction => {
      const event = await MessagingOutboxEvent.findOne({
        where: {
          eventType: { [Op.in]: deliverableEvents },
          status: "ready",
          availableAt: { [Op.lte]: new Date() }
        },
        order: [["createdAt", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE,
        skipLocked: true
      });
      if (!event) return null;
      await event.update(
        { status: "processing", leaseExpiresAt: new Date(Date.now() + 120000) },
        { transaction }
      );
      return event.toJSON() as DomainEvent;
    }),
  findSubscriptions: (companyId, transaction) =>
    WebhookSubscription.findAll({
      where: { companyId, enabled: true, pausedAt: null },
      transaction
    }),
  createDelivery: (data, transaction) =>
    WebhookDelivery.create(data as any, { transaction }),
  completeEvent: (id, transaction) =>
    MessagingOutboxEvent.update(
      { status: "completed", leaseExpiresAt: null },
      { where: { id, status: "processing" }, transaction }
    )
};

const matches = (subscription: any, event: DomainEvent): boolean => {
  if (!subscription.events?.includes(event.eventType)) return false;
  if (event.payload.origin === "api" && !subscription.includeApiOrigin)
    return false;
  if (
    subscription.connectionIds?.length &&
    !subscription.connectionIds.includes(event.payload.whatsappId)
  )
    return false;
  if (
    subscription.messageKinds?.length &&
    !subscription.messageKinds.includes(event.payload.kind)
  )
    return false;
  return true;
};

class WebhookFanoutService {
  constructor(
    private readonly dependencies: WebhookFanoutDependencies = defaultDependencies
  ) {}

  async fanoutOne(): Promise<{
    status: "idle" | "created";
    deliveries: number;
  }> {
    const event = await this.dependencies.claimEvent();
    if (!event) return { status: "idle", deliveries: 0 };
    const deliveries = await this.dependencies.transaction(
      async transaction => {
        const subscriptions = await this.dependencies.findSubscriptions(
          event.companyId,
          transaction
        );
        let created = 0;
        for (const subscription of subscriptions.filter(item =>
          matches(item, event)
        )) {
          await this.dependencies.createDelivery(
            {
              subscriptionId: subscription.id,
              companyId: event.companyId,
              eventId: event.id,
              eventType: event.eventType,
              urlSnapshot: subscription.url,
              methodSnapshot: subscription.method || "POST",
              secretCiphertextSnapshot: subscription.secretCiphertext,
              keyVersion: subscription.keyVersion,
              payload: {
                id: event.id,
                type: event.eventType,
                createdAt: new Date().toISOString(),
                data: event.payload
              },
              status: "ready",
              attemptCount: 0,
              availableAt: new Date()
            },
            transaction
          );
          created += 1;
        }
        await this.dependencies.completeEvent(event.id, transaction);
        return created;
      }
    );
    return { status: "created", deliveries };
  }
}

export default WebhookFanoutService;
