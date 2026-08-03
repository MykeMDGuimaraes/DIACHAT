import type { WAMessage, WASocket } from "baileys";
import type Ticket from "../../../models/Ticket";
import { RetryableSendError } from "../../contracts/ProviderSendError";
import { sendBaileysSocketMessage } from "./BaileysSocketPort";
import { resolveContactJid } from "./BaileysContactIdentity";

type TicketSocket = Pick<WASocket, "sendMessage"> & {
  relayMessage?: WASocket["relayMessage"];
  user?: WASocket["user"];
  sendPresenceUpdate?: WASocket["sendPresenceUpdate"];
};

interface SendTicketTextInput {
  ticket: Ticket;
  text: string;
  messageId?: string;
  quoted?: WAMessage;
}

interface SendTicketContentInput {
  ticket: Ticket;
  content: Record<string, unknown>;
  messageId?: string;
  quoted?: WAMessage;
}

interface SendNativeButtonsInput {
  ticket: Ticket;
  text: string;
  buttons: Array<{ id: string; title: string }>;
  messageId: string;
  quoted?: WAMessage;
}

type NativeButtonsRelay = (
  socket: Pick<WASocket, "relayMessage" | "user">,
  jid: string,
  text: string,
  buttons: Array<{ id: string; title: string }>,
  messageId: string,
  quoted?: WAMessage
) => Promise<WAMessage>;

const defaultNativeButtonsRelay: NativeButtonsRelay = async (...args) => {
  const { relayNativeButtons } = await import("./BaileysNativeButtonsTransport");
  return relayNativeButtons(...args);
};

class BaileysTicketMessagingProvider {
  // Parameter properties keep socket and relay ports replaceable in tests.
  // eslint-disable-next-line no-useless-constructor
  constructor(
    private readonly getSocket: (ticket: Ticket) => Promise<TicketSocket>,
    private readonly nativeButtonsRelay: NativeButtonsRelay = defaultNativeButtonsRelay
  ) {}

  async sendText({
    ticket,
    text,
    messageId,
    quoted
  }: SendTicketTextInput): Promise<WAMessage> {
    return this.sendContent({ ticket, content: { text }, messageId, quoted });
  }

  async sendContent({
    ticket,
    content,
    messageId,
    quoted
  }: SendTicketContentInput): Promise<WAMessage> {
    // Socket indisponivel acontece ANTES de sendMessage: falha retryable
    let socket: TicketSocket;
    try {
      socket = await this.getSocket(ticket);
    } catch (error) {
      throw new RetryableSendError({
        code: "BAILEYS_SOCKET_UNAVAILABLE",
        message: "Sessao Baileys indisponivel antes do envio",
        details: {
          cause: error instanceof Error ? error.message : String(error)
        }
      });
    }
    const jid = resolveContactJid({
      number: ticket.contact.number,
      lid: (ticket.contact as any).lid,
      jidServer: (ticket.contact as any).jidServer,
      isGroup: ticket.isGroup
    });

    return sendBaileysSocketMessage(
      socket,
      jid,
      content as any,
      quoted || messageId ? { ...(quoted ? { quoted } : {}), messageId } : undefined
    );
  }

  async sendNativeButtons({
    ticket,
    text,
    buttons,
    messageId,
    quoted
  }: SendNativeButtonsInput): Promise<WAMessage> {
    let socket: TicketSocket;
    try {
      socket = await this.getSocket(ticket);
    } catch (error) {
      throw new RetryableSendError({
        code: "BAILEYS_SOCKET_UNAVAILABLE",
        message: "Sessao Baileys indisponivel antes do envio",
        details: {
          cause: error instanceof Error ? error.message : String(error)
        }
      });
    }
    if (!socket.relayMessage || !socket.user?.id) {
      throw new RetryableSendError({
        code: "BAILEYS_INTERACTIVE_SOCKET_UNAVAILABLE",
        message: "Socket Baileys sem suporte interativo"
      });
    }
    const jid = resolveContactJid({
      number: ticket.contact.number,
      lid: (ticket.contact as any).lid,
      jidServer: (ticket.contact as any).jidServer,
      isGroup: ticket.isGroup
    });
    return this.nativeButtonsRelay(
      socket as Pick<WASocket, "relayMessage" | "user">,
      jid,
      text,
      buttons,
      messageId,
      quoted
    );
  }

  async sendPresence(ticket: Ticket, recipient: string, presence: "available" | "unavailable" | "composing" | "recording" | "paused"): Promise<void> {
    let socket: TicketSocket;
    try {
      socket = await this.getSocket(ticket);
    } catch (error) {
      throw new RetryableSendError({
        code: "BAILEYS_SOCKET_UNAVAILABLE",
        message: "Sessao Baileys indisponivel para presenca",
        details: { cause: error instanceof Error ? error.message : String(error) }
      });
    }
    if (!socket.sendPresenceUpdate) {
      throw new RetryableSendError({ code: "BAILEYS_PRESENCE_UNAVAILABLE", message: "Socket Baileys sem presenca" });
    }
    await socket.sendPresenceUpdate(presence, `${recipient}@s.whatsapp.net`);
  }
}

export default BaileysTicketMessagingProvider;
