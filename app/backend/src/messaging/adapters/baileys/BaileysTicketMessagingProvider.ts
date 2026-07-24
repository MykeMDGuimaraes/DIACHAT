import type { WAMessage, WASocket } from "baileys";
import type Ticket from "../../../models/Ticket";
import { sendBaileysSocketMessage } from "./BaileysSocketPort";

type TicketSocket = Pick<WASocket, "sendMessage">;

interface SendTicketTextInput {
  ticket: Ticket;
  text: string;
  quoted?: WAMessage;
}

interface SendTicketContentInput {
  ticket: Ticket;
  content: Record<string, unknown>;
  quoted?: WAMessage;
}

class BaileysTicketMessagingProvider {
  constructor(
    private readonly getSocket: (ticket: Ticket) => Promise<TicketSocket>
  ) {}

  async sendText({ ticket, text, quoted }: SendTicketTextInput): Promise<WAMessage> {
    return this.sendContent({ ticket, content: { text }, quoted });
  }

  async sendContent({ ticket, content, quoted }: SendTicketContentInput): Promise<WAMessage> {
    const socket = await this.getSocket(ticket);
    const jid = `${ticket.contact.number}@${
      ticket.isGroup ? "g.us" : "s.whatsapp.net"
    }`;

    return sendBaileysSocketMessage(
      socket,
      jid,
      content as any,
      quoted ? { quoted } : undefined
    );
  }
}

export default BaileysTicketMessagingProvider;
