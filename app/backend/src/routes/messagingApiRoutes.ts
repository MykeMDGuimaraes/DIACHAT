import { Router } from "express";
import apiKeyAuth from "../messaging/api/apiKeyAuth";
import {
  createIssueApiCredentialHandler,
  listApiCredentialsHandler,
  revokeApiCredentialHandler
} from "../messaging/api/ApiCredentialController";
import { createPublicTextMessageHandler } from "../messaging/api/PublicMessageController";
import requireApiScope from "../messaging/api/requireApiScope";
import {
  createMetaCloudChannelHandler,
  listMetaCloudChannelsHandler,
  revokeMetaCloudChannelHandler,
  rotateMetaCloudChannelHandler
} from "../messaging/channels/meta-cloud/MetaCloudChannelController";
import {
  receiveMetaWebhookHandler,
  verifyMetaWebhookHandler
} from "../messaging/channels/meta-cloud/MetaWebhookController";
import isAuth from "../middleware/isAuth";
import { webhookAdminHandlers } from "../messaging/webhooks/WebhookAdminController";
import publicApiRateLimit from "../messaging/api/publicApiRateLimit";
import messagingOpenApi from "../messaging/contracts/MessagingOpenApi";

const messagingApiRoutes = Router();

messagingApiRoutes.get("/openapi.json", (_req, res) =>
  res.json(messagingOpenApi)
);
messagingApiRoutes.post("/credentials", isAuth, createIssueApiCredentialHandler());
messagingApiRoutes.get("/credentials", isAuth, listApiCredentialsHandler);
messagingApiRoutes.delete(
  "/credentials/:credentialId",
  isAuth,
  revokeApiCredentialHandler
);
messagingApiRoutes.get("/webhook-subscriptions", isAuth, webhookAdminHandlers.list);
messagingApiRoutes.post("/webhook-subscriptions", isAuth, webhookAdminHandlers.create);
messagingApiRoutes.put("/webhook-subscriptions/:subscriptionId", isAuth, webhookAdminHandlers.update);
messagingApiRoutes.delete("/webhook-subscriptions/:subscriptionId", isAuth, webhookAdminHandlers.remove);
messagingApiRoutes.get("/webhook-deliveries", isAuth, webhookAdminHandlers.listDeliveries);
messagingApiRoutes.post("/webhook-deliveries/:deliveryId/retry", isAuth, webhookAdminHandlers.retryDelivery);

messagingApiRoutes.post(
  "/channels/meta-cloud",
  isAuth,
  createMetaCloudChannelHandler()
);
messagingApiRoutes.get("/channels/meta-cloud", isAuth, listMetaCloudChannelsHandler);
messagingApiRoutes.put(
  "/channels/meta-cloud/:whatsappId/credentials",
  isAuth,
  rotateMetaCloudChannelHandler
);
messagingApiRoutes.delete(
  "/channels/meta-cloud/:whatsappId",
  isAuth,
  revokeMetaCloudChannelHandler
);

messagingApiRoutes.get(
  "/channels/meta-cloud/:credentialPublicId/webhook",
  verifyMetaWebhookHandler
);
messagingApiRoutes.post(
  "/channels/meta-cloud/:credentialPublicId/webhook",
  receiveMetaWebhookHandler
);

messagingApiRoutes.post(
  "/messages",
  apiKeyAuth,
  publicApiRateLimit,
  requireApiScope("messages:write"),
  createPublicTextMessageHandler()
);

export default messagingApiRoutes;
