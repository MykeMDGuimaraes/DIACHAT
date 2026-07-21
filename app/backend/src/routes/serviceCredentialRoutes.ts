import { Router } from "express";
import isAuth from "../middleware/isAuth";
import isSuper from "../middleware/isSuper";
import isServiceAuth from "../middleware/isServiceAuth";
import * as ServiceCredentialController from "../controllers/ServiceCredentialController";

const serviceCredentialRoutes = Router();

serviceCredentialRoutes.get(
  "/service-credentials",
  isAuth,
  isSuper,
  ServiceCredentialController.index
);

serviceCredentialRoutes.post(
  "/service-credentials",
  isAuth,
  isSuper,
  ServiceCredentialController.store
);

serviceCredentialRoutes.delete(
  "/service-credentials/:id",
  isAuth,
  isSuper,
  ServiceCredentialController.revoke
);

// Rota de verificação para chamadas serviço-a-serviço (BFF).
serviceCredentialRoutes.get(
  "/service/me",
  isServiceAuth,
  ServiceCredentialController.me
);

export default serviceCredentialRoutes;
