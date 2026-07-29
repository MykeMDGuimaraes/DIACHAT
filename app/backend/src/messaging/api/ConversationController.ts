import { Request, Response } from "express";

import AppError from "../../errors/AppError";
import ConversationCommandService, {
  CreateConversationCommandInput
} from "../application/ConversationCommandService";

interface ConversationCommandCreator {
  create(input: CreateConversationCommandInput): Promise<{
    command: any;
    replayed: boolean;
  }>;
}

const inputFor = (
  req: Request,
  action: CreateConversationCommandInput["action"]
): CreateConversationCommandInput => {
  const credential = req.apiCredential;
  const idempotencyKey = req.header("Idempotency-Key");
  if (!credential) throw new AppError("Credencial de API invalida", 401);
  if (!idempotencyKey) {
    throw new AppError("Idempotency-Key e obrigatoria", 400);
  }
  return {
    companyId: credential.companyId,
    allowedConnectionIds: credential.connectionIds,
    idempotencyScope: credential.id,
    idempotencyKey,
    conversationId: req.params.conversationId,
    externalTicketId: req.body.externalTicketId,
    automationEpoch: req.body.automationEpoch,
    action,
    queueId: req.body.queueId,
    userId: req.body.userId,
    ...(action === "finalize"
      ? { sendNativeSurvey: req.body.sendNativeSurvey }
      : {})
  };
};

const respond = (res: Response, command: any, replayed: boolean): Response => {
  if (replayed) res.set("Idempotent-Replayed", "true");
  return res.status(replayed ? 200 : 202).json(
    command.responseSnapshot || {
      id: command.id,
      status: "accepted",
      conversationId: command.conversationId
    }
  );
};

export const createHandoffConversationHandler =
  (service: ConversationCommandCreator = new ConversationCommandService()) =>
  async (req: Request, res: Response): Promise<Response> => {
    const action = req.body.action;
    if (
      !["pause_automation", "takeover", "release_automation"].includes(action)
    ) {
      throw new AppError("INVALID_HANDOFF_ACTION", 422);
    }
    const result = await service.create(inputFor(req, action));
    return respond(res, result.command, result.replayed);
  };

export const createFinalizeConversationHandler =
  (service: ConversationCommandCreator = new ConversationCommandService()) =>
  async (req: Request, res: Response): Promise<Response> => {
    const result = await service.create(inputFor(req, "finalize"));
    return respond(res, result.command, result.replayed);
  };
