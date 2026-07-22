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
import AppError from "./errors/AppError";
import routes from "./routes";
import { logger } from "./utils/logger";
import { messageQueue, sendScheduledMessages } from "./queues";
import bodyParser from 'body-parser';

Sentry.init({ dsn: process.env.SENTRY_DSN });

const app = express();

app.set("queues", {
  messageQueue,
  sendScheduledMessages
});

const bodyparser = require('body-parser');
app.use(bodyParser.json({ limit: '10mb' }));

app.use(
  cors({
    credentials: true,
    origin: process.env.FRONTEND_URL
  })
);
app.use(cookieParser());
app.use(express.json());
app.use(Sentry.Handlers.requestHandler());
app.use("/public", mediaAuth, express.static(uploadConfig.directory));
app.use(routes);

const frontendBuildDir = path.resolve(
  __dirname,
  "..",
  "..",
  "frontend",
  "build"
);
const serveFrontend = fs.existsSync(
  path.join(frontendBuildDir, "index.html")
);

if (serveFrontend) {
  app.use(express.static(frontendBuildDir));
  app.get("*", (req: Request, res: Response, next: NextFunction) => {
    if (req.method === "GET" && req.accepts("html")) {
      return res.sendFile(path.join(frontendBuildDir, "index.html"));
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

app.use(async (err: Error, req: Request, res: Response, _: NextFunction) => {

  if (err instanceof AppError) {
    logger.warn(err);
    return res.status(err.statusCode).json({ error: err.message });
  }

  logger.error(err);
  return res.status(500).json({ error: "ERR_INTERNAL_SERVER_ERROR" });
});

export default app;
