export interface NormalizedMetaMessage {
  providerMessageId: string;
  sender: string;
  senderName?: string;
  timestamp?: Date;
  kind: string;
  body: string;
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  raw: Record<string, any>;
}

export interface NormalizedMetaStatus {
  providerMessageId: string;
  status: string;
  ack: number;
  timestamp?: Date;
  recipient?: string;
  raw: Record<string, any>;
}

const statusAck: Record<string, number> = {
  sent: 2,
  delivered: 3,
  read: 4,
  failed: 0,
  deleted: 0
};

const messageBody = (message: Record<string, any>): string => {
  if (message.type === "text") return message.text?.body || "";
  if (["image", "audio", "video", "document", "sticker"].includes(message.type)) {
    return message[message.type]?.caption || message[message.type]?.filename || "";
  }
  if (message.type === "location") {
    const location = message.location || {};
    return JSON.stringify({ latitude: location.latitude, longitude: location.longitude, name: location.name, address: location.address });
  }
  if (message.type === "contacts") return JSON.stringify(message.contacts || []);
  if (message.type === "reaction") return message.reaction?.emoji || "";
  if (message.type === "button") return message.button?.text || message.button?.payload || "";
  if (message.type === "interactive") {
    return message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "";
  }
  return "";
};

const parseTimestamp = (value: unknown): Date | undefined => {
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : undefined;
};

export const parseMetaCallback = (payload: Record<string, any>): {
  messages: NormalizedMetaMessage[];
  statuses: NormalizedMetaStatus[];
} => {
  const messages: NormalizedMetaMessage[] = [];
  const statuses: NormalizedMetaStatus[] = [];

  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const names = new Map<string, string>();
      for (const contact of value.contacts || []) {
        names.set(contact.wa_id, contact.profile?.name);
      }

      for (const message of value.messages || []) {
        const media = message[message.type] || {};
        messages.push({
          providerMessageId: message.id,
          sender: message.from,
          senderName: names.get(message.from),
          timestamp: parseTimestamp(message.timestamp),
          kind: message.type,
          body: messageBody(message),
          mediaId: media.id,
          mimeType: media.mime_type,
          fileName: media.filename,
          raw: message
        });
      }

      for (const status of value.statuses || []) {
        statuses.push({
          providerMessageId: status.id,
          status: status.status,
          ack: statusAck[status.status] ?? 0,
          timestamp: parseTimestamp(status.timestamp),
          recipient: status.recipient_id,
          raw: status
        });
      }
    }
  }

  return { messages, statuses };
};
