import { logger } from "../../../utils/logger";
import {
  DELIVERY_ALERT,
  DELIVERY_METRIC,
  SEND_PIPELINE_STAGE,
  STREAM_REPLACEMENT_STATUS_CODES,
  UNCONFIRMED_DELIVERY_ALERT_THRESHOLD,
  emitDeliveryAlert,
  incrementDeliveryCounter,
  observeAckLatencyMs,
  observeSendPipelineLatencyMs,
  resetDeliveryMetrics,
  setDeliveryGauge,
  shouldAlertDuplicateSocket,
  shouldAlertStaleWriteAccepted,
  snapshotDeliveryMetrics
} from "../DeliveryObservability";

jest.mock("../../../utils/logger", () => ({
  logger: { debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
}));

const loggerMock = logger as unknown as {
  debug: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
};

describe("DeliveryObservability (T7)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetDeliveryMetrics();
  });

  it("acumula contadores por rótulo normalizado (ids e códigos apenas)", () => {
    incrementDeliveryCounter(DELIVERY_METRIC.RECONNECT_TOTAL, {
      whatsappId: 1,
      companyId: 10,
      reasonCode: "CONNECTION_LOST"
    });
    incrementDeliveryCounter(DELIVERY_METRIC.RECONNECT_TOTAL, {
      companyId: 10,
      reasonCode: "CONNECTION_LOST",
      whatsappId: 1
    });
    incrementDeliveryCounter(DELIVERY_METRIC.RECONNECT_TOTAL, {
      whatsappId: 1,
      companyId: 10,
      reasonCode: "STREAM_ERROR"
    });

    const snap = snapshotDeliveryMetrics();
    expect(
      snap.counters[
        'reconnect_total|{"companyId":10,"reasonCode":"CONNECTION_LOST","whatsappId":1}'
      ]
    ).toBe(2);
    expect(
      snap.counters[
        'reconnect_total|{"companyId":10,"reasonCode":"STREAM_ERROR","whatsappId":1}'
      ]
    ).toBe(1);
  });

  it("fixa gauges e agrega latência de ack (count/sum/max)", () => {
    setDeliveryGauge(DELIVERY_METRIC.ACTIVE_SOCKET_COUNT, { whatsappId: 1 }, 1);
    observeAckLatencyMs(120, { whatsappId: 1 });
    observeAckLatencyMs(80, { whatsappId: 1 });
    observeAckLatencyMs(-5, { whatsappId: 1 }); // inválida: ignorada

    const snap = snapshotDeliveryMetrics();
    expect(snap.gauges['active_socket_count|{"whatsappId":1}']).toBe(1);
    expect(snap.ackLatencyMs).toEqual({ count: 2, sumMs: 200, maxMs: 120 });
  });

  it("alerta crítico sai no logger.error e aviso no logger.warn, com contexto sem PII", () => {
    emitDeliveryAlert("critical", DELIVERY_ALERT.DUPLICATE_ACTIVE_SOCKET, {
      whatsappId: 1,
      companyId: 10,
      generation: "3",
      activeSocketCount: 2
    });
    emitDeliveryAlert("warning", DELIVERY_ALERT.TERMINAL_SESSION, {
      whatsappId: 1,
      statusCode: 401,
      reasonCode: "LOGGED_OUT"
    });

    expect(loggerMock.error).toHaveBeenCalledWith(
      expect.objectContaining({
        alert: "duplicate_active_socket",
        severity: "critical",
        whatsappId: 1,
        companyId: 10,
        generation: "3",
        activeSocketCount: 2
      }),
      "delivery-alert"
    );
    expect(loggerMock.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        alert: "terminal_session",
        severity: "warning",
        whatsappId: 1,
        statusCode: 401,
        reasonCode: "LOGGED_OUT"
      }),
      "delivery-alert"
    );
    // O contexto de alerta nunca carrega campos sensíveis.
    const payload = loggerMock.error.mock.calls[0][0];
    expect(Object.keys(payload).sort()).toEqual(
      [
        "activeSocketCount",
        "alert",
        "companyId",
        "generation",
        "severity",
        "whatsappId"
      ].sort()
    );
  });

  it("regras puras: socket duplicado, escrita stale aceita e limiares", () => {
    expect(shouldAlertDuplicateSocket(1)).toBe(false);
    expect(shouldAlertDuplicateSocket(2)).toBe(true);
    expect(shouldAlertStaleWriteAccepted(3, 2)).toBe(false);
    expect(shouldAlertStaleWriteAccepted(2, 2)).toBe(true);
    expect(shouldAlertStaleWriteAccepted(1, 2)).toBe(true);
    expect(UNCONFIRMED_DELIVERY_ALERT_THRESHOLD).toBe(2);
    expect(STREAM_REPLACEMENT_STATUS_CODES).toEqual([440, 463]);
  });

  it("reset zera o registro em processo", () => {
    incrementDeliveryCounter(DELIVERY_METRIC.CONNECT_ATTEMPT_TOTAL, {
      whatsappId: 1
    });
    observeAckLatencyMs(50);
    resetDeliveryMetrics();
    const snap = snapshotDeliveryMetrics();
    expect(snap.counters).toEqual({});
    expect(snap.ackLatencyMs).toEqual({ count: 0, sumMs: 0, maxMs: 0 });
  });
});

describe("latências do pipeline de envio (T8)", () => {
  it("resume p50/p95/p99 por estágio", () => {
    resetDeliveryMetrics();
    for (let value = 1; value <= 100; value += 1) {
      observeSendPipelineLatencyMs(
        SEND_PIPELINE_STAGE.COMMIT_TO_DISPATCH,
        value
      );
    }
    const summary =
      snapshotDeliveryMetrics().sendPipeline[
        SEND_PIPELINE_STAGE.COMMIT_TO_DISPATCH
      ];
    expect(summary.count).toBe(100);
    expect(summary.sampled).toBe(100);
    expect(summary.p50).toBe(50);
    expect(summary.p95).toBe(95);
    expect(summary.p99).toBe(99);
    expect(summary.maxMs).toBe(100);
  });

  it("limita o reservatório e conta os descartes", () => {
    resetDeliveryMetrics();
    for (let value = 0; value < 600; value += 1) {
      observeSendPipelineLatencyMs(
        SEND_PIPELINE_STAGE.DISPATCH_TO_PROVIDER_ID,
        value
      );
    }
    const summary =
      snapshotDeliveryMetrics().sendPipeline[
        SEND_PIPELINE_STAGE.DISPATCH_TO_PROVIDER_ID
      ];
    expect(summary.count).toBe(600);
    expect(summary.sampled).toBe(512);
    expect(summary.maxMs).toBe(599);
  });

  it("ignora valores inválidos", () => {
    resetDeliveryMetrics();
    observeSendPipelineLatencyMs(SEND_PIPELINE_STAGE.PROVIDER_ID_TO_ACK, -5);
    observeSendPipelineLatencyMs(
      SEND_PIPELINE_STAGE.PROVIDER_ID_TO_ACK,
      Number.NaN
    );
    const summary =
      snapshotDeliveryMetrics().sendPipeline[
        SEND_PIPELINE_STAGE.PROVIDER_ID_TO_ACK
      ];
    expect(summary.count).toBe(0);
    expect(summary.sampled).toBe(0);
  });
});
