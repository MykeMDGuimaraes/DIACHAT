import AppError from "../../../errors/AppError";
import Contact from "../../../models/Contact";
import Ticket from "../../../models/Ticket";
import { DispatchableMessageCommand, MessagingProvider } from "../../contracts/MessagingProvider";

interface BaileysMessageCommandProviderDependencies {
  findTicket(id: number, companyId: number, whatsappId: number): Promise<any>;
  sendText(input: { ticket: any; text: string }): Promise<any>;
  sendContent?(input: { ticket: any; content: Record<string, unknown> }): Promise<any>;
}

const defaultDependencies: BaileysMessageCommandProviderDependencies = {
  findTicket: (id, companyId, whatsappId) =>
    Ticket.findOne({ where: { id, companyId, whatsappId }, include: [Contact] }),
  sendText: async ({ ticket, text }) => {
    const { default: adapter } = await import("./getBaileysTicketMessagingProvider");
    return adapter.sendText({ ticket, text });
  },
  sendContent: async ({ ticket, content }) => {
    const { default: adapter } = await import("./getBaileysTicketMessagingProvider");
    return adapter.sendContent({ ticket, content });
  }
};

const mediaContent = (
  kind: string,
  payload: Record<string, unknown>
): Record<string, unknown> => {
  const link = payload.link;
  if (typeof link !== "string" || !/^https:\/\//i.test(link)) {
    throw new AppError("URL de midia invalida", 400);
  }
  return {
    [kind]: { url: link },
    ...(payload.caption ? { caption: payload.caption } : {}),
    ...(kind === "document" && payload.fileName ? { fileName: payload.fileName } : {}),
    ...(payload.mimeType ? { mimetype: payload.mimeType } : {})
  };
};

class BaileysMessageCommandProvider implements MessagingProvider {
  readonly provider = "baileys";

  constructor(private readonly dependencies = defaultDependencies) {}

  async send(command: DispatchableMessageCommand): Promise<{ providerMessageId?: string }> {
    const ticketId = command.requestPayload.ticketId;
    if (!Number.isInteger(ticketId)) {
      throw new AppError("Ticket da mensagem invalido", 400);
    }
    if (
      command.messageKind === "text" &&
      (typeof command.requestPayload.text !== "string" ||
        !command.requestPayload.text.trim())
    ) {
      throw new AppError("Payload de texto invalido", 400);
    }
    if (
      !["text", "image", "audio", "video", "document"].includes(command.messageKind)
    ) {
      throw new AppError("Tipo de mensagem nao suportado pelo Baileys", 400);
    }
    const ticket = await this.dependencies.findTicket(
      ticketId as number,
      command.companyId,
      command.whatsappId
    );
    if (!ticket) {
      throw new AppError("Ticket da mensagem nao encontrado", 404);
    }

    let sent: any;
    if (command.messageKind === "text") {
      sent = await this.dependencies.sendText({
        ticket,
        text: command.requestPayload.text as string
      });
    } else if (["image", "audio", "video", "document"].includes(command.messageKind)) {
      if (!this.dependencies.sendContent) {
        throw new AppError("Envio de midia Baileys indisponivel", 500);
      }
      sent = await this.dependencies.sendContent({
        ticket,
        content: mediaContent(command.messageKind, command.requestPayload)
      });
    }
    return { providerMessageId: sent?.key?.id };
  }
}

export default BaileysMessageCommandProvider;
