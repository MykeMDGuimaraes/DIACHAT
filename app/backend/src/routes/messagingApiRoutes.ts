import { Router } from "express";
import {
  apiKeyAuth,
  createIssueApiCredentialHandler,
  listApiCredentialsHandler,
  revokeApiCredentialHandler,
  createPublicTextMessageHandler,
  createPresenceHandler,
  createReactionHandler,
  deleteReactionHandler,
  editMessageHandler,
  deleteMessageHandler,
  listPublicConversationsHandler,
  getPublicConversationHandler,
  listInternalTemplatesHandler,
  createInternalTemplateHandler,
  updateInternalTemplateHandler,
  deleteInternalTemplateHandler,
  renderInternalTemplateHandler,
  getMessageMediaHandler,
  publicMediaUpload,
  createHandoffConversationHandler,
  createFinalizeConversationHandler,
  createIntegrationReadinessHandler,
  createTranscriptHandler,
  transcriptMediaHandler,
  webhookMediaHandler,
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
messagingApiRoutes.get("/webhook-media/:messageId", webhookMediaHandler);
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
  publicMediaUpload.single("media"),
  createPublicTextMessageHandler()
);
messagingApiRoutes.get("/messages/:messageId/media", apiKeyAuth, publicApiRateLimit, requireApiScope("media:read"), getMessageMediaHandler);
messagingApiRoutes.get("/message-templates", isAuth, isMessagingAdmin, listInternalTemplatesHandler);
messagingApiRoutes.post("/message-templates", isAuth, isMessagingAdmin, createInternalTemplateHandler);
messagingApiRoutes.put("/message-templates/:templateId", isAuth, isMessagingAdmin, updateInternalTemplateHandler);
messagingApiRoutes.delete("/message-templates/:templateId", isAuth, isMessagingAdmin, deleteInternalTemplateHandler);
messagingApiRoutes.post("/message-templates/:templateId/render", apiKeyAuth, requireApiScope("templates:write"), renderInternalTemplateHandler);

messagingApiRoutes.get("/conversations", apiKeyAuth, publicApiRateLimit, requireApiScope("conversations:read"), listPublicConversationsHandler());
messagingApiRoutes.get("/conversations/:conversationId", apiKeyAuth, publicApiRateLimit, requireApiScope("conversations:read"), getPublicConversationHandler());

messagingApiRoutes.post("/messages/:messageId/reactions", apiKeyAuth, publicApiRateLimit, requireApiScope("reactions:write"), createReactionHandler());
messagingApiRoutes.delete("/messages/:messageId/reactions", apiKeyAuth, publicApiRateLimit, requireApiScope("reactions:write"), deleteReactionHandler());
messagingApiRoutes.patch("/messages/:messageId", apiKeyAuth, publicApiRateLimit, requireApiScope("messages:manage"), editMessageHandler());
messagingApiRoutes.delete("/messages/:messageId", apiKeyAuth, publicApiRateLimit, requireApiScope("messages:manage"), deleteMessageHandler());

messagingApiRoutes.post(
  "/presence",
  apiKeyAuth,
  publicApiRateLimit,
  requireApiScope("presence:write"),
  createPresenceHandler()
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
