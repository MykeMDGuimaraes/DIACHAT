import { Router } from "express";
import apiKeyAuth from "../messaging/api/apiKeyAuth";
import { createIssueApiCredentialHandler } from "../messaging/api/ApiCredentialController";
import { createPublicTextMessageHandler } from "../messaging/api/PublicMessageController";
import requireApiScope from "../messaging/api/requireApiScope";
import { createMetaCloudChannelHandler } from "../messaging/channels/meta-cloud/MetaCloudChannelController";
import isAuth from "../middleware/isAuth";

const messagingApiRoutes = Router();

messagingApiRoutes.post("/credentials", isAuth, createIssueApiCredentialHandler());

messagingApiRoutes.post(
  "/channels/meta-cloud",
  isAuth,
  createMetaCloudChannelHandler()
);

messagingApiRoutes.post(
  "/messages",
  apiKeyAuth,
  requireApiScope("messages:write"),
  createPublicTextMessageHandler()
);

export default messagingApiRoutes;
