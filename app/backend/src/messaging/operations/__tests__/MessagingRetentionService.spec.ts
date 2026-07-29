import { Op } from "sequelize";
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

  it("keeps an old dead-letter row whose backfilled body expires in the future", async () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    const oldBackfilledDeadLetter = {
      status: "dead_letter",
      createdAt: new Date("2025-01-01T00:00:00.000Z"),
      bodyCiphertext: "encrypted-body",
      bodyExpiresAt: new Date("2026-08-05T12:00:00.000Z"),
      bodyPurgedAt: null
    };
    const deliveries = {
      update: jest.fn().mockResolvedValue([0]),
      destroy: jest.fn(async ({ where }) => {
        const statusMatches = where.status[Op.in].includes(
          oldBackfilledDeadLetter.status
        );
        const ageMatches =
          oldBackfilledDeadLetter.createdAt < where.createdAt[Op.lt];
        const purgeMatches =
          !where.bodyPurgedAt ||
          oldBackfilledDeadLetter.bodyPurgedAt !==
            where.bodyPurgedAt[Op.ne];
        return statusMatches && ageMatches && purgeMatches ? 1 : 0;
      })
    };
    const service = new MessagingRetentionService(
      {
        commands: repository(),
        outbox: repository(),
        inbox: repository(),
        deliveries
      } as any,
      () => now
    );

    const result = await service.purge();

    expect(result.deleted).toBe(6);
    expect(deliveries.destroy).toHaveBeenCalledWith({
      where: {
        status: { [Op.in]: ["delivered", "dead_letter"] },
        createdAt: { [Op.lt]: new Date("2026-01-30T12:00:00.000Z") },
        bodyPurgedAt: { [Op.ne]: null }
      }
    });
  });
});
