import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";
import { lookup as lookupMimeType } from "mime-types";
import {
  privateMediaDirectory,
  privateMediaRelativePath
} from "../api/PublicMediaUpload";
import type { OutboundMessageKind } from "./OutboundMessageService";

const safeFileName = (name: string): string =>
  `${crypto.randomUUID()}-${path
    .basename(name || "midia")
    .replace(/[^A-Za-z0-9._-]/g, "_")}`;

/**
 * Upload duravel ANTES de enfileirar (Task 4): o arquivo sai da pasta
 * temporaria do multer para storage/messaging, de onde o provider Baileys
 * le no momento do envio (pode ser minutos depois, apos retries).
 */
export const persistMessagingUpload = async (file: {
  path: string;
  originalname: string;
}): Promise<string> => {
  await fs.mkdir(privateMediaDirectory, { recursive: true, mode: 0o700 });
  const target = path.join(
    privateMediaDirectory,
    safeFileName(file.originalname)
  );
  try {
    await fs.rename(file.path, target);
  } catch {
    // rename falha entre filesystems distintos: copia e descarta o temp.
    await fs.copyFile(file.path, target);
    await fs.unlink(file.path).catch(() => undefined);
  }
  return privateMediaRelativePath(target);
};

/**
 * Variante de copia para assets que precisam permanecer na origem
 * (ex.: midias de fluxos de automacao servidas da pasta public/).
 */
export const stageMessagingMedia = async (
  sourcePath: string,
  originalName?: string
): Promise<string> => {
  await fs.mkdir(privateMediaDirectory, { recursive: true, mode: 0o700 });
  const target = path.join(
    privateMediaDirectory,
    safeFileName(originalName || path.basename(sourcePath))
  );
  await fs.copyFile(sourcePath, target);
  return privateMediaRelativePath(target);
};

export const messageKindForMime = (
  mimetype?: string | null
): OutboundMessageKind => {
  const mime = mimetype || "";
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("audio/")) return "audio";
  if (mime.startsWith("video/")) return "video";
  return "document";
};

export const messageKindForFile = (filePath: string): OutboundMessageKind => {
  const mime = lookupMimeType(filePath);
  return messageKindForMime(typeof mime === "string" ? mime : "");
};
