import { Request } from "express";
import AuditLog from "../models/AuditLog";
import { logger } from "../utils/logger";

export interface AuditEntry {
  companyId?: number | null;
  actorType: "user" | "service" | "anonymous";
  actorId?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | number | null;
  outcome?: "success" | "denied" | "failure";
  ip?: string | null;
  // Apenas identificadores/flags — NUNCA conteúdo de mensagem.
  metadata?: Record<string, unknown> | null;
}

export const requestIp = (req: Request): string | null => {
  const fwd = req.headers["x-forwarded-for"];
  if (typeof fwd === "string" && fwd.length > 0) {
    return fwd.split(",")[0].trim();
  }
  return req.ip || null;
};

// Fire-and-forget: auditoria nunca pode derrubar o fluxo principal.
export const audit = (entry: AuditEntry): void => {
  AuditLog.create({
    companyId: entry.companyId ?? null,
    actorType: entry.actorType,
    actorId: entry.actorId != null ? String(entry.actorId) : null,
    action: entry.action,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId != null ? String(entry.targetId) : null,
    outcome: entry.outcome ?? "success",
    ip: entry.ip ?? null,
    metadata: entry.metadata ?? null
  } as any).catch(err => {
    logger.warn(`[audit] failed to persist audit log: ${err?.message}`);
  });
};

export default audit;
