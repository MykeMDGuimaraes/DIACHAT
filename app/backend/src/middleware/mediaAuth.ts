import { verify } from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import path from "path";
import authConfig from "../config/auth";
import Message from "../models/Message";
import QuickMessage from "../models/QuickMessage";
import Announcement from "../models/Announcement";
import Campaign from "../models/Campaign";
import Schedule from "../models/Schedule";
import { FlowAudioModel } from "../models/FlowAudio";
import { FlowImgModel } from "../models/FlowImg";
import FilesOptions from "../models/FilesOptions";
import Files from "../models/Files";

interface TokenPayload {
  id: string;
  companyId: number;
}

const PUBLIC_ALLOWLIST = new Set([
  "logo.png",
  "logotipos",
  "nopicture.png",
  "favicon.ico"
]);

const notFound = (res: Response): Response =>
  res.status(404).json({ error: "ERR_NOT_FOUND" });

const mediaAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<Response | void> => {
  let relPath: string;
  try {
    relPath = decodeURIComponent(req.path);
  } catch {
    return res.status(400).json({ error: "ERR_BAD_REQUEST" });
  }

  const normalized = path.posix.normalize(relPath).replace(/^\/+/, "");
  if (
    !normalized ||
    normalized.startsWith("..") ||
    normalized.includes("../") ||
    normalized.includes("\\") ||
    path.isAbsolute(normalized)
  ) {
    return notFound(res);
  }

  const segments = normalized.split("/").filter(Boolean);
  if (segments.length === 0) {
    return notFound(res);
  }
  const filename = segments[segments.length - 1];

  if (PUBLIC_ALLOWLIST.has(segments[0])) {
    return next();
  }

  let token: string | undefined;
  const authHeader = req.headers.authorization;
  if (authHeader) {
    [, token] = authHeader.split(" ");
  }
  if (!token && typeof req.query.token === "string") {
    token = req.query.token;
  }
  if (!token) {
    return res.status(401).json({ error: "ERR_SESSION_EXPIRED" });
  }

  let companyId: number;
  try {
    const decoded = verify(token, authConfig.secret) as unknown as TokenPayload;
    companyId = decoded.companyId;
  } catch {
    return res.status(401).json({ error: "ERR_INVALID_TOKEN" });
  }

  // quickMessage/<mediaPath> — exatamente como gerado pelo model QuickMessage
  if (segments[0] === "quickMessage") {
    const record = await QuickMessage.findOne({
      where: { mediaPath: filename, companyId },
      attributes: ["id"]
    });
    if (record && normalized === `quickMessage/${filename}`) {
      return next();
    }
    return notFound(res);
  }

  // announcements/<mediaPath>
  if (segments[0] === "announcements") {
    const record = await Announcement.findOne({
      where: { mediaPath: filename, companyId },
      attributes: ["id"]
    });
    if (record && normalized === `announcements/${filename}`) {
      return next();
    }
    return notFound(res);
  }

  // Arquivos na raiz de /public: mensagens, agendamentos, campanhas,
  // mídia de fluxo (FlowAudio/FlowImg) e anúncios legados (URL flat).
  if (segments.length === 1) {
    const [message, schedule, campaign, flowAudio, flowImg, announcement] =
      await Promise.all([
        Message.findOne({
          where: { mediaUrl: filename, companyId },
          attributes: ["id"]
        }),
        Schedule.findOne({
          where: { mediaPath: filename, companyId },
          attributes: ["id"]
        }),
        Campaign.findOne({
          where: { mediaPath: filename, companyId },
          attributes: ["id"]
        }),
        FlowAudioModel.findOne({
          where: { name: filename, companyId },
          attributes: ["id"]
        }),
        FlowImgModel.findOne({
          where: { name: filename, companyId },
          attributes: ["id"]
        }),
        Announcement.findOne({
          where: { mediaPath: filename, companyId },
          attributes: ["id"]
        })
      ]);
    if (
      message ||
      schedule ||
      campaign ||
      flowAudio ||
      flowImg ||
      announcement
    ) {
      return next();
    }
    return notFound(res);
  }

  // Subpastas do recurso "Files" (lista de arquivos): <typeArch>/<fileId>/<nome>
  const fileOption = await FilesOptions.findOne({
    where: { path: filename },
    attributes: ["id"],
    include: [
      {
        model: Files,
        as: "file",
        where: { companyId },
        attributes: ["id"],
        required: true
      }
    ]
  });
  if (fileOption) {
    return next();
  }

  return notFound(res);
};

export default mediaAuth;
