import { Request, Response } from "express";

import {
  TenantEvent,
  getEventsAfter,
  subscribeTenantEvents
} from "../libs/tenantEvents";
import { logger } from "../utils/logger";

const HEARTBEAT_MS = 25000;

const parseCursor = (req: Request): number | null => {
  const raw =
    (typeof req.query.cursor === "string" && req.query.cursor) ||
    (typeof req.headers["last-event-id"] === "string" &&
      (req.headers["last-event-id"] as string)) ||
    "";
  if (!raw) return 0;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return null;
  return n;
};

const writeEvent = (res: Response, event: TenantEvent): void => {
  res.write(
    `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  );
};

export const streamEvents = async (
  req: Request,
  res: Response
): Promise<void> => {
  const { companyId } = req.user;
  const cursor = parseCursor(req);

  if (cursor === null) {
    res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "cursor deve ser um inteiro >= 0"
      }
    });
    return;
  }

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();
  res.write("retry: 3000\n\n");

  let lastSentId = cursor;
  let backlogDone = false;
  const pending: TenantEvent[] = [];

  const deliver = (event: TenantEvent): void => {
    if (event.id <= lastSentId) return;
    writeEvent(res, event);
    lastSentId = event.id;
  };

  const unsubscribe = subscribeTenantEvents(companyId, event => {
    if (!backlogDone) {
      pending.push(event);
      return;
    }
    deliver(event);
  });

  const heartbeat = setInterval(() => {
    res.write(`: heartbeat ${Date.now()}\n\n`);
  }, HEARTBEAT_MS);

  const cleanup = (): void => {
    clearInterval(heartbeat);
    unsubscribe();
  };
  req.on("close", cleanup);

  try {
    if (cursor > 0) {
      const backlog = await getEventsAfter(companyId, cursor);
      if (backlog.latestSeq < cursor) {
        // Sequence was reset (retention window expired): cursor is invalid.
        res.write(
          `event: resync\ndata: ${JSON.stringify({
            reason: "CURSOR_AHEAD_OF_SEQUENCE",
            latestSeq: backlog.latestSeq
          })}\n\n`
        );
        lastSentId = 0;
      } else if (backlog.needsResync && backlog.latestSeq > cursor) {
        res.write(
          `event: resync\ndata: ${JSON.stringify({
            reason: "CURSOR_OUT_OF_WINDOW",
            latestSeq: backlog.latestSeq
          })}\n\n`
        );
        lastSentId = backlog.latestSeq;
      } else {
        backlog.events.forEach(deliver);
      }
    }
  } catch (err) {
    logger.error(`[internal/v1/events] backlog error: ${err?.message}`);
    res.write(
      `event: resync\ndata: ${JSON.stringify({
        reason: "BACKLOG_UNAVAILABLE"
      })}\n\n`
    );
  }

  backlogDone = true;
  pending.forEach(deliver);
  pending.length = 0;
};
