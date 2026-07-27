import { NextFunction, Request, Response } from "express";
import AuditLog from "../../models/AuditLog";
import { logger } from "../../utils/logger";
import { Op } from "sequelize";

type CreateAudit = (data: Record<string, unknown>) => Promise<unknown>;
type CountRecentUsage = (companyId?: number) => Promise<number>;

const defaultCreateAudit: CreateAudit = data => AuditLog.create(data as any);
const defaultCountRecentUsage: CountRecentUsage = companyId =>
  AuditLog.count({
    where: {
      ...(companyId ? { companyId } : {}),
      action: "legacy_messages_send_accessed",
      createdAt: { [Op.gte]: new Date(Date.now() - 14 * 86_400_000) }
    }
  });

export const createLegacyApiDeprecation = (
  createAudit: CreateAudit = defaultCreateAudit,
  sunset = process.env.LEGACY_MESSAGES_API_SUNSET_AT || "Tue, 22 Sep 2026 00:00:00 GMT",
  countRecentUsage: CountRecentUsage = defaultCountRecentUsage
) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  res.set("Deprecation", "true");
  res.set("Sunset", sunset);
  res.set("Link", "</api/v1/messages>; rel=\"successor-version\"");

  try {
    const sunsetAt = new Date(sunset);
    if (
      !Number.isNaN(sunsetAt.getTime()) &&
      Date.now() >= sunsetAt.getTime() &&
      await countRecentUsage(req.user?.companyId) === 0
    ) {
      await createAudit({
        companyId: req.user?.companyId || null,
        actorType: "legacy_api",
        actorId: req.params.whatsappId || null,
        action: "legacy_messages_send_gone",
        targetType: "endpoint",
        targetId: req.originalUrl,
        outcome: "denied",
        metadata: { successor: "/api/v1/messages" }
      });
      res.status(410).json({
        error: "LEGACY_ENDPOINT_GONE",
        successor: "/api/v1/messages"
      });
      return;
    }
    await createAudit({
      companyId: req.user?.companyId || null,
      actorType: "legacy_api",
      actorId: req.params.whatsappId || null,
      action: "legacy_messages_send_accessed",
      targetType: "endpoint",
      targetId: req.originalUrl,
      outcome: "success",
      metadata: { whatsappId: req.params.whatsappId || null }
    });
  } catch (error) {
    logger.warn({ error }, "Falha ao registrar uso do endpoint legado de mensageria");
  }

  next();
};

export default createLegacyApiDeprecation();
