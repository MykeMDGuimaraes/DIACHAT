import MessagingRetentionService from "../MessagingRetentionService";

const repository = () => ({
  destroy: jest.fn().mockResolvedValue(2),
  update: jest.fn().mockResolvedValue([3])
});

describe("MessagingRetentionService", () => {
  it("redacts payloads after 30 days and removes terminal rows after 180 days", async () => {
    const commands = repository();
    const outbox = repository();
    const inbox = repository();
    const deliveries = repository();
    const service = new MessagingRetentionService(
      { commands, outbox, inbox, deliveries } as any,
      () => new Date("2026-07-24T12:00:00.000Z")
    );

    const result = await service.purge();

    expect(result.redacted).toBe(12);
    expect(result.deleted).toBe(8);
    expect(commands.update).toHaveBeenCalledWith(
      { requestPayload: { purged: true } },
      expect.objectContaining({ silent: true })
    );
    expect(deliveries.destroy).toHaveBeenCalled();
    expect(deliveries.update).toHaveBeenCalledWith(
      {
        bodyCiphertext: null,
        bodyKeyVersion: null,
        bodyExpiresAt: null,
        bodyPurgedAt: new Date("2026-07-24T12:00:00.000Z")
      },
      expect.objectContaining({ silent: true })
    );
  });
});
