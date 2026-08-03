import * as Sentry from "@sentry/node";
import type { WAMessage } from "../../messaging/public/baileys";
import AppError from "../../errors/AppError";
import Message from "../../models/Message";
import Ticket from "../../models/Ticket";
import {
  BaileysTicketMessagingProvider,
  ProviderSendError
} from "../../messaging/public/baileysTicketMessaging";
import GetTicketWbot from "../../helpers/GetTicketWbot";
import { logger } from "../../utils/logger";

import formatBody from "../../helpers/Mustache";

// Wait for the socket to recover if the connection is mid-reconnect
// (e.g. after a Baileys stream error 515) instead of failing instantly.
const baileysTicketMessagingProvider = new BaileysTicketMessagingProvider(
  ticket => GetTicketWbot(ticket, { waitForReconnectMs: 45000 })
);

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
    // console.log(err) serializava o erro como linha vazia no log — a falha
    // de envio ficava invisível. Registrar com contexto para diagnóstico.
    logger.error(
      { err, ticketId: ticket.id, companyId: ticket.companyId },
      "SendWhatsAppMessage: falha ao enviar mensagem WhatsApp"
    );
    if (err instanceof AppError) {
      throw err;
    }
    if (
      err instanceof ProviderSendError &&
      err.code === "BAILEYS_SOCKET_UNAVAILABLE"
    ) {
      // Socket did not recover within the reconnect wait window.
      throw new AppError("ERR_WAPP_NOT_AVAILABLE", 503);
    }
    throw new AppError("ERR_SENDING_WAPP_MSG");
  }
};

export default SendWhatsAppMessage;
