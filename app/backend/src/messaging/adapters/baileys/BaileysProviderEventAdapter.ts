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
import WhatsAppProviderEventPublisher from "../../application/WhatsAppProviderEventPublisher";

interface BaileysMessageAdapterInput extends WhatsAppProviderEventContext {
  raw: any;
}

interface BaileysUpdateAdapterInput extends WhatsAppProviderEventContext {
  raw: any;
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

const opaqueNativeFlowId = (raw: any): string | null => {
  const paramsJson =
    raw?.message?.interactiveResponseMessage?.nativeFlowResponseMessage
      ?.paramsJson;
  if (typeof paramsJson !== "string") return null;
  try {
    const id = JSON.parse(paramsJson)?.id;
    return typeof id === "string" &&
      id.length > 0 &&
      Buffer.byteLength(id, "utf8") <= 256
      ? id
      : null;
  } catch {
    return null;
  }
};

const selectedButton = (
  raw: any
): { type: string; id: string; title: string | null } | null => {
  const message = raw?.message || {};
  if (message.buttonsResponseMessage?.selectedButtonId) {
    return {
      type: "button",
      id: message.buttonsResponseMessage.selectedButtonId,
      title: message.buttonsResponseMessage.selectedDisplayText ?? null
    };
  }
  if (message.templateButtonReplyMessage?.selectedId) {
    return {
      type: "button",
      id: message.templateButtonReplyMessage.selectedId,
      title: message.templateButtonReplyMessage.selectedDisplayText ?? null
    };
  }
  if (message.listResponseMessage?.singleSelectReply?.selectedRowId) {
    return {
      type: "list",
      id: message.listResponseMessage.singleSelectReply.selectedRowId,
      title: message.listResponseMessage.title ?? null
    };
  }
  const nativeFlowId = opaqueNativeFlowId(raw);
  if (nativeFlowId) {
    return {
      type: "button",
      id: nativeFlowId,
      title: null
    };
  }
  return null;
};

const baileysRichContent = (raw: any) => {
  const message = raw?.message || {};
  const extended = message.extendedTextMessage;
  const mediaEntry = [
    ["image", message.imageMessage],
    ["audio", message.audioMessage],
    ["video", message.videoMessage],
    ["document", message.documentMessage]
  ].find(([, value]) => value);
  const media = mediaEntry
    ? {
        type: mediaEntry[0],
        mimeType: mediaEntry[1]?.mimetype ?? null,
        fileName: mediaEntry[1]?.fileName ?? null,
        sizeBytes: Number(mediaEntry[1]?.fileLength ?? 0) || null,
        sha256: null,
        url: null,
        available: true,
        caption: mediaEntry[1]?.caption ?? null
      }
    : null;
  const context =
    extended?.contextInfo ||
    mediaEntry?.[1]?.contextInfo ||
    message.buttonsResponseMessage?.contextInfo;
  const contactMessages =
    message.contactsArrayMessage?.contacts ||
    (message.contactMessage ? [message.contactMessage] : null);
  const pollMessage =
    message.pollCreationMessage ||
    message.pollCreationMessageV2 ||
    message.pollCreationMessageV3;
  return {
    text:
      message.conversation ??
      extended?.text ??
      message.imageMessage?.caption ??
      message.videoMessage?.caption ??
      message.documentMessage?.caption ??
      null,
    quoted: context?.stanzaId
      ? {
          id: context.stanzaId,
          providerMessageId: context.stanzaId,
          participant: context.participant ?? null,
          type: Object.keys(context.quotedMessage || {})[0] ?? null,
          text:
            context.quotedMessage?.conversation ??
            context.quotedMessage?.extendedTextMessage?.text ??
            null
        }
      : null,
    media,
    location: message.locationMessage
      ? {
          latitude: message.locationMessage.degreesLatitude ?? null,
          longitude: message.locationMessage.degreesLongitude ?? null,
          name: message.locationMessage.name ?? null,
          address: message.locationMessage.address ?? null,
          url: null
        }
      : null,
    contacts: contactMessages
      ? contactMessages.map((contact: any) => ({
          displayName: contact.displayName ?? null,
          vcard: contact.vcard ?? null,
          phoneNumbers: null
        }))
      : null,
    poll: pollMessage
      ? {
          name: pollMessage.name ?? null,
          options: (pollMessage.options || []).map(
            (option: any) => option.optionName ?? null
          ),
          selectedOptionIds: null,
          multipleAnswers: Number(pollMessage.selectableOptionsCount || 1) > 1
        }
      : null
  };
};

export const adaptBaileysMessageEvents = (
  input: BaileysMessageAdapterInput
): WhatsAppProviderEvent[] => {
  const raw = input.raw || {};
  const messageId = raw.key?.id ? String(raw.key.id) : null;
  const occurredAt = timestamp(raw.messageTimestamp);
  const interactive = selectedButton(raw);
  const rich = baileysRichContent(raw);
  const kind = interactive?.type || Object.keys(raw.message || {})[0] || null;
  const shared = {
    context: input,
    providerName: "baileys" as const,
    providerEventId: messageId,
    messageId,
    occurredAt,
    jid: raw.key?.remoteJid ?? null,
    lid: [
      raw.key?.remoteJid,
      raw.key?.remoteJidAlt,
      raw.key?.participant,
      raw.key?.participantAlt
    ].find(value => String(value || "").endsWith("@lid")) || null,
    actorType: raw.key?.fromMe ? "human" : "contact",
    kind,
    fromMe: Boolean(raw.key?.fromMe),
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
  const reaction = raw.message?.reactionMessage;
  if (reaction) {
    return [
      createProviderEvent({
        ...shared,
        eventType: "message.reaction",
        kind: "reaction",
        interactive: null,
        reaction: {
          emoji: reaction.text || null,
          targetMessageId: reaction.key?.id ?? null,
          removed: !reaction.text
        }
      })
    ];
  }
  const protocol =
    raw.message?.editedMessage?.message?.protocolMessage ||
    raw.message?.protocolMessage;
  if (raw.message?.editedMessage && protocol) {
    return [
      createProviderEvent({
        ...shared,
        eventType: "message.edited",
        kind: "edited",
        interactive: null,
        edit: {
          targetMessageId: protocol.key?.id ?? null,
          text:
            protocol.editedMessage?.conversation ??
            protocol.editedMessage?.extendedTextMessage?.text ??
            null,
          editedAt: occurredAt.toISOString()
        }
      })
    ];
  }
  const revokeStub = raw.messageStubType === 1;
  const revokeProtocol = raw.message?.protocolMessage?.type === 0;
  if (revokeProtocol || revokeStub) {
    return [
      createProviderEvent({
        ...shared,
        eventType: "message.deleted",
        kind: "deleted",
        interactive: null,
        delete: {
          targetMessageId:
            protocol?.key?.id ??
            raw.messageStubParameters?.[0] ??
            raw.key?.id ??
            null,
          deletedAt: occurredAt.toISOString(),
          forEveryone: true
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

const connectionState = (value: unknown): string | null => {
  if (value === "open") return "connected";
  if (value === "close") return "disconnected";
  return typeof value === "string" ? value : null;
};

export const adaptBaileysChatUpdate = (
  input: BaileysUpdateAdapterInput
): WhatsAppProviderEvent => {
  const raw = input.raw || {};
  const jid = raw.id ? String(raw.id) : null;
  const occurredAt = timestamp(raw.conversationTimestamp, input.observedAt);
  const lastMessage = Array.isArray(raw.messages)
    ? raw.messages[raw.messages.length - 1]
    : null;
  const preview =
    lastMessage?.message?.conversation ??
    lastMessage?.message?.extendedTextMessage?.text ??
    null;
  const archived = hasOwn(raw, "archived") ? booleanOrNull(raw.archived) : null;
  const pinned = hasOwn(raw, "pin") ? booleanOrNull(raw.pin) : null;
  const mutedUntil = hasOwn(raw, "muteEndTime")
    ? raw.muteEndTime === null || raw.muteEndTime === undefined
      ? null
      : timestamp(raw.muteEndTime).toISOString()
    : null;
  const unreadCount = hasOwn(raw, "unreadCount")
    ? raw.unreadCount === null || raw.unreadCount === undefined
      ? null
      : Number(raw.unreadCount)
    : null;
  const lastMessageAt = hasOwn(raw, "lastMessageRecvTimestamp")
    ? raw.lastMessageRecvTimestamp === null ||
      raw.lastMessageRecvTimestamp === undefined
      ? null
      : timestamp(raw.lastMessageRecvTimestamp)
    : null;
  const identity = createLifecycleEventIdentity({
    provider: "baileys",
    kind: "chat",
    sourceId:
      raw.eventId ?? raw.event_id ?? raw.updateId ?? raw.update_id ?? null,
    providerTimestamp: raw.conversationTimestamp,
    content: [
      jid,
      ["lid", hasOwn(raw, "lid"), raw.lid ?? null],
      ["name", hasOwn(raw, "name"), raw.name ?? null],
      ["archived", hasOwn(raw, "archived"), archived],
      ["pinned", hasOwn(raw, "pin"), pinned],
      ["mutedUntil", hasOwn(raw, "muteEndTime"), mutedUntil],
      ["unreadCount", hasOwn(raw, "unreadCount"), unreadCount],
      ["lastMessageId", Boolean(lastMessage), lastMessage?.key?.id ?? null],
      [
        "lastMessageAt",
        hasOwn(raw, "lastMessageRecvTimestamp"),
        lastMessageAt?.toISOString() ?? null
      ],
      ["lastMessagePreview", Boolean(lastMessage), preview]
    ]
  });
  const event = createProviderEvent({
    context: input,
    eventType: "chat.updated",
    providerName: "baileys",
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
    if (hasOwn(raw, "muteEndTime")) {
      state.mutedUntil = mutedUntil ? new Date(mutedUntil) : null;
    }
    if (unreadCount !== null && Number.isFinite(unreadCount)) {
      state.unreadCount = unreadCount;
    }
    if (lastMessage) {
      state.lastMessageId = lastMessage.key?.id ?? null;
      state.lastMessagePreview = preview;
    }
    if (hasOwn(raw, "lastMessageRecvTimestamp")) {
      state.lastMessageAt = lastMessageAt;
    }
    event.chatState = state;
  }
  return event;
};

export const adaptBaileysConnectionUpdate = (
  input: BaileysUpdateAdapterInput
): WhatsAppProviderEvent => {
  const state = connectionState(input.raw?.connection);
  const raw = input.raw || {};
  const identity = createLifecycleEventIdentity({
    provider: "baileys",
    kind: "connection",
    sourceId:
      raw.eventId ?? raw.event_id ?? raw.updateId ?? raw.update_id ?? null,
    providerTimestamp: raw.timestamp ?? raw.connectionTimestamp,
    content: {
      state,
      isNewLogin: raw.isNewLogin ?? null,
      receivedPendingNotifications: raw.receivedPendingNotifications ?? null
    }
  });
  const occurredAt = timestamp(
    raw.timestamp ?? raw.connectionTimestamp,
    input.observedAt
  );
  return createProviderEvent({
    context: input,
    eventType: "connection.updated",
    providerName: "baileys",
    providerEventId: identity.providerEventId,
    occurredAt,
    revision: identity.revision,
    kind: "connection",
    connection: { state }
  });
};

const lifecyclePublisher = new WhatsAppProviderEventPublisher();

export const registerBaileysMirrorLifecycleListeners = (
  socket: {
    ev: {
      on(event: string, handler: (value: any) => Promise<void>): unknown;
    };
  },
  context: WhatsAppProviderEventContext,
  publish: (
    events: readonly WhatsAppProviderEvent[]
  ) => Promise<void> = events => lifecyclePublisher.publish(events),
  now: () => Date = () => new Date()
): void => {
  const publishDeletedEvents = async (messages: any[]): Promise<void> => {
    const deleted = (messages || [])
      .flatMap((raw: any) =>
        adaptBaileysMessageEvents({
          ...context,
          raw
        })
      )
      .filter(
        (event: WhatsAppProviderEvent) => event.eventType === "message.deleted"
      );
    if (deleted.length) await publish(deleted);
  };
  socket.ev.on("chats.update", async (updates: any[]) => {
    const events = (updates || []).map(raw =>
      adaptBaileysChatUpdate({ ...context, raw, observedAt: now() })
    );
    if (events.length) await publish(events);
  });
  socket.ev.on("connection.update", async (raw: any) => {
    await publish([
      adaptBaileysConnectionUpdate({ ...context, raw, observedAt: now() })
    ]);
  });
  socket.ev.on("messages.upsert", async (upsert: any) => {
    await publishDeletedEvents(upsert?.messages || []);
  });
  socket.ev.on("messages.update", async (updates: any[]) => {
    await publishDeletedEvents(
      (updates || []).map(item => ({
        ...(item.update || {}),
        key: item.key
      }))
    );
  });
};
