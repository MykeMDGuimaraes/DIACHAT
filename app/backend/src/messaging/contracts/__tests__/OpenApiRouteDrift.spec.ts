import messagingOpenApi from "../MessagingOpenApi";

describe("Messaging OpenAPI route drift", () => {
  it("keeps every public Phase 1 resource in the published contract", () => {
    ["/api/v1/messages", "/api/v1/messages/{messageId}", "/api/v1/messages/{messageId}/reactions", "/api/v1/messages/{messageId}/media", "/api/v1/presence", "/api/v1/conversations", "/api/v1/conversations/{conversationId}", "/api/v1/message-templates/{templateId}/render"].forEach(path => {
      expect(messagingOpenApi.paths).toHaveProperty(path);
    });
  });
});
