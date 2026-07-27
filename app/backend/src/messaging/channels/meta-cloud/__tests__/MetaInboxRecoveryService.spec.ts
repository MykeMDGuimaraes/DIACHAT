import { Op } from "sequelize";
import MessagingInboxEvent from "../../../persistence/models/MessagingInboxEvent";
import MetaInboxRecoveryService from "../MetaInboxRecoveryService";

describe("MetaInboxRecoveryService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("requeues expired processing events for immediate retry", async () => {
    const now = new Date("2026-07-27T12:00:00.000Z");
    const update = jest
      .spyOn(MessagingInboxEvent, "update")
      .mockResolvedValue([2]);

    await expect(new MetaInboxRecoveryService().recover(now)).resolves.toEqual({
      recovered: 2
    });
    expect(update).toHaveBeenCalledWith(
      {
        status: "received",
        availableAt: now,
        leaseExpiresAt: null
      },
      {
        where: {
          provider: "meta_cloud",
          status: "processing",
          leaseExpiresAt: { [Op.lte]: now }
        }
      }
    );
  });
});
