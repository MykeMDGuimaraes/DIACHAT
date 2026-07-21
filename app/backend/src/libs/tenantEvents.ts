import { EventEmitter } from "events";
import Redis from "ioredis";
import { REDIS_URI_CONNECTION } from "../config/redis";
import { logger } from "../utils/logger";

export interface TenantEvent {
  id: number;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
}

const BUFFER_SIZE = 500;
const BUFFER_TTL_SECONDS = 3600;

const redis = new Redis(REDIS_URI_CONNECTION);
redis.on("error", err => {
  logger.error(`[tenantEvents] redis error: ${err?.message}`);
});

const emitter = new EventEmitter();
emitter.setMaxListeners(0);

const seqKey = (companyId: number): string => `v1events:${companyId}:seq`;
const bufKey = (companyId: number): string => `v1events:${companyId}:buf`;

export const publishTenantEvent = async (
  companyId: number,
  type: string,
  payload: Record<string, unknown>
): Promise<void> => {
  try {
    const id = await redis.incr(seqKey(companyId));
    const event: TenantEvent = {
      id,
      type,
      occurredAt: new Date().toISOString(),
      payload
    };
    await redis
      .multi()
      .zadd(bufKey(companyId), id, JSON.stringify(event))
      .zremrangebyrank(bufKey(companyId), 0, -(BUFFER_SIZE + 1))
      .expire(bufKey(companyId), BUFFER_TTL_SECONDS)
      .expire(seqKey(companyId), BUFFER_TTL_SECONDS)
      .exec();
    emitter.emit(`company-${companyId}`, event);
  } catch (err) {
    logger.error(
      `[tenantEvents] failed to publish ${type} for company ${companyId}: ${err?.message}`
    );
  }
};

export interface Backlog {
  events: TenantEvent[];
  needsResync: boolean;
  latestSeq: number;
}

export const getEventsAfter = async (
  companyId: number,
  cursor: number
): Promise<Backlog> => {
  const latestRaw = await redis.get(seqKey(companyId));
  const latestSeq = latestRaw ? parseInt(latestRaw, 10) : 0;

  if (latestSeq <= cursor) {
    return { events: [], needsResync: false, latestSeq };
  }

  const raw = await redis.zrangebyscore(
    bufKey(companyId),
    `(${cursor}`,
    "+inf"
  );
  const events: TenantEvent[] = [];
  for (const item of raw) {
    try {
      events.push(JSON.parse(item));
    } catch {
      // ignore malformed entries
    }
  }

  // If the first buffered event after the cursor is not cursor+1, part of the
  // gap was evicted from the short retention window: consumer must resync.
  const needsResync =
    events.length === 0 || events[0].id !== cursor + 1;

  return { events, needsResync, latestSeq };
};

export const subscribeTenantEvents = (
  companyId: number,
  listener: (event: TenantEvent) => void
): (() => void) => {
  const channel = `company-${companyId}`;
  emitter.on(channel, listener);
  return () => {
    emitter.off(channel, listener);
  };
};
