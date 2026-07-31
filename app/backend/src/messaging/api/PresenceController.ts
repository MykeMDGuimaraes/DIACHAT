import { Request, Response } from "express";
import AppError from "../../errors/AppError";
import PresenceService, { PresenceState } from "../application/PresenceService";
import baileysTicketMessagingProvider from "../adapters/baileys/getBaileysTicketMessagingProvider";

export const createPresenceHandler = (service = new PresenceService(async () => baileysTicketMessagingProvider)) => async (req: Request, res: Response): Promise<Response> => {
  const credential = req.apiCredential;
  if (!credential) throw new AppError("Credencial de API invalida", 401);
  await service.send({ companyId: credential.companyId, allowedConnectionIds: credential.connectionIds, connectionId: Number(req.body.connectionId), recipient: req.body.to, state: req.body.state as PresenceState, duration: req.body.duration === undefined ? undefined : Number(req.body.duration) });
  return res.status(204).send();
};
