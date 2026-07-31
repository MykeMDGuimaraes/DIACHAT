import crypto from "crypto";
import fs from "fs";
import path from "path";
import multer from "multer";

export const privateMediaDirectory = path.resolve(process.cwd(), "storage", "messaging");
const maxBytes = Number(process.env.MESSAGING_MEDIA_UPLOAD_MAX_BYTES || 16 * 1024 * 1024);
export const publicMediaUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      fs.mkdirSync(privateMediaDirectory, { recursive: true, mode: 0o700 });
      callback(null, privateMediaDirectory);
    },
    filename: (_req, file, callback) => callback(null, `${crypto.randomUUID()}-${path.basename(file.originalname).replace(/[^A-Za-z0-9._-]/g, "_")}`)
  }),
  limits: { files: 1, fileSize: maxBytes }
});

export const privateMediaRelativePath = (filePath: string): string => {
  const resolved = path.resolve(filePath);
  const relative = path.relative(privateMediaDirectory, resolved);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Invalid private media path");
  return `messaging/${relative}`;
};
