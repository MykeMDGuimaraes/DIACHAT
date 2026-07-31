import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import WhatsAppChatState from "../persistence/models/WhatsAppChatState";

type Cursor = { lastMessageAt: string | null; id: string };
const decode = (value: string): Cursor | null => { try { const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")); return typeof parsed.id === "string" ? parsed : null; } catch { return null; } };
const encode = (value: Cursor) => Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
class PublicConversationService {
  async list(input: { companyId: number; connectionIds: number[]; connectionId?: number; cursor?: string; limit?: number }) {
    const limit = input.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError("Limite de conversas invalido", 400);
    const cursor = input.cursor ? decode(input.cursor) : null;
    if (input.cursor && !cursor) throw new AppError("Cursor de conversas invalido", 400);
    const ids = input.connectionId ? [input.connectionId] : input.connectionIds;
    if (input.connectionId && !input.connectionIds.includes(input.connectionId)) throw new AppError("Canal de WhatsApp nao autorizado", 403);
    const rows = await WhatsAppChatState.findAll({ where: { companyId: input.companyId, whatsappId: { [Op.in]: ids }, ...(cursor ? { [Op.or]: [{ lastMessageAt: { [Op.lt]: cursor.lastMessageAt ? new Date(cursor.lastMessageAt) : new Date(0) } }, { lastMessageAt: cursor.lastMessageAt ? new Date(cursor.lastMessageAt) : null, id: { [Op.lt]: cursor.id } }] } : {}) }, order: [["lastMessageAt", "DESC NULLS LAST"], ["id", "DESC"]], limit: limit + 1 });
    const page = rows.slice(0, limit);
    return { items: page.map(row => this.serialize(row)), nextCursor: rows.length > limit && page.length ? encode({ lastMessageAt: page[page.length - 1].lastMessageAt ? new Date(page[page.length - 1].lastMessageAt).toISOString() : null, id: page[page.length - 1].id }) : null };
  }
  async get(input: { companyId: number; connectionIds: number[]; id: string }) {
    const row = await WhatsAppChatState.findOne({ where: { id: input.id, companyId: input.companyId, whatsappId: { [Op.in]: input.connectionIds } } });
    if (!row) throw new AppError("Conversa nao encontrada", 404);
    return this.serialize(row);
  }
  private serialize(row: WhatsAppChatState) { return { id: row.id, connectionId: row.whatsappId, jid: row.jid, lid: row.lid || null, isGroup: row.isGroup, archived: row.archived, pinned: row.pinned, mutedUntil: row.mutedUntil || null, unreadCount: row.unreadCount, lastMessageId: row.lastMessageId || null, lastMessageAt: row.lastMessageAt || null, revision: String(row.revision) }; }
}
export default PublicConversationService;
