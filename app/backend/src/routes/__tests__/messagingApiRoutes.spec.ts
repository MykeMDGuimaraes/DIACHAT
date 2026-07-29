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
const mockConversation = jest.fn((_req: Request, res: Response) =>
  res.status(202).json({ status: "accepted" })
);

jest.mock("../../messaging/public/http", () => {
  const { default: isMessagingAdmin } = jest.requireActual(
    "../../messaging/api/MessagingAdminGuard"
  );
  return {
    apiKeyAuth: jest.fn(
      (_req: Request, _res: Response, next: NextFunction) => next()
    ),
    createIssueApiCredentialHandler: () => mockOk,
    listApiCredentialsHandler: mockOk,
    revokeApiCredentialHandler: mockOk,
    createPublicTextMessageHandler: () => jest.fn(),
    requireApiScope: () =>
      jest.fn((_req: Request, _res: Response, next: NextFunction) => next()),
    createHandoffConversationHandler: () => mockConversation,
    createFinalizeConversationHandler: () => mockConversation,
    createIntegrationReadinessHandler: () => mockOk,
    createTranscriptHandler: () => mockOk,
    transcriptMediaHandler: mockOk,
    webhookMediaHandler: mockOk,
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
    publicApiRateLimit: jest.fn(
      (_req: Request, _res: Response, next: NextFunction) => next()
    ),
    messagingOpenApi: {},
    isMessagingAdmin
  };
});

// The mocked route dependencies must be initialized before this import.
// eslint-disable-next-line import/first
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

  it.each([
    ["post", "/api/v1/conversations/conversation-1/handoff"],
    ["post", "/api/v1/conversations/conversation-1/finalize"]
  ] as const)("registers the Router contract route %s %s", async (method, route) => {
    const response = await request(buildApp())
      [method](route)
      .set("Authorization", "Bearer dch_live_test.secret")
      .set("Idempotency-Key", "request-12345678")
      .send({});

    expect(response.status).toBe(202);
  });

  it("registers authenticated integration readiness", async () => {
    const response = await request(buildApp())
      .get(
        "/api/v1/integration/ready?connectionId=2&automationQueueId=11&humanQueueId=12"
      )
      .set("Authorization", "Bearer dch_live_test.secret");

    expect(response.status).toBe(200);
  });

  it("registers the signed webhook media route without session or API-key middleware", async () => {
    const response = await request(buildApp()).get(
      "/api/v1/webhook-media/message-1?companyId=7&expires=1&keyVersion=v1&token=x"
    );

    expect(response.status).toBe(200);
  });
});
