import { createHash } from "crypto";

const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 128;

const stableSerialize = (value: unknown): string => {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }

  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableSerialize(record[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

export const validateIdempotencyKey = (key: string): string => {
  const normalized = key.trim();

  if (
    normalized.length < MIN_KEY_LENGTH ||
    normalized.length > MAX_KEY_LENGTH
  ) {
    throw new Error("Idempotency-Key deve ter entre 8 e 128 caracteres");
  }

  return normalized;
};

export const createRequestFingerprint = (payload: unknown): string =>
  createHash("sha256").update(stableSerialize(payload)).digest("hex");
