import { v4 as uuidv4 } from "uuid";
import sequelize from "../../database";
import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import MessageCommand from "../persistence/models/MessageCommand";
import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import { createRequestFingerprint, validateIdempotencyKey } from "../domain/IdempotencyKey";
import CapabilityResolver from "./CapabilityResolver";

export type MessageMutationKind = "reaction" | "edit" | "delete";
class MessageMutationService {
  constructor(private readonly capabilities = new CapabilityResolver()) {}
  async create(input: { companyId: number; allowedConnectionIds: number[]; idempotencyScope: string; idempotencyKey: string; messageId: string; kind: MessageMutationKind; emoji?: string; text?: string }): Promise<{ command: any; replayed: boolean }> {
    const idempotencyKey = validateIdempotencyKey(input.idempotencyKey);
    if (input.kind === "reaction" && (typeof input.emoji !== "string" || input.emoji.length > 32)) throw new AppError("Reacao invalida", 400);
    if (input.kind === "edit" && (!input.text || !input.text.trim())) throw new AppError("Edicao invalida", 400);
    return sequelize.transaction(async transaction => {
      const message = await Message.findOne({ where: { id: input.messageId, companyId: input.companyId }, transaction, lock: transaction.LOCK.UPDATE });
      if (!message) throw new AppError("Mensagem nao encontrada", 404);
      const ticket = await Ticket.findOne({ where: { id: message.ticketId, companyId: input.companyId }, include: [Contact], transaction });
      if (!ticket || !input.allowedConnectionIds.includes(Number(ticket.whatsappId))) throw new AppError("Mensagem nao autorizada", 403);
      const provider = "baileys";
      const capability = input.kind === "reaction" ? "reactions" : input.kind === "edit" ? "messageEdit" : "messageDelete";
      if (!this.capabilities.resolve("baileys").capabilities[capability]) throw new AppError("CAPABILITY_NOT_SUPPORTED", 422);
      const targetId = await MessageCommand.findOne({ where: { messageId: String(message.id), companyId: input.companyId }, order: [["createdAt", "DESC"]], transaction });
      if (!targetId?.providerMessageId) throw new AppError("Mensagem ainda nao pode ser alterada", 409);
      const requestPayload = { ticketId: ticket.id, target: { id: targetId.providerMessageId }, ...(input.emoji !== undefined ? { emoji: input.emoji } : {}), ...(input.text !== undefined ? { text: input.text } : {}) };
      const fingerprint = createRequestFingerprint({ provider, messageKind: input.kind, recipient: ticket.contact.number, requestPayload });
      const existing = await MessageCommand.findOne({ where: { companyId: input.companyId, idempotencyScope: input.idempotencyScope, idempotencyKey }, transaction });
      if (existing) {
        if (existing.requestFingerprint !== fingerprint) throw new AppError("IDEMPOTENCY_CONFLICT", 409);
        if (!existing.responseSnapshot) throw new AppError("REQUEST_IN_PROGRESS", 409);
        return { command: existing, replayed: true };
      }
      const id = uuidv4();
      const command = await MessageCommand.create({ id, companyId: input.companyId, whatsappId: ticket.whatsappId, provider, messageKind: input.kind, recipient: ticket.contact.number, idempotencyScope: input.idempotencyScope, idempotencyKey, requestFingerprint: fingerprint, requestPayload, status: "queued", attemptCount: 0, messageId: String(message.id), conversationId: ticket.uuid, contactId: String(message.contactId), responseSnapshot: { id, status: "accepted", messageId: String(message.id), conversationId: ticket.uuid, contactId: String(message.contactId) } } as any, { transaction });
      await MessagingOutboxEvent.create({ companyId: input.companyId, eventType: "message.dispatch.requested", aggregateId: id, payload: { commandId: id }, status: "ready", attemptCount: 0 } as any, { transaction });
      return { command, replayed: false };
    });
  }
}
export default MessageMutationService;
