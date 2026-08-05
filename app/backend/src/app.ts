import "./bootstrap";
import "reflect-metadata";
import "express-async-errors";
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import fs from "fs";
import * as Sentry from "@sentry/node";

import "./database";
import uploadConfig from "./config/upload";
import mediaAuth from "./middleware/mediaAuth";
import { privateMediaDirectory } from "./messaging/public/outbound";
import AppError from "./errors/AppError";
import routes from "./routes";
import { logger } from "./utils/logger";
import { messageQueue, sendScheduledMessages } from "./queues";
import {
  configureJsonBodyParsing,
  payloadTooLargeErrorHandler
} from "./middleware/metaWebhookBodyParser";

Sentry.init({ dsn: process.env.SENTRY_DSN });

const app = express();

app.set("queues", {
  messageQueue,
  sendScheduledMessages
});

configureJsonBodyParsing(app);

app.use(
  cors({
    credentials: true,
    origin: process.env.FRONTEND_URL
  })
);
app.use(cookieParser());
app.use(Sentry.Handlers.requestHandler());
app.use("/public", mediaAuth, express.static(uploadConfig.directory));
// Midia privada do outbox (storage/messaging): mesmo contrato de auth do
// /public, servida da raiz storage/ para URLs /media/messaging/<arquivo>.
app.use(
  "/media",
  mediaAuth,
  express.static(path.dirname(privateMediaDirectory))
);

const frontendBuildDir = path.resolve(
  __dirname,
  "..",
  "..",
  "frontend",
  "build"
);
const indexHtmlPath = path.join(frontendBuildDir, "index.html");
const serveFrontend = fs.existsSync(indexHtmlPath);

// Navegação direta/refresh em rotas do SPA (ex.: /tickets/:uuid): o request de
// documento não carrega Authorization e cairia nas rotas da API (isAuth -> 401
// JSON). Servimos o index.html antes das rotas quando é um GET de documento.
if (serveFrontend) {
  app.use((req: Request, res: Response, next: NextFunction) => {
    const accept = req.headers.accept || "";
    if (
      req.method === "GET" &&
      accept.includes("text/html") &&
      !req.headers.authorization
    ) {
      return res.sendFile(indexHtmlPath);
    }
    return next();
  });
}

app.use(routes);

if (serveFrontend) {
  app.use(express.static(frontendBuildDir));
  app.get("*", (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" && req.accepts("html")) {
      return res.sendFile(indexHtmlPath);
    }
    return next();
  });
} else {
  app.get("*", (req: Request, res: Response, next: NextFunction) => {
    const frontendUrl = process.env.FRONTEND_URL;
    if (frontendUrl && req.method === "GET" && req.accepts("html")) {
      return res.redirect(302, `${frontendUrl}${req.originalUrl}`);
    }
    return next();
  });
}

app.use(Sentry.Handlers.errorHandler());
app.use(payloadTooLargeErrorHandler);

app.use(async (err: Error, req: Request, res: Response, _: NextFunction) => {
  if (err instanceof AppError) {
    logger.warn(err);
    return res.status(err.statusCode).json({ error: err.message });
  }

  logger.error(err);
  return res.status(500).json({ error: "ERR_INTERNAL_SERVER_ERROR" });
});

export default app;
