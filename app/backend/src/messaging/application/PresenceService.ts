import AppError from "../../errors/AppError";
import Whatsapp from "../../models/Whatsapp";
import CapabilityResolver from "./CapabilityResolver";

export type PresenceState = "available" | "unavailable" | "composing" | "recording" | "paused";
const validStates = new Set<PresenceState>(["available", "unavailable", "composing", "recording", "paused"]);

class PresenceService {
  private readonly recent = new Map<string, number>();
  constructor(
    private readonly resolveSocket: () => Promise<{ sendPresence: (ticket: any, recipient: string, state: PresenceState) => Promise<void> }>,
    private readonly capabilities = new CapabilityResolver(),
    private readonly now = () => Date.now()
  ) {}

  async send(input: { companyId: number; allowedConnectionIds: number[]; connectionId: number; recipient: string; state: PresenceState; duration?: number }): Promise<void> {
    if (process.env.MESSAGING_PRESENCE_V1_ENABLED !== "true") throw new AppError("FEATURE_NOT_ENABLED", 404);
    if (!input.allowedConnectionIds.includes(input.connectionId)) throw new AppError("Canal de WhatsApp nao autorizado", 403);
    const recipient = input.recipient.replace(/\D/g, "");
    if (recipient.length < 10 || recipient.length > 15 || !validStates.has(input.state)) throw new AppError("Presenca invalida", 400);
    const connection = await Whatsapp.findOne({ where: { id: input.connectionId, companyId: input.companyId } });
    if (!connection) throw new AppError("Canal de WhatsApp nao encontrado", 404);
    this.capabilities.require(connection.channelType, "presence");
    const key = `${input.connectionId}:${recipient}`;
    const last = this.recent.get(key) || 0;
    if (this.now() - last < 2_000) throw new AppError("PRESENCE_RATE_LIMITED", 429);
    this.recent.set(key, this.now());
    const adapter = await this.resolveSocket();
    // Presence must not create a Contact/Ticket or leave any durable trace.
    const ticket = { whatsappId: input.connectionId, isGroup: false, contact: { number: recipient } };
    await adapter.sendPresence(ticket as any, recipient, input.state);
    if (input.duration && input.duration > 0 && input.duration <= 60) {
      setTimeout(() => adapter.sendPresence(ticket as any, recipient, "paused").catch(() => undefined), input.duration * 1000).unref();
    }
  }
}
export default PresenceService;
