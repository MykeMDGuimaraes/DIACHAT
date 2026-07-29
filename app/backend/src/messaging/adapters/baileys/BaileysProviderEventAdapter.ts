import {
  createProviderEvent,
  WhatsAppProviderEvent,
  WhatsAppProviderEventContext
} from "../../domain/WhatsAppProviderEvent";
import WhatsAppProviderEventPublisher from "../../application/WhatsAppProviderEventPublisher";

interface BaileysMessageAdapterInput extends WhatsAppProviderEventContext {
  raw: any;
}

interface BaileysUpdateAdapterInput extends WhatsAppProviderEventContext {
  raw: any;
  observedAt: Date;
}

const timestamp = (value: unknown, fallback = new Date(0)): Date => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0
    ? new Date(seconds * 1000)
    : fallback;
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
  return null;
};

export const adaptBaileysMessageEvents = (
  input: BaileysMessageAdapterInput
): WhatsAppProviderEvent[] => {
  const raw = input.raw || {};
  const messageId = raw.key?.id ? String(raw.key.id) : null;
  const occurredAt = timestamp(raw.messageTimestamp);
  const interactive = selectedButton(raw);
  const kind = interactive?.type || Object.keys(raw.message || {})[0] || null;
  const shared = {
    context: input,
    providerName: "baileys" as const,
    providerEventId: messageId,
    messageId,
    occurredAt,
    jid: raw.key?.remoteJid ?? null,
    actorType: raw.key?.fromMe ? "human" : "contact",
    kind,
    fromMe: Boolean(raw.key?.fromMe),
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
  if (raw.message?.protocolMessage) {
    return [
      createProviderEvent({
        ...shared,
        eventType: "message.deleted",
        kind: "deleted",
        interactive: null,
        delete: {
          targetMessageId: protocol?.key?.id ?? null,
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
    events.push(createProviderEvent({ ...shared, eventType: "button.clicked" }));
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
  const revision = String(occurredAt.getTime());
  const lastMessage = Array.isArray(raw.messages)
    ? raw.messages[raw.messages.length - 1]
    : null;
  const lastMessageAt = timestamp(
    raw.lastMessageRecvTimestamp,
    occurredAt
  );
  const preview =
    lastMessage?.message?.conversation ??
    lastMessage?.message?.extendedTextMessage?.text ??
    null;
  const event = createProviderEvent({
    context: input,
    eventType: "chat.updated",
    providerName: "baileys",
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
      pinned: Boolean(raw.pin),
      mutedUntil:
        raw.muteEndTime === null || raw.muteEndTime === undefined
          ? null
          : timestamp(raw.muteEndTime).toISOString(),
      unreadCount: Number(raw.unreadCount || 0)
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
      pinned: Boolean(raw.pin),
      mutedUntil:
        raw.muteEndTime === null || raw.muteEndTime === undefined
          ? null
          : timestamp(raw.muteEndTime),
      unreadCount: Number(raw.unreadCount || 0),
      lastMessageId: lastMessage?.key?.id ?? null,
      lastMessageAt,
      lastMessagePreview: preview,
      revision
    };
  }
  return event;
};

export const adaptBaileysConnectionUpdate = (
  input: BaileysUpdateAdapterInput
): WhatsAppProviderEvent => {
  const state = connectionState(input.raw?.connection);
  const revision = String(input.observedAt.getTime());
  return createProviderEvent({
    context: input,
    eventType: "connection.updated",
    providerName: "baileys",
    providerEventId: `connection:${input.whatsappId}:${revision}:${state}`,
    occurredAt: input.observedAt,
    revision,
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
};
