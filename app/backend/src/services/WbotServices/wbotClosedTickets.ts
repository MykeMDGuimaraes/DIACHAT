import { Op } from "sequelize";
import { v4 as uuidv4 } from "uuid";
import moment from "moment";
import Ticket from "../../models/Ticket";
import Whatsapp from "../../models/Whatsapp";
import { getIO } from "../../libs/socket";
import formatBody from "../../helpers/Mustache";
import { OutboundMessageService } from "../../messaging/public/outbound";
import ShowTicketService from "../TicketServices/ShowTicketService";
import TicketTraking from "../../models/TicketTraking";

const outboundMessageService = new OutboundMessageService();

export const ClosedAllOpenTickets = async (
  companyId: number
): Promise<void> => {
  // @ts-ignore: Unreachable code error
  const closeTicket = async (ticket: any, currentStatus: any, body: any) => {
    if (currentStatus === "nps") {
      await ticket.update({
        status: "closed",
        // userId: ticket.userId || null,
        lastMessage: body,
        unreadMessages: 0,
        amountUseBotQueues: 0
      });
    } else if (currentStatus === "open") {
      await ticket.update({
        status: "closed",
        //  userId: ticket.userId || null,
        lastMessage: body,
        unreadMessages: 0,
        amountUseBotQueues: 0
      });
    } else {
      await ticket.update({
        status: "closed",
        // userId: ticket.userId || null,
        unreadMessages: 0
      });
    }
  };

  const io = getIO();
  try {
    const { rows: tickets } = await Ticket.findAndCountAll({
      where: { status: { [Op.in]: ["open"] }, companyId },
      order: [["updatedAt", "DESC"]]
    });

    tickets.forEach(async ticket => {
      const showTicket = await ShowTicketService(ticket.id, companyId);
      const whatsapp = await Whatsapp.findByPk(showTicket?.whatsappId);
      const ticketTraking = await TicketTraking.findOne({
        where: {
          ticketId: ticket.id,
          finishedAt: null
        }
      });

      if (!whatsapp) return;

      const {
        expiresInactiveMessage, // mensage de encerramento por inatividade
        expiresTicket // tempo em horas para fechar ticket automaticamente
      } = whatsapp;

      // @ts-ignore: Unreachable code error
      if (
        expiresTicket &&
        // @ts-ignore: Unreachable code error
        expiresTicket !== "" &&
        // @ts-ignore: Unreachable code error
        expiresTicket !== "0" &&
        Number(expiresTicket) > 0
      ) {
        // mensagem de encerramento por inatividade
        const bodyExpiresMessageInactive = formatBody(
          `\u200e ${expiresInactiveMessage}`,
          showTicket.contact
        );

        const dataLimite = new Date();
        dataLimite.setMinutes(dataLimite.getMinutes() - Number(expiresTicket));

        if (showTicket.status === "open" && !showTicket.isGroup) {
          const dataUltimaInteracaoChamado = new Date(showTicket.updatedAt);

          if (dataUltimaInteracaoChamado < dataLimite && showTicket.fromMe) {
            closeTicket(
              showTicket,
              showTicket.status,
              bodyExpiresMessageInactive
            );

            if (
              expiresInactiveMessage !== "" &&
              expiresInactiveMessage !== undefined
            ) {
              await outboundMessageService.create({
                companyId,
                ticketId: showTicket.id,
                idempotencyScope: "ticket-inactivity-closure",
                idempotencyKey: uuidv4(),
                kind: "text",
                text: bodyExpiresMessageInactive,
                origin: "automation"
              });
            }

            await ticketTraking.update({
              finishedAt: moment().toDate(),
              closedAt: moment().toDate(),
              whatsappId: ticket.whatsappId,
              userId: ticket.userId
            } as any);

            io.to("open").emit(`company-${companyId}-ticket`, {
              action: "delete",
              ticketId: showTicket.id
            });
          }
        }
      }
    });
  } catch (e: any) {
    console.log("e", e);
  }
};
