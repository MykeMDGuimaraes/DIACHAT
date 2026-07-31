import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import MessageCommand from "../persistence/models/MessageCommand";
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
    filters?: TranscriptFilters;
  }) => Promise<any[]>;
  signAttachment: (messageId: string, companyId: number) => string;
  resolveProviderMessageIds?: (companyId: number, providerMessageId: string) => Promise<string[]>;
}

const defaultDependencies: TranscriptDependencies = {
  findTicket: (conversationId, companyId) =>
    Ticket.findOne({
      where: { uuid: conversationId, companyId },
      attributes: ["id", "uuid", "companyId", "whatsappId"]
    }),
  findMessages: ({ ticketId, companyId, cursor, limit, filters }) =>
    Message.findAll({
      where: {
        ticketId, companyId,
        [Op.and]: [
          ...(cursor ? [{ [Op.or]: [{ createdAt: { [Op.lt]: new Date(cursor.createdAt) } }, { createdAt: new Date(cursor.createdAt), id: { [Op.lt]: cursor.id } }] }] : []),
          ...(filters?.from ? [{ createdAt: { [Op.gte]: new Date(filters.from) } }] : []),
          ...(filters?.to ? [{ createdAt: { [Op.lte]: new Date(filters.to) } }] : [])
        ],
        ...(filters?.fromMe === undefined ? {} : { fromMe: filters.fromMe }),
        ...(filters?.mediaOnly ? { mediaUrl: { [Op.ne]: null } } : {}),
        ...(filters?.type ? { mediaType: filters.type } : {}),
        ...((filters as any)?.messageIds ? { id: { [Op.in]: (filters as any).messageIds } } : {}),
        ...statusWhere(filters?.status)
      },
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"]
      ],
      limit: limit + 1
    }),
  signAttachment: signTranscriptAttachment
  ,resolveProviderMessageIds: async (companyId, providerMessageId) => {
    const commands = await MessageCommand.findAll({ where: { companyId, providerMessageId }, attributes: ["messageId"] });
    return commands.map(command => String(command.messageId)).filter(Boolean);
  }
};

export interface TranscriptFilters {
  from?: string;
  to?: string;
  type?: string;
  fromMe?: boolean;
  mediaOnly?: boolean;
  status?: "accepted" | "sent" | "delivered" | "read" | "failed" | "received";
  providerMessageId?: string;
  /** Internal resolved IDs; never accepted from HTTP. */
  messageIds?: string[];
}

const statusWhere = (status?: TranscriptFilters["status"]): Record<string, unknown> => {
  if (!status) return {};
  if (status === "received") return { fromMe: false };
  if (status === "failed") return { fromMe: true, ack: { [Op.lt]: 0 } };
  if (status === "read") return { fromMe: true, [Op.or]: [{ read: true }, { ack: { [Op.gte]: 4 } }] };
  if (status === "delivered") return { fromMe: true, ack: { [Op.gte]: 3 } };
  if (status === "sent") return { fromMe: true, ack: { [Op.gte]: 1 } };
  return { fromMe: true, ack: { [Op.lte]: 0 } };
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
    filters?: TranscriptFilters;
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

    const providerMessageIds = input.filters?.providerMessageId
      ? await (this.dependencies.resolveProviderMessageIds || defaultDependencies.resolveProviderMessageIds!)(input.companyId, input.filters.providerMessageId)
      : undefined;
    if (providerMessageIds && providerMessageIds.length === 0) return { items: [], nextCursor: null };
    const rows = await this.dependencies.findMessages({
      ticketId: ticket.id,
      companyId: input.companyId,
      cursor,
      limit,
      filters: providerMessageIds ? { ...input.filters, providerMessageId: undefined, messageIds: providerMessageIds } as any : input.filters
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
