import type { WAMessage, WASocket } from "baileys";
import type Ticket from "../../../models/Ticket";

type TicketSocket = Pick<WASocket, "sendMessage">;

interface SendTicketTextInput {
  ticket: Ticket;
  text: string;
  quoted?: WAMessage;
}

class BaileysTicketMessagingProvider {
  constructor(
    private readonly getSocket: (ticket: Ticket) => Promise<TicketSocket>
  ) {}

  async sendText({ ticket, text, quoted }: SendTicketTextInput): Promise<WAMessage> {
    const socket = await this.getSocket(ticket);
    const jid = `${ticket.contact.number}@${
      ticket.isGroup ? "g.us" : "s.whatsapp.net"
    }`;

    return socket.sendMessage(
      jid,
      { text },
      quoted ? { quoted } : undefined
    );
  }
}

export default BaileysTicketMessagingProvider;
