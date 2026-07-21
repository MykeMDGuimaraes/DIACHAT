import Contact from "../../models/Contact";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";

export interface ContactDTO {
  id: number;
  name: string;
  number: string;
  email: string | null;
  isGroup: boolean;
  profilePicUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationSummaryDTO {
  id: number;
  uuid: string;
  status: string;
  unreadCount: number;
  lastMessage: string | null;
  isGroup: boolean;
  contact: ContactDTO | null;
  queueId: number | null;
  userId: number | null;
  whatsappId: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationMessageDTO {
  id: string;
  conversationId: number;
  direction: "in" | "out";
  body: string;
  mediaType: string | null;
  mediaUrl: string | null;
  ack: number;
  read: boolean;
  isDeleted: boolean;
  isEdited: boolean;
  quotedMessageId: string | null;
  contactId: number | null;
  createdAt: string;
  updatedAt: string;
}

const iso = (d: Date | null | undefined): string =>
  d ? new Date(d).toISOString() : null;

export const toContactDTO = (contact: Contact): ContactDTO => ({
  id: contact.id,
  name: contact.name,
  number: contact.number,
  email: contact.email || null,
  isGroup: !!contact.isGroup,
  profilePicUrl: contact.profilePicUrl || null,
  createdAt: iso(contact.createdAt),
  updatedAt: iso(contact.updatedAt)
});

export const toConversationSummaryDTO = (
  ticket: Ticket
): ConversationSummaryDTO => ({
  id: ticket.id,
  uuid: ticket.uuid,
  status: ticket.status,
  unreadCount: ticket.unreadMessages || 0,
  lastMessage: ticket.lastMessage || null,
  isGroup: !!ticket.isGroup,
  contact: ticket.contact ? toContactDTO(ticket.contact) : null,
  queueId: ticket.queueId ?? null,
  userId: ticket.userId ?? null,
  whatsappId: ticket.whatsappId ?? null,
  createdAt: iso(ticket.createdAt),
  updatedAt: iso(ticket.updatedAt)
});

export const toConversationMessageDTO = (
  message: Message
): ConversationMessageDTO => ({
  id: message.id,
  conversationId: message.ticketId,
  direction: message.fromMe ? "out" : "in",
  body: message.body,
  mediaType: message.mediaType || null,
  mediaUrl: message.getDataValue("mediaUrl")
    ? `/public/${message.getDataValue("mediaUrl")}`
    : null,
  ack: message.ack,
  read: !!message.read,
  isDeleted: !!message.isDeleted,
  isEdited: !!message.isEdited,
  quotedMessageId: message.quotedMsgId || null,
  contactId: message.contactId ?? null,
  createdAt: iso(message.createdAt),
  updatedAt: iso(message.updatedAt)
});

export const encodeCursor = (payload: Record<string, unknown>): string =>
  Buffer.from(JSON.stringify(payload)).toString("base64url");

export const decodeCursor = <T>(cursor: string): T | null => {
  try {
    return JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as T;
  } catch {
    return null;
  }
};
