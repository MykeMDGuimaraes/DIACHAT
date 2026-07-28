import MessagingOutboxEvent from "../persistence/models/MessagingOutboxEvent";
import { logger } from "../../utils/logger";

interface EmitDomainEventInput {
  companyId: number;
  eventType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

// Emissão "best effort": a outbox alimenta os webhooks externos, mas uma
// falha aqui nunca pode quebrar o fluxo principal de mensagens.
export const emitMessagingDomainEvent = async (
  input: EmitDomainEventInput
): Promise<void> => {
  try {
    await MessagingOutboxEvent.create({
      companyId: input.companyId,
      eventType: input.eventType,
      aggregateId: input.aggregateId,
      payload: input.payload,
      status: "ready",
      attemptCount: 0,
      availableAt: new Date()
    } as any);
  } catch (error) {
    logger.error(`[webhooks] falha ao emitir ${input.eventType}: ${error}`);
  }
};

const kindByMediaType: Record<string, string> = {
  image: "image",
  imageMessage: "image",
  audio: "audio",
  audioMessage: "audio",
  ptt: "audio",
  video: "video",
  videoMessage: "video",
  document: "document",
  documentMessage: "document",
  application: "document"
};

export const normalizeMessageKind = (mediaType?: string): string =>
  (mediaType && kindByMediaType[mediaType]) || "text";

interface EmitMessageReceivedInput {
  companyId: number;
  messageId: string;
  ticketId: number;
  contactId?: number;
  whatsappId?: number;
  mediaType?: string;
}

// Ponto único de emissão de message.received para canais que não passam pelo
// pipeline Meta Cloud (hoje: conexões Baileys).
export const emitMessageReceived = async (
  input: EmitMessageReceivedInput
): Promise<void> => {
  if (!input.whatsappId) {
    // Sem whatsappId o filtro de conexões da assinatura não consegue casar;
    // registrar para não perder webhooks silenciosamente.
    logger.warn(
      `[webhooks] message.received não emitido: ticket ${input.ticketId} sem whatsappId (mensagem ${input.messageId})`
    );
    return;
  }
  await emitMessagingDomainEvent({
    companyId: input.companyId,
    eventType: "message.received",
    aggregateId: input.messageId,
    payload: {
      messageId: input.messageId,
      whatsappId: input.whatsappId,
      kind: normalizeMessageKind(input.mediaType),
      origin: "whatsapp",
      ticketId: input.ticketId,
      contactId: input.contactId
    }
  });
};
