import AppError from "../../../errors/AppError";
import Contact from "../../../models/Contact";
import Ticket from "../../../models/Ticket";
import { DispatchableMessageCommand, MessagingProvider } from "../../contracts/MessagingProvider";

interface BaileysMessageCommandProviderDependencies {
  findTicket: (
    id: number,
    companyId: number,
    whatsappId: number
  ) => Promise<any>;
  sendText: (input: { ticket: any; text: string }) => Promise<any>;
}

const defaultDependencies: BaileysMessageCommandProviderDependencies = {
  findTicket: (id, companyId, whatsappId) =>
    Ticket.findOne({
      where: { id, companyId, whatsappId },
      include: [Contact]
    }),
  sendText: async ({ ticket, text }) => {
    const { default: baileysTicketMessagingProvider } = await import(
      "./getBaileysTicketMessagingProvider"
    );
    return baileysTicketMessagingProvider.sendText({ ticket, text });
  }
};

class BaileysMessageCommandProvider implements MessagingProvider {
  readonly provider = "baileys";

  constructor(private readonly dependencies = defaultDependencies) {}

  async send(command: DispatchableMessageCommand): Promise<{ providerMessageId?: string }> {
    const ticketId = command.requestPayload.ticketId;
    const text = command.requestPayload.text;

    if (
      command.messageKind !== "text" ||
      !Number.isInteger(ticketId) ||
      typeof text !== "string" ||
      text.trim().length === 0
    ) {
      throw new AppError("Payload de texto invÃ¡lido", 400);
    }

    const ticket = await this.dependencies.findTicket(
      ticketId as number,
      command.companyId,
      command.whatsappId
    );
    if (!ticket) {
      throw new AppError("Ticket da mensagem nÃ£o encontrado", 404);
    }

    const sent = await this.dependencies.sendText({ ticket, text });
    return { providerMessageId: sent?.key?.id };
  }
}

export default BaileysMessageCommandProvider;
