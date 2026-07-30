import { createHash } from "crypto";
import Message from "../../models/Message";
import WhatsAppMirrorPayloadBuilder, {
  WhatsAppMirrorMedia,
  WhatsAppMirrorPayloadInput,
  WhatsAppMirrorSerializedSnapshot
} from "./WhatsAppMirrorPayloadBuilder";
import WebhookMediaService from "./WebhookMediaService";

export interface WhatsAppMirrorSourceEvent {
  id: string;
  companyId: number;
  eventType: string;
  aggregateId: string;
  payload: Record<string, any>;
  createdAt: Date;
  leaseToken: string;
  attemptCount?: number;
}

interface ProjectionDependencies {
  loadMessage(companyId: number, messageId: string): Promise<any | null>;
  builder: Pick<WhatsAppMirrorPayloadBuilder, "buildSnapshot">;
  projectMedia(
    companyId: number,
    messageId: string,
    now: Date
  ): Promise<WhatsAppMirrorMedia | null>;
  now(): Date;
}

const webhookMediaService = new WebhookMediaService();

const defaultDependencies: ProjectionDependencies = {
  loadMessage: (companyId, messageId) =>
    Message.findOne({
      where: { id: messageId, companyId },
      attributes: ["id", "body", "fromMe", "mediaType", "createdAt"]
    }),
  builder: new WhatsAppMirrorPayloadBuilder(),
  projectMedia: (companyId, messageId, now) =>
    webhookMediaService.project(companyId, messageId, now),
  now: () => new Date()
};

const dateOrNull = (value: unknown): string | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

const hasPersistedMedia = (mediaType: unknown): boolean =>
  typeof mediaType === "string" &&
  ![
    "",
    "text",
    "conversation",
    "extendedTextMessage",
    "buttonsResponseMessage",
    "templateButtonReplyMessage",
    "interactiveResponseMessage",
    "listResponseMessage",
    "reactionMessage",
    "editedMessage",
    "protocolMessage"
  ].includes(mediaType);

class WhatsAppMirrorProjectionService {
  private readonly dependencies: ProjectionDependencies;

  constructor(dependencies: Partial<ProjectionDependencies> = {}) {
    this.dependencies = { ...defaultDependencies, ...dependencies };
  }

  async buildLegacySnapshot(
    event: WhatsAppMirrorSourceEvent,
    persistedEnvelope?: Record<string, any>
  ): Promise<Pick<WhatsAppMirrorSerializedSnapshot, "rawBody" | "bodySha256">> {
    const envelopeData =
      persistedEnvelope?.data && typeof persistedEnvelope.data === "object"
        ? persistedEnvelope.data
        : event.payload || {};
    const messageId =
      envelopeData.messageId === null || envelopeData.messageId === undefined
        ? null
        : String(envelopeData.messageId);
    const persistedMessage =
      event.eventType === "message.received" &&
      envelopeData.actorType === "contact" &&
      messageId
        ? await this.dependencies.loadMessage(event.companyId, messageId)
        : null;
    const data = persistedMessage?.body
      ? { ...envelopeData, text: persistedMessage.body }
      : envelopeData;
    const envelope = persistedEnvelope
      ? { ...persistedEnvelope, data }
      : {
          id: event.id,
          type: event.eventType,
          createdAt: event.createdAt
            ? new Date(event.createdAt).toISOString()
            : new Date().toISOString(),
          data
        };
    const rawBody = JSON.stringify(envelope);
    return {
      rawBody,
      bodySha256: createHash("sha256")
        .update(Buffer.from(rawBody, "utf8"))
        .digest("hex")
    };
  }

  async buildSnapshot(
    event: WhatsAppMirrorSourceEvent
  ): Promise<WhatsAppMirrorSerializedSnapshot> {
    const source = event.payload || {};
    const messageId =
      source.messageId === null || source.messageId === undefined
        ? null
        : String(source.messageId);
    const persistedMessage = messageId
      ? await this.dependencies.loadMessage(event.companyId, messageId)
      : null;
    const nestedMessage = source.message || {};
    const protectedMedia =
      messageId &&
      (nestedMessage.media || hasPersistedMedia(persistedMessage?.mediaType))
        ? await this.dependencies.projectMedia(
            event.companyId,
            messageId,
            this.dependencies.now()
          )
        : null;
    const fromMe =
      nestedMessage.fromMe ??
      source.fromMe ??
      (persistedMessage?.fromMe === undefined
        ? null
        : Boolean(persistedMessage.fromMe));
    const input: WhatsAppMirrorPayloadInput = {
      eventType: event.eventType,
      occurredAt: event.createdAt,
      identity: {
        companyId: event.companyId,
        aggregateId: event.aggregateId,
        revision:
          source.revision === null || source.revision === undefined
            ? null
            : String(source.revision)
      },
      correlation: {
        messageId,
        whatsappId:
          source.whatsappId === null || source.whatsappId === undefined
            ? null
            : Number(source.whatsappId),
        conversationId: source.conversationId ?? null,
        contactId:
          source.contactId === null || source.contactId === undefined
            ? null
            : String(source.contactId),
        externalTicketId: source.externalTicketId ?? null,
        automationEpoch:
          source.automationEpoch === null ||
          source.automationEpoch === undefined
            ? null
            : Number(source.automationEpoch),
        actorType: source.actorType ?? null,
        kind: source.kind ?? nestedMessage.type ?? null,
        origin: source.origin ?? null
      },
      provider: source.provider,
      connection: {
        ...(source.connection || {}),
        id: source.connection?.id ?? source.whatsappId ?? null
      },
      contact: source.contact,
      conversation: {
        ...(source.conversation || {}),
        id: source.conversation?.id ?? source.conversationId ?? null,
        externalTicketId:
          source.conversation?.externalTicketId ??
          source.externalTicketId ??
          null,
        automationEpoch:
          source.conversation?.automationEpoch ?? source.automationEpoch ?? null
      },
      chat: source.chat,
      message: {
        ...nestedMessage,
        id: nestedMessage.id ?? messageId,
        providerMessageId:
          nestedMessage.providerMessageId ?? source.providerMessageId ?? null,
        direction:
          nestedMessage.direction ??
          (fromMe === null ? null : fromMe ? "outbound" : "inbound"),
        fromMe,
        type:
          nestedMessage.type ??
          source.kind ??
          persistedMessage?.mediaType ??
          null,
        text:
          nestedMessage.text ?? source.text ?? persistedMessage?.body ?? null,
        timestamp:
          nestedMessage.timestamp ??
          dateOrNull(source.timestamp) ??
          dateOrNull(persistedMessage?.createdAt),
        status: nestedMessage.status ?? source.status ?? null,
        media: protectedMedia
          ? { ...(nestedMessage.media || {}), ...protectedMedia }
          : nestedMessage.media ?? null
      }
    };
    return this.dependencies.builder.buildSnapshot(input);
  }
}

export default WhatsAppMirrorProjectionService;
