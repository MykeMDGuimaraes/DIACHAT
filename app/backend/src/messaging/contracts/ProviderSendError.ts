export type SendErrorClassification = "retryable" | "permanent" | "unknown";

export interface ProviderSendErrorInput {
  code: string;
  message: string;
  providerStatus?: number;
  retryAfterMs?: number;
  details?: Record<string, unknown>;
}

const sanitizeDetails = (
  details?: Record<string, unknown>
): Record<string, unknown> | undefined => {
  if (!details) return undefined;
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(details)) {
    if (/token|secret|authorization|password|credential/i.test(key)) continue;
    if (typeof value === "string") {
      sanitized[key] = value.slice(0, 500);
    } else if (
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

export class ProviderSendError extends Error {
  readonly classification: SendErrorClassification;

  readonly code: string;

  readonly providerStatus?: number;

  readonly retryAfterMs?: number;

  readonly details?: Record<string, unknown>;

  constructor(
    classification: SendErrorClassification,
    input: ProviderSendErrorInput
  ) {
    super(input.message);
    this.name = "ProviderSendError";
    this.classification = classification;
    this.code = input.code;
    this.providerStatus = input.providerStatus;
    this.retryAfterMs = input.retryAfterMs;
    this.details = sanitizeDetails(input.details);
  }
}

export class RetryableSendError extends ProviderSendError {
  constructor(input: ProviderSendErrorInput) {
    super("retryable", input);
    this.name = "RetryableSendError";
  }
}

export class PermanentSendError extends ProviderSendError {
  constructor(input: ProviderSendErrorInput) {
    super("permanent", input);
    this.name = "PermanentSendError";
  }
}

export class UnknownSendError extends ProviderSendError {
  constructor(input: ProviderSendErrorInput) {
    super("unknown", input);
    this.name = "UnknownSendError";
  }
}

export const isProviderSendError = (
  error: unknown
): error is ProviderSendError => error instanceof ProviderSendError;

export const parseRetryAfterMs = (
  header: string | undefined,
  now = new Date()
): number | undefined => {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const dateValue = Date.parse(header);
  if (!Number.isNaN(dateValue)) {
    return Math.max(0, dateValue - now.getTime());
  }
  return undefined;
};
