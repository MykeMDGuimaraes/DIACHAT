import { createHash } from "crypto";
import { createReadStream, promises as fs } from "fs";
import path from "path";
import { lookup as lookupMimeType } from "mime-types";

import uploadConfig from "../../config/upload";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { privateMediaDirectory } from "../api/PublicMediaUpload";
import { signTranscriptAttachmentDetails } from "./TranscriptAttachmentSigner";

export type MessageMediaFormat = "url" | "download" | "base64";

export interface ResolvedMessageMedia {
  messageId: string;
  absolutePath: string;
  fileName: string;
  mediaType: string | null;
  mimeType: string | null;
  sizeBytes: number;
  sha256: string;
}

interface MessageMediaDependencies {
  findMessage(companyId: number, messageId: string): Promise<any | null>;
  findTicket(companyId: number, ticketId: number): Promise<any | null>;
  realpath(value: string): Promise<string>;
  stat(value: string): Promise<{ isFile(): boolean; size: number }>;
  readFile(value: string): Promise<Buffer>;
  hashFile(value: string): Promise<string>;
}

const hashFile = (absolutePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const digest = createHash("sha256");
    const stream = createReadStream(absolutePath);
    stream.on("data", chunk => digest.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(digest.digest("hex")));
  });

const defaultDependencies: MessageMediaDependencies = {
  findMessage: (companyId, messageId) =>
    Message.findOne({
      where: { id: messageId, companyId },
      attributes: ["id", "mediaUrl", "mediaType", "ticketId"]
    }),
  findTicket: (companyId, ticketId) =>
    Ticket.findOne({
      where: { id: ticketId, companyId },
      attributes: ["id", "whatsappId"]
    }),
  realpath: value => fs.realpath(value),
  stat: value => fs.stat(value),
  readFile: value => fs.readFile(value),
  hashFile
};

const rawValue = (record: any, field: string): any =>
  typeof record?.getDataValue === "function"
    ? record.getDataValue(field)
    : record?.[field];

class MessageMediaService {
  private readonly dependencies: MessageMediaDependencies;

  constructor(dependencies: Partial<MessageMediaDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  private async safeFile(storedPath: string): Promise<{ absolutePath: string; sizeBytes: number }> {
    if (!storedPath || path.isAbsolute(storedPath) || storedPath.includes("\0")) {
      throw new AppError("Anexo nao encontrado", 404);
    }

    const privateUpload = storedPath.startsWith("messaging/");
    const root = path.resolve(
      privateUpload ? path.dirname(privateMediaDirectory) : uploadConfig.directory
    );
    const candidate = path.resolve(root, storedPath);
    const relative = path.relative(root, candidate);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new AppError("Anexo nao encontrado", 404);
    }

    try {
      const [realRoot, realTarget] = await Promise.all([
        this.dependencies.realpath(root),
        this.dependencies.realpath(candidate)
      ]);
      const realRelative = path.relative(realRoot, realTarget);
      if (!realRelative || realRelative.startsWith("..") || path.isAbsolute(realRelative)) {
        throw new AppError("Anexo nao encontrado", 404);
      }
      const stat = await this.dependencies.stat(realTarget);
      if (!stat.isFile()) throw new AppError("Anexo nao encontrado", 404);
      return { absolutePath: realTarget, sizeBytes: stat.size };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Anexo nao encontrado", 404);
    }
  }

  async resolve(input: {
    companyId: number;
    allowedConnectionIds: number[];
    messageId: string;
  }): Promise<ResolvedMessageMedia> {
    const message = await this.dependencies.findMessage(input.companyId, input.messageId);
    const storedPath = rawValue(message, "mediaUrl");
    const ticketId = Number(rawValue(message, "ticketId"));
    if (!message || typeof storedPath !== "string" || !storedPath || !Number.isInteger(ticketId)) {
      throw new AppError("Anexo nao encontrado", 404);
    }

    const ticket = await this.dependencies.findTicket(input.companyId, ticketId);
    if (!ticket || !input.allowedConnectionIds.includes(Number(rawValue(ticket, "whatsappId")))) {
      // Do not reveal that media exists on another connection of the company.
      throw new AppError("Anexo nao encontrado", 404);
    }

    const file = await this.safeFile(storedPath);
    const mime = lookupMimeType(file.absolutePath);
    return {
      messageId: String(rawValue(message, "id")),
      absolutePath: file.absolutePath,
      fileName: path.basename(file.absolutePath),
      mediaType: rawValue(message, "mediaType") || null,
      mimeType: typeof mime === "string" ? mime : null,
      sizeBytes: file.sizeBytes,
      sha256: await this.dependencies.hashFile(file.absolutePath)
    };
  }

  async json(
    media: ResolvedMessageMedia,
    options: { includeUrl: boolean; includeBase64: boolean; companyId: number }
  ): Promise<Record<string, unknown>> {
    const signed = options.includeUrl
      ? signTranscriptAttachmentDetails(media.messageId, options.companyId)
      : null;
    const result: Record<string, unknown> = {
      messageId: media.messageId,
      mediaType: media.mediaType,
      mimeType: media.mimeType,
      fileName: media.fileName,
      sizeBytes: media.sizeBytes,
      sha256: media.sha256,
      available: true,
      // `url` is kept for clients of the original endpoint contract.
      url: signed?.url || null,
      downloadUrl: signed?.url || null,
      expiresAt: signed?.expiresAt || null
    };

    if (options.includeBase64) {
      const configuredLimit = Number(
        process.env.MESSAGING_MEDIA_BASE64_MAX_BYTES || 10 * 1024 * 1024
      );
      const maxBytes = Number.isFinite(configuredLimit) && configuredLimit > 0
        ? configuredLimit
        : 10 * 1024 * 1024;
      if (media.sizeBytes > maxBytes) {
        throw new AppError("MEDIA_BASE64_TOO_LARGE", 413);
      }
      result.encoding = "base64";
      result.base64 = (await this.dependencies.readFile(media.absolutePath)).toString("base64");
    }

    return result;
  }
}

export default MessageMediaService;
