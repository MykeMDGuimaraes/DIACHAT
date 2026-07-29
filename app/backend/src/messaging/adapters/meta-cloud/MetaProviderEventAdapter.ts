import {
  createProviderEvent,
  WhatsAppProviderEvent,
  WhatsAppProviderEventContext
} from "../../domain/WhatsAppProviderEvent";

interface MetaMessageAdapterInput extends WhatsAppProviderEventContext {
  raw: Record<string, any>;
}

interface MetaUpdateAdapterInput extends WhatsAppProviderEventContext {
  raw: Record<string, any>;
  observedAt: Date;
}

const timestamp = (value: unknown, fallback = new Date(0)): Date => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : fallback;
};

const selectedButton = (
  raw: Record<string, any>
): { type: string; id: string; title: string | null } | null => {
  if (raw.type === "button" && (raw.button?.payload || raw.button?.text)) {
    return {
      type: "button",
      id: raw.button.payload || raw.button.text,
      title: raw.button.text ?? null
    };
  }
  const reply = raw.interactive?.button_reply || raw.interactive?.list_reply;
  if (raw.type === "interactive" && reply?.id) {
    return {
      type: raw.interactive?.list_reply ? "list" : "button",
      id: reply.id,
      title: reply.title ?? null
    };
  }
  return null;
};

export const adaptMetaMessageEvents = (
  input: MetaMessageAdapterInput
): WhatsAppProviderEvent[] => {
  const raw = input.raw || {};
  const messageId = raw.id ? String(raw.id) : null;
  const occurredAt = timestamp(raw.timestamp);
  const jid = raw.from
    ? String(raw.from).includes("@")
      ? String(raw.from)
      : `${raw.from}@s.whatsapp.net`
    : null;
  const interactive = selectedButton(raw);
  const kind = interactive?.type || raw.type || null;
  const shared = {
    context: input,
    providerName: "meta_cloud" as const,
    providerEventId: messageId,
    messageId,
    occurredAt,
    jid,
    actorType: "contact",
    kind,
    fromMe: false,
    interactive: interactive
      ? {
          type: interactive.type,
          id: interactive.id,
          title: interactive.title,
          description: null
        }
      : null
  };
  if (raw.type === "reaction") {
    return [
      createProviderEvent({
        ...shared,
        eventType: "message.reaction",
        kind: "reaction",
        interactive: null,
        reaction: {
          emoji: raw.reaction?.emoji || null,
          targetMessageId: raw.reaction?.message_id ?? null,
          removed: !raw.reaction?.emoji
        }
      })
    ];
  }
  if (raw.type === "edited") {
    return [
      createProviderEvent({
        ...shared,
        eventType: "message.edited",
        kind: "edited",
        interactive: null,
        edit: {
          targetMessageId: raw.edit?.message_id ?? null,
          text: raw.edit?.text ?? null,
          editedAt: occurredAt.toISOString()
        }
      })
    ];
  }
  if (raw.type === "deleted") {
    return [
      createProviderEvent({
        ...shared,
        eventType: "message.deleted",
        kind: "deleted",
        interactive: null,
        delete: {
          targetMessageId: raw.delete?.message_id ?? null,
          deletedAt: occurredAt.toISOString(),
          forEveryone: raw.delete?.for_everyone ?? null
        }
      })
    ];
  }
  const events = [
    createProviderEvent({ ...shared, eventType: "message.received" })
  ];
  if (interactive) {
    events.push(createProviderEvent({ ...shared, eventType: "button.clicked" }));
  }
  return events;
};

export const adaptMetaChatUpdate = (
  input: MetaUpdateAdapterInput
): WhatsAppProviderEvent => {
  const raw = input.raw || {};
  const jid = raw.jid ? String(raw.jid) : null;
  const occurredAt = timestamp(raw.timestamp, input.observedAt);
  const revision = String(occurredAt.getTime());
  const lastMessageAt = timestamp(raw.last_message_at, occurredAt);
  const event = createProviderEvent({
    context: input,
    eventType: "chat.updated",
    providerName: "meta_cloud",
    providerEventId: jid ? `chat:${jid}:${revision}` : null,
    occurredAt,
    revision,
    jid,
    kind: "chat",
    chat: {
      jid,
      lid: raw.lid ?? null,
      type: jid ? (jid.endsWith("@g.us") ? "group" : "direct") : null,
      name: raw.name ?? null,
      archived: Boolean(raw.archived),
      pinned: Boolean(raw.pinned),
      mutedUntil:
        raw.muted_until === null || raw.muted_until === undefined
          ? null
          : timestamp(raw.muted_until).toISOString(),
      unreadCount: Number(raw.unread_count || 0)
    }
  });
  if (jid) {
    event.chatState = {
      companyId: input.companyId,
      whatsappId: input.whatsappId,
      jid,
      lid: raw.lid ?? null,
      isGroup: jid.endsWith("@g.us"),
      archived: Boolean(raw.archived),
      pinned: Boolean(raw.pinned),
      mutedUntil:
        raw.muted_until === null || raw.muted_until === undefined
          ? null
          : timestamp(raw.muted_until),
      unreadCount: Number(raw.unread_count || 0),
      lastMessageId: raw.last_message_id ?? null,
      lastMessageAt,
      lastMessagePreview: raw.last_message_preview ?? null,
      revision
    };
  }
  return event;
};

export const adaptMetaConnectionUpdate = (
  input: MetaUpdateAdapterInput
): WhatsAppProviderEvent => {
  const rawState = input.raw?.state;
  const state =
    rawState === "open"
      ? "connected"
      : rawState === "close"
      ? "disconnected"
      : typeof rawState === "string"
      ? rawState
      : null;
  const occurredAt = timestamp(input.raw?.timestamp, input.observedAt);
  const revision = String(occurredAt.getTime());
  return createProviderEvent({
    context: input,
    eventType: "connection.updated",
    providerName: "meta_cloud",
    providerEventId: `connection:${input.whatsappId}:${revision}:${state}`,
    occurredAt,
    revision,
    kind: "connection",
    connection: {
      publicId: input.raw?.phone_number_id ?? null,
      state
    }
  });
};

const metaConnectionFields = new Set([
  "account_update",
  "phone_number_quality_update",
  "phone_number_name_update"
]);

export const adaptMetaLifecycleEvents = (
  input: WhatsAppProviderEventContext & {
    payload: Record<string, any>;
    observedAt: Date;
  }
): WhatsAppProviderEvent[] => {
  const events: WhatsAppProviderEvent[] = [];
  for (const entry of input.payload?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      if (metaConnectionFields.has(change.field)) {
        events.push(
          adaptMetaConnectionUpdate({
            ...input,
            raw: {
              state: value.state ?? value.event ?? change.field,
              phone_number_id:
                value.phone_number_id ?? value.metadata?.phone_number_id ?? null,
              timestamp: value.timestamp
            }
          })
        );
      }
      for (const chat of value.chats || []) {
        events.push(
          adaptMetaChatUpdate({
            ...input,
            raw: chat
          })
        );
      }
    }
  }
  return events;
};
