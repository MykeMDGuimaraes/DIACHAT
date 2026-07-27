import WebhookRecoveryService from "../WebhookRecoveryService";

describe("WebhookRecoveryService", () => {
  it("requeues expired leases without depending on Redis", async () => {
    const requeueDeliveries = jest.fn().mockResolvedValue([2]);
    const requeueEvents = jest.fn().mockResolvedValue([1]);
    const service = new WebhookRecoveryService({ requeueDeliveries, requeueEvents });
    await expect(service.recover(new Date("2026-07-24T12:00:00Z"))).resolves.toEqual({ deliveries: 2, events: 1 });
  });
});
