import {
  WEBHOOK_EVENTS,
  WEBHOOK_MESSAGE_KINDS,
  WEBHOOK_EXCLUDE_FILTERS,
  webhookFormFromSubscription
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

  it("offers the supported exclusion filters", () => {
    expect(WEBHOOK_EXCLUDE_FILTERS.map(item => item.value)).toEqual([
      "fromMe",
      "group",
      "apiOriginated"
    ]);
  });

  it("hydrates every editable subscription field", () => {
    expect(
      webhookFormFromSubscription({
        id: "sub_1",
        name: "n8n",
        url: "https://hooks.example.com/diachat",
        method: "PUT",
        events: ["message.received"],
        messageKinds: ["text"],
        connectionIds: [2],
        includeApiOrigin: true,
        excludeFilters: ["group"],
        enabled: false
      })
    ).toEqual({
      name: "n8n",
      url: "https://hooks.example.com/diachat",
      method: "PUT",
      selectedEvents: ["message.received"],
      selectedKinds: ["text"],
      connectionIds: [2],
      includeApiOrigin: true,
      excludeFilters: ["group"],
      enabled: false
    });
  });
});
