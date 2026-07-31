jest.mock("../database", () => ({}));
jest.mock("../queues", () => ({
  messageQueue: {},
  sendScheduledMessages: {}
}));
jest.mock(
  "../middleware/mediaAuth",
  () => (_req: unknown, _res: unknown, next: () => void) => next()
);
jest.mock("@sentry/node", () => ({
  init: jest.fn(),
  Handlers: {
    requestHandler: () => (_req: unknown, _res: unknown, next: () => void) =>
      next(),
    errorHandler:
      () =>
      (
        error: unknown,
        _req: unknown,
        _res: unknown,
        next: (nextError: unknown) => void
      ) =>
        next(error)
  }
}));
jest.mock("../routes", () => {
  const express = require("express");
  const routes = express.Router();
  const describeBody = (req: any, res: any) =>
    res.json({
      body: req.body,
      hasRawBody: Buffer.isBuffer(req.rawBody),
      rawBody: Buffer.isBuffer(req.rawBody)
        ? req.rawBody.toString("utf8")
        : null
    });

  routes.post("/test/json-body", describeBody);
  routes.post(
    "/api/v1/channels/meta-cloud/:credentialPublicId/webhook",
    describeBody
  );
  return { __esModule: true, default: routes };
});

import request from "supertest";
import app from "../app";

describe("application JSON body parsing", () => {
  it("parses ordinary JSON requests without retaining a raw-body copy", async () => {
    const response = await request(app)
      .post("/test/json-body")
      .send({ message: "ordinary" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      body: { message: "ordinary" },
      hasRawBody: false,
      rawBody: null
    });
  });

  it("preserves the 10 MiB limit for ordinary JSON without retaining raw body", async () => {
    const data = "x".repeat(200 * 1024);
    const response = await request(app).post("/test/json-body").send({ data });

    expect(response.status).toBe(200);
    expect(response.body.body.data).toHaveLength(data.length);
    expect(response.body.hasRawBody).toBe(false);
    expect(response.body.rawBody).toBeNull();
  });

  it("retains the exact raw body only for the Meta callback", async () => {
    const payload = '{"object":"whatsapp_business_account","entry":[]}';
    const response = await request(app)
      .post("/api/v1/channels/meta-cloud/credential_1/webhook")
      .set("Content-Type", "application/json")
      .send(payload);

    expect(response.status).toBe(200);
    expect(response.body.body).toEqual({
      object: "whatsapp_business_account",
      entry: []
    });
    expect(response.body.hasRawBody).toBe(true);
    expect(response.body.rawBody).toBe(payload);
  });

  it("rejects Meta callback payloads larger than 1 MiB with 413", async () => {
    const response = await request(app)
      .post("/api/v1/channels/meta-cloud/credential_1/webhook")
      .send({ data: "x".repeat(1024 * 1024) });

    expect(response.status).toBe(413);
    expect(response.body).toEqual({ error: "PAYLOAD_TOO_LARGE" });
  });
});
