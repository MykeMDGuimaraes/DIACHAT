import { createHash } from "crypto";
import { createReadStream, promises as fs } from "fs";
import path from "path";
import { lookup as lookupMimeType } from "mime-types";

import uploadConfig from "../../config/upload";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import { WhatsAppMirrorMedia } from "./WhatsAppMirrorPayloadBuilder";
import { signWebhookMediaUrl } from "./WebhookMediaToken";
import { recordWhatsAppMirrorMetric } from "../operations/WhatsAppMirrorMetrics";

interface StoredWebhookMedia {
  storedPath: string | null;
  mediaType: string | null;
  body: string | null;
}

interface WebhookMediaDependencies {
  root: string;
  loadMessage(
    companyId: number,
    messageId: string
  ): Promise<StoredWebhookMedia | null>;
  signUrl(messageId: string, companyId: number, now?: Date): string;
}

const defaultDependencies: WebhookMediaDependencies = {
  root: uploadConfig.directory,
  loadMessage: async (companyId, messageId) => {
    const message = await Message.findOne({
      where: { id: messageId, companyId },
      attributes: ["id", "mediaUrl", "mediaType", "body"]
    });
    if (!message) return null;
    return {
      storedPath: message.getDataValue("mediaUrl") || null,
      mediaType: message.mediaType || null,
      body: message.body || null
    };
  },
  signUrl: signWebhookMediaUrl
};

const mimeTypeFor = (storedPath: string | null): string | null => {
  if (!storedPath) return null;
  const value = lookupMimeType(storedPath);
  return typeof value === "string" ? value : null;
};

const sha256File = (absolutePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(absolutePath);
    stream.on("data", chunk => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(digest.digest("hex")));
  });

class WebhookMediaService {
  private readonly dependencies: WebhookMediaDependencies;

  constructor(dependencies: Partial<WebhookMediaDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  private async safeFile(storedPath: string | null): Promise<{
    absolutePath: string;
    sizeBytes: number;
  } | null> {
    if (
      !storedPath ||
      path.isAbsolute(storedPath) ||
      storedPath.includes("\0")
    ) {
      return null;
    }
    const root = path.resolve(this.dependencies.root);
    const candidate = path.resolve(root, storedPath);
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      return null;
    }
    try {
      const [realRoot, realTarget] = await Promise.all([
        fs.realpath(root),
        fs.realpath(candidate)
      ]);
      const realRelative = path.relative(realRoot, realTarget);
      if (
        !realRelative ||
        realRelative.startsWith("..") ||
        path.isAbsolute(realRelative)
      ) {
        return null;
      }
      const stat = await fs.stat(realTarget);
      if (!stat.isFile()) return null;
      return { absolutePath: realTarget, sizeBytes: stat.size };
    } catch {
      return null;
    }
  }

  async project(
    companyId: number,
    messageId: string,
    now = new Date()
  ): Promise<WhatsAppMirrorMedia | null> {
    try {
      const message = await this.dependencies.loadMessage(companyId, messageId);
      if (!message || (!message.storedPath && !message.mediaType)) return null;
      const storedPath = message.storedPath;
      const common = {
        type: message.mediaType,
        mimeType: mimeTypeFor(storedPath),
        fileName: storedPath ? path.basename(storedPath) : null,
        caption: message.body
      };
      const file = await this.safeFile(storedPath);
      if (!file) {
        recordWhatsAppMirrorMetric("mediaUnavailable");
        return {
          ...common,
          sizeBytes: null,
          sha256: null,
          url: null,
          available: false
        };
      }
      const projected = {
        ...common,
        sizeBytes: file.sizeBytes,
        sha256: await sha256File(file.absolutePath),
        url: this.dependencies.signUrl(messageId, companyId, now),
        available: true
      };
      recordWhatsAppMirrorMetric("mediaAvailable");
      return projected;
    } catch (error) {
      recordWhatsAppMirrorMetric("mediaFailure");
      throw error;
    }
  }

  async open(
    companyId: number,
    messageId: string
  ): Promise<{ absolutePath: string; mimeType: string | null }> {
    const message = await this.dependencies.loadMessage(companyId, messageId);
    const file = await this.safeFile(message?.storedPath || null);
    if (!message || !file) {
      throw new AppError("Mídia de webhook não encontrada", 404);
    }
    return {
      absolutePath: file.absolutePath,
      mimeType: mimeTypeFor(message.storedPath)
    };
  }
}

export default WebhookMediaService;
