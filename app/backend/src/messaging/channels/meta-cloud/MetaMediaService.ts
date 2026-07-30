import { promises as fs } from "fs";
import https from "https";
import path from "path";

import uploadConfig from "../../../config/upload";
import AppError from "../../../errors/AppError";
import MetaGraphApiClient from "../../adapters/meta-cloud/MetaGraphApiClient";
import MetaCloudCredential from "../../persistence/models/MetaCloudCredential";
import {
  decryptMessagingSecret,
  loadMessagingKeyring
} from "../../security/MessagingSecretCipher";
import { NormalizedMetaMessage } from "./MetaCallbackParser";

interface Dependencies {
  findCredential(companyId: number, whatsappId: number): Promise<any>;
  decryptToken(value: string): string;
  getMetadata(input: {
    mediaId: string;
    accessToken: string;
    graphVersion?: string;
  }): Promise<{ url: string; mimeType?: string }>;
  download(url: string, accessToken: string): Promise<Buffer>;
  writeFile(filePath: string, data: Buffer): Promise<void>;
  publicDirectory: string;
}

const downloadHttps = (value: string, accessToken: string): Promise<Buffer> => {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new AppError("URL de midia Meta invalida", 502);
  return new Promise((resolve, reject) => {
    const request = https.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 15000
    }, response => {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        reject(new AppError("Falha ao baixar midia Meta", 502));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on("data", chunk => {
        total += chunk.length;
        if (total > 25 * 1024 * 1024) {
          request.destroy(new Error("Midia Meta excede 25 MB"));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      response.on("end", () => resolve(Buffer.concat(chunks)));
    });
    request.on("timeout", () => request.destroy(new Error("Timeout de midia Meta")));
    request.on("error", reject);
  });
};

const extensionByMime: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "video/mp4": "mp4",
  "application/pdf": "pdf"
};

const defaults = (): Dependencies => {
  const keyring = loadMessagingKeyring();
  const client = new MetaGraphApiClient();
  return {
    findCredential: (companyId, whatsappId) =>
      MetaCloudCredential.findOne({ where: { companyId, whatsappId } }),
    decryptToken: value => decryptMessagingSecret(value, keyring),
    getMetadata: input => client.getMediaMetadata(input),
    download: downloadHttps,
    writeFile: (filePath, data) => fs.writeFile(filePath, data),
    publicDirectory: uploadConfig.directory
  };
};

class MetaMediaService {
  constructor(private readonly dependencies: Dependencies = defaults()) {}

  async download(
    companyId: number,
    whatsappId: number,
    message: NormalizedMetaMessage
  ): Promise<{ fileName: string; mimeType?: string } | undefined> {
    if (!message.mediaId) return undefined;
    const credential = await this.dependencies.findCredential(companyId, whatsappId);
    if (!credential || credential.validationStatus === "REVOKED") {
      throw new AppError("Credencial Meta indisponivel para baixar midia", 409);
    }
    const accessToken = this.dependencies.decryptToken(credential.accessTokenCiphertext);
    const metadata = await this.dependencies.getMetadata({
      mediaId: message.mediaId,
      accessToken,
      graphVersion: credential.graphVersion
    });
    const data = await this.dependencies.download(metadata.url, accessToken);
    const mimeType = message.mimeType || metadata.mimeType;
    const extension = extensionByMime[mimeType || ""] || "bin";
    const safeMessageId = message.providerMessageId.replace(/[^a-zA-Z0-9._-]/g, "_");
    const fileName = `meta-${companyId}-${safeMessageId}.${extension}`;
    await this.dependencies.writeFile(
      path.join(this.dependencies.publicDirectory, fileName),
      data
    );
    return { fileName, mimeType };
  }
}

export default MetaMediaService;
