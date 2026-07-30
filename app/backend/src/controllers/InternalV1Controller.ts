import { Request, Response } from "express";
import { Op, UniqueConstraintError } from "sequelize";

import AppError from "../errors/AppError";
import Contact from "../models/Contact";
import Message from "../models/Message";
import Ticket from "../models/Ticket";
import V1MessageIdempotency from "../models/V1MessageIdempotency";
import SendWhatsAppMessage from "../services/WbotServices/SendWhatsAppMessage";
import SendWhatsAppMedia from "../services/WbotServices/SendWhatsAppMedia";
import { audit, requestIp } from "../libs/auditLog";
import {
  toContactDTO,
  toConversationSummaryDTO,
  toConversationMessageDTO,
  encodeCursor,
  decodeCursor
} from "../services/InternalV1Services/Dtos";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

class ApiV1Error extends Error {
  public statusCode: number;

  public code: string;

  public details?: unknown;

  constructor(
    statusCode: number,
    code: string,
    message: string,
    details?: unknown
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export { ApiV1Error };

const parseLimit = (raw: unknown): number => {
  if (raw === undefined || raw === null || raw === "") return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > MAX_LIMIT) {
    throw new ApiV1Error(
      400,
      "VALIDATION_ERROR",
      `limit deve ser um inteiro entre 1 e ${MAX_LIMIT}`
    );
  }
  return n;
};

const parseCursor = <T>(raw: unknown): T | null => {
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    throw new ApiV1Error(400, "VALIDATION_ERROR", "cursor inválido");
  }
  const decoded = decodeCursor<T>(raw);
  if (!decoded) {
    throw new ApiV1Error(400, "VALIDATION_ERROR", "cursor inválido");
  }
  return decoded;
};

type ContactCursor = { id: number };

export const listContacts = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const limit = parseLimit(req.query.limit);
  const cursor = parseCursor<ContactCursor>(req.query.cursor);
  const search =
    typeof req.query.search === "string" ? req.query.search.trim() : "";

  const where: any = { companyId };
  if (cursor) {
    if (typeof cursor.id !== "number") {
      throw new ApiV1Error(400, "VALIDATION_ERROR", "cursor inválido");
    }
    where.id = { [Op.gt]: cursor.id };
  }
  if (search) {
    where[Op.or] = [
      { name: { [Op.iLike]: `%${search}%` } },
      { number: { [Op.like]: `%${search}%` } }
    ];
  }

  const rows = await Contact.findAll({
    where,
    order: [["id", "ASC"]],
    limit: limit + 1
  });

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const nextCursor =
    hasMore && items.length > 0
      ? encodeCursor({ id: items[items.length - 1].id })
      : null;

  return res.json({ data: items.map(toContactDTO), nextCursor });
};

type ConversationCursor = { updatedAt: string; id: number };

export const listConversations = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const limit = parseLimit(req.query.limit);
  const cursor = parseCursor<ConversationCursor>(req.query.cursor);
  const status = typeof req.query.status === "string" ? req.query.status : "";

  const where: any = { companyId };
  if (status) {
    if (!["open", "pending", "closed"].includes(status)) {
      throw new ApiV1Error(
        400,
        "VALIDATION_ERROR",
        "status deve ser open, pending ou closed"
      );
    }
    where.status = status;
  }
  if (cursor) {
    const updatedAt = new Date(cursor.updatedAt);
    if (Number.isNaN(updatedAt.getTime()) || typeof cursor.id !== "number") {
      throw new ApiV1Error(400, "VALIDATION_ERROR", "cursor inválido");
    }
    where[Op.or] = [
      { updatedAt: { [Op.lt]: updatedAt } },
      { updatedAt, id: { [Op.lt]: cursor.id } }
    ];
  }

  const rows = await Ticket.findAll({
    where,
    include: [{ model: Contact, as: "contact" }],
    order: [
      ["updatedAt", "DESC"],
      ["id", "DESC"]
    ],
    limit: limit + 1
  });

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          updatedAt: new Date(last.updatedAt).toISOString(),
          id: last.id
        })
      : null;

  return res.json({
    data: items.map(toConversationSummaryDTO),
    nextCursor
  });
};

const findConversation = async (
  conversationId: string,
  companyId: number
): Promise<Ticket> => {
  const id = Number(conversationId);
  if (!Number.isInteger(id) || id < 1) {
    throw new ApiV1Error(400, "VALIDATION_ERROR", "id de conversa inválido");
  }
  const ticket = await Ticket.findOne({
    where: { id, companyId },
    include: [{ model: Contact, as: "contact" }]
  });
  if (!ticket) {
    throw new ApiV1Error(404, "NOT_FOUND", "Conversa não encontrada");
  }
  return ticket;
};

export const showConversation = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const ticket = await findConversation(
    req.params.conversationId,
    req.user.companyId
  );
  return res.json({ data: toConversationSummaryDTO(ticket) });
};

type MessageCursor = { createdAt: string; id: string };

export const listConversationMessages = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const ticket = await findConversation(req.params.conversationId, companyId);
  const limit = parseLimit(req.query.limit);
  const cursor = parseCursor<MessageCursor>(req.query.cursor);

  const where: any = { ticketId: ticket.id, companyId };
  if (cursor) {
    const createdAt = new Date(cursor.createdAt);
    if (Number.isNaN(createdAt.getTime()) || typeof cursor.id !== "string") {
      throw new ApiV1Error(400, "VALIDATION_ERROR", "cursor inválido");
    }
    where[Op.or] = [
      { createdAt: { [Op.lt]: createdAt } },
      { createdAt, id: { [Op.lt]: cursor.id } }
    ];
  }

  const rows = await Message.findAll({
    where,
    order: [
      ["createdAt", "DESC"],
      ["id", "DESC"]
    ],
    limit: limit + 1
  });

  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeCursor({
          createdAt: new Date(last.createdAt).toISOString(),
          id: last.id
        })
      : null;

  return res.json({
    data: items.map(toConversationMessageDTO),
    nextCursor
  });
};

const buildSendResult = async (
  messageId: string,
  clientMessageId: string,
  conversationId: number,
  duplicate: boolean,
  companyId: number
) => {
  const message = await Message.findOne({
    where: { id: messageId, ticketId: conversationId, companyId }
  });
  return {
    id: messageId,
    clientMessageId,
    conversationId,
    duplicate,
    message: message ? toConversationMessageDTO(message) : null
  };
};

export const sendConversationMessage = async (
  req: Request,
  res: Response
): Promise<Response> => {
  const { companyId } = req.user;
  const ticket = await findConversation(req.params.conversationId, companyId);
  const media = req.file as Express.Multer.File | undefined;
  const clientMessageId =
    typeof req.body.clientMessageId === "string"
      ? req.body.clientMessageId.trim()
      : "";
  const body = typeof req.body.body === "string" ? req.body.body : "";

  if (!clientMessageId || clientMessageId.length > 191) {
    throw new ApiV1Error(
      400,
      "VALIDATION_ERROR",
      "clientMessageId é obrigatório (string de até 191 caracteres)"
    );
  }
  if (!media && !body.trim()) {
    throw new ApiV1Error(
      400,
      "VALIDATION_ERROR",
      "body é obrigatório quando não há anexo (campo media)"
    );
  }

  const existing = await V1MessageIdempotency.findOne({
    where: { companyId, ticketId: ticket.id, clientMessageId }
  });
  if (existing) {
    if (!existing.messageId) {
      throw new ApiV1Error(
        409,
        "REQUEST_IN_PROGRESS",
        "Envio com este clientMessageId ainda está em processamento"
      );
    }
    const result = await buildSendResult(
      existing.messageId,
      clientMessageId,
      ticket.id,
      true,
      companyId
    );
    audit({
      companyId,
      actorType: "service",
      actorId: req.user.id,
      action: "v1.message.send",
      targetType: "ticket",
      targetId: ticket.id,
      ip: requestIp(req),
      metadata: { clientMessageId, duplicate: true, hasMedia: !!media }
    });
    return res.status(200).json({ data: result });
  }

  if (!ticket.whatsappId) {
    throw new ApiV1Error(
      422,
      "CONVERSATION_NOT_SENDABLE",
      "Conversa não possui conexão WhatsApp associada"
    );
  }

  let record: V1MessageIdempotency;
  try {
    record = await V1MessageIdempotency.create({
      companyId,
      ticketId: ticket.id,
      clientMessageId
    } as any);
  } catch (err) {
    if (err instanceof UniqueConstraintError) {
      const concurrent = await V1MessageIdempotency.findOne({
        where: { companyId, ticketId: ticket.id, clientMessageId }
      });
      if (concurrent && concurrent.messageId) {
        const result = await buildSendResult(
          concurrent.messageId,
          clientMessageId,
          ticket.id,
          true,
          companyId
        );
        return res.status(200).json({ data: result });
      }
      throw new ApiV1Error(
        409,
        "REQUEST_IN_PROGRESS",
        "Envio com este clientMessageId ainda está em processamento"
      );
    }
    throw err;
  }

  try {
    const sent = media
      ? await SendWhatsAppMedia({ media, ticket, body })
      : await SendWhatsAppMessage({ body, ticket });

    const messageId = sent?.key?.id;
    if (!messageId) {
      throw new AppError("ERR_SENDING_WAPP_MSG");
    }
    await record.update({ messageId });

    const result = await buildSendResult(
      messageId,
      clientMessageId,
      ticket.id,
      false,
      companyId
    );
    audit({
      companyId,
      actorType: "service",
      actorId: req.user.id,
      action: "v1.message.send",
      targetType: "ticket",
      targetId: ticket.id,
      ip: requestIp(req),
      metadata: { clientMessageId, duplicate: false, hasMedia: !!media }
    });
    return res.status(201).json({ data: result });
  } catch (err) {
    await record.destroy().catch(() => undefined);
    if (err instanceof AppError) {
      throw new ApiV1Error(
        502,
        "SEND_FAILED",
        `Falha ao enviar a mensagem pelo canal WhatsApp (${err.message}); a operação pode ser repetida com o mesmo clientMessageId`
      );
    }
    throw err;
  }
};
