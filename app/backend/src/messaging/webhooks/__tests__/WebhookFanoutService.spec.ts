import WebhookFanoutService, {
  buildFanoutClaimState
} from "../WebhookFanoutService";
import {
  resetWhatsAppMirrorMetricsForTests,
  snapshotWhatsAppMirrorMetrics
} from "../../operations/WhatsAppMirrorMetrics";

describe("WebhookFanoutService", () => {
  afterEach(() => resetWhatsAppMirrorMetricsForTests());
  it("increments the durable attempt while assigning a fenced lease", () => {
    expect(
      buildFanoutClaimState(2, "lease-3", new Date("2026-07-29T12:00:00.000Z"))
    ).toEqual({
      status: "processing",
      attemptCount: 3,
      leaseToken: "lease-3",
      leaseExpiresAt: new Date("2026-07-29T12:02:00.000Z")
    });
  });
  it("uses the rich mirror snapshot only when the feature flag is enabled", async () => {
    const createDelivery = jest.fn();
    const completeEvent = jest.fn();
    const transaction = {};
    const buildSnapshot = jest.fn().mockResolvedValue({
      rawBody: '{"schema":"whatsapp-mirror/1"}',
      bodySha256: "snapshot-digest"
    });
    const buildLegacySnapshot = jest.fn();
    const service = new WebhookFanoutService({
      transaction: callback => callback(transaction),
      claimEvent: jest.fn().mockResolvedValue({
        id: "evt_1",
        companyId: 7,
        eventType: "message.received",
        aggregateId: "msg_1",
        payload: {
          messageId: "msg_1",
          whatsappId: 42,
          kind: "text",
          origin: "provider",
          text: "must-not-remain-in-jsonb"
        },
        createdAt: new Date("2026-07-29T12:00:00.000Z"),
        leaseToken: "event-lease-1"
      }),
      findSubscriptions: jest.fn().mockResolvedValue([
        {
          id: "sub_1",
          companyId: 7,
          url: "https://hooks.example.com/diachat",
          events: ["message.received"],
          connectionIds: [42],
          messageKinds: ["text"],
          includeApiOrigin: false,
          secretCiphertext: "ciphertext",
          keyVersion: "v1"
        }
      ]),
      createDelivery,
      completeEvent,
      buildSnapshot,
      buildLegacySnapshot,
      encryptBody: jest.fn().mockReturnValue({
        bodyCiphertext: "encrypted-body",
        bodyKeyVersion: "body-v2",
        bodySha256: "snapshot-digest"
      }),
      getKeyring: jest
        .fn()
        .mockReturnValue({ activeKeyId: "body-v2", keys: {} }),
      newId: jest.fn().mockReturnValue("del_1"),
      mirrorEnabled: jest.fn().mockReturnValue(true)
    });

    await expect(service.fanoutOne()).resolves.toEqual({
      status: "created",
      deliveries: 1
    });
    expect(buildSnapshot).toHaveBeenCalledTimes(1);
    expect(buildLegacySnapshot).not.toHaveBeenCalled();
    expect(createDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "del_1",
        subscriptionId: "sub_1",
        companyId: 7,
        eventId: "evt_1",
        urlSnapshot: "https://hooks.example.com/diachat",
        secretCiphertextSnapshot: "ciphertext",
        bodyCiphertext: "encrypted-body",
        bodyKeyVersion: "body-v2",
        bodySha256: "snapshot-digest",
        bodyExpiresAt: null,
        bodyPurgedAt: null,
        payload: {
          messageId: "msg_1",
          whatsappId: 42,
          conversationId: null,
          contactId: null,
          externalTicketId: null,
          automationEpoch: null
        }
      }),
      transaction
    );
    expect(completeEvent).toHaveBeenCalledWith(
      "evt_1",
      "event-lease-1",
      transaction
    );
  });

  it("encrypts the exact hydrated v1.1 envelope bytes when the feature flag is off", async () => {
    const rawBody =
      '{"id":"evt_1","type":"message.received","createdAt":"2026-07-29T12:00:00.000Z","data":{"messageId":"msg_1","whatsappId":42,"actorType":"contact","text":"texto persistido"}}';
    const buildSnapshot = jest.fn();
    const buildLegacySnapshot = jest.fn().mockResolvedValue({
      rawBody,
      bodySha256: "legacy-digest"
    });
    const encryptBody = jest.fn().mockReturnValue({
      bodyCiphertext: "encrypted-legacy-body",
      bodyKeyVersion: "body-v2",
      bodySha256: "legacy-digest"
    });
    const service = new WebhookFanoutService({
      transaction: callback => callback({}),
      claimEvent: jest.fn().mockResolvedValue({
        id: "evt_1",
        companyId: 7,
        eventType: "message.received",
        aggregateId: "msg_1",
        payload: {
          messageId: "msg_1",
          whatsappId: 42,
          actorType: "contact"
        },
        createdAt: new Date("2026-07-29T12:00:00.000Z"),
        leaseToken: "event-lease-1"
      }),
      findSubscriptions: jest.fn().mockResolvedValue([
        {
          id: "sub_1",
          events: ["message.received"],
          connectionIds: [],
          messageKinds: [],
          includeApiOrigin: true
        }
      ]),
      createDelivery: jest.fn(),
      completeEvent: jest.fn(),
      buildSnapshot,
      buildLegacySnapshot,
      encryptBody,
      getKeyring: jest
        .fn()
        .mockReturnValue({ activeKeyId: "body-v2", keys: {} }),
      newId: jest.fn().mockReturnValue("del_1"),
      mirrorEnabled: jest.fn().mockReturnValue(false)
    });

    await service.fanoutOne();

    expect(buildLegacySnapshot).toHaveBeenCalledTimes(1);
    expect(buildSnapshot).not.toHaveBeenCalled();
    expect(encryptBody).toHaveBeenCalledWith(
      Buffer.from(rawBody, "utf8"),
      {
        companyId: 7,
        subscriptionId: "sub_1",
        deliveryId: "del_1",
        eventId: "evt_1"
      },
      { activeKeyId: "body-v2", keys: {} }
    );
  });

  it.each([
    { enabled: false, specialized: false },
    { enabled: true, specialized: true }
  ])(
    "gates specialized event claims when mirror enabled is $enabled",
    async ({ enabled, specialized }) => {
      const claimEvent = jest.fn().mockResolvedValue(null);
      const service = new WebhookFanoutService({
        claimEvent,
        mirrorEnabled: jest.fn().mockReturnValue(enabled)
      });

      await service.fanoutOne();

      expect(claimEvent).toHaveBeenCalledWith(
        expect.arrayContaining(["message.received", "message.sent"])
      );
      const claimedEvents = claimEvent.mock.calls[0][0] as string[];
      expect(claimedEvents.includes("message.reaction")).toBe(specialized);
    }
  );

  it("does not send public API-originated events unless explicitly enabled", async () => {
    const createDelivery = jest.fn();
    const service = new WebhookFanoutService({
      transaction: callback => callback({}),
      claimEvent: jest.fn().mockResolvedValue({
        id: "evt_1",
        companyId: 7,
        eventType: "message.received",
        aggregateId: "msg_1",
        payload: { origin: "api" }
      }),
      findSubscriptions: jest.fn().mockResolvedValue([
        {
          id: "sub_1",
          events: ["message.received"],
          connectionIds: [],
          messageKinds: [],
          includeApiOrigin: false
        }
      ]),
      createDelivery,
      completeEvent: jest.fn()
    });
    await service.fanoutOne();
    expect(createDelivery).not.toHaveBeenCalled();
  });

  it.each(["projection", "encryption"])(
    "does not complete the claimed event after %s failure",
    async failure => {
      const completeEvent = jest.fn();
      const failEvent = jest.fn().mockResolvedValue([1]);
      const now = new Date("2026-07-29T12:00:00.000Z");
      const transaction = jest.fn(async callback => callback({}));
      const service = new WebhookFanoutService({
        transaction,
        claimEvent: jest.fn().mockResolvedValue({
          id: "evt_1",
          companyId: 7,
          eventType: "message.received",
          aggregateId: "msg_1",
          payload: { messageId: "msg_1" },
          createdAt: new Date("2026-07-29T12:00:00.000Z"),
          attemptCount: 1,
          leaseToken: "event-lease-1"
        }),
        findSubscriptions: jest.fn().mockResolvedValue([
          {
            id: "sub_1",
            events: ["message.received"],
            connectionIds: [],
            messageKinds: [],
            includeApiOrigin: true
          }
        ]),
        createDelivery: jest.fn(),
        completeEvent,
        failEvent,
        buildSnapshot:
          failure === "projection"
            ? jest.fn().mockRejectedValue(new Error("projection failed"))
            : jest.fn().mockResolvedValue({
                rawBody: "{}",
                bodySha256: "snapshot-digest"
              }),
        encryptBody:
          failure === "encryption"
            ? jest.fn(() => {
                throw new Error("encryption failed");
              })
            : jest.fn(),
        getKeyring: jest.fn().mockReturnValue({ activeKeyId: "v1", keys: {} }),
        newId: jest.fn().mockReturnValue("del_1"),
        mirrorEnabled: jest.fn().mockReturnValue(true),
        now: () => now
      });

      await expect(service.fanoutOne()).rejects.toThrow(`${failure} failed`);
      expect(completeEvent).not.toHaveBeenCalled();
      expect(failEvent).toHaveBeenCalledWith("evt_1", "event-lease-1", {
        status: "ready",
        availableAt: new Date("2026-07-29T12:00:05.000Z"),
        attemptCount: 1,
        lastError:
          failure === "projection"
            ? "WHATSAPP_MIRROR_PROJECTION_FAILED"
            : "WHATSAPP_MIRROR_CRYPTO_FAILED"
      });
      expect(snapshotWhatsAppMirrorMetrics()).toMatchObject({
        projectionFailures: failure === "projection" ? 1 : 0,
        cryptoFailures: failure === "encryption" ? 1 : 0
      });
    }
  );

  it("persists exponential backoff and sends a permanent projection failure to DLQ", async () => {
    const now = new Date("2026-07-29T12:00:00.000Z");
    const failEvent = jest.fn().mockResolvedValue([1]);
    const attempts = [1, 2, 3, 4, 5, 6];
    for (const attemptCount of attempts) {
      const service = new WebhookFanoutService({
        claimEvent: jest.fn().mockResolvedValue({
          id: "evt_1",
          companyId: 7,
          eventType: "message.received",
          aggregateId: "msg_1",
          payload: { messageId: "msg_1" },
          createdAt: now,
          attemptCount,
          leaseToken: `lease-${attemptCount}`
        }),
        findSubscriptions: jest.fn().mockResolvedValue([
          {
            id: "sub_1",
            events: ["message.received"],
            includeApiOrigin: true
          }
        ]),
        buildSnapshot: jest
          .fn()
          .mockRejectedValue(new Error("projection failed")),
        failEvent,
        mirrorEnabled: jest.fn().mockReturnValue(true),
        now: () => now
      } as any);

      await expect(service.fanoutOne()).rejects.toThrow("projection failed");
    }

    const retryStates = failEvent.mock.calls.slice(0, 5).map(call => call[2]);
    expect(retryStates.map(state => state.status)).toEqual(
      Array(5).fill("ready")
    );
    expect(retryStates.map(state => state.availableAt.getTime())).toEqual([
      now.getTime() + 5_000,
      now.getTime() + 15_000,
      now.getTime() + 30_000,
      now.getTime() + 60_000,
      now.getTime() + 120_000
    ]);
    expect(failEvent.mock.calls[5][2]).toEqual({
      status: "dead_letter",
      availableAt: now,
      attemptCount: 6,
      lastError: "WHATSAPP_MIRROR_PROJECTION_FAILED"
    });
    expect(
      failEvent.mock.calls.every(
        call => call[1] === `lease-${call[2].attemptCount}`
      )
    ).toBe(true);
  });
});
