import { createHash } from "crypto";

export type WhatsAppProviderEventType =
  | "message.received"
  | "button.clicked"
  | "message.reaction"
  | "message.edited"
  | "message.deleted"
  | "message.status.updated"
  | "chat.updated"
  | "connection.updated";

export interface WhatsAppProviderEventContext {
  companyId: number;
  whatsappId: number;
  conversationId?: string | null;
  contactId?: string | number | null;
  externalTicketId?: string | null;
  automationEpoch?: number | null;
}

export interface WhatsAppProviderEventPayload {
  messageId: string | null;
  whatsappId: number;
  conversationId: string | null;
  contactId: string | null;
  externalTicketId: string | null;
  automationEpoch: number | null;
  actorType: string | null;
  kind: string | null;
  origin: string | null;
  revision: string | null;
  provider: {
    name: string | null;
    eventId: string | null;
    messageId: string | null;
    timestamp: string | null;
  };
  connection: {
    id: number;
    publicId: string | null;
    state: string | null;
    phoneNumber: string | null;
  };
  contact: {
    id: string | null;
    jid: string | null;
    lid: string | null;
    phoneNumber: string | null;
    name: string | null;
    pushName: string | null;
    isBusiness: boolean | null;
  };
  conversation: {
    id: string | null;
    externalTicketId: string | null;
    automationEpoch: number | null;
    status: string | null;
  };
  chat: {
    jid: string | null;
    lid: string | null;
    type: string | null;
    name: string | null;
    archived: boolean | null;
    pinned: boolean | null;
    mutedUntil: string | null;
    unreadCount: number | null;
  };
  message: {
    id: string | null;
    providerMessageId: string | null;
    direction: string | null;
    fromMe: boolean | null;
    type: string | null;
    text: string | null;
    timestamp: string | null;
    status: string | null;
    quoted: Record<string, unknown> | null;
    reaction: Record<string, unknown> | null;
    interactive: Record<string, unknown> | null;
    media: Record<string, unknown> | null;
    location: Record<string, unknown> | null;
    contacts: Array<Record<string, unknown>> | null;
    poll: Record<string, unknown> | null;
    edit: Record<string, unknown> | null;
    delete: Record<string, unknown> | null;
  };
}

export interface WhatsAppChatStateUpdate {
  companyId: number;
  whatsappId: number;
  jid: string;
  lid?: string | null;
  isGroup?: boolean;
  archived?: boolean;
  pinned?: boolean;
  mutedUntil?: Date | null;
  unreadCount?: number;
  lastMessageId?: string | null;
  lastMessageAt?: Date | null;
  lastMessagePreview?: string | null;
  revision: string;
}

export interface WhatsAppProviderEvent {
  companyId: number;
  eventType: WhatsAppProviderEventType;
  aggregateId: string;
  occurredAt: Date;
  payload: WhatsAppProviderEventPayload;
  chatState?: WhatsAppChatStateUpdate;
}

export interface CreateProviderEventInput {
  context: WhatsAppProviderEventContext;
  eventType: WhatsAppProviderEventType;
  providerName: "baileys" | "meta_cloud";
  providerEventId: string | null;
  messageId?: string | null;
  occurredAt: Date;
  revision?: string | null;
  jid?: string | null;
  lid?: string | null;
  actorType?: string | null;
  kind?: string | null;
  fromMe?: boolean | null;
  text?: string | null;
  interactive?: Record<string, unknown> | null;
  reaction?: Record<string, unknown> | null;
  quoted?: Record<string, unknown> | null;
  media?: Record<string, unknown> | null;
  location?: Record<string, unknown> | null;
  contacts?: Array<Record<string, unknown>> | null;
  poll?: Record<string, unknown> | null;
  edit?: Record<string, unknown> | null;
  delete?: Record<string, unknown> | null;
  connection?: Partial<WhatsAppProviderEventPayload["connection"]>;
  chat?: Partial<WhatsAppProviderEventPayload["chat"]>;
}

const stringOrNull = (value: string | number | null | undefined) =>
  value === null || value === undefined ? null : String(value);

const phoneNumberFromJid = (jid: string | null): string | null => {
  if (!jid) return null;
  const match = /^(\d+)@(?:s\.whatsapp\.net|c\.us)$/.exec(jid);
  return match?.[1] ?? null;
};

export const createProviderEvent = (
  input: CreateProviderEventInput
): WhatsAppProviderEvent => {
  const messageId = stringOrNull(input.messageId);
  const revision =
    input.revision ?? String(Math.max(0, input.occurredAt.getTime()));
  const jid = input.jid ?? null;
  const payload: WhatsAppProviderEventPayload = {
    messageId,
    whatsappId: input.context.whatsappId,
    conversationId: input.context.conversationId ?? null,
    contactId: stringOrNull(input.context.contactId),
    externalTicketId: input.context.externalTicketId ?? null,
    automationEpoch: input.context.automationEpoch ?? null,
    actorType: input.actorType ?? null,
    kind: input.kind ?? null,
    origin: "provider",
    revision,
    provider: {
      name: input.providerName,
      eventId: input.providerEventId,
      messageId,
      timestamp: input.occurredAt.toISOString()
    },
    connection: {
      id: input.context.whatsappId,
      publicId: null,
      state: null,
      phoneNumber: null,
      ...input.connection
    },
    contact: {
      id: stringOrNull(input.context.contactId),
      jid,
      lid: input.lid ?? null,
      phoneNumber: phoneNumberFromJid(jid),
      name: null,
      pushName: null,
      isBusiness: null
    },
    conversation: {
      id: input.context.conversationId ?? null,
      externalTicketId: input.context.externalTicketId ?? null,
      automationEpoch: input.context.automationEpoch ?? null,
      status: null
    },
    chat: {
      jid,
      lid: input.lid ?? null,
      type: jid ? (jid.endsWith("@g.us") ? "group" : "direct") : null,
      name: null,
      archived: null,
      pinned: null,
      mutedUntil: null,
      unreadCount: null,
      ...input.chat
    },
    message: {
      id: messageId,
      providerMessageId: messageId,
      direction:
        input.fromMe === null || input.fromMe === undefined
          ? null
          : input.fromMe
          ? "outbound"
          : "inbound",
      fromMe: input.fromMe ?? null,
      type: input.kind ?? null,
      text: input.text ?? null,
      timestamp: input.occurredAt.toISOString(),
      status: null,
      quoted: input.quoted ?? null,
      reaction: input.reaction ?? null,
      interactive: input.interactive ?? null,
      media: input.media ?? null,
      location: input.location ?? null,
      contacts: input.contacts ?? null,
      poll: input.poll ?? null,
      edit: input.edit ?? null,
      delete: input.delete ?? null
    }
  };
  const identity = JSON.stringify([
    input.context.companyId,
    input.eventType,
    input.providerName,
    input.providerEventId,
    messageId,
    jid,
    revision
  ]);
  return {
    companyId: input.context.companyId,
    eventType: input.eventType,
    aggregateId: createHash("sha256").update(identity).digest("hex"),
    occurredAt: input.occurredAt,
    payload
  };
};
