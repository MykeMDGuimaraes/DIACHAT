import { createHash } from "crypto";

const stableValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value === null || typeof value !== "object") return value;
  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((result, key) => {
      result[key] = stableValue((value as Record<string, unknown>)[key]);
      return result;
    }, {});
};

export const providerTimestampMillis = (value: unknown): number | null => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric < 1_000_000_000_000
      ? Math.floor(numeric * 1000)
      : Math.floor(numeric);
  }
  if (typeof value !== "string" || !value) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
};

export const createLifecycleEventIdentity = (input: {
  provider: "baileys" | "meta_cloud";
  kind: "chat" | "connection";
  sourceId?: string | null;
  providerTimestamp?: unknown;
  content: unknown;
}): { providerEventId: string; revision: string } => {
  const digest = createHash("sha256")
    .update(
      JSON.stringify([
        input.kind,
        stableValue(input.content)
      ])
    )
    .digest("hex");
  const timestampMillis = providerTimestampMillis(input.providerTimestamp) || 0;
  const suffix = Number.parseInt(digest.slice(0, 5), 16);
  const revision =
    BigInt(timestampMillis) * 1_048_576n + BigInt(suffix);
  const sourceId =
    typeof input.sourceId === "string" && input.sourceId.trim()
      ? `source:${input.sourceId.trim()}`
      : "content";
  return {
    providerEventId: `${input.provider}:${input.kind}:${sourceId}:${digest}`,
    revision: revision.toString()
  };
};
