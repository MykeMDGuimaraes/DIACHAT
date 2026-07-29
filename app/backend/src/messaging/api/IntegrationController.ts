import { Request, Response } from "express";

import AppError from "../../errors/AppError";
import IntegrationReadinessService from "../application/IntegrationReadinessService";

interface ReadinessChecker {
  check(input: {
    companyId: number;
    allowedConnectionIds: number[];
    connectionId: number;
    automationQueueId: string;
    humanQueueId: string;
  }): Promise<unknown>;
}

export const createIntegrationReadinessHandler =
  (service: ReadinessChecker = new IntegrationReadinessService()) =>
  async (req: Request, res: Response): Promise<Response> => {
    const credential = req.apiCredential;
    if (!credential) throw new AppError("Credencial de API invalida", 401);
    const connectionId = Number(req.query.connectionId);
    const automationQueueId = String(req.query.automationQueueId || "");
    const humanQueueId = String(req.query.humanQueueId || "");
    const readiness = await service.check({
      companyId: credential.companyId,
      allowedConnectionIds: credential.connectionIds,
      connectionId,
      automationQueueId,
      humanQueueId
    });
    return res.json(readiness);
  };
