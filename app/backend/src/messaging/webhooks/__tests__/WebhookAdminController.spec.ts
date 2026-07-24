import { Request, Response } from "express";
import { createWebhookAdminHandlers } from "../WebhookAdminController";

describe("WebhookAdminController", () => {
  const response = () => {
    const json = jest.fn();
    const sendStatus = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return { value: { json, sendStatus, status } as unknown as Response, json, sendStatus, status };
  };

  it("creates a company-scoped subscription and returns its one-time secret", async () => {
    const create = jest.fn().mockResolvedValue({ id: "sub_1", signingSecret: "secret-once" });
    const handlers = createWebhookAdminHandlers({ create, list: jest.fn(), update: jest.fn(), remove: jest.fn(), listDeliveries: jest.fn(), retryDelivery: jest.fn() });
    const res = response();
    await handlers.create({ user: { companyId: 7 }, body: { name: "n8n" } } as unknown as Request, res.value);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ companyId: 7, name: "n8n" }));
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("requeues only a delivery belonging to the authenticated company", async () => {
    const retryDelivery = jest.fn();
    const handlers = createWebhookAdminHandlers({ create: jest.fn(), list: jest.fn(), update: jest.fn(), remove: jest.fn(), listDeliveries: jest.fn(), retryDelivery });
    const res = response();
    await handlers.retryDelivery({ user: { companyId: 7 }, params: { deliveryId: "del_1" } } as unknown as Request, res.value);
    expect(retryDelivery).toHaveBeenCalledWith(7, "del_1");
    expect(res.sendStatus).toHaveBeenCalledWith(202);
  });
});
