import TicketNote from "../../models/TicketNote";
import Ticket from "../../models/Ticket";
import AppError from "../../errors/AppError";

const ShowTicketNoteService = async (
  id: string | number,
  companyId: number
): Promise<TicketNote> => {
  const ticketNote = await TicketNote.findByPk(id, {
    include: [{ model: Ticket, as: "ticket", attributes: ["id", "companyId"] }]
  });

  if (!ticketNote || ticketNote.ticket?.companyId !== companyId) {
    throw new AppError("ERR_NO_TICKETNOTE_FOUND", 404);
  }

  return ticketNote;
};

export default ShowTicketNoteService;
