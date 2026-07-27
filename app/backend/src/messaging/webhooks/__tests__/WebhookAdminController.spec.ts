import { Request, Response } from "express";
import { createWebhookAdminHandlers } from "../WebhookAdminController";

describe("WebhookAdminController", () => {
  const response = () => {
    const json = jest.fn();
    const sendStatus = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    return {
      value: { json, sendStatus, status } as unknown as Response,
      json,
      sendStatus,
      status
    };
  };

  it("creates a company-scoped subscription and returns its one-time secret", async () => {
    const create = jest.fn().mockResolvedValue({
      id: "sub_1",
      signingSecret: "secret-once",
      secretCiphertext: "must-not-leak",
      keyVersion: "key-v1"
    });
    const handlers = createWebhookAdminHandlers({
      create,
      list: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      listDeliveries: jest.fn(),
      retryDelivery: jest.fn()
    });
    const res = response();
    await handlers.create(
      { user: { companyId: 7 }, body: { name: "n8n" } } as unknown as Request,
      res.value
    );
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ companyId: 7, name: "n8n" })
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      id: "sub_1",
      signingSecret: "secret-once"
    });
  });

  it("lists subscriptions without stored secret material", async () => {
    const list = jest.fn().mockResolvedValue([
      {
        id: "sub_1",
        companyId: 7,
        name: "n8n",
        url: "https://n8n.example.test/webhook",
        enabled: true,
        events: ["message.received"],
        connectionIds: [],
        messageKinds: [],
        includeApiOrigin: false,
        secretCiphertext: "must-not-leak",
        keyVersion: "key-v1"
      }
    ]);
    const handlers = createWebhookAdminHandlers({
      create: jest.fn(),
      list,
      update: jest.fn(),
      remove: jest.fn(),
      listDeliveries: jest.fn(),
      retryDelivery: jest.fn()
    });
    const res = response();

    await handlers.list(
      { user: { companyId: 7 } } as unknown as Request,
      res.value
    );

    expect(res.json).toHaveBeenCalledWith([
      {
        id: "sub_1",
        companyId: 7,
        name: "n8n",
        url: "https://n8n.example.test/webhook",
        enabled: true,
        events: ["message.received"],
        connectionIds: [],
        messageKinds: [],
        includeApiOrigin: false
      }
    ]);
  });

  it("lists deliveries without encryption metadata or stored response bodies", async () => {
    const listDeliveries = jest.fn().mockResolvedValue([
      {
        id: "del_1",
        subscriptionId: "sub_1",
        companyId: 7,
        eventId: "evt_1",
        eventType: "message.received",
        urlSnapshot: "https://n8n.example.test/webhook",
        payload: { messageId: "msg_1" },
        status: "dead_letter",
        attemptCount: 6,
        responseStatus: 401,
        responseBody: "token=must-not-leak",
        secretCiphertextSnapshot: "must-not-leak",
        keyVersion: "key-v1",
        lastError: "HTTP 401"
      }
    ]);
    const handlers = createWebhookAdminHandlers({
      create: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      listDeliveries,
      retryDelivery: jest.fn()
    });
    const res = response();

    await handlers.listDeliveries(
      { user: { companyId: 7 }, query: {} } as unknown as Request,
      res.value
    );

    expect(res.json).toHaveBeenCalledWith([
      {
        id: "del_1",
        subscriptionId: "sub_1",
        companyId: 7,
        eventId: "evt_1",
        eventType: "message.received",
        urlSnapshot: "https://n8n.example.test/webhook",
        payload: { messageId: "msg_1" },
        status: "dead_letter",
        attemptCount: 6,
        responseStatus: 401,
        lastError: "HTTP 401"
      }
    ]);
  });

  it("requeues only a delivery belonging to the authenticated company", async () => {
    const retryDelivery = jest.fn();
    const handlers = createWebhookAdminHandlers({
      create: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
      listDeliveries: jest.fn(),
      retryDelivery
    });
    const res = response();
    await handlers.retryDelivery(
      {
        user: { companyId: 7 },
        params: { deliveryId: "del_1" }
      } as unknown as Request,
      res.value
    );
    expect(retryDelivery).toHaveBeenCalledWith(7, "del_1");
    expect(res.sendStatus).toHaveBeenCalledWith(202);
  });
});
