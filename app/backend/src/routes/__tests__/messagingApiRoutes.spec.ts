import express, { NextFunction, Request, Response } from "express";
import { sign } from "jsonwebtoken";
import request from "supertest";

import authConfig from "../../config/auth";

const mockWebhookList = jest.fn((_req: Request, res: Response) =>
  res.status(200).json([])
);
const mockMetaList = jest.fn((_req: Request, res: Response) =>
  res.status(200).json([])
);
const mockOk = jest.fn((_req: Request, res: Response) =>
  res.status(200).json({})
);

jest.mock("../../messaging/public/http", () => {
  const { default: isMessagingAdmin } = jest.requireActual(
    "../../messaging/api/MessagingAdminGuard"
  );
  return {
    apiKeyAuth: jest.fn(),
    createIssueApiCredentialHandler: () => mockOk,
    listApiCredentialsHandler: mockOk,
    revokeApiCredentialHandler: mockOk,
    createPublicTextMessageHandler: () => jest.fn(),
    requireApiScope: () => jest.fn(),
    createMetaCloudChannelHandler: () => mockOk,
    listMetaCloudChannelsHandler: mockMetaList,
    revokeMetaCloudChannelHandler: mockOk,
    rotateMetaCloudChannelHandler: mockOk,
    receiveMetaWebhookHandler: jest.fn(),
    verifyMetaWebhookHandler: jest.fn(),
    webhookAdminHandlers: {
      list: mockWebhookList,
      create: mockOk,
      update: mockOk,
      remove: mockOk,
      listDeliveries: mockOk,
      retryDelivery: mockOk
    },
    publicApiRateLimit: jest.fn(),
    messagingOpenApi: {},
    isMessagingAdmin
  };
});

import messagingApiRoutes from "../messagingApiRoutes";

const buildApp = () => {
  const app = express();
  app.use(express.json());
  app.use("/api/v1", messagingApiRoutes);
  app.use(
    (error: any, _req: Request, res: Response, _next: NextFunction): Response =>
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || "internal error" })
  );
  return app;
};

const bearerFor = (profile: string): string =>
  `Bearer ${sign({ id: "user_1", profile, companyId: 7 }, authConfig.secret, {
    expiresIn: "5m"
  })}`;

describe("messaging admin routes", () => {
  it.each([
    ["post", "/api/v1/credentials"],
    ["get", "/api/v1/credentials"],
    ["delete", "/api/v1/credentials/cred_1"],
    ["get", "/api/v1/webhook-subscriptions"],
    ["post", "/api/v1/webhook-subscriptions"],
    ["put", "/api/v1/webhook-subscriptions/sub_1"],
    ["delete", "/api/v1/webhook-subscriptions/sub_1"],
    ["get", "/api/v1/webhook-deliveries"],
    ["post", "/api/v1/webhook-deliveries/del_1/retry"],
    ["post", "/api/v1/channels/meta-cloud"],
    ["get", "/api/v1/channels/meta-cloud"],
    ["put", "/api/v1/channels/meta-cloud/42/credentials"],
    ["delete", "/api/v1/channels/meta-cloud/42"]
  ] as const)("rejects a regular user on %s %s", async (method, route) => {
    const response = await request(buildApp())
      [method](route)
      .set("Authorization", bearerFor("user"));

    expect(response.status).toBe(403);
  });

  it.each(["admin", "superadmin"])(
    "allows the %s profile to reach an admin handler",
    async profile => {
      const response = await request(buildApp())
        .get("/api/v1/webhook-subscriptions")
        .set("Authorization", bearerFor(profile));

      expect(response.status).toBe(200);
    }
  );
});
