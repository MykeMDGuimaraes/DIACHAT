import { Request, Response } from "express";
import sequelize from "../../database";
import { getWbotSessionIds } from "../../libs/wbot";
import AppError from "../../errors/AppError";
import MessagingMetricsService from "./MessagingMetricsService";
import MessagingCapacitySample from "../persistence/models/MessagingCapacitySample";

const metricsService = new MessagingMetricsService();

export const messagingMetrics = async (
  req: Request,
  res: Response
): Promise<Response> =>
  res.json(await metricsService.collect(req.user?.companyId));

export const messagingCapacityProbe = async (
  req: Request,
  res: Response
): Promise<Response> => {
  if (process.env.MESSAGING_CAPACITY_PROBE_ENABLED !== "true") {
    throw new AppError("CAPACITY_PROBE_DISABLED", 404);
  }

  const requestedIds = String(req.query.connectionIds || "")
    .split(",")
    .filter(Boolean)
    .map(Number)
    .filter(Number.isInteger);
  if (requestedIds.length !== 20 || new Set(requestedIds).size !== 20) {
    throw new AppError("CAPACITY_REQUIRES_20_CONNECTION_IDS", 400);
  }

  const activeIds = new Set(getWbotSessionIds());
  const missingConnectionIds = requestedIds.filter(id => !activeIds.has(id));
  if (missingConnectionIds.length) {
    return res.status(409).json({
      error: "CAPACITY_CONNECTIONS_NOT_ACTIVE",
      missingConnectionIds
    });
  }

  const runId = String(req.query.runId || "");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(runId)) {
    throw new AppError("CAPACITY_RUN_ID_INVALID", 400);
  }

  const startedAt = process.hrtime.bigint();
  const sample = await sequelize.transaction(transaction =>
    MessagingCapacitySample.create(
      {
        companyId: req.user.companyId,
        runId,
        status: "ready"
      } as any,
      { transaction }
    )
  );
  const databaseLatencyMs =
    Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  return res.json({
    ok: true,
    sampleId: sample.id,
    activeConnections: requestedIds.length,
    databaseLatencyMs,
    metrics: await metricsService.collect(req.user?.companyId)
  });
};
