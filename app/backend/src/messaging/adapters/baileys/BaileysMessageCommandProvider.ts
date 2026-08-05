import path from "path";
import AppError from "../../../errors/AppError";
import Contact from "../../../models/Contact";
import Message from "../../../models/Message";
import Ticket from "../../../models/Ticket";
import { fetchRemoteMediaSecurely } from "../../application/fetchRemoteMediaSecurely";
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
  findQuotedMessage?(
    id: string,
    ticketId: number,
    companyId: number
  ): Promise<any>;
  sendText(input: {
    ticket: any;
    text: string;
    messageId: string;
    quoted?: any;
  }): Promise<any>;
  sendNativeButtons?(input: {
    ticket: any;
    text: string;
    buttons: Array<{ id: string; title: string }>;
    messageId: string;
    quoted?: any;
  }): Promise<any>;
  sendContent?(input: {
    ticket: any;
    content: Record<string, unknown>;
    messageId: string;
    quoted?: any;
  }): Promise<any>;
}

const defaultDependencies: BaileysMessageCommandProviderDependencies = {
  findTicket: (id, companyId, whatsappId) =>
    Ticket.findOne({
      where: { id, companyId, whatsappId },
      include: [Contact]
    }),
  findQuotedMessage: (id, ticketId, companyId) =>
    Message.findOne({ where: { id, ticketId, companyId } }),
  sendText: async ({ ticket, text, messageId, quoted }) => {
    const { default: adapter } = await import(
      "./getBaileysTicketMessagingProvider"
    );
    return adapter.sendText({ ticket, text, messageId, quoted });
  },
  sendNativeButtons: async ({ ticket, text, buttons, messageId, quoted }) => {
    const { default: adapter } = await import(
      "./getBaileysTicketMessagingProvider"
    );
    return adapter.sendNativeButtons({
      ticket,
      text,
      buttons,
      messageId,
      quoted
    });
  },
  sendContent: async ({ ticket, content, messageId, quoted }) => {
    const { default: adapter } = await import(
      "./getBaileysTicketMessagingProvider"
    );
    return adapter.sendContent({ ticket, content, messageId, quoted });
  }
};

const mediaContent = async (
  kind: string,
  payload: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const link = payload.link;
  const localPath = payload.localPath;
  let stagedLocalPath: string | null = null;
  if (typeof link === "string" && /^https:\/\//i.test(link)) {
    // Anti-SSRF: midia remota e baixada por um fetcher controlado (HTTPS,
    // hostname/DNS publicos, redirects revalidados, limites de tamanho e
    // tempo) e staged em disco — o Baileys NUNCA recebe a URL remota.
    stagedLocalPath = await fetchRemoteMediaSecurely(
      link,
      typeof payload.fileName === "string" ? payload.fileName : undefined
    );
  } else if (
    typeof localPath === "string" &&
    /^messaging\/[A-Za-z0-9._-]+$/.test(localPath)
  ) {
    stagedLocalPath = localPath;
  }
  if (!stagedLocalPath) {
    throw new AppError("URL de midia invalida", 400);
  }
  const mediaSource = path.resolve(process.cwd(), "storage", stagedLocalPath);
  return {
    [kind]: { url: mediaSource },
    ...(payload.caption ? { caption: payload.caption } : {}),
    ...(kind === "document" && payload.fileName
      ? { fileName: payload.fileName }
      : {}),
    ...(payload.mimeType ? { mimetype: payload.mimeType } : {}),
    ...(kind === "audio" && payload.ptt === true ? { ptt: true } : {})
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

// A mensagem citada pode ser uma recebida (dataJson no formato proto) ou
// uma criada upfront pelo outbox (dataJson de dominio): neste caso o
// quoted e sintetizado como texto para o WhatsApp exibir o contexto.
export const buildQuotedMessage = (
  row: any,
  fallbackJid: string
): Record<string, unknown> | undefined => {
  if (!row) return undefined;
  try {
    const parsed =
      typeof row.dataJson === "string" ? JSON.parse(row.dataJson) : null;
    if (parsed?.key && parsed?.message) {
      return { key: parsed.key, message: parsed.message };
    }
  } catch {
    // dataJson fora do formato proto: cai no resumo sintetizado abaixo.
  }
  return {
    key: {
      id: row.id,
      remoteJid: row.remoteJid || fallbackJid,
      fromMe: Boolean(row.fromMe)
    },
    message: { extendedTextMessage: { text: row.body || "" } }
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
  private readonly dependencies: BaileysMessageCommandProviderDependencies;

  constructor(
    dependencies: Partial<BaileysMessageCommandProviderDependencies> = {}
  ) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

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
      ![
        "text",
        "buttons",
        "image",
        "audio",
        "video",
        "document",
        "reaction",
        "edit",
        "delete"
      ].includes(command.messageKind)
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
        } else if (
          ["reaction", "edit", "delete"].includes(command.messageKind)
        ) {
          const target = command.requestPayload.target;
          if (!target || typeof target !== "object")
            throw new AppError("Mensagem alvo invalida", 400);
          const key = target as Record<string, unknown>;
          if (typeof key.id !== "string" || !key.id)
            throw new AppError("Mensagem alvo invalida", 400);
          const targetKey = {
            id: key.id,
            remoteJid:
              typeof key.remoteJid === "string"
                ? key.remoteJid
                : `${command.recipient}@s.whatsapp.net`,
            fromMe: typeof key.fromMe === "boolean" ? key.fromMe : true
          };
          if (command.messageKind === "reaction") {
            if (typeof command.requestPayload.emoji !== "string")
              throw new AppError("Reacao invalida", 400);
            content = {
              react: { text: command.requestPayload.emoji, key: targetKey }
            };
          } else if (command.messageKind === "edit") {
            if (
              typeof command.requestPayload.text !== "string" ||
              !command.requestPayload.text.trim()
            )
              throw new AppError("Edicao invalida", 400);
            content = { text: command.requestPayload.text, edit: targetKey };
          } else {
            content = { delete: targetKey };
          }
        } else {
          content = await mediaContent(
            command.messageKind,
            command.requestPayload
          );
        }
      } catch (error) {
        throw new PermanentSendError({
          code: "BAILEYS_INVALID_MEDIA",
          message: error instanceof AppError ? error.message : "Midia invalida"
        });
      }
    }

    let quoted: Record<string, unknown> | undefined;
    const quotedMessageId = command.requestPayload.quotedMessageId;
    if (
      typeof quotedMessageId === "string" &&
      quotedMessageId &&
      this.dependencies.findQuotedMessage
    ) {
      let quotedRow: any;
      try {
        quotedRow = await this.dependencies.findQuotedMessage(
          quotedMessageId,
          ticketId as number,
          command.companyId
        );
      } catch (error) {
        throw new RetryableSendError({
          code: "BAILEYS_DB_UNAVAILABLE",
          message: "Falha ao carregar mensagem citada antes do envio",
          details: {
            cause: error instanceof Error ? error.message : String(error)
          }
        });
      }
      quoted = buildQuotedMessage(
        quotedRow,
        `${command.recipient}@s.whatsapp.net`
      );
    }

    // A partir daqui o sendMessage pode ter partido: rejeicao/timeout = unknown
    let sent: any;
    try {
      if (command.messageKind === "text") {
        sent = await withSendTimeout(
          this.dependencies.sendText({
            ticket,
            text: command.requestPayload.text as string,
            messageId: command.id,
            quoted
          })
        );
      } else if (command.messageKind === "buttons") {
        sent = await withSendTimeout(
          this.dependencies.sendNativeButtons!({
            ticket,
            text: buttons!.text,
            buttons: buttons!.buttons,
            messageId: command.id,
            quoted
          })
        );
      } else {
        sent = await withSendTimeout(
          this.dependencies.sendContent!({
            ticket,
            content: content as Record<string, unknown>,
            messageId: command.id,
            quoted
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
