import { NextFunction, Request, Response } from "express";
import AuditLog from "../../models/AuditLog";
import { logger } from "../../utils/logger";

type CreateAudit = (data: Record<string, unknown>) => Promise<unknown>;

const defaultCreateAudit: CreateAudit = data => AuditLog.create(data as any);

export const createLegacyApiDeprecation = (
  createAudit: CreateAudit = defaultCreateAudit,
  sunset = process.env.LEGACY_MESSAGES_API_SUNSET_AT || "Tue, 22 Sep 2026 00:00:00 GMT"
) => async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  res.set("Deprecation", "true");
  res.set("Sunset", sunset);
  res.set("Link", "</api/v1/messages>; rel=\"successor-version\"");

  try {
    await createAudit({
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
