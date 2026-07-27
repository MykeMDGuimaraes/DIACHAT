import AppError from "../../../errors/AppError";
import Contact from "../../../models/Contact";
import Ticket from "../../../models/Ticket";
import {
  DispatchableMessageCommand,
  MessagingProvider
} from "../../contracts/MessagingProvider";
import {
  PermanentSendError,
  ProviderSendError,
  RetryableSendError,
  UnknownSendError
} from "../../contracts/ProviderSendError";
import { SEND_TIMEOUT_MS } from "../../domain/MessagingStates";

interface BaileysMessageCommandProviderDependencies {
  findTicket(id: number, companyId: number, whatsappId: number): Promise<any>;
  sendText(input: { ticket: any; text: string }): Promise<any>;
  sendContent?(input: {
    ticket: any;
    content: Record<string, unknown>;
  }): Promise<any>;
}

const defaultDependencies: BaileysMessageCommandProviderDependencies = {
  findTicket: (id, companyId, whatsappId) =>
    Ticket.findOne({
      where: { id, companyId, whatsappId },
      include: [Contact]
    }),
  sendText: async ({ ticket, text }) => {
    const { default: adapter } = await import(
      "./getBaileysTicketMessagingProvider"
    );
    return adapter.sendText({ ticket, text });
  },
  sendContent: async ({ ticket, content }) => {
    const { default: adapter } = await import(
      "./getBaileysTicketMessagingProvider"
    );
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
    ...(kind === "document" && payload.fileName
      ? { fileName: payload.fileName }
      : {}),
    ...(payload.mimeType ? { mimetype: payload.mimeType } : {})
  };
};

const withSendTimeout = async <T>(operation: Promise<T>): Promise<T> => {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(
            new UnknownSendError({
              code: "BAILEYS_SEND_TIMEOUT",
              message:
                "Timeout aguardando confirmacao do Baileys apos sendMessage"
            })
          );
        }, SEND_TIMEOUT_MS);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

class BaileysMessageCommandProvider implements MessagingProvider {
  readonly provider = "baileys";

  constructor(private readonly dependencies = defaultDependencies) {}

  async send(
    command: DispatchableMessageCommand
  ): Promise<{ providerMessageId?: string }> {
    // Validacoes deterministicas: permanentes
    const ticketId = command.requestPayload.ticketId;
    if (!Number.isInteger(ticketId)) {
      throw new PermanentSendError({
        code: "BAILEYS_INVALID_TICKET",
        message: "Ticket da mensagem invalido"
      });
    }
    if (
      command.messageKind === "text" &&
      (typeof command.requestPayload.text !== "string" ||
        !command.requestPayload.text.trim())
    ) {
      throw new PermanentSendError({
        code: "BAILEYS_INVALID_PAYLOAD",
        message: "Payload de texto invalido"
      });
    }
    if (
      !["text", "image", "audio", "video", "document"].includes(
        command.messageKind
      )
    ) {
      throw new PermanentSendError({
        code: "BAILEYS_UNSUPPORTED_KIND",
        message: "Tipo de mensagem nao suportado pelo Baileys"
      });
    }

    // Falhas antes de invocar sendMessage (banco/socket): retryable
    let ticket: any;
    try {
      ticket = await this.dependencies.findTicket(
        ticketId as number,
        command.companyId,
        command.whatsappId
      );
    } catch (error) {
      throw new RetryableSendError({
        code: "BAILEYS_DB_UNAVAILABLE",
        message: "Falha ao carregar ticket antes do envio",
        details: {
          cause: error instanceof Error ? error.message : String(error)
        }
      });
    }
    if (!ticket) {
      throw new PermanentSendError({
        code: "BAILEYS_TICKET_NOT_FOUND",
        message: "Ticket da mensagem nao encontrado"
      });
    }

    let content: Record<string, unknown> | undefined;
    if (command.messageKind !== "text") {
      if (!this.dependencies.sendContent) {
        throw new PermanentSendError({
          code: "BAILEYS_MEDIA_UNAVAILABLE",
          message: "Envio de midia Baileys indisponivel"
        });
      }
      try {
        content = mediaContent(command.messageKind, command.requestPayload);
      } catch (error) {
        throw new PermanentSendError({
          code: "BAILEYS_INVALID_MEDIA",
          message: error instanceof AppError ? error.message : "Midia invalida"
        });
      }
    }

    // A partir daqui o sendMessage pode ter partido: rejeicao/timeout = unknown
    let sent: any;
    try {
      if (command.messageKind === "text") {
        sent = await withSendTimeout(
          this.dependencies.sendText({
            ticket,
            text: command.requestPayload.text as string
          })
        );
      } else {
        sent = await withSendTimeout(
          this.dependencies.sendContent!({
            ticket,
            content: content as Record<string, unknown>
          })
        );
      }
    } catch (error) {
      if (error instanceof ProviderSendError) {
        throw error;
      }
      throw new UnknownSendError({
        code: "BAILEYS_SEND_REJECTED",
        message: "Falha apos invocar sendMessage no Baileys",
        details: {
          cause: error instanceof Error ? error.message : String(error)
        }
      });
    }
    return { providerMessageId: sent?.key?.id };
  }
}

export default BaileysMessageCommandProvider;
