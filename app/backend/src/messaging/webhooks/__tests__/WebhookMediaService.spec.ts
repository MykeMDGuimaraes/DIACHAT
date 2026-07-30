import { promises as fs } from "fs";
import os from "os";
import path from "path";

import WebhookMediaService from "../WebhookMediaService";
import {
  resetWhatsAppMirrorMetricsForTests,
  snapshotWhatsAppMirrorMetrics
} from "../../operations/WhatsAppMirrorMetrics";

describe("WebhookMediaService", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "diachat-webhook-media-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    resetWhatsAppMirrorMetricsForTests();
  });

  it("projects only a protected signed file descriptor and returns the same safe file for access", async () => {
    await fs.mkdir(path.join(root, "company-7"));
    await fs.writeFile(
      path.join(root, "company-7", "photo.jpg"),
      Buffer.from("media-bytes", "utf8")
    );
    const service = new WebhookMediaService({
      root,
      loadMessage: jest.fn().mockResolvedValue({
        storedPath: "company-7/photo.jpg",
        mediaType: "image",
        body: "legenda"
      }),
      signUrl: jest
        .fn()
        .mockReturnValue("/api/v1/webhook-media/message-1?sig=signed")
    });

    await expect(
      service.project(7, "message-1", new Date("2026-07-29T12:00:00.000Z"))
    ).resolves.toEqual({
      type: "image",
      mimeType: "image/jpeg",
      fileName: "photo.jpg",
      sizeBytes: 11,
      sha256:
        "bd7aa67d0cee967e6fca8ef4917e3c70445a9cfe0f3d91ddd2eeff1bfe4b2069",
      url: "/api/v1/webhook-media/message-1?sig=signed",
      available: true,
      caption: "legenda"
    });
    await expect(service.open(7, "message-1")).resolves.toEqual({
      absolutePath: path.join(root, "company-7", "photo.jpg"),
      mimeType: "image/jpeg"
    });
    expect(snapshotWhatsAppMirrorMetrics()).toMatchObject({
      media: { available: 1, unavailable: 0, failures: 0 }
    });
  });

  it.each([
    "company-7/missing.jpg",
    "../outside.jpg",
    "company-7/../../outside.jpg"
  ])(
    "projects unavailable and returns 404 for a missing or unsafe path: %s",
    async storedPath => {
      const service = new WebhookMediaService({
        root,
        loadMessage: jest.fn().mockResolvedValue({
          storedPath,
          mediaType: "image",
          body: null
        }),
        signUrl: jest.fn()
      });

      await expect(service.project(7, "message-1")).resolves.toEqual({
        type: "image",
        mimeType: "image/jpeg",
        fileName: path.basename(storedPath),
        sizeBytes: null,
        sha256: null,
        url: null,
        available: false,
        caption: null
      });
      await expect(service.open(7, "message-1")).rejects.toMatchObject({
        statusCode: 404
      });
      expect(snapshotWhatsAppMirrorMetrics()).toMatchObject({
        media: { available: 0, unavailable: 1, failures: 0 }
      });
    }
  );
});
