/**
 * Fachada pública da observabilidade de entrega (Hardening T7). O core
 * (SessionManager, authStateWriter, wbot) emite métricas e alertas somente
 * por aqui — nunca importa src/messaging/telemetry diretamente (fronteira
 * depcruise).
 */
export {
  DELIVERY_ALERT,
  DELIVERY_METRIC,
  STREAM_REPLACEMENT_STATUS_CODES,
  UNCONFIRMED_DELIVERY_ALERT_THRESHOLD,
  emitDeliveryAlert,
  incrementDeliveryCounter,
  observeAckLatencyMs,
  resetDeliveryMetrics,
  setDeliveryGauge,
  shouldAlertDuplicateSocket,
  shouldAlertStaleWriteAccepted,
  snapshotDeliveryMetrics,
  AlertContext,
  AlertSeverity,
  DeliveryAlertCode,
  DeliveryMetricName,
  MetricLabels
} from "../telemetry/DeliveryObservability";
