import { Request, Response } from "express";

import AppError from "../../../errors/AppError";
import { createMetaCloudChannel } from "./CreateMetaCloudChannelService";

const publicBackendUrl = (): string => {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    throw new AppError("BACKEND_URL nÃ£o configurada para o callback Meta", 500);
  }
  return backendUrl.replace(/\/$/, "");
};

export const createMetaCloudChannelHandler = () => async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const {
    name,
    appId,
    appSecret,
    accessToken,
    wabaId,
    phoneNumberId
  } = req.body;
  const backendUrl = publicBackendUrl();

  const channel = await createMetaCloudChannel({
    companyId,
    name,
    appId,
    appSecret,
    accessToken,
    wabaId,
    phoneNumberId
  });

  return res.status(201).json({
    whatsappId: channel.whatsappId,
    displayPhoneNumber: channel.displayPhoneNumber,
    verifyToken: channel.verifyToken,
    callbackUrl: `${backendUrl}/api/v1/channels/meta-cloud/${channel.credentialPublicId}/webhook`
  });
};
