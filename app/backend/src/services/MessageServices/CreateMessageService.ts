import { getIO } from "../../libs/socket";
import { publishTenantEvent } from "../../libs/tenantEvents";
import {
  toConversationMessageDTO,
  toConversationSummaryDTO
} from "../InternalV1Services/Dtos";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";

export interface MessageData {
  id: string;
  ticketId: number;
  body: string;
  contactId?: number;
  fromMe?: boolean;
  read?: boolean;
  mediaType?: string;
  mediaUrl?: string;
  ack?: number;
  queueId?: number;
  remoteJid?: string;
  participant?: string;
  dataJson?: string;
}
interface Request {
  messageData: MessageData;
  companyId: number;
}

export const notifyCreatedMessage = (
  message: Message,
  companyId: number
): void => {
  const io = getIO();
  io.to(message.ticketId.toString())
    .to(`company-${companyId}-${message.ticket.status}`)
    .to(`company-${companyId}-notification`)
    .to(`queue-${message.ticket.queueId}-${message.ticket.status}`)
    .to(`queue-${message.ticket.queueId}-notification`)
    .emit(`company-${companyId}-appMessage`, {
      action: "create",
      message,
      ticket: message.ticket,
      contact: message.ticket.contact
    });

  publishTenantEvent(companyId, "message.created", {
    message: toConversationMessageDTO(message),
    conversation: toConversationSummaryDTO(message.ticket)
  });
};

const CreateMessageService = async ({
  messageData,
  companyId
}: Request): Promise<Message> => {
  await Message.upsert({ ...messageData, companyId });

  const message = await Message.findByPk(messageData.id, {
    include: [
      "contact",
      {
        model: Ticket,
        as: "ticket",
        include: [
          "contact",
          "queue",
          {
            model: Whatsapp,
            as: "whatsapp",
            attributes: ["name"]
          }
        ]
      },
      {
        model: Message,
        as: "quotedMsg",
        include: ["contact"]
      }
    ]
  });

  if (!message) {
    throw new Error("ERR_CREATING_MESSAGE");
  }

  if (message.ticket.queueId !== null && message.queueId === null) {
    await message.update({ queueId: message.ticket.queueId });
  }

  notifyCreatedMessage(message, companyId);

  return message;
};

export default CreateMessageService;
