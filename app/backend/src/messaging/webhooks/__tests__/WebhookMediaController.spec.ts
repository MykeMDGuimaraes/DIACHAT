import "express-async-errors";
import express, { NextFunction, Request, Response } from "express";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import request from "supertest";

import { createWebhookMediaHandler } from "../WebhookMediaController";
import { signWebhookMediaUrl } from "../WebhookMediaToken";

const keyring = {
  activeKeyId: "v1",
  keys: { v1: Buffer.alloc(32, 9).toString("base64") }
};

describe("WebhookMediaController", () => {
  let root: string;
  let mediaPath: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "diachat-media-route-"));
    mediaPath = path.join(root, "photo.jpg");
    await fs.writeFile(mediaPath, Buffer.from("protected-media", "utf8"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  const buildApp = (service: { open: jest.Mock }) => {
    const app = express();
    app.get(
      "/api/v1/webhook-media/:messageId",
      createWebhookMediaHandler(service as any, () => keyring)
    );
    app.use(
      (
        error: any,
        _req: Request,
        res: Response,
        _next: NextFunction
      ): Response =>
        res
          .status(error.statusCode || 500)
          .json({ error: error.message || "internal error" })
    );
    return app;
  };

  it("serves a protected file only when the signed token matches the route tuple", async () => {
    const now = new Date();
    const signed = signWebhookMediaUrl("message-1", 7, now, keyring);
    const service = {
      open: jest.fn().mockResolvedValue({
        absolutePath: mediaPath,
        mimeType: "image/jpeg"
      })
    };

    const response = await request(buildApp(service)).get(signed);

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toMatch(/^image\/jpeg/);
    expect(response.body).toEqual(Buffer.from("protected-media", "utf8"));
    expect(service.open).toHaveBeenCalledWith(7, "message-1");
  });

  it("rejects a tampered token before looking up a file", async () => {
    const signed = new URL(
      signWebhookMediaUrl("message-1", 7, new Date(), keyring),
      "https://dia-chat.invalid"
    );
    signed.searchParams.set("companyId", "8");
    const service = { open: jest.fn() };

    const response = await request(buildApp(service)).get(
      `${signed.pathname}${signed.search}`
    );

    expect(response.status).toBe(401);
    expect(service.open).not.toHaveBeenCalled();
  });
});
