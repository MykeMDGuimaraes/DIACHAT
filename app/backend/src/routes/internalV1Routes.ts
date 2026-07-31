import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";

import isServiceAuth from "../middleware/isServiceAuth";
import uploadConfig from "../config/upload";
import AppError from "../errors/AppError";
import * as InternalV1Controller from "../controllers/InternalV1Controller";
import { streamEvents } from "../controllers/InternalV1EventsController";
import { ApiV1Error } from "../controllers/InternalV1Controller";
import {
  messagingCapacityProbe,
  messagingCapacityReplay,
  messagingMetrics
} from "../messaging/public/http";

const upload = multer(uploadConfig);

const internalV1Routes = Router();

internalV1Routes.use(isServiceAuth);

internalV1Routes.get("/messaging/metrics", messagingMetrics);
internalV1Routes.post("/messaging/capacity-probe", messagingCapacityProbe);
internalV1Routes.post("/messaging/capacity-replay", messagingCapacityReplay);
internalV1Routes.get("/events", streamEvents);
internalV1Routes.get("/contacts", InternalV1Controller.listContacts);
internalV1Routes.get("/conversations", InternalV1Controller.listConversations);
internalV1Routes.get(
  "/conversations/:conversationId",
  InternalV1Controller.showConversation
);
internalV1Routes.get(
  "/conversations/:conversationId/messages",
  InternalV1Controller.listConversationMessages
);
internalV1Routes.post(
  "/conversations/:conversationId/messages",
  upload.single("media"),
  InternalV1Controller.sendConversationMessage
);

internalV1Routes.use(
  (err: Error, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ApiV1Error) {
      return res.status(err.statusCode).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {})
        }
      });
    }
    if (err instanceof AppError) {
      const code =
        err.statusCode === 401
          ? "UNAUTHORIZED"
          : err.statusCode === 404
          ? "NOT_FOUND"
          : "BAD_REQUEST";
      return res.status(err.statusCode).json({
        error: { code, message: err.message }
      });
    }
    console.error("internal/v1 error:", err);
    return res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Erro interno" }
    });
  }
);

export default internalV1Routes;
