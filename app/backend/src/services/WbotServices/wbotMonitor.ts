import * as Sentry from "@sentry/node";
import { v4 as uuidv4 } from "uuid";
import {
  WASocket,
  BinaryNode,
  Contact as BContact
} from "../../messaging/public/baileys";
import { OutboundMessageService } from "../../messaging/public/outbound";

// import { getIO } from "../../libs/socket";
import { Store } from "../../libs/store";
import Contact from "../../models/Contact";
import Setting from "../../models/Setting";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { logger } from "../../utils/logger";
import createOrUpdateBaileysService from "../BaileysServices/CreateOrUpdateBaileysService";
import CreateMessageService from "../MessageServices/CreateMessageService";
import Company from "../../models/Company";
import { fenceSessionListener } from "./sessionListenerGuard";

const outboundMessageService = new OutboundMessageService();

type Session = WASocket & {
  id?: number;
  store?: Store;
};

const wbotMonitor = async (
  wbot: Session,
  whatsapp: Whatsapp,
  companyId: number,
  generation?: string
): Promise<void> => {
  try {
    // Handlers fenced por geracao: eventos de uma sessao substituida ficam
    // inertes (nao enviam mensagens nem gravam nada).
    wbot.ws.on(
      "CB:call",
      fenceSessionListener(
        whatsapp.id,
        generation,
        async (node: BinaryNode) => {
          const content = node.content[0] as any;

          if (content.tag === "offer") {
            // offer node received
          }

          if (content.tag === "terminate") {
            const sendMsgCall = await Setting.findOne({
              where: { key: "call", companyId }
            });

            const translatedMessage = {
              pt: "*Mensagem Automática:*\n\nAs chamadas de voz e vídeo estão desabilitas para esse WhatsApp, favor enviar uma mensagem de texto. Obrigado",
              en: "*Automatic Message:*\n\nVoice and video calls are disabled for this WhatsApp, please send a text message. Thank you",
              es: "*Mensaje Automático:*\n\nLas llamadas de voz y video están deshabilitadas para este WhatsApp, por favor envía un mensaje de texto. Gracias"
            };

            if (sendMsgCall.value === "disabled") {
              const company = await Company.findByPk(companyId);

              const number = node.attrs.from.replace(/\D/g, "");

              await outboundMessageService.create({
                companyId,
                whatsappId: wbot.id,
                recipient: number,
                idempotencyScope: "call-disabled-autoreply",
                idempotencyKey: uuidv4(),
                kind: "text",
                text: translatedMessage[company.language],
                origin: "automation"
              });

              const contact = await Contact.findOne({
                where: { companyId, number }
              });

              const ticket = await Ticket.findOne({
                where: {
                  contactId: contact.id,
                  whatsappId: wbot.id,
                  //status: { [Op.or]: ["close"] },
                  companyId
                }
              });
              // se não existir o ticket não faz nada.
              if (!ticket) return;

              const date = new Date();
              const hours = date.getHours();
              const minutes = date.getMinutes();

              const body = `Chamada de voz/vídeo perdida às ${hours}:${minutes}`;
              const messageData = {
                id: content.attrs["call-id"],
                ticketId: ticket.id,
                contactId: contact.id,
                body,
                fromMe: false,
                mediaType: "call_log",
                read: true,
                quotedMsgId: null,
                ack: 1
              };

              await ticket.update({
                lastMessage: body
              });

              if (ticket.status === "closed") {
                await ticket.update({
                  status: "pending"
                });
              }

              return CreateMessageService({
                messageData,
                companyId: companyId
              });
            }
          }
        }
      )
    );

    wbot.ev.on(
      "contacts.upsert",
      fenceSessionListener(
        whatsapp.id,
        generation,
        async (contacts: BContact[]) => {
          await createOrUpdateBaileysService({
            whatsappId: whatsapp.id,
            contacts
          });
        }
      )
    );
  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }
};

export default wbotMonitor;
