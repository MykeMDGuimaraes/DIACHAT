import { v5 as uuidv5 } from "uuid";

import { canonicalJsonBytes } from "./WhatsAppMirrorCanonical";
import { WhatsAppMirrorUnsafePayloadError } from "./WhatsAppMirrorErrors";

export { WhatsAppMirrorUnsafePayloadError } from "./WhatsAppMirrorErrors";

export const WHATSAPP_MIRROR_SCHEMA = "whatsapp-mirror/1" as const;
export const WHATSAPP_MIRROR_EVENT_NAMESPACE =
  "35be580d-2a91-5ae0-9ac6-4d58e9f497da";
export const WHATSAPP_MIRROR_MESSAGE_TEXT_BYTES = 64 * 1024;
export const WHATSAPP_MIRROR_QUOTE_TEXT_BYTES = 4 * 1024;
export const WHATSAPP_MIRROR_ENVELOPE_BYTES = 262144;

type Nullable<T> = T | null;
type InputBlock<T> = Partial<T> | null | undefined;

const forbiddenKeys = new Set([
  "accesstoken",
  "apikey",
  "authorization",
  "clientsecret",
  "cookie",
  "credential",
  "credentials",
  "password",
  "passwd",
  "privatekey",
  "refreshtoken",
  "secret",
  "setcookie",
  "token",
  "verifytoken"
]);

const forbiddenValuePatterns = [
  /\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /\bdch_(?:live|test)_[A-Za-z0-9_-]{8,}/i,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{8,}/,
  /\bsvc_[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /[?&](?:access_token|api[_-]?key|secret|signature|token)=[^&#\s]+/i
];

const validateSafePayload = (
  value: unknown,
  path = "$",
  ancestors = new Set<object>()
): void => {
  if (typeof value === "string") {
    if (forbiddenValuePatterns.some(pattern => pattern.test(value))) {
      throw new WhatsAppMirrorUnsafePayloadError(`Forbidden value at ${path}`);
    }
    return;
  }
  if (value === null || typeof value !== "object" || value instanceof Date)
    return;
  if (ancestors.has(value)) {
    throw new WhatsAppMirrorUnsafePayloadError(`Cyclic value at ${path}`);
  }

  ancestors.add(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      validateSafePayload(item, `${path}[${index}]`, ancestors)
    );
  } else {
    Object.entries(value).forEach(([key, child]) => {
      const normalizedKey = key.replace(/[^a-z0-9]/gi, "").toLowerCase();
      const childPath = `${path}.${key}`;
      if (forbiddenKeys.has(normalizedKey)) {
        throw new WhatsAppMirrorUnsafePayloadError(
          `Forbidden key at ${childPath}`
        );
      }
      validateSafePayload(child, childPath, ancestors);
    });
  }
  ancestors.delete(value);
};

export interface WhatsAppMirrorCorrelation {
  messageId?: Nullable<string>;
  whatsappId?: Nullable<number>;
  conversationId?: Nullable<string>;
  contactId?: Nullable<string>;
  externalTicketId?: Nullable<string>;
  automationEpoch?: Nullable<number>;
  actorType?: Nullable<string>;
  kind?: Nullable<string>;
  origin?: Nullable<string>;
}

export interface WhatsAppMirrorProvider {
  name: Nullable<string>;
  eventId: Nullable<string>;
  messageId: Nullable<string>;
  timestamp: Nullable<string>;
}

export interface WhatsAppMirrorConnection {
  id: Nullable<number>;
  publicId: Nullable<string>;
  state: Nullable<string>;
  phoneNumber: Nullable<string>;
}

export interface WhatsAppMirrorContact {
  id: Nullable<string>;
  jid: Nullable<string>;
  lid: Nullable<string>;
  phoneNumber: Nullable<string>;
  name: Nullable<string>;
  pushName: Nullable<string>;
  isBusiness: Nullable<boolean>;
}

export interface WhatsAppMirrorConversation {
  id: Nullable<string>;
  externalTicketId: Nullable<string>;
  automationEpoch: Nullable<number>;
  status: Nullable<string>;
}

export interface WhatsAppMirrorChat {
  jid: Nullable<string>;
  lid: Nullable<string>;
  type: Nullable<string>;
  name: Nullable<string>;
  archived: Nullable<boolean>;
  pinned: Nullable<boolean>;
  mutedUntil: Nullable<string>;
  unreadCount: Nullable<number>;
}

export interface WhatsAppMirrorQuotedMessage {
  id: Nullable<string>;
  providerMessageId: Nullable<string>;
  participant: Nullable<string>;
  type: Nullable<string>;
  text: Nullable<string>;
}

export interface WhatsAppMirrorReaction {
  emoji: Nullable<string>;
  targetMessageId: Nullable<string>;
  removed: Nullable<boolean>;
}

export interface WhatsAppMirrorInteractive {
  type: Nullable<string>;
  id: Nullable<string>;
  title: Nullable<string>;
  description: Nullable<string>;
}

export interface WhatsAppMirrorMedia {
  type: Nullable<string>;
  mimeType: Nullable<string>;
  fileName: Nullable<string>;
  sizeBytes: Nullable<number>;
  sha256: Nullable<string>;
  url: Nullable<string>;
  available: Nullable<boolean>;
  caption: Nullable<string>;
}

export interface WhatsAppMirrorLocation {
  latitude: Nullable<number>;
  longitude: Nullable<number>;
  name: Nullable<string>;
  address: Nullable<string>;
  url: Nullable<string>;
}

export interface WhatsAppMirrorSharedContact {
  displayName: Nullable<string>;
  vcard: Nullable<string>;
  phoneNumbers: Nullable<Array<Nullable<string>>>;
}

export interface WhatsAppMirrorPoll {
  name: Nullable<string>;
  options: Nullable<Array<Nullable<string>>>;
  selectedOptionIds: Nullable<Array<Nullable<string>>>;
  multipleAnswers: Nullable<boolean>;
}

export interface WhatsAppMirrorEdit {
  targetMessageId: Nullable<string>;
  text: Nullable<string>;
  editedAt: Nullable<string>;
}

export interface WhatsAppMirrorDelete {
  targetMessageId: Nullable<string>;
  deletedAt: Nullable<string>;
  forEveryone: Nullable<boolean>;
}

export interface WhatsAppMirrorMessage {
  id: Nullable<string>;
  providerMessageId: Nullable<string>;
  direction: Nullable<string>;
  fromMe: Nullable<boolean>;
  type: Nullable<string>;
  text: Nullable<string>;
  timestamp: Nullable<string>;
  status: Nullable<string>;
  quoted: Nullable<WhatsAppMirrorQuotedMessage>;
  reaction: Nullable<WhatsAppMirrorReaction>;
  interactive: Nullable<WhatsAppMirrorInteractive>;
  media: Nullable<WhatsAppMirrorMedia>;
  location: Nullable<WhatsAppMirrorLocation>;
  contacts: Nullable<WhatsAppMirrorSharedContact[]>;
  poll: Nullable<WhatsAppMirrorPoll>;
  edit: Nullable<WhatsAppMirrorEdit>;
  delete: Nullable<WhatsAppMirrorDelete>;
}

export interface WhatsAppMirrorIdentity {
  companyId: number;
  aggregateId: string;
  revision?: Nullable<string>;
}

export interface WhatsAppMirrorPayloadInput {
  eventType: string;
  occurredAt: string | Date;
  identity: WhatsAppMirrorIdentity;
  correlation: WhatsAppMirrorCorrelation;
  provider?: InputBlock<WhatsAppMirrorProvider>;
  connection?: InputBlock<WhatsAppMirrorConnection>;
  contact?: InputBlock<WhatsAppMirrorContact>;
  conversation?: InputBlock<WhatsAppMirrorConversation>;
  chat?: InputBlock<WhatsAppMirrorChat>;
  message?: InputBlock<
    Omit<
      WhatsAppMirrorMessage,
      | "quoted"
      | "reaction"
      | "interactive"
      | "media"
      | "location"
      | "contacts"
      | "poll"
      | "edit"
      | "delete"
    > & {
      quoted?: InputBlock<WhatsAppMirrorQuotedMessage>;
      reaction?: InputBlock<WhatsAppMirrorReaction>;
      interactive?: InputBlock<WhatsAppMirrorInteractive>;
      media?: InputBlock<WhatsAppMirrorMedia>;
      location?: InputBlock<WhatsAppMirrorLocation>;
      contacts?: Array<Partial<WhatsAppMirrorSharedContact>> | null;
      poll?: InputBlock<WhatsAppMirrorPoll>;
      edit?: InputBlock<WhatsAppMirrorEdit>;
      delete?: InputBlock<WhatsAppMirrorDelete>;
    }
  >;
}

export interface WhatsAppMirrorEnvelope {
  schema: typeof WHATSAPP_MIRROR_SCHEMA;
  id: string;
  type: string;
  createdAt: string;
  data: Required<WhatsAppMirrorCorrelation> & {
    provider: WhatsAppMirrorProvider;
    connection: WhatsAppMirrorConnection;
    contact: WhatsAppMirrorContact;
    conversation: WhatsAppMirrorConversation;
    chat: WhatsAppMirrorChat;
    message: WhatsAppMirrorMessage;
    truncated: boolean;
  };
}

const valueOrNull = <T>(value: T | null | undefined): T | null =>
  value === undefined ? null : value;

const truncateUtf8 = (
  value: string | null,
  maximumBytes: number
): { value: string | null; truncated: boolean } => {
  if (value === null || Buffer.byteLength(value, "utf8") <= maximumBytes) {
    return { value, truncated: false };
  }

  const prefix = Array.from(value).reduce(
    (state, character) => {
      if (state.full) return state;
      const characterBytes = Buffer.byteLength(character, "utf8");
      if (state.bytes + characterBytes > maximumBytes) {
        return { ...state, full: true };
      }
      return {
        bytes: state.bytes + characterBytes,
        value: state.value + character,
        full: false
      };
    },
    { bytes: 0, value: "", full: false }
  ).value;
  return { value: prefix, truncated: true };
};

const normalizeProvider = (
  value: InputBlock<WhatsAppMirrorProvider>
): WhatsAppMirrorProvider => ({
  name: valueOrNull(value?.name),
  eventId: valueOrNull(value?.eventId),
  messageId: valueOrNull(value?.messageId),
  timestamp: valueOrNull(value?.timestamp)
});

const normalizeConnection = (
  value: InputBlock<WhatsAppMirrorConnection>
): WhatsAppMirrorConnection => ({
  id: valueOrNull(value?.id),
  publicId: valueOrNull(value?.publicId),
  state: valueOrNull(value?.state),
  phoneNumber: valueOrNull(value?.phoneNumber)
});

const normalizeContact = (
  value: InputBlock<WhatsAppMirrorContact>
): WhatsAppMirrorContact => ({
  id: valueOrNull(value?.id),
  jid: valueOrNull(value?.jid),
  lid: valueOrNull(value?.lid),
  phoneNumber: valueOrNull(value?.phoneNumber),
  name: valueOrNull(value?.name),
  pushName: valueOrNull(value?.pushName),
  isBusiness: valueOrNull(value?.isBusiness)
});

const normalizeConversation = (
  value: InputBlock<WhatsAppMirrorConversation>
): WhatsAppMirrorConversation => ({
  id: valueOrNull(value?.id),
  externalTicketId: valueOrNull(value?.externalTicketId),
  automationEpoch: valueOrNull(value?.automationEpoch),
  status: valueOrNull(value?.status)
});

const normalizeChat = (
  value: InputBlock<WhatsAppMirrorChat>
): WhatsAppMirrorChat => ({
  jid: valueOrNull(value?.jid),
  lid: valueOrNull(value?.lid),
  type: valueOrNull(value?.type),
  name: valueOrNull(value?.name),
  archived: valueOrNull(value?.archived),
  pinned: valueOrNull(value?.pinned),
  mutedUntil: valueOrNull(value?.mutedUntil),
  unreadCount: valueOrNull(value?.unreadCount)
});

const normalizeQuoted = (
  value: InputBlock<WhatsAppMirrorQuotedMessage>
): WhatsAppMirrorQuotedMessage | null =>
  value
    ? {
        id: valueOrNull(value.id),
        providerMessageId: valueOrNull(value.providerMessageId),
        participant: valueOrNull(value.participant),
        type: valueOrNull(value.type),
        text: valueOrNull(value.text)
      }
    : null;

const normalizeReaction = (
  value: InputBlock<WhatsAppMirrorReaction>
): WhatsAppMirrorReaction | null =>
  value
    ? {
        emoji: valueOrNull(value.emoji),
        targetMessageId: valueOrNull(value.targetMessageId),
        removed: valueOrNull(value.removed)
      }
    : null;

const normalizeInteractive = (
  value: InputBlock<WhatsAppMirrorInteractive>
): WhatsAppMirrorInteractive | null =>
  value
    ? {
        type: valueOrNull(value.type),
        id: valueOrNull(value.id),
        title: valueOrNull(value.title),
        description: valueOrNull(value.description)
      }
    : null;

const normalizeMedia = (
  value: InputBlock<WhatsAppMirrorMedia>
): WhatsAppMirrorMedia | null =>
  value
    ? {
        type: valueOrNull(value.type),
        mimeType: valueOrNull(value.mimeType),
        fileName: valueOrNull(value.fileName),
        sizeBytes: valueOrNull(value.sizeBytes),
        sha256: valueOrNull(value.sha256),
        url: valueOrNull(value.url),
        available: valueOrNull(value.available),
        caption: valueOrNull(value.caption)
      }
    : null;

const normalizeLocation = (
  value: InputBlock<WhatsAppMirrorLocation>
): WhatsAppMirrorLocation | null =>
  value
    ? {
        latitude: valueOrNull(value.latitude),
        longitude: valueOrNull(value.longitude),
        name: valueOrNull(value.name),
        address: valueOrNull(value.address),
        url: valueOrNull(value.url)
      }
    : null;

const normalizeContacts = (
  value: Array<Partial<WhatsAppMirrorSharedContact>> | null | undefined
): WhatsAppMirrorSharedContact[] | null =>
  value
    ? value.map(contact => ({
        displayName: valueOrNull(contact.displayName),
        vcard: valueOrNull(contact.vcard),
        phoneNumbers: contact.phoneNumbers
          ? contact.phoneNumbers.map(valueOrNull)
          : valueOrNull(contact.phoneNumbers)
      }))
    : null;

const normalizePoll = (
  value: InputBlock<WhatsAppMirrorPoll>
): WhatsAppMirrorPoll | null =>
  value
    ? {
        name: valueOrNull(value.name),
        options: value.options
          ? value.options.map(valueOrNull)
          : valueOrNull(value.options),
        selectedOptionIds: value.selectedOptionIds
          ? value.selectedOptionIds.map(valueOrNull)
          : valueOrNull(value.selectedOptionIds),
        multipleAnswers: valueOrNull(value.multipleAnswers)
      }
    : null;

const normalizeEdit = (
  value: InputBlock<WhatsAppMirrorEdit>
): WhatsAppMirrorEdit | null =>
  value
    ? {
        targetMessageId: valueOrNull(value.targetMessageId),
        text: valueOrNull(value.text),
        editedAt: valueOrNull(value.editedAt)
      }
    : null;

const normalizeDelete = (
  value: InputBlock<WhatsAppMirrorDelete>
): WhatsAppMirrorDelete | null =>
  value
    ? {
        targetMessageId: valueOrNull(value.targetMessageId),
        deletedAt: valueOrNull(value.deletedAt),
        forEveryone: valueOrNull(value.forEveryone)
      }
    : null;

const normalizeMessage = (
  value: WhatsAppMirrorPayloadInput["message"]
): { message: WhatsAppMirrorMessage; truncated: boolean } => {
  const text = truncateUtf8(
    valueOrNull(value?.text),
    WHATSAPP_MIRROR_MESSAGE_TEXT_BYTES
  );
  const quoted = normalizeQuoted(value?.quoted);
  const quotedText = truncateUtf8(
    quoted?.text ?? null,
    WHATSAPP_MIRROR_QUOTE_TEXT_BYTES
  );
  if (quoted) quoted.text = quotedText.value;

  return {
    message: {
      id: valueOrNull(value?.id),
      providerMessageId: valueOrNull(value?.providerMessageId),
      direction: valueOrNull(value?.direction),
      fromMe: valueOrNull(value?.fromMe),
      type: valueOrNull(value?.type),
      text: text.value,
      timestamp: valueOrNull(value?.timestamp),
      status: valueOrNull(value?.status),
      quoted,
      reaction: normalizeReaction(value?.reaction),
      interactive: normalizeInteractive(value?.interactive),
      media: normalizeMedia(value?.media),
      location: normalizeLocation(value?.location),
      contacts: normalizeContacts(value?.contacts),
      poll: normalizePoll(value?.poll),
      edit: normalizeEdit(value?.edit),
      delete: normalizeDelete(value?.delete)
    },
    truncated: text.truncated || quotedText.truncated
  };
};

const deterministicEventId = (input: WhatsAppMirrorPayloadInput): string =>
  uuidv5(
    JSON.stringify([
      input.identity.companyId,
      input.eventType,
      input.identity.aggregateId,
      input.identity.revision ?? null
    ]),
    WHATSAPP_MIRROR_EVENT_NAMESPACE
  );

interface StringLeaf {
  path: string;
  bytes: number;
  clear(): void;
}

const collectStringLeaves = (
  value: unknown,
  path: string,
  leaves: StringLeaf[]
): void => {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (typeof item === "string") {
        leaves.push({
          path: `${path}[${index}]`,
          bytes: Buffer.byteLength(item, "utf8"),
          clear: () => {
            value[index] = null;
          }
        });
      } else {
        collectStringLeaves(item, `${path}[${index}]`, leaves);
      }
    });
    return;
  }
  Object.entries(value).forEach(([key, child]) => {
    if (typeof child === "string") {
      leaves.push({
        path: `${path}.${key}`,
        bytes: Buffer.byteLength(child, "utf8"),
        clear: () => {
          (value as Record<string, unknown>)[key] = null;
        }
      });
    } else {
      collectStringLeaves(child, `${path}.${key}`, leaves);
    }
  });
};

const enforceEnvelopeCap = (
  payload: WhatsAppMirrorEnvelope
): WhatsAppMirrorEnvelope => {
  if (
    canonicalJsonBytes(payload).byteLength <= WHATSAPP_MIRROR_ENVELOPE_BYTES
  ) {
    return payload;
  }

  payload.data.truncated = true;
  const message = payload.data.message;
  const richBlocks: Array<
    keyof Pick<
      WhatsAppMirrorMessage,
      | "contacts"
      | "poll"
      | "location"
      | "media"
      | "interactive"
      | "reaction"
      | "quoted"
      | "edit"
      | "delete"
    >
  > = [
    "contacts",
    "poll",
    "location",
    "media",
    "interactive",
    "reaction",
    "quoted",
    "edit",
    "delete"
  ];
  const fitsAfterRichBlockPruning = richBlocks.some(key => {
    if (message[key] !== null) message[key] = null;
    return (
      canonicalJsonBytes(payload).byteLength <= WHATSAPP_MIRROR_ENVELOPE_BYTES
    );
  });
  if (fitsAfterRichBlockPruning) return payload;

  while (
    canonicalJsonBytes(payload).byteLength > WHATSAPP_MIRROR_ENVELOPE_BYTES
  ) {
    const leaves: StringLeaf[] = [];
    collectStringLeaves(payload.data, "$.data", leaves);
    const largest = leaves.sort(
      (left, right) =>
        right.bytes - left.bytes || left.path.localeCompare(right.path)
    )[0];
    if (!largest) break;
    largest.clear();
  }

  if (canonicalJsonBytes(payload).byteLength > WHATSAPP_MIRROR_ENVELOPE_BYTES) {
    const overflow =
      canonicalJsonBytes(payload).byteLength - WHATSAPP_MIRROR_ENVELOPE_BYTES;
    const maximumTypeBytes = Math.max(
      0,
      Buffer.byteLength(payload.type, "utf8") - overflow - 16
    );
    payload.type = truncateUtf8(payload.type, maximumTypeBytes).value || "";
  }
  if (canonicalJsonBytes(payload).byteLength > WHATSAPP_MIRROR_ENVELOPE_BYTES) {
    throw new RangeError("WhatsApp mirror envelope exceeds 262144 bytes");
  }
  return payload;
};

class WhatsAppMirrorPayloadBuilder {
  // The builder is intentionally stateless so adapters can share one pure contract.
  // eslint-disable-next-line class-methods-use-this
  build(input: WhatsAppMirrorPayloadInput): WhatsAppMirrorEnvelope {
    validateSafePayload(input);
    const normalizedMessage = normalizeMessage(input.message);
    return enforceEnvelopeCap({
      schema: WHATSAPP_MIRROR_SCHEMA,
      id: deterministicEventId(input),
      type: input.eventType,
      createdAt: new Date(input.occurredAt).toISOString(),
      data: {
        messageId: valueOrNull(input.correlation.messageId),
        whatsappId: valueOrNull(input.correlation.whatsappId),
        conversationId: valueOrNull(input.correlation.conversationId),
        contactId: valueOrNull(input.correlation.contactId),
        externalTicketId: valueOrNull(input.correlation.externalTicketId),
        automationEpoch: valueOrNull(input.correlation.automationEpoch),
        actorType: valueOrNull(input.correlation.actorType),
        kind: valueOrNull(input.correlation.kind),
        origin: valueOrNull(input.correlation.origin),
        provider: normalizeProvider(input.provider),
        connection: normalizeConnection(input.connection),
        contact: normalizeContact(input.contact),
        conversation: normalizeConversation(input.conversation),
        chat: normalizeChat(input.chat),
        message: normalizedMessage.message,
        truncated: normalizedMessage.truncated
      }
    });
  }
}

export default WhatsAppMirrorPayloadBuilder;
