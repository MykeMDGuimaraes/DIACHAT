import { Op } from "sequelize";
import AuditLog from "../../../models/AuditLog";
import MessageCommand from "../../persistence/models/MessageCommand";
import MessagingCapacitySample from "../../persistence/models/MessagingCapacitySample";
import MessagingInboxEvent from "../../persistence/models/MessagingInboxEvent";
import MessagingOutboxEvent from "../../persistence/models/MessagingOutboxEvent";
import WebhookDelivery from "../../persistence/models/WebhookDelivery";
import WebhookSubscription from "../../persistence/models/WebhookSubscription";
import MessagingMetricsService from "../MessagingMetricsService";
import {
  recordWhatsAppMirrorMetric,
  resetWhatsAppMirrorMetricsForTests
} from "../WhatsAppMirrorMetrics";

describe("MessagingMetricsService", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    resetWhatsAppMirrorMetricsForTests();
  });

  it("includes fixed-label mirror failure, crypto, media and purge aggregates", async () => {
    jest.spyOn(MessageCommand, "count").mockResolvedValue(0);
    jest.spyOn(MessageCommand, "findOne").mockResolvedValue(null);
    jest.spyOn(MessagingOutboxEvent, "count").mockResolvedValue(0);
    jest.spyOn(MessagingOutboxEvent, "findOne").mockResolvedValue(null);
    jest.spyOn(MessagingInboxEvent, "count").mockResolvedValue(0);
    jest.spyOn(MessagingInboxEvent, "findOne").mockResolvedValue(null);
    jest.spyOn(WebhookDelivery, "count").mockResolvedValue(0);
    jest.spyOn(WebhookDelivery, "findOne").mockResolvedValue(null);
    jest.spyOn(WebhookSubscription, "count").mockResolvedValue(0);
    jest.spyOn(MessagingCapacitySample, "count").mockResolvedValue(0);
    jest.spyOn(MessagingCapacitySample, "findOne").mockResolvedValue(null);
    jest.spyOn(AuditLog, "count").mockResolvedValue(0);
    jest.spyOn(AuditLog, "findOne").mockResolvedValue(null);
    recordWhatsAppMirrorMetric("projectionFailure");
    recordWhatsAppMirrorMetric("cryptoFailure");
    recordWhatsAppMirrorMetric("mediaUnavailable");
    recordWhatsAppMirrorMetric("purgedBody", 2);

    const result = (await new MessagingMetricsService().collect(7)) as {
      mirror: Record<string, unknown>;
    };

    expect(result.mirror).toEqual({
      projectionFailures: 1,
      cryptoFailures: 1,
      media: { available: 0, unavailable: 1, failures: 0 },
      purge: { encryptedBodies: 2, bodiesLastMinute: 0 },
      throughput: {
        eventsCompletedLastMinute: 0,
        deliveriesLastMinute: 0
      }
    });
    expect(Object.keys(result.mirror)).toEqual([
      "projectionFailures",
      "cryptoFailures",
      "media",
      "purge",
      "throughput"
    ]);
  });

  it("counts processing webhook deliveries as in-flight, pending and lease-expired", async () => {
    const oldestProcessing = new Date(Date.now() - 15_000);

    jest.spyOn(MessageCommand, "count").mockResolvedValue(0);
    jest.spyOn(MessageCommand, "findOne").mockResolvedValue(null);
    jest.spyOn(MessagingOutboxEvent, "count").mockResolvedValue(0);
    jest.spyOn(MessagingOutboxEvent, "findOne").mockResolvedValue(null);
    jest.spyOn(MessagingInboxEvent, "count").mockResolvedValue(0);
    jest.spyOn(MessagingInboxEvent, "findOne").mockResolvedValue(null);
    jest.spyOn(WebhookSubscription, "count").mockResolvedValue(0);
    jest.spyOn(MessagingCapacitySample, "count").mockResolvedValue(0);
    jest.spyOn(MessagingCapacitySample, "findOne").mockResolvedValue(null);
    jest.spyOn(AuditLog, "count").mockResolvedValue(0);
    jest.spyOn(AuditLog, "findOne").mockResolvedValue(null);

    jest.spyOn(WebhookDelivery, "count").mockImplementation(async options => {
      const where = options?.where as Record<string | symbol, unknown>;
      if (where.leaseExpiresAt) return 1;
      if (where.status === "processing") return 2;
      return 0;
    });
    jest.spyOn(WebhookDelivery, "findOne").mockImplementation(async options => {
      const where = options?.where as {
        status?: Record<symbol, string[]>;
      };
      const pendingStatuses = where.status?.[Op.in];
      return pendingStatuses?.includes("processing")
        ? ({ createdAt: oldestProcessing } as WebhookDelivery)
        : null;
    });

    const result = (await new MessagingMetricsService().collect(7)) as {
      webhooks: {
        inFlight: number;
        expiredLeases: number;
        oldestPendingSeconds: number;
      };
    };

    expect(result.webhooks.inFlight).toBe(2);
    expect(result.webhooks.expiredLeases).toBe(1);
    expect(result.webhooks.oldestPendingSeconds).toBeGreaterThanOrEqual(14);
  });

  it("reports pending, in-flight, dead-letter, expired and oldest inbox work", async () => {
    const oldestInbox = new Date(Date.now() - 20_000);

    jest.spyOn(MessageCommand, "count").mockResolvedValue(0);
    jest.spyOn(MessageCommand, "findOne").mockResolvedValue(null);
    jest.spyOn(MessagingOutboxEvent, "count").mockResolvedValue(0);
    jest.spyOn(MessagingOutboxEvent, "findOne").mockResolvedValue(null);
    jest.spyOn(WebhookDelivery, "count").mockResolvedValue(0);
    jest.spyOn(WebhookDelivery, "findOne").mockResolvedValue(null);
    jest.spyOn(WebhookSubscription, "count").mockResolvedValue(0);
    jest.spyOn(MessagingCapacitySample, "count").mockResolvedValue(0);
    jest.spyOn(MessagingCapacitySample, "findOne").mockResolvedValue(null);
    jest.spyOn(AuditLog, "count").mockResolvedValue(0);
    jest.spyOn(AuditLog, "findOne").mockResolvedValue(null);

    jest
      .spyOn(MessagingInboxEvent, "count")
      .mockImplementation(async options => {
        const where = options?.where as Record<string | symbol, unknown>;
        if (where.leaseExpiresAt) return 1;
        if (where.status === "received") return 3;
        if (where.status === "processing") return 2;
        if (where.status === "dead_letter") return 4;
        return 0;
      });
    jest
      .spyOn(MessagingInboxEvent, "findOne")
      .mockResolvedValue({ createdAt: oldestInbox } as MessagingInboxEvent);

    const result = (await new MessagingMetricsService().collect(7)) as {
      inbox: {
        pending: number;
        inFlight: number;
        deadLetter: number;
        expiredLeases: number;
        oldestPendingSeconds: number;
      };
    };

    expect(result.inbox).toEqual({
      pending: 3,
      inFlight: 2,
      deadLetter: 4,
      expiredLeases: 1,
      oldestPendingSeconds: expect.any(Number)
    });
    expect(result.inbox.oldestPendingSeconds).toBeGreaterThanOrEqual(19);
  });
});
