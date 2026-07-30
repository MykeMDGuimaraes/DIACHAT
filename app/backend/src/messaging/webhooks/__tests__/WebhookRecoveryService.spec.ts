import WebhookRecoveryService, {
  WEBHOOK_RECOVERABLE_EVENT_TYPES
} from "../WebhookRecoveryService";
import MessagingOutboxEvent from "../../persistence/models/MessagingOutboxEvent";
import WebhookDelivery from "../../persistence/models/WebhookDelivery";

describe("WebhookRecoveryService", () => {
  afterEach(() => jest.restoreAllMocks());

  it("requeues expired leases without depending on Redis", async () => {
    const requeueDeliveries = jest.fn().mockResolvedValue([2]);
    const requeueEvents = jest.fn().mockResolvedValue([1]);
    const service = new WebhookRecoveryService({ requeueDeliveries, requeueEvents });
    await expect(service.recover(new Date("2026-07-24T12:00:00Z"))).resolves.toEqual({ deliveries: 2, events: 1 });
  });

  it("recovers every Router P0 event including message.failed", () => {
    expect(WEBHOOK_RECOVERABLE_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        "message.received",
        "message.reaction",
        "message.edited",
        "message.deleted",
        "chat.updated",
        "connection.updated",
        "message.sent",
        "message.failed",
        "message.status.updated",
        "button.clicked",
        "handoff.paused",
        "handoff.released",
        "conversation.created",
        "conversation.updated"
      ])
    );
  });

  it("clears stale delivery and event fence tokens before requeue", async () => {
    const deliveryUpdate = jest
      .spyOn(WebhookDelivery, "update")
      .mockResolvedValue([1] as any);
    const eventUpdate = jest
      .spyOn(MessagingOutboxEvent, "update")
      .mockResolvedValue([1] as any);
    const now = new Date("2026-07-29T12:00:00.000Z");

    await new WebhookRecoveryService().recover(now);

    expect(deliveryUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ leaseExpiresAt: null, leaseToken: null }),
      expect.any(Object)
    );
    expect(eventUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ leaseExpiresAt: null, leaseToken: null }),
      expect.any(Object)
    );
  });
});
