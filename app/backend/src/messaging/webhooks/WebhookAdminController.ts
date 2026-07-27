import { Request, Response } from "express";
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

const subscriptionResponseFields = [
  "id",
  "companyId",
  "name",
  "url",
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

const serializeDelivery = (value: any): Record<string, unknown> =>
  selectResponseFields(value, deliveryResponseFields);

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
    if (!subscription) throw new AppError("Webhook não encontrado", 404);
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
  retryDelivery: async (companyId, id) => {
    const delivery = await WebhookDelivery.findOne({
      where: { id, companyId }
    });
    if (!delivery) throw new AppError("Entrega de webhook não encontrada", 404);
    if (delivery.status !== "dead_letter")
      throw new AppError("A entrega não está em dead-letter", 409);
    await delivery.update({
      status: "ready",
      attemptCount: 0,
      availableAt: new Date(),
      leaseExpiresAt: null,
      lastError: null
    });
  }
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
