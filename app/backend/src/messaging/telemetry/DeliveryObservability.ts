import { logger } from "../../utils/logger";

/**
 * Observabilidade de entrega WhatsApp (Hardening T7).
 *
 * Os sinais até então invisíveis — socket duplicado, callback de geração
 * antiga, falha de escrita de credencial, conflito de revisão, entrega não
 * confirmada — viram métricas em processo + logs estruturados + alertas.
 *
 * Identificação SOMENTE por ids e códigos normalizados (companyId,
 * whatsappId, generation, commandId, reasonCode, errorCode): nunca telefone,
 * jid, corpo de mensagem ou segredo — e o logger redige esses campos mesmo
 * que alguém os passe por engano (ver utils/logger).
 */

export const DELIVERY_METRIC = {
  ACTIVE_SOCKET_COUNT: "active_socket_count",
  CONNECT_ATTEMPT_TOTAL: "connect_attempt_total",
  RECONNECT_TOTAL: "reconnect_total",
  STALE_CALLBACK_TOTAL: "stale_callback_total",
  AUTH_WRITE_FAILURE_TOTAL: "auth_write_failure_total",
  AUTH_REVISION_CONFLICT_TOTAL: "auth_revision_conflict_total",
  DELIVERY_UNCONFIRMED_TOTAL: "delivery_unconfirmed_total",
  ACK_LATENCY_MS: "ack_latency_ms"
} as const;

export type DeliveryMetricName =
  (typeof DELIVERY_METRIC)[keyof typeof DELIVERY_METRIC];

export const DELIVERY_ALERT = {
  DUPLICATE_ACTIVE_SOCKET: "duplicate_active_socket",
  STALE_WRITE_ACCEPTED: "stale_write_accepted",
  DELIVERY_UNCONFIRMED_THRESHOLD: "delivery_unconfirmed_threshold",
  STREAM_REPLACEMENT_WARNING: "stream_replacement_warning",
  TERMINAL_SESSION: "terminal_session"
} as const;

export type DeliveryAlertCode =
  (typeof DELIVERY_ALERT)[keyof typeof DELIVERY_ALERT];

/** Estágios de latência do pipeline de envio (T8): commit → dispatch → providerMessageId → ACK. */
export const SEND_PIPELINE_STAGE = {
  COMMIT_TO_DISPATCH: "send_pipeline_commit_to_dispatch_ms",
  DISPATCH_TO_PROVIDER_ID: "send_pipeline_dispatch_to_provider_id_ms",
  PROVIDER_ID_TO_ACK: "send_pipeline_provider_id_to_ack_ms"
} as const;

export type SendPipelineStage =
  (typeof SEND_PIPELINE_STAGE)[keyof typeof SEND_PIPELINE_STAGE];

export interface PipelineLatencySummary {
  count: number;
  sampled: number;
  p50: number;
  p95: number;
  p99: number;
  maxMs: number;
}

export type AlertSeverity = "critical" | "warning";

/** Rótulos permitidos nas métricas — nada além de ids e códigos normalizados. */
export interface MetricLabels {
  companyId?: number;
  whatsappId?: number;
  reasonCode?: string;
}

export interface AlertContext {
  companyId?: number;
  whatsappId?: number;
  generation?: string;
  commandId?: string;
  statusCode?: number | null;
  reasonCode?: string;
  errorCode?: string;
  activeSocketCount?: number;
  revision?: number;
  consecutiveUnconfirmed?: number;
}

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const ackLatency = { count: 0, sumMs: 0, maxMs: 0 };

// Reservatório limitado por estágio (T8): memória constante; excedentes são
// descartados (os mais antigos) e contados em `count` mas não em `sampled`.
const PIPELINE_LATENCY_RESERVOIR_SIZE = 512;
const pipelineLatencySamples = new Map<string, number[]>();
const pipelineLatencyOverflow = new Map<string, number>();

export const observeSendPipelineLatencyMs = (
  stage: SendPipelineStage,
  latencyMs: number
): void => {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  const samples = pipelineLatencySamples.get(stage) ?? [];
  if (samples.length >= PIPELINE_LATENCY_RESERVOIR_SIZE) {
    samples.shift();
    pipelineLatencyOverflow.set(
      stage,
      (pipelineLatencyOverflow.get(stage) ?? 0) + 1
    );
  }
  const rounded = Math.round(latencyMs);
  samples.push(rounded);
  pipelineLatencySamples.set(stage, samples);
  logger.debug({ metric: stage, value: rounded }, "delivery-metric");
};

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((p / 100) * sorted.length) - 1)
  );
  return sorted[index];
};

const summarizePipelineStage = (
  stage: SendPipelineStage
): PipelineLatencySummary => {
  const samples = [...(pipelineLatencySamples.get(stage) ?? [])].sort(
    (left, right) => left - right
  );
  return {
    count: samples.length + (pipelineLatencyOverflow.get(stage) ?? 0),
    sampled: samples.length,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    p99: percentile(samples, 99),
    maxMs: samples.length > 0 ? samples[samples.length - 1] : 0
  };
};

const labelKey = (labels: MetricLabels): string =>
  JSON.stringify(
    Object.fromEntries(
      Object.entries(labels)
        .filter(([, value]) => value !== undefined && value !== null)
        .sort(([left], [right]) => left.localeCompare(right))
    )
  );

export const incrementDeliveryCounter = (
  name: DeliveryMetricName,
  labels: MetricLabels = {},
  value = 1
): void => {
  const key = `${name}|${labelKey(labels)}`;
  const next = (counters.get(key) ?? 0) + value;
  counters.set(key, next);
  logger.debug({ metric: name, value: next, ...labels }, "delivery-metric");
};

export const setDeliveryGauge = (
  name: DeliveryMetricName,
  labels: MetricLabels,
  value: number
): void => {
  const key = `${name}|${labelKey(labels)}`;
  gauges.set(key, value);
  logger.debug({ metric: name, value, ...labels }, "delivery-metric");
};

export const observeAckLatencyMs = (
  latencyMs: number,
  labels: MetricLabels = {}
): void => {
  if (!Number.isFinite(latencyMs) || latencyMs < 0) return;
  ackLatency.count += 1;
  ackLatency.sumMs += Math.round(latencyMs);
  ackLatency.maxMs = Math.max(ackLatency.maxMs, Math.round(latencyMs));
  logger.debug(
    {
      metric: DELIVERY_METRIC.ACK_LATENCY_MS,
      value: Math.round(latencyMs),
      ...labels
    },
    "delivery-metric"
  );
};

/** Alerta operacional: crítico = ação imediata; aviso = investigar em seguida. */
export const emitDeliveryAlert = (
  severity: AlertSeverity,
  code: DeliveryAlertCode,
  context: AlertContext = {}
): void => {
  const payload = { alert: code, severity, ...context };
  if (severity === "critical") {
    logger.error(payload, "delivery-alert");
  } else {
    logger.warn(payload, "delivery-alert");
  }
};

// --- Regras puras de alerta (testáveis sem efeito colateral) ---

/** Crítico: mais de um socket ativo no mesmo canal (invariante do manager). */
export const shouldAlertDuplicateSocket = (
  activeSocketCount: number
): boolean => activeSocketCount > 1;

/**
 * Crítico: uma escrita aplicada com revisão anterior/igual à última aplicada
 * — a fila serializada torna isso impossível; disparar indica regressão.
 */
export const shouldAlertStaleWriteAccepted = (
  appliedRevision: number,
  lastAppliedRevision: number
): boolean => appliedRevision <= lastAppliedRevision;

/** Crítico: não confirmadas consecutivas na janela (alinhado à saúde T5). */
export const UNCONFIRMED_DELIVERY_ALERT_THRESHOLD = 2;

/** Aviso: substituição/encerramento de stream pelo WhatsApp (440/463). */
export const STREAM_REPLACEMENT_STATUS_CODES: readonly number[] = [440, 463];

export const snapshotDeliveryMetrics = (): {
  counters: Record<string, number>;
  gauges: Record<string, number>;
  ackLatencyMs: { count: number; sumMs: number; maxMs: number };
  sendPipeline: Record<SendPipelineStage, PipelineLatencySummary>;
} => ({
  counters: Object.fromEntries(counters),
  gauges: Object.fromEntries(gauges),
  ackLatencyMs: { ...ackLatency },
  sendPipeline: {
    [SEND_PIPELINE_STAGE.COMMIT_TO_DISPATCH]: summarizePipelineStage(
      SEND_PIPELINE_STAGE.COMMIT_TO_DISPATCH
    ),
    [SEND_PIPELINE_STAGE.DISPATCH_TO_PROVIDER_ID]: summarizePipelineStage(
      SEND_PIPELINE_STAGE.DISPATCH_TO_PROVIDER_ID
    ),
    [SEND_PIPELINE_STAGE.PROVIDER_ID_TO_ACK]: summarizePipelineStage(
      SEND_PIPELINE_STAGE.PROVIDER_ID_TO_ACK
    )
  }
});

/** Testes: zera o registro em processo. */
export const resetDeliveryMetrics = (): void => {
  counters.clear();
  gauges.clear();
  ackLatency.count = 0;
  ackLatency.sumMs = 0;
  ackLatency.maxMs = 0;
  pipelineLatencySamples.clear();
  pipelineLatencyOverflow.clear();
};
