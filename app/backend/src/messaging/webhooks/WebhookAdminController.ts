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

const defaults: WebhookAdminDependencies = {
  create: createWebhookSubscription,
  list: companyId =>
    WebhookSubscription.findAll({
      where: { companyId },
      attributes: { exclude: ["secretCiphertext"] },
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
    return res.status(201).json(result);
  },
  list: async (req: Request, res: Response): Promise<Response> =>
    res.json(await dependencies.list(req.user.companyId)),
  update: async (req: Request, res: Response): Promise<Response> =>
    res.json(
      await dependencies.update({
        ...req.body,
        companyId: req.user.companyId,
        id: req.params.subscriptionId
      })
    ),
  remove: async (req: Request, res: Response): Promise<Response> => {
    await dependencies.remove(req.user.companyId, req.params.subscriptionId);
    return res.sendStatus(204);
  },
  listDeliveries: async (req: Request, res: Response): Promise<Response> =>
    res.json(
      await dependencies.listDeliveries(req.user.companyId, req.query as any)
    ),
  retryDelivery: async (req: Request, res: Response): Promise<Response> => {
    await dependencies.retryDelivery(req.user.companyId, req.params.deliveryId);
    return res.sendStatus(202);
  }
});

export const webhookAdminHandlers = createWebhookAdminHandlers();
