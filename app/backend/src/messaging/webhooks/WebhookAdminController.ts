import { Request, Response } from "express";
import { Op } from "sequelize";
import sequelize from "../../database";
import AppError from "../../errors/AppError";
import WebhookDelivery from "../persistence/models/WebhookDelivery";
import WebhookSubscription from "../persistence/models/WebhookSubscription";
import {
  createWebhookSubscription,
  updateWebhookSubscription
} from "./WebhookSubscriptionService";

interface WebhookAdminDependencies {
  create(input: any): Promise<any>;
  list(companyId: number): Promise<any[]>;
  update(input: any): Promise<any>;
  remove(companyId: number, id: string): Promise<void>;
  listDeliveries(companyId: number, query: Record<string, any>): Promise<any[]>;
  retryDelivery(companyId: number, id: string): Promise<void>;
}

interface RetryWebhookDeliveryDependencies {
  transaction<T>(callback: (transaction: any) => Promise<T>): Promise<T>;
  update(
    values: Record<string, unknown>,
    options: Record<string, unknown>
  ): Promise<unknown>;
  findOne(options: Record<string, unknown>): Promise<any | null>;
}

const subscriptionResponseFields = [
  "id",
  "companyId",
  "name",
  "url",
  "method",
  "enabled",
  "events",
  "connectionIds",
  "messageKinds",
  "includeApiOrigin",
  "consecutiveFailures",
  "pausedAt",
  "lastSuccessAt",
  "lastFailureAt",
  "createdAt",
  "updatedAt"
] as const;

const deliveryResponseFields = [
  "id",
  "subscriptionId",
  "companyId",
  "eventId",
  "eventType",
  "urlSnapshot",
  "methodSnapshot",
  "payload",
  "status",
  "attemptCount",
  "availableAt",
  "leaseExpiresAt",
  "responseStatus",
  "lastError",
  "deliveredAt",
  "createdAt",
  "updatedAt"
] as const;

const correlationFields = [
  "messageId",
  "whatsappId",
  "conversationId",
  "contactId",
  "externalTicketId",
  "automationEpoch"
] as const;

const toPlainRecord = (value: any): Record<string, unknown> => {
  if (value && typeof value.toJSON === "function") {
    return value.toJSON();
  }
  return value || {};
};

const selectResponseFields = (
  value: any,
  fields: readonly string[]
): Record<string, unknown> => {
  const plain = toPlainRecord(value);
  return fields.reduce<Record<string, unknown>>((result, field) => {
    if (plain[field] !== undefined) result[field] = plain[field];
    return result;
  }, {});
};

const correlationOnlyPayload = (value: unknown): Record<string, unknown> => {
  const payload =
    value && typeof value === "object"
      ? (value as Record<string, any>)
      : {};
  const legacyData =
    payload.data && typeof payload.data === "object" ? payload.data : {};
  return correlationFields.reduce<Record<string, unknown>>((result, field) => {
    const correlation = payload[field] ?? legacyData[field];
    if (correlation !== undefined) result[field] = correlation;
    return result;
  }, {});
};

const serializeSubscription = (value: any): Record<string, unknown> =>
  selectResponseFields(value, subscriptionResponseFields);

const serializeSubscriptionMutation = (value: any): Record<string, unknown> => {
  const result = serializeSubscription(value);
  const plain = toPlainRecord(value);
  if (plain.signingSecret !== undefined) {
    result.signingSecret = plain.signingSecret;
  }
  return result;
};

const serializeDelivery = (value: any): Record<string, unknown> => {
  const result = selectResponseFields(value, deliveryResponseFields);
  if (result.payload !== undefined) {
    result.payload = correlationOnlyPayload(result.payload);
  }
  return result;
};

export const retryWebhookDelivery = async (
  companyId: number,
  id: string,
  now = new Date(),
  dependencies: RetryWebhookDeliveryDependencies = {
    transaction: callback => sequelize.transaction(callback),
    update: (values, options) =>
      WebhookDelivery.update(values as any, options as any),
    findOne: options => WebhookDelivery.findOne(options as any)
  }
): Promise<void> =>
  dependencies.transaction(async transaction => {
    const updateResult = await dependencies.update(
      {
        status: "ready",
        attemptCount: 0,
        availableAt: now,
        leaseExpiresAt: null,
        leaseToken: null,
        lastError: null,
        bodyExpiresAt: null
      },
      {
        where: {
          companyId,
          id,
          status: "dead_letter",
          bodyCiphertext: { [Op.ne]: null },
          bodyPurgedAt: null,
          bodyExpiresAt: { [Op.gt]: now }
        },
        transaction
      }
    );
    const affected = Array.isArray(updateResult)
      ? Number(updateResult[0])
      : Number(updateResult);
    if (affected > 0) return;

    const delivery = await dependencies.findOne({
      where: { id, companyId },
      attributes: [
        "status",
        "bodyCiphertext",
        "bodyPurgedAt",
        "bodyExpiresAt",
        "leaseToken"
      ],
      transaction
    });
    if (!delivery) throw new AppError("Webhook delivery not found", 404);
    if (delivery.status !== "dead_letter") {
      throw new AppError("Webhook delivery is not dead-lettered", 409);
    }
    const expired =
      !delivery.bodyExpiresAt ||
      new Date(delivery.bodyExpiresAt).getTime() <= now.getTime();
    if (!delivery.bodyCiphertext || delivery.bodyPurgedAt || expired) {
      throw new AppError("Webhook delivery body expired", 410);
    }
    throw new AppError("Webhook delivery changed concurrently", 409);
  });

const defaults: WebhookAdminDependencies = {
  create: createWebhookSubscription,
  list: companyId =>
    WebhookSubscription.findAll({
      where: { companyId },
      attributes: { exclude: ["secretCiphertext", "keyVersion"] },
      order: [["createdAt", "DESC"]]
    }),
  update: updateWebhookSubscription,
  remove: async (companyId, id) => {
    const subscription = await WebhookSubscription.findOne({
      where: { id, companyId }
    });
    if (!subscription) throw new AppError("Webhook not found", 404);
    await subscription.destroy();
  },
  listDeliveries: (companyId, query) => {
    const where: Record<string, unknown> = { companyId };
    if (query.subscriptionId) where.subscriptionId = query.subscriptionId;
    if (query.status) where.status = query.status;
    return WebhookDelivery.findAll({
      where,
      attributes: [...deliveryResponseFields],
      order: [["createdAt", "DESC"]],
      limit: 100
    });
  },
  retryDelivery: retryWebhookDelivery
};

export const createWebhookAdminHandlers = (
  dependencies: WebhookAdminDependencies = defaults
) => ({
  create: async (req: Request, res: Response): Promise<Response> => {
    const result = await dependencies.create({
      ...req.body,
      companyId: req.user.companyId
    });
    return res.status(201).json(serializeSubscriptionMutation(result));
  },
  list: async (req: Request, res: Response): Promise<Response> =>
    res.json(
      (await dependencies.list(req.user.companyId)).map(serializeSubscription)
    ),
  update: async (req: Request, res: Response): Promise<Response> =>
    res.json(
      serializeSubscriptionMutation(
        await dependencies.update({
          ...req.body,
          companyId: req.user.companyId,
          id: req.params.subscriptionId
        })
      )
    ),
  remove: async (req: Request, res: Response): Promise<Response> => {
    await dependencies.remove(req.user.companyId, req.params.subscriptionId);
    return res.sendStatus(204);
  },
  listDeliveries: async (req: Request, res: Response): Promise<Response> =>
    res.json(
      (
        await dependencies.listDeliveries(req.user.companyId, req.query as any)
      ).map(serializeDelivery)
    ),
  retryDelivery: async (req: Request, res: Response): Promise<Response> => {
    await dependencies.retryDelivery(req.user.companyId, req.params.deliveryId);
    return res.sendStatus(202);
  }
});

export const webhookAdminHandlers = createWebhookAdminHandlers();
