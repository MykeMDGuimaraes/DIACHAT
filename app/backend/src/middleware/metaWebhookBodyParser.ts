import express, { Application, ErrorRequestHandler, Request } from "express";

export const META_WEBHOOK_PATH =
  "/api/v1/channels/meta-cloud/:credentialPublicId/webhook";

// Webhooks Meta carregam metadados e IDs de mídia, não o binário da mídia.
// 1 MiB acomoda callbacks em lote sem manter a cópia global de até 10 MiB.
export const META_WEBHOOK_BODY_LIMIT = "1mb";
const DEFAULT_JSON_BODY_LIMIT = "10mb";

export const configureJsonBodyParsing = (app: Application): void => {
  app.use(
    META_WEBHOOK_PATH,
    express.json({
      limit: META_WEBHOOK_BODY_LIMIT,
      verify: (req, _res, buffer) => {
        (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
      }
    })
  );
  app.use(express.json({ limit: DEFAULT_JSON_BODY_LIMIT }));
};

interface BodyParserError extends Error {
  status?: number;
  statusCode?: number;
  type?: string;
}

export const payloadTooLargeErrorHandler: ErrorRequestHandler = (
  error: BodyParserError,
  _req,
  res,
  next
) => {
  const status = error.status || error.statusCode;
  if (status === 413 && error.type === "entity.too.large") {
    res.status(413).json({ error: "PAYLOAD_TOO_LARGE" });
    return;
  }
  next(error);
};
