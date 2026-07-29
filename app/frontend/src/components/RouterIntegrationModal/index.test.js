import { ROUTER_EVENTS, ROUTER_SCOPES } from "./index";

describe("RouterIntegrationModal contract preset", () => {
  it("requests every DIA CHAT 1.1 scope", () => {
    expect(ROUTER_SCOPES).toEqual([
      "messages:write",
      "conversations:write",
      "integration:read",
      "transcript:read"
    ]);
  });

  it("subscribes to all P0 events including API-origin outcomes", () => {
    expect(ROUTER_EVENTS).toEqual([
      "button.clicked",
      "message.received",
      "message.sent",
      "message.failed",
      "message.status.updated",
      "handoff.paused",
      "handoff.released",
      "conversation.created",
      "conversation.updated"
    ]);
  });
});
