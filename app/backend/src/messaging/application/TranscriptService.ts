import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import { signTranscriptAttachment } from "./TranscriptAttachmentSigner";

interface TranscriptCursor {
  createdAt: string;
  id: string;
}

export const encodeTranscriptCursor = (cursor: TranscriptCursor): string =>
  Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");

export const decodeTranscriptCursor = (
  cursor: string
): TranscriptCursor | null => {
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    );
    if (
      typeof parsed?.createdAt !== "string" ||
      Number.isNaN(new Date(parsed.createdAt).getTime()) ||
      typeof parsed?.id !== "string"
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
};

interface TranscriptDependencies {
  findTicket: (conversationId: string, companyId: number) => Promise<any>;
  findMessages: (input: {
    ticketId: number;
    companyId: number;
    cursor: TranscriptCursor | null;
    limit: number;
  }) => Promise<any[]>;
  signAttachment: (messageId: string, companyId: number) => string;
}

const defaultDependencies: TranscriptDependencies = {
  findTicket: (conversationId, companyId) =>
    Ticket.findOne({
      where: { uuid: conversationId, companyId },
      attributes: ["id", "uuid", "companyId", "whatsappId"]
    }),
  findMessages: ({ ticketId, companyId, cursor, limit }) =>
    Message.findAll({
      where: {
        ticketId,
        companyId,
        ...(cursor
          ? {
              [Op.or]: [
                { createdAt: { [Op.lt]: new Date(cursor.createdAt) } },
                {
                  createdAt: new Date(cursor.createdAt),
                  id: { [Op.lt]: cursor.id }
                }
              ]
            }
          : {})
      },
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"]
      ],
      limit: limit + 1
    }),
  signAttachment: signTranscriptAttachment
};

const statusFor = (message: any): string => {
  if (!message.fromMe) return "received";
  if (message.ack < 0) return "failed";
  if (message.read || message.ack >= 4) return "read";
  if (message.ack >= 3) return "delivered";
  if (message.ack >= 1) return "sent";
  return "accepted";
};

const actorFor = (message: any): "contact" | "automation" | "human" => {
  if (!message.fromMe) return "contact";
  try {
    const data =
      typeof message.dataJson === "string"
        ? JSON.parse(message.dataJson)
        : message.dataJson;
    if (data?.origin === "api" || data?.origin === "automation") {
      return "automation";
    }
  } catch {
    // Dados históricos inválidos não alteram o isolamento ou a paginação.
  }
  return "human";
};

class TranscriptService {
  // Parameter property keeps transcript storage and signing independently testable.
  // eslint-disable-next-line no-useless-constructor
  constructor(private readonly dependencies = defaultDependencies) {}

  async list(input: {
    companyId: number;
    allowedConnectionIds: number[];
    conversationId: string;
    cursor?: string;
    limit?: number;
  }): Promise<{ items: Record<string, unknown>[]; nextCursor: string | null }> {
    const limit = input.limit === undefined ? 50 : Number(input.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new AppError("Limite do transcript inválido", 400);
    }
    const cursor = input.cursor ? decodeTranscriptCursor(input.cursor) : null;
    if (input.cursor && !cursor) {
      throw new AppError("Cursor do transcript inválido", 400);
    }

    const ticket = await this.dependencies.findTicket(
      input.conversationId,
      input.companyId
    );
    if (
      !ticket ||
      !input.allowedConnectionIds.includes(Number(ticket.whatsappId))
    ) {
      throw new AppError("Conversa não encontrada", 404);
    }

    const rows = await this.dependencies.findMessages({
      ticketId: ticket.id,
      companyId: input.companyId,
      cursor,
      limit
    });
    const page = rows.slice(0, limit);
    const items = page.map(message => {
      const storedMedia = message.getDataValue("mediaUrl");
      return {
        id: String(message.id),
        conversationId: input.conversationId,
        contactId:
          message.contactId === null || message.contactId === undefined
            ? null
            : String(message.contactId),
        actorType: actorFor(message),
        body: message.body || "",
        status: statusFor(message),
        mediaType: message.mediaType || null,
        attachmentUrl: storedMedia
          ? this.dependencies.signAttachment(
              String(message.id),
              input.companyId
            )
          : null,
        isDeleted: Boolean(message.isDeleted),
        createdAt: new Date(message.createdAt).toISOString()
      };
    });
    const last = page[page.length - 1];

    return {
      items,
      nextCursor:
        rows.length > limit && last
          ? encodeTranscriptCursor({
              createdAt: new Date(last.createdAt).toISOString(),
              id: String(last.id)
            })
          : null
    };
  }
}

export default TranscriptService;
