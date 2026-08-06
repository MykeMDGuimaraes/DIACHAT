import {
  CHANNEL_DELIVERY_HEALTH,
  DELIVERY_HEALTH_WINDOW_MS,
  MESSAGE_COMMAND_ERROR_CODE
} from "../../domain/MessagingStates";
import ChannelDeliveryHealthService from "../ChannelDeliveryHealthService";
import { logger } from "../../../utils/logger";
import {
  resetDeliveryMetrics,
  snapshotDeliveryMetrics
} from "../../telemetry/DeliveryObservability";

jest.mock("../../../utils/logger", () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const loggerMock = logger as unknown as { error: jest.Mock };

const NOW = new Date("2026-08-05T12:00:00Z");

const buildChannel = (overrides: Record<string, unknown> = {}) => ({
  id: 5,
  companyId: 7,
  deliveryHealth: CHANNEL_DELIVERY_HEALTH.HEALTHY,
  consecutiveUnconfirmedDeliveries: 0,
  lastDeliveryErrorCode: null,
  lastUnconfirmedDeliveryAt: null,
  lastConfirmedDeliveryAt: null,
  deliveryHealthChangedAt: null,
  update: jest.fn().mockResolvedValue(undefined),
  ...overrides
});

const buildService = (channel: any, now = NOW) =>
  new ChannelDeliveryHealthService({
    findChannelForUpdate: jest.fn().mockResolvedValue(channel),
    now: () => now
  });

describe("ChannelDeliveryHealthService", () => {
  it("registers one isolated failure without degrading the channel", async () => {
    const channel = buildChannel();

    const changed = await buildService(channel).recordUnconfirmedDelivery(
      5,
      MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED,
      {}
    );

    expect(changed).toBeNull();
    expect(channel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        consecutiveUnconfirmedDeliveries: 1,
        lastDeliveryErrorCode: MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED
      }),
      expect.any(Object)
    );
    expect(channel.update).not.toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryHealth: CHANNEL_DELIVERY_HEALTH.DEGRADED
      }),
      expect.anything()
    );
  });

  it("degrades the channel on the second failure inside the window", async () => {
    const channel = buildChannel({
      consecutiveUnconfirmedDeliveries: 1,
      lastUnconfirmedDeliveryAt: new Date(
        NOW.getTime() - DELIVERY_HEALTH_WINDOW_MS + 1000
      )
    });

    const changed = await buildService(channel).recordUnconfirmedDelivery(
      5,
      MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED,
      {}
    );

    expect(changed).toBe(channel);
    expect(channel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        consecutiveUnconfirmedDeliveries: 2,
        deliveryHealth: CHANNEL_DELIVERY_HEALTH.DEGRADED,
        deliveryHealthChangedAt: NOW
      }),
      expect.any(Object)
    );
  });

  it("restarts the counter when the previous failure is outside the window", async () => {
    const channel = buildChannel({
      consecutiveUnconfirmedDeliveries: 1,
      lastUnconfirmedDeliveryAt: new Date(
        NOW.getTime() - DELIVERY_HEALTH_WINDOW_MS - 1000
      )
    });

    const changed = await buildService(channel).recordUnconfirmedDelivery(
      5,
      MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED,
      {}
    );

    expect(changed).toBeNull();
    expect(channel.update).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveUnconfirmedDeliveries: 1 }),
      expect.any(Object)
    );
  });

  it("does not re-notify when the channel is already degraded", async () => {
    const channel = buildChannel({
      deliveryHealth: CHANNEL_DELIVERY_HEALTH.DEGRADED,
      consecutiveUnconfirmedDeliveries: 2,
      lastUnconfirmedDeliveryAt: NOW
    });

    const changed = await buildService(channel).recordUnconfirmedDelivery(
      5,
      MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED,
      {}
    );

    expect(changed).toBeNull();
    expect(channel.update).toHaveBeenCalledWith(
      expect.objectContaining({ consecutiveUnconfirmedDeliveries: 3 }),
      expect.any(Object)
    );
    expect(channel.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ deliveryHealthChangedAt: expect.anything() }),
      expect.anything()
    );
  });

  it("restores healthy, zeroes the counter and clears the error on confirmed delivery", async () => {
    const channel = buildChannel({
      deliveryHealth: CHANNEL_DELIVERY_HEALTH.DEGRADED,
      consecutiveUnconfirmedDeliveries: 2,
      lastDeliveryErrorCode: MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED
    });

    const changed = await buildService(channel).recordConfirmedDelivery(5, {});

    expect(changed).toBe(channel);
    expect(channel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        consecutiveUnconfirmedDeliveries: 0,
        lastDeliveryErrorCode: null,
        lastConfirmedDeliveryAt: NOW,
        deliveryHealth: CHANNEL_DELIVERY_HEALTH.HEALTHY,
        deliveryHealthChangedAt: NOW
      }),
      expect.any(Object)
    );
  });

  it("zeroes the counter on confirmation even when the channel was never degraded", async () => {
    const channel = buildChannel({
      consecutiveUnconfirmedDeliveries: 1,
      lastDeliveryErrorCode: MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED
    });

    const changed = await buildService(channel).recordConfirmedDelivery(5, {});

    expect(changed).toBeNull();
    expect(channel.update).toHaveBeenCalledWith(
      expect.objectContaining({
        consecutiveUnconfirmedDeliveries: 0,
        lastDeliveryErrorCode: null,
        deliveryHealth: CHANNEL_DELIVERY_HEALTH.HEALTHY
      }),
      expect.any(Object)
    );
  });

  it("only stamps lastConfirmedDeliveryAt when there is no failure state", async () => {
    const channel = buildChannel();

    const changed = await buildService(channel).recordConfirmedDelivery(5, {});

    expect(changed).toBeNull();
    expect(channel.update).toHaveBeenCalledWith(
      { lastConfirmedDeliveryAt: NOW },
      expect.any(Object)
    );
  });

  it("ignores unknown channels", async () => {
    const service = new ChannelDeliveryHealthService({
      findChannelForUpdate: jest.fn().mockResolvedValue(null),
      now: () => NOW
    });

    await expect(
      service.recordUnconfirmedDelivery(999, "X", {})
    ).resolves.toBeNull();
    await expect(service.recordConfirmedDelivery(999, {})).resolves.toBeNull();
  });
});

describe("telemetria (T7)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDeliveryMetrics();
  });

  it("falha isolada conta a métrica sem alerta crítico", async () => {
    const channel = buildChannel();

    await buildService(channel).recordUnconfirmedDelivery(
      5,
      MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED,
      {}
    );

    const snap = snapshotDeliveryMetrics();
    expect(snap.counters['delivery_unconfirmed_total|{"whatsappId":5}']).toBe(
      1
    );
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it("transição para degraded emite alerta crítico com contexto sem PII", async () => {
    const channel = buildChannel({
      consecutiveUnconfirmedDeliveries: 1,
      lastUnconfirmedDeliveryAt: new Date(NOW.getTime() - 60000)
    });

    const changed = await buildService(channel).recordUnconfirmedDelivery(
      5,
      MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED,
      {}
    );

    expect(changed).not.toBeNull();
    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        alert: "delivery_unconfirmed_threshold",
        severity: "critical",
        whatsappId: 5,
        consecutiveUnconfirmed: 2,
        errorCode: MESSAGE_COMMAND_ERROR_CODE.DELIVERY_UNCONFIRMED
      }),
      "delivery-alert"
    );
  });
});
