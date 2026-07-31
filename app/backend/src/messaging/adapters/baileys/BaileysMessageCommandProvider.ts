import AppError from "../../../errors/AppError";
import path from "path";
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
  sendText(input: { ticket: any; text: string; messageId: string }): Promise<any>;
  sendNativeButtons?(input: {
    ticket: any;
    text: string;
    buttons: Array<{ id: string; title: string }>;
    messageId: string;
  }): Promise<any>;
  sendContent?(input: {
    ticket: any;
    content: Record<string, unknown>;
    messageId: string;
  }): Promise<any>;
}

const defaultDependencies: BaileysMessageCommandProviderDependencies = {
  findTicket: (id, companyId, whatsappId) =>
    Ticket.findOne({
      where: { id, companyId, whatsappId },
      include: [Contact]
    }),
  sendText: async ({ ticket, text, messageId }) => {
    const { default: adapter } = await import(
      "./getBaileysTicketMessagingProvider"
    );
    return adapter.sendText({ ticket, text, messageId });
  },
  sendNativeButtons: async ({ ticket, text, buttons, messageId }) => {
    const { default: adapter } = await import(
      "./getBaileysTicketMessagingProvider"
    );
    return adapter.sendNativeButtons({ ticket, text, buttons, messageId });
  },
  sendContent: async ({ ticket, content, messageId }) => {
    const { default: adapter } = await import(
      "./getBaileysTicketMessagingProvider"
    );
    return adapter.sendContent({ ticket, content, messageId });
  }
};

const mediaContent = (
  kind: string,
  payload: Record<string, unknown>
): Record<string, unknown> => {
  const link = payload.link;
  const localPath = payload.localPath;
  const mediaSource = typeof link === "string" && /^https:\/\//i.test(link)
    ? link
    : typeof localPath === "string" && /^messaging\/[A-Za-z0-9._-]+$/.test(localPath)
      ? path.resolve(process.cwd(), "storage", localPath)
      : null;
  if (!mediaSource) {
    throw new AppError("URL de midia invalida", 400);
  }
  return {
    [kind]: { url: mediaSource },
    ...(payload.caption ? { caption: payload.caption } : {}),
    ...(kind === "document" && payload.fileName
      ? { fileName: payload.fileName }
      : {}),
    ...(payload.mimeType ? { mimetype: payload.mimeType } : {})
  };
};

const nativeButtons = (
  payload: Record<string, unknown>
): { text: string; buttons: Array<{ id: string; title: string }> } => {
  const text = payload.text;
  const buttons = payload.buttons;
  if (
    typeof text !== "string" ||
    !text.trim() ||
    !Array.isArray(buttons) ||
    buttons.length < 1 ||
    buttons.length > 3
  ) {
    throw new AppError("Payload de botoes invalido", 400);
  }
  return {
    text,
    buttons: buttons.map(button => {
      const item = button as { id?: unknown; title?: unknown };
      if (
        typeof item.id !== "string" ||
        !item.id ||
        Buffer.byteLength(item.id, "utf8") > 256 ||
        typeof item.title !== "string" ||
        !item.title ||
        item.title.length > 20
      ) {
        throw new AppError("Botao nativo invalido", 400);
      }
      return { id: item.id, title: item.title };
    })
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

  // Parameter property keeps the adapter replaceable in tests.
  // eslint-disable-next-line no-useless-constructor
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
      !["text", "buttons", "image", "audio", "video", "document", "reaction", "edit", "delete"].includes(
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
    let buttons:
      | { text: string; buttons: Array<{ id: string; title: string }> }
      | undefined;
    if (command.messageKind !== "text") {
      if (
        command.messageKind === "buttons" &&
        !this.dependencies.sendNativeButtons
      ) {
        throw new PermanentSendError({
          code: "BAILEYS_BUTTONS_UNAVAILABLE",
          message: "Envio de botoes nativos Baileys indisponivel"
        });
      }
      if (!this.dependencies.sendContent) {
        if (command.messageKind !== "buttons") {
          throw new PermanentSendError({
            code: "BAILEYS_MEDIA_UNAVAILABLE",
            message: "Envio de midia Baileys indisponivel"
          });
        }
      }
      try {
        if (command.messageKind === "buttons") {
          buttons = nativeButtons(command.requestPayload);
        } else if (["reaction", "edit", "delete"].includes(command.messageKind)) {
          const target = command.requestPayload.target;
          if (!target || typeof target !== "object") throw new AppError("Mensagem alvo invalida", 400);
          const key = target as Record<string, unknown>;
          if (typeof key.id !== "string" || !key.id) throw new AppError("Mensagem alvo invalida", 400);
          if (command.messageKind === "reaction") {
            if (typeof command.requestPayload.emoji !== "string") throw new AppError("Reacao invalida", 400);
            content = { react: { text: command.requestPayload.emoji, key: { id: key.id, remoteJid: `${command.recipient}@s.whatsapp.net`, fromMe: true } } };
          } else if (command.messageKind === "edit") {
            if (typeof command.requestPayload.text !== "string" || !command.requestPayload.text.trim()) throw new AppError("Edicao invalida", 400);
            content = { text: command.requestPayload.text, edit: { id: key.id, remoteJid: `${command.recipient}@s.whatsapp.net`, fromMe: true } };
          } else {
            content = { delete: { id: key.id, remoteJid: `${command.recipient}@s.whatsapp.net`, fromMe: true } };
          }
        } else {
          content = mediaContent(command.messageKind, command.requestPayload);
        }
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
            text: command.requestPayload.text as string,
            messageId: command.id
          })
        );
      } else if (command.messageKind === "buttons") {
        sent = await withSendTimeout(
          this.dependencies.sendNativeButtons!({
            ticket,
            text: buttons!.text,
            buttons: buttons!.buttons,
            messageId: command.id
          })
        );
      } else {
        sent = await withSendTimeout(
          this.dependencies.sendContent!({
            ticket,
            content: content as Record<string, unknown>,
            messageId: command.id
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
