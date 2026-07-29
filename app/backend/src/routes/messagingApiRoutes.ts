import { Router } from "express";
import {
  apiKeyAuth,
  createIssueApiCredentialHandler,
  listApiCredentialsHandler,
  revokeApiCredentialHandler,
  createPublicTextMessageHandler,
  createHandoffConversationHandler,
  createFinalizeConversationHandler,
  createIntegrationReadinessHandler,
  createTranscriptHandler,
  transcriptMediaHandler,
  requireApiScope,
  createMetaCloudChannelHandler,
  listMetaCloudChannelsHandler,
  revokeMetaCloudChannelHandler,
  rotateMetaCloudChannelHandler,
  receiveMetaWebhookHandler,
  verifyMetaWebhookHandler,
  webhookAdminHandlers,
  publicApiRateLimit,
  messagingOpenApi,
  isMessagingAdmin
} from "../messaging/public/http";
import isAuth from "../middleware/isAuth";

const messagingApiRoutes = Router();

messagingApiRoutes.get(
  "/openapi.json",
  apiKeyAuth,
  requireApiScope("integration:read"),
  (_req, res) => res.json(messagingOpenApi)
);
messagingApiRoutes.get(
  "/integration/ready",
  apiKeyAuth,
  requireApiScope("integration:read"),
  createIntegrationReadinessHandler()
);
messagingApiRoutes.get(
  "/transcript/media/:messageId",
  transcriptMediaHandler
);
messagingApiRoutes.post(
  "/credentials",
  isAuth,
  isMessagingAdmin,
  createIssueApiCredentialHandler()
);
messagingApiRoutes.get(
  "/credentials",
  isAuth,
  isMessagingAdmin,
  listApiCredentialsHandler
);
messagingApiRoutes.delete(
  "/credentials/:credentialId",
  isAuth,
  isMessagingAdmin,
  revokeApiCredentialHandler
);
messagingApiRoutes.get(
  "/webhook-subscriptions",
  isAuth,
  isMessagingAdmin,
  webhookAdminHandlers.list
);
messagingApiRoutes.post(
  "/webhook-subscriptions",
  isAuth,
  isMessagingAdmin,
  webhookAdminHandlers.create
);
messagingApiRoutes.put(
  "/webhook-subscriptions/:subscriptionId",
  isAuth,
  isMessagingAdmin,
  webhookAdminHandlers.update
);
messagingApiRoutes.delete(
  "/webhook-subscriptions/:subscriptionId",
  isAuth,
  isMessagingAdmin,
  webhookAdminHandlers.remove
);
messagingApiRoutes.get(
  "/webhook-deliveries",
  isAuth,
  isMessagingAdmin,
  webhookAdminHandlers.listDeliveries
);
messagingApiRoutes.post(
  "/webhook-deliveries/:deliveryId/retry",
  isAuth,
  isMessagingAdmin,
  webhookAdminHandlers.retryDelivery
);

messagingApiRoutes.post(
  "/channels/meta-cloud",
  isAuth,
  isMessagingAdmin,
  createMetaCloudChannelHandler()
);
messagingApiRoutes.get(
  "/channels/meta-cloud",
  isAuth,
  isMessagingAdmin,
  listMetaCloudChannelsHandler
);
messagingApiRoutes.put(
  "/channels/meta-cloud/:whatsappId/credentials",
  isAuth,
  isMessagingAdmin,
  rotateMetaCloudChannelHandler
);
messagingApiRoutes.delete(
  "/channels/meta-cloud/:whatsappId",
  isAuth,
  isMessagingAdmin,
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

messagingApiRoutes.post(
  "/conversations/:conversationId/handoff",
  apiKeyAuth,
  publicApiRateLimit,
  requireApiScope("conversations:write"),
  createHandoffConversationHandler()
);

messagingApiRoutes.post(
  "/conversations/:conversationId/finalize",
  apiKeyAuth,
  publicApiRateLimit,
  requireApiScope("conversations:write"),
  createFinalizeConversationHandler()
);

messagingApiRoutes.get(
  "/conversations/:conversationId/messages",
  apiKeyAuth,
  publicApiRateLimit,
  requireApiScope("transcript:read"),
  createTranscriptHandler()
);

export default messagingApiRoutes;
