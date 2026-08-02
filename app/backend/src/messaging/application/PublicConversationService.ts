import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import { resolveContactJid } from "../adapters/baileys/BaileysContactIdentity";
import Contact from "../../models/Contact";
import Queue from "../../models/Queue";
import Ticket from "../../models/Ticket";
import User from "../../models/User";
import WhatsAppChatState from "../persistence/models/WhatsAppChatState";

type Cursor = { updatedAt: string; id: number };

const decode = (value: string): Cursor | null => {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof parsed.id === "number" && typeof parsed.updatedAt === "string" && !Number.isNaN(new Date(parsed.updatedAt).getTime()) ? parsed : null;
  } catch {
    return null;
  }
};
const encode = (value: Cursor): string => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");

const jidFor = (ticket: Ticket): string | null => {
  const contact = ticket.get("contact") as Contact | undefined;
  if (!contact?.number) return null;
  return resolveContactJid({ ...contact, isGroup: ticket.isGroup });
};

class PublicConversationService {
  async list(input: { companyId: number; connectionIds: number[]; connectionId?: number; cursor?: string; limit?: number }) {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError("Limite de conversas invalido", 400);
    const cursor = input.cursor ? decode(input.cursor) : null;
    if (input.cursor && !cursor) throw new AppError("Cursor de conversas invalido", 400);
    const ids = input.connectionId ? [input.connectionId] : input.connectionIds;
    if (input.connectionId && !input.connectionIds.includes(input.connectionId)) throw new AppError("Canal de WhatsApp nao autorizado", 403);
    if (ids.length === 0) return { items: [], nextCursor: null };

    const rows = await Ticket.findAll({
      where: {
        companyId: input.companyId,
        whatsappId: { [Op.in]: ids },
        ...(cursor ? { [Op.or]: [{ updatedAt: { [Op.lt]: new Date(cursor.updatedAt) } }, { updatedAt: new Date(cursor.updatedAt), id: { [Op.lt]: cursor.id } }] } : {})
      },
      include: [{ model: Contact, attributes: ["id", "name", "number"] }, { model: Queue, attributes: ["id", "name"], required: false }, { model: User, attributes: ["id", "name"], required: false }],
      order: [["updatedAt", "DESC"], ["id", "DESC"]],
      limit: limit + 1
    });
    return this.page(rows, limit, input.companyId);
  }

  async get(input: { companyId: number; connectionIds: number[]; id: string }) {
    const ticket = await Ticket.findOne({
      where: { uuid: input.id, companyId: input.companyId, whatsappId: { [Op.in]: input.connectionIds } },
      include: [{ model: Contact, attributes: ["id", "name", "number"] }, { model: Queue, attributes: ["id", "name"], required: false }, { model: User, attributes: ["id", "name"], required: false }]
    });
    if (!ticket) throw new AppError("Conversa nao encontrada", 404);
    const states = await this.statesFor([ticket], input.companyId);
    return this.serialize(ticket, states.get(`${ticket.whatsappId}:${jidFor(ticket)}`));
  }

  private async page(rows: Ticket[], limit: number, companyId: number) {
    const page = rows.slice(0, limit);
    const states = await this.statesFor(page, companyId);
    const last = page[page.length - 1];
    return {
      items: page.map(ticket => this.serialize(ticket, states.get(`${ticket.whatsappId}:${jidFor(ticket)}`))),
      nextCursor: rows.length > limit && last ? encode({ updatedAt: new Date(last.updatedAt).toISOString(), id: Number(last.id) }) : null
    };
  }

  private async statesFor(tickets: Ticket[], companyId: number): Promise<Map<string, WhatsAppChatState>> {
    const tuples = tickets.map(ticket => ({ whatsappId: Number(ticket.whatsappId), jid: jidFor(ticket) })).filter((item): item is { whatsappId: number; jid: string } => Boolean(item.jid));
    if (tuples.length === 0) return new Map();
    const states = await WhatsAppChatState.findAll({ where: { companyId, [Op.or]: tuples } });
    return new Map(states.map(state => [`${state.whatsappId}:${state.jid}`, state]));
  }

  private serialize(ticket: Ticket, state?: WhatsAppChatState) {
    const contact = ticket.get("contact") as Contact | undefined;
    const queue = ticket.get("queue") as Queue | undefined;
    const user = ticket.get("user") as User | undefined;
    return {
      id: ticket.uuid,
      connectionId: ticket.whatsappId,
      status: ticket.status,
      contact: contact ? { id: String(contact.id), name: contact.name || null, phone: contact.number || null } : null,
      queue: queue ? { id: queue.id, name: queue.name } : null,
      assignee: user ? { id: user.id, name: user.name } : null,
      chat: state ? { jid: state.jid, lid: state.lid || null, isGroup: state.isGroup, archived: state.archived, pinned: state.pinned, mutedUntil: state.mutedUntil || null, unreadCount: state.unreadCount, lastMessageId: state.lastMessageId || null, lastMessageAt: state.lastMessageAt || null, revision: String(state.revision) } : null,
      lastMessage: ticket.lastMessage || null,
      updatedAt: ticket.updatedAt.toISOString()
    };
  }
}

export default PublicConversationService;
