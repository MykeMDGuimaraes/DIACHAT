import Message from "../models/Message";
import Ticket from "../models/Ticket";
import { resolveContactJid } from "../messaging/public/baileys";

const SerializeWbotMsgId = (ticket: Ticket, message: Message): string => {
  const serializedMsgId = `${message.fromMe}_${resolveContactJid({
    ...ticket.contact,
    isGroup: ticket.isGroup
  })}_${message.id}`;

  return serializedMsgId;
};

export default SerializeWbotMsgId;
