import { Op } from "sequelize";

import WebhookDelivery from "../persistence/models/WebhookDelivery";

interface WebhookBodyPurgeDependencies {
  purgeExpired(
    values: Record<string, unknown>,
    options: Record<string, unknown>
  ): Promise<[number, unknown[]?]>;
}

const defaults: WebhookBodyPurgeDependencies = {
  purgeExpired: (values, options) =>
    WebhookDelivery.update(values, options as any) as any
};

class WebhookBodyPurgeService {
  private readonly dependencies: WebhookBodyPurgeDependencies;

  constructor(dependencies: Partial<WebhookBodyPurgeDependencies> = {}) {
    this.dependencies = { ...defaults, ...dependencies };
  }

  async purge(now = new Date()): Promise<{ purged: number }> {
    const [purged] = await this.dependencies.purgeExpired(
      {
        bodyCiphertext: null,
        bodyKeyVersion: null,
        bodyExpiresAt: null,
        bodyPurgedAt: now
      },
      {
        where: {
          bodyCiphertext: { [Op.ne]: null },
          bodyExpiresAt: { [Op.lte]: now }
        },
        silent: true
      }
    );
    return { purged };
  }
}

export default WebhookBodyPurgeService;
