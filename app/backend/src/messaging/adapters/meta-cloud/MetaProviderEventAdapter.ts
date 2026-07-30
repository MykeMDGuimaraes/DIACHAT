import {
  createProviderEvent,
  WhatsAppChatStateUpdate,
  WhatsAppProviderEvent,
  WhatsAppProviderEventContext
} from "../../domain/WhatsAppProviderEvent";
import {
  createLifecycleEventIdentity,
  providerTimestampMillis
} from "../../domain/LifecycleEventIdentity";

interface MetaMessageAdapterInput extends WhatsAppProviderEventContext {
  raw: Record<string, any>;
}

interface MetaUpdateAdapterInput extends WhatsAppProviderEventContext {
  raw: Record<string, any>;
  observedAt: Date;
}

const timestamp = (value: unknown, fallback = new Date(0)): Date => {
  const millis = providerTimestampMillis(value);
  return millis === null ? fallback : new Date(millis);
};

const hasOwn = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

const booleanOrNull = (value: unknown): boolean | null =>
  typeof value === "boolean" || typeof value === "number"
    ? Boolean(value)
    : null;

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

const metaRichContent = (raw: Record<string, any>) => {
  const mediaValue = ["image", "audio", "video", "document"].includes(raw.type)
    ? raw[raw.type]
    : null;
  return {
    text:
      raw.text?.body ??
      raw.image?.caption ??
      raw.video?.caption ??
      raw.document?.caption ??
      null,
    quoted: raw.context?.id
      ? {
          id: raw.context.id,
          providerMessageId: raw.context.id,
          participant: raw.context.from
            ? `${raw.context.from}@s.whatsapp.net`
            : null,
          type: null,
          text: null
        }
      : null,
    media: mediaValue
      ? {
          type: raw.type,
          mimeType: mediaValue.mime_type ?? null,
          fileName: mediaValue.filename ?? null,
          sizeBytes: null,
          sha256: mediaValue.sha256 ?? null,
          url: null,
          available: true,
          caption: mediaValue.caption ?? null
        }
      : null,
    location:
      raw.type === "location"
        ? {
            latitude: raw.location?.latitude ?? null,
            longitude: raw.location?.longitude ?? null,
            name: raw.location?.name ?? null,
            address: raw.location?.address ?? null,
            url: null
          }
        : null,
    contacts:
      raw.type === "contacts"
        ? (raw.contacts || []).map((contact: any) => ({
            displayName: contact.name?.formatted_name ?? null,
            vcard: null,
            phoneNumbers: (contact.phones || []).map(
              (phone: any) => phone.phone ?? null
            )
          }))
        : null,
    poll:
      raw.type === "poll"
        ? {
            name: raw.poll?.name ?? null,
            options: (raw.poll?.options || []).map(
              (option: any) => option.title ?? null
            ),
            selectedOptionIds: raw.poll?.selected_option_ids ?? null,
            multipleAnswers: raw.poll?.multiple_answers ?? null
          }
        : null
  };
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
  const rich = metaRichContent(raw);
  const kind = interactive?.type || raw.type || null;
  const shared = {
    context: input,
    providerName: "meta_cloud" as const,
    providerEventId: messageId,
    messageId,
    occurredAt,
    jid,
    lid: raw.lid ?? null,
    actorType: "contact",
    kind,
    fromMe: false,
    text: rich.text,
    quoted: rich.quoted,
    media: rich.media,
    location: rich.location,
    contacts: rich.contacts,
    poll: rich.poll,
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
    events.push(
      createProviderEvent({ ...shared, eventType: "button.clicked" })
    );
  }
  return events;
};

export const adaptMetaChatUpdate = (
  input: MetaUpdateAdapterInput
): WhatsAppProviderEvent => {
  const raw = input.raw || {};
  const jid = raw.jid ? String(raw.jid) : null;
  const occurredAt = timestamp(raw.timestamp, input.observedAt);
  const archived = hasOwn(raw, "archived") ? booleanOrNull(raw.archived) : null;
  const pinned = hasOwn(raw, "pinned") ? booleanOrNull(raw.pinned) : null;
  const mutedUntil = hasOwn(raw, "muted_until")
    ? raw.muted_until === null || raw.muted_until === undefined
      ? null
      : timestamp(raw.muted_until).toISOString()
    : null;
  const unreadCount = hasOwn(raw, "unread_count")
    ? raw.unread_count === null || raw.unread_count === undefined
      ? null
      : Number(raw.unread_count)
    : null;
  const lastMessageAt = hasOwn(raw, "last_message_at")
    ? raw.last_message_at === null || raw.last_message_at === undefined
      ? null
      : timestamp(raw.last_message_at)
    : null;
  const identity = createLifecycleEventIdentity({
    provider: "meta_cloud",
    kind: "chat",
    sourceId:
      raw.source_id ??
      raw.event_id ??
      raw.update_id ??
      raw.callback_index ??
      null,
    providerTimestamp: raw.timestamp,
    content: [
      jid,
      ["lid", hasOwn(raw, "lid"), raw.lid ?? null],
      ["name", hasOwn(raw, "name"), raw.name ?? null],
      ["archived", hasOwn(raw, "archived"), archived],
      ["pinned", hasOwn(raw, "pinned"), pinned],
      ["mutedUntil", hasOwn(raw, "muted_until"), mutedUntil],
      ["unreadCount", hasOwn(raw, "unread_count"), unreadCount],
      [
        "lastMessageId",
        hasOwn(raw, "last_message_id"),
        raw.last_message_id ?? null
      ],
      [
        "lastMessageAt",
        hasOwn(raw, "last_message_at"),
        lastMessageAt?.toISOString() ?? null
      ],
      [
        "lastMessagePreview",
        hasOwn(raw, "last_message_preview"),
        raw.last_message_preview ?? null
      ]
    ]
  });
  const event = createProviderEvent({
    context: input,
    eventType: "chat.updated",
    providerName: "meta_cloud",
    providerEventId: identity.providerEventId,
    occurredAt,
    revision: identity.revision,
    jid,
    kind: "chat",
    chat: {
      jid,
      lid: raw.lid ?? null,
      type: jid ? (jid.endsWith("@g.us") ? "group" : "direct") : null,
      name: raw.name ?? null,
      archived,
      pinned,
      mutedUntil,
      unreadCount
    }
  });
  if (jid) {
    const state: WhatsAppChatStateUpdate = {
      companyId: input.companyId,
      whatsappId: input.whatsappId,
      jid,
      isGroup: jid.endsWith("@g.us"),
      revision: identity.revision
    };
    if (hasOwn(raw, "lid")) state.lid = raw.lid ?? null;
    if (archived !== null) state.archived = archived;
    if (pinned !== null) state.pinned = pinned;
    if (hasOwn(raw, "muted_until")) {
      state.mutedUntil = mutedUntil ? new Date(mutedUntil) : null;
    }
    if (unreadCount !== null && Number.isFinite(unreadCount)) {
      state.unreadCount = unreadCount;
    }
    if (hasOwn(raw, "last_message_id")) {
      state.lastMessageId = raw.last_message_id ?? null;
    }
    if (hasOwn(raw, "last_message_at")) {
      state.lastMessageAt = lastMessageAt;
    }
    if (hasOwn(raw, "last_message_preview")) {
      state.lastMessagePreview = raw.last_message_preview ?? null;
    }
    event.chatState = state;
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
  const identity = createLifecycleEventIdentity({
    provider: "meta_cloud",
    kind: "connection",
    sourceId:
      input.raw?.source_id ??
      input.raw?.event_id ??
      input.raw?.update_id ??
      input.raw?.callback_index ??
      null,
    providerTimestamp: input.raw?.timestamp,
    content: {
      publicId: input.raw?.phone_number_id ?? null,
      state
    }
  });
  return createProviderEvent({
    context: input,
    eventType: "connection.updated",
    providerName: "meta_cloud",
    providerEventId: identity.providerEventId,
    occurredAt,
    revision: identity.revision,
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
  for (const [entryIndex, entry] of (input.payload?.entry || []).entries()) {
    for (const [changeIndex, change] of (entry.changes || []).entries()) {
      const value = change.value || {};
      const sourcePrefix = `${entry.id ?? entryIndex}:${changeIndex}`;
      if (metaConnectionFields.has(change.field)) {
        events.push(
          adaptMetaConnectionUpdate({
            ...input,
            raw: {
              state: value.state ?? value.event ?? change.field,
              phone_number_id:
                value.phone_number_id ??
                value.metadata?.phone_number_id ??
                null,
              timestamp: value.timestamp,
              source_id: `${sourcePrefix}:${change.field}`
            }
          })
        );
      }
      for (const [chatIndex, chat] of (value.chats || []).entries()) {
        events.push(
          adaptMetaChatUpdate({
            ...input,
            raw: {
              ...chat,
              source_id: `${sourcePrefix}:chat:${chatIndex}`
            }
          })
        );
      }
    }
  }
  return events;
};
