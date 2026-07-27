import { WASocket } from "../messaging/public/baileys";
import { getWbot, waitForWbot } from "../libs/wbot";
import GetDefaultWhatsApp from "./GetDefaultWhatsApp";
import Ticket from "../models/Ticket";
import { Store } from "../libs/store";

type Session = WASocket & {
  id?: number;
  store?: Store;
};

interface Options {
  /**
   * When > 0, waits up to this many milliseconds for the WhatsApp socket to
   * come back if it is reconnecting (e.g. after a stream error) instead of
   * failing immediately. Use for outbound sends; keep 0 for ancillary
   * operations like read receipts.
   */
  waitForReconnectMs?: number;
}

const GetTicketWbot = async (
  ticket: Ticket,
  { waitForReconnectMs = 0 }: Options = {}
): Promise<Session> => {
  if (!ticket.whatsappId) {
    const defaultWhatsapp = await GetDefaultWhatsApp(ticket.user.id);

    await ticket.$set("whatsapp", defaultWhatsapp);
  }

  if (waitForReconnectMs > 0) {
    return waitForWbot(ticket.whatsappId, waitForReconnectMs);
  }

  const wbot = getWbot(ticket.whatsappId);
  return wbot;
};

export default GetTicketWbot;
