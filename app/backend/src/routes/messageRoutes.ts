import { Router } from "express";
import multer from "multer";
import isAuth from "../middleware/isAuth";
import uploadConfig from "../config/upload";
import tokenAuth from "../middleware/tokenAuth";
import legacyApiDeprecation from "../messaging/api/legacyApiDeprecation";

import * as MessageController from "../controllers/MessageController";

const messageRoutes = Router();

const upload = multer(uploadConfig);

messageRoutes.get("/messages/:ticketId", isAuth, MessageController.index);
messageRoutes.post("/messages/:ticketId", isAuth, upload.array("medias"), MessageController.store);
messageRoutes.delete("/messages/:messageId", isAuth, MessageController.remove);
messageRoutes.post(
  "/api/messages/send",
  tokenAuth,
  legacyApiDeprecation,
  upload.array("medias"),
  MessageController.send
);

export default messageRoutes;
