import Ticket from "../../models/Ticket";
import AppError from "../../errors/AppError";
import Contact from "../../models/Contact";
import User from "../../models/User";
import Queue from "../../models/Queue";
import Tag from "../../models/Tag";
import Whatsapp from "../../models/Whatsapp";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ShowTicketUUIDService = async (
  uuid: string,
  companyId: number
): Promise<Ticket> => {
  // Evita 500 por cast inválido no Postgres quando o parâmetro não é UUID
  // (ex.: string "undefined" vinda do frontend).
  if (!UUID_PATTERN.test(uuid)) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  const ticket = await Ticket.findOne({
    where: {
      uuid,
      companyId
    },
    include: [
      {
        model: Contact,
        as: "contact",
        attributes: ["id", "name", "number", "email", "profilePicUrl"],
        include: ["extraInfo"]
      },
      {
        model: User,
        as: "user",
        attributes: ["id", "name"]
      },
      {
        model: Queue,
        as: "queue",
        attributes: ["id", "name", "color"]
      },
      {
        model: Whatsapp,
        as: "whatsapp",
        // id + deliveryHealth (T5): banner de canal degradado no ticket.
        attributes: ["id", "name", "deliveryHealth"]
      },
      {
        model: Tag,
        as: "tags",
        attributes: ["id", "name", "color"]
      }
    ]
  });

  if (!ticket || ticket.companyId !== companyId) {
    throw new AppError("ERR_NO_TICKET_FOUND", 404);
  }

  return ticket;
};

export default ShowTicketUUIDService;
