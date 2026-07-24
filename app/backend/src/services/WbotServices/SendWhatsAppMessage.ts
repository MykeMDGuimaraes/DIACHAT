import * as Sentry from "@sentry/node";
import type { WAMessage } from "baileys";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import baileysTicketMessagingProvider from "../../messaging/adapters/baileys/getBaileysTicketMessagingProvider";

import formatBody from "../../helpers/Mustache";

interface Request {
  body: string;
  ticket: Ticket;
  quotedMsg?: Message;
}

const SendWhatsAppMessage = async ({
  body,
  ticket,
  quotedMsg
}: Request): Promise<WAMessage> => {
  let quoted: WAMessage | undefined;

  if (quotedMsg) {
      const chatMessages = await Message.findOne({
        where: {
          id: quotedMsg.id
        }
      });

      if (chatMessages) {
        const msgFound = JSON.parse(chatMessages.dataJson);

        quoted = {
          key: msgFound.key,
          message: {
            extendedTextMessage: msgFound.message.extendedTextMessage
          }
        } as WAMessage;
      }
    
  }

  try {
    const sentMessage = await baileysTicketMessagingProvider.sendText({
      ticket,
      text: formatBody(body, ticket.contact),
      quoted
    });

    await ticket.update({ lastMessage: formatBody(body, ticket.contact) });
    return sentMessage;
  } catch (err) {
    Sentry.captureException(err);
    console.log(err);
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMessage;
