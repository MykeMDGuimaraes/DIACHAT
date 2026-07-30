import { createHash } from "crypto";

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson };

const normalizeCanonicalValue = (
  value: unknown,
  ancestors: Set<object>
): CanonicalJson => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (
    typeof value === "bigint" ||
    typeof value === "function" ||
    typeof value === "symbol"
  ) {
    return null;
  }
  if (typeof value !== "object") return null;
  if (value instanceof Date) return value.toISOString();
  if (ancestors.has(value)) {
    throw new TypeError("WhatsApp mirror payload cannot contain cycles");
  }

  ancestors.add(value);
  let normalized: CanonicalJson;
  if (Array.isArray(value)) {
    normalized = value.map(item => normalizeCanonicalValue(item, ancestors));
  } else {
    normalized = {};
    Object.keys(value)
      .sort()
      .forEach(key => {
        normalized[key] = normalizeCanonicalValue(
          (value as Record<string, unknown>)[key],
          ancestors
        );
      });
  }
  ancestors.delete(value);
  return normalized;
};

export const canonicalJsonBytes = (value: unknown): Buffer =>
  Buffer.from(
    JSON.stringify(normalizeCanonicalValue(value, new Set())),
    "utf8"
  );

export const sha256Hex = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
