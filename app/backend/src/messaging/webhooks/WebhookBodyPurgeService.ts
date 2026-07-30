import { Op } from "sequelize";

import WebhookDelivery from "../persistence/models/WebhookDelivery";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import { recordWhatsAppMirrorMetric } from "../operations/WhatsAppMirrorMetrics";

interface WebhookBodyPurgeDependencies {
  purgeExpired(
    values: Record<string, unknown>,
    options: Record<string, unknown>
  ): Promise<[number, unknown[]?]>;
  purgeExpiredOutbox(
    values: Record<string, unknown>,
    options: Record<string, unknown>
  ): Promise<[number, unknown[]?]>;
}

const defaults: WebhookBodyPurgeDependencies = {
  purgeExpired: (values, options) =>
    WebhookDelivery.update(values, options as any) as any,
  purgeExpiredOutbox: (values, options) =>
    MessagingOutboxEvent.update(values, options as any) as any
};

class WebhookBodyPurgeService {
  private readonly dependencies: WebhookBodyPurgeDependencies;

  constructor(dependencies: Partial<WebhookBodyPurgeDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async purge(now = new Date()): Promise<{ purged: number }> {
    const values = {
      bodyCiphertext: null,
      bodyKeyVersion: null,
      bodyExpiresAt: null,
      bodyPurgedAt: now
    };
    const options = {
      where: {
        bodyCiphertext: { [Op.ne]: null },
        bodyExpiresAt: { [Op.lte]: now }
      },
      silent: true
    };
    const [[deliveries], [outbox]] = await Promise.all([
      this.dependencies.purgeExpired(values, options),
      this.dependencies.purgeExpiredOutbox(values, options)
    ]);
    const purged = deliveries + outbox;
    if (purged > 0) recordWhatsAppMirrorMetric("purgedBody", purged);
    return { purged };
  }
}

export default WebhookBodyPurgeService;
