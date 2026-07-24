import { Request, Response } from "express";

import AppError from "../../../errors/AppError";
import { createMetaCloudChannel } from "./CreateMetaCloudChannelService";
import MetaCloudChannelAdminService from "./MetaCloudChannelAdminService";

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
    phoneNumberId,
    graphVersion
  } = req.body;
  const backendUrl = publicBackendUrl();

  const channel = await createMetaCloudChannel({
    companyId,
    name,
    appId,
    appSecret,
    accessToken,
    wabaId,
    phoneNumberId,
    graphVersion
  });

  return res.status(201).json({
    whatsappId: channel.whatsappId,
    displayPhoneNumber: channel.displayPhoneNumber,
    verifyToken: channel.verifyToken,
    callbackUrl: `${backendUrl}/api/v1/channels/meta-cloud/${channel.credentialPublicId}/webhook`
  });
};

export const listMetaCloudChannelsHandler = async (
  req: Request,
  res: Response
): Promise<Response> =>
  res.json(await new MetaCloudChannelAdminService().list(req.user.companyId));

export const rotateMetaCloudChannelHandler = async (
  req: Request,
  res: Response
): Promise<Response> =>
  res.json(await new MetaCloudChannelAdminService().rotate(
    req.user.companyId,
    Number(req.params.whatsappId),
    req.body
  ));

export const revokeMetaCloudChannelHandler = async (
  req: Request,
  res: Response
): Promise<Response> => {
  await new MetaCloudChannelAdminService().revoke(
    req.user.companyId,
    Number(req.params.whatsappId)
  );
  return res.status(204).send();
};
