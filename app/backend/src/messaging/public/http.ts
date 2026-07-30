/**
 * Fachada publica HTTP do modulo de mensageria para o nucleo (core).
 *
 * Rotas do core devem importar controllers e middlewares de mensageria
 * exclusivamente por aqui.
 */
export { default as apiKeyAuth } from "../api/apiKeyAuth";
export { default as requireApiScope } from "../api/requireApiScope";
export { default as publicApiRateLimit } from "../api/publicApiRateLimit";
export { default as legacyApiDeprecation } from "../api/legacyApiDeprecation";
export { default as isMessagingAdmin } from "../api/MessagingAdminGuard";
export {
  createIssueApiCredentialHandler,
  listApiCredentialsHandler,
  revokeApiCredentialHandler
} from "../api/ApiCredentialController";
export { createPublicTextMessageHandler } from "../api/PublicMessageController";
export {
  createHandoffConversationHandler,
  createFinalizeConversationHandler
} from "../api/ConversationController";
export { createIntegrationReadinessHandler } from "../api/IntegrationController";
export {
  createTranscriptHandler,
  transcriptMediaHandler
} from "../api/TranscriptController";
export { webhookMediaHandler } from "../webhooks/WebhookMediaController";
export {
  createMetaCloudChannelHandler,
  listMetaCloudChannelsHandler,
  rotateMetaCloudChannelHandler,
  revokeMetaCloudChannelHandler
} from "../channels/meta-cloud/MetaCloudChannelController";
export {
  verifyMetaWebhookHandler,
  receiveMetaWebhookHandler
} from "../channels/meta-cloud/MetaWebhookController";
export { webhookAdminHandlers } from "../webhooks/WebhookAdminController";
export {
  messagingMetrics,
  messagingCapacityProbe,
  messagingCapacityReplay
} from "../operations/MessagingOperationsController";
export { default as messagingOpenApi } from "../contracts/MessagingOpenApi";
