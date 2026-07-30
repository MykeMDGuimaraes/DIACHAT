import { Op } from "sequelize";
import WebhookBodyPurgeService from "../WebhookBodyPurgeService";
import {
  resetWhatsAppMirrorMetricsForTests,
  snapshotWhatsAppMirrorMetrics
} from "../../operations/WhatsAppMirrorMetrics";

describe("WebhookBodyPurgeService", () => {
  afterEach(() => resetWhatsAppMirrorMetricsForTests());

  it("purges expired ciphertext while preserving its digest", async () => {
    const purgeExpired = jest.fn().mockResolvedValue([3]);
    const purgeExpiredOutbox = jest.fn().mockResolvedValue([2]);
    const now = new Date("2026-07-29T12:00:00.000Z");
    const service = new WebhookBodyPurgeService({
      purgeExpired,
      purgeExpiredOutbox
    });

    await expect(service.purge(now)).resolves.toEqual({ purged: 5 });
    expect(purgeExpired).toHaveBeenCalledWith(
      {
        bodyCiphertext: null,
        bodyKeyVersion: null,
        bodyExpiresAt: null,
        bodyPurgedAt: now
      },
      {
        where: {
          bodyCiphertext: { [Op.ne]: null },
          bodyExpiresAt: { [Op.lte]: now }
        },
        silent: true
      }
    );
    expect(purgeExpiredOutbox).toHaveBeenCalledWith(
      expect.objectContaining({ bodyPurgedAt: now }),
      expect.objectContaining({ silent: true })
    );
    expect(snapshotWhatsAppMirrorMetrics()).toMatchObject({
      purge: { encryptedBodies: 5 }
    });
  });
});
