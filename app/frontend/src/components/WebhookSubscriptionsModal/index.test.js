import {
  WEBHOOK_EVENTS,
  WEBHOOK_MESSAGE_KINDS
} from "./index";

describe("WebhookSubscriptionsModal catalog", () => {
  it("offers every backend WhatsApp mirror event and supported message kind", () => {
    expect(WEBHOOK_EVENTS).toEqual([
      "button.clicked",
      "message.received",
      "message.reaction",
      "message.edited",
      "message.deleted",
      "chat.updated",
      "connection.updated",
      "message.sent",
      "message.failed",
      "message.status.updated",
      "handoff.paused",
      "handoff.released",
      "conversation.created",
      "conversation.updated",
      "ticket.created",
      "ticket.updated",
      "contact.updated"
    ]);
    expect(WEBHOOK_MESSAGE_KINDS).toEqual([
      "text",
      "image",
      "audio",
      "video",
      "document",
      "template"
    ]);
  });
});
