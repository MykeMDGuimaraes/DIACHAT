export const MESSAGE_COMMAND_STATUS = {
  QUEUED: "queued",
  SENDING: "sending",
  SENT: "sent",
  DELIVERED: "delivered",
  READ: "read",
  FAILED: "failed",
  UNKNOWN: "unknown",
  CANCELLED: "cancelled"
} as const;

export type MessageCommandStatusValue =
  (typeof MESSAGE_COMMAND_STATUS)[keyof typeof MESSAGE_COMMAND_STATUS];

export const OUTBOX_EVENT_STATUS = {
  READY: "ready",
  PROCESSING: "processing",
  COMPLETED: "completed",
  DEAD_LETTER: "dead_letter"
} as const;

export type OutboxEventStatusValue =
  (typeof OUTBOX_EVENT_STATUS)[keyof typeof OUTBOX_EVENT_STATUS];

export const INBOX_EVENT_STATUS = {
  RECEIVED: "received",
  PROCESSING: "processing",
  PROCESSED: "processed",
  DEAD_LETTER: "dead_letter"
} as const;

export const WEBHOOK_DELIVERY_STATUS = {
  READY: "ready",
  PROCESSING: "processing",
  DELIVERED: "delivered",
  DEAD_LETTER: "dead_letter"
} as const;

export const OUTBOX_EVENT_TYPE = {
  MESSAGE_DISPATCH_REQUESTED: "message.dispatch.requested",
  MESSAGE_SENT: "message.sent",
  MESSAGE_FAILED: "message.failed",
  MESSAGE_STATUS_UPDATED: "message.status.updated"
} as const;

export const MESSAGE_COMMAND_ERROR_CODE = {
  SEND_OUTCOME_UNKNOWN: "SEND_OUTCOME_UNKNOWN",
  SEND_RETRY_EXHAUSTED: "SEND_RETRY_EXHAUSTED",
  DELIVERY_UNCONFIRMED: "DELIVERY_UNCONFIRMED"
} as const;

export const MAX_SEND_ATTEMPTS = 8;
export const SEND_LEASE_MS = 120_000;
export const SEND_TIMEOUT_MS = 60_000;
// Tempo máximo esperando o ack do WhatsApp após o socket aceitar a mensagem.
// Sem ack até esse prazo, o comando deixa de constar como "sent".
export const DELIVERY_CONFIRM_TIMEOUT_MS = 5 * 60_000;
export const BACKOFF_BASE_MS = 5_000;
export const BACKOFF_MAX_MS = 15 * 60_000;

export interface BackoffOptions {
  attempt: number;
  retryAfterMs?: number;
  random?: () => number;
}

export const computeRetryDelayMs = ({
  attempt,
  retryAfterMs,
  random = Math.random
}: BackoffOptions): number => {
  const exponential = Math.min(
    BACKOFF_MAX_MS,
    BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1)
  );
  const jitter = 0.5 + random(); // 0.5..1.5
  const backoff = Math.round(exponential * jitter);
  return Math.max(backoff, retryAfterMs || 0);
};
