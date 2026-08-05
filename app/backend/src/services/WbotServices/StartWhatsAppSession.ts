import * as Sentry from "@sentry/node";
import Whatsapp from "../../models/Whatsapp";
import { wbotMessageListener } from "./wbotMessageListener";
import { getIO } from "../../libs/socket";
import wbotMonitor from "./wbotMonitor";
import { logger } from "../../utils/logger";
import { getSessionManager } from "./WhatsAppSessionManager";
import type { Session } from "../../libs/wbot";

export const StartWhatsAppSession = async (
  whatsapp: Whatsapp,
  companyId: number
): Promise<void> => {
  await whatsapp.update({ status: "OPENING" });

  const io = getIO();
  io.to(`company-${whatsapp.companyId}-mainchannel`).emit("whatsappSession", {
    action: "update",
    session: whatsapp
  });

  try {
    // Toda entrada (boot, endpoint conectar, callback de reconexao) passa
    // pelo single-flight do SessionManager: no maximo uma tentativa e um
    // socket por canal. onCreated dispara uma unica vez por sessao nova —
    // starts reutilizados nunca duplicam listeners.
    await getSessionManager().start({
      whatsapp,
      onCreated: created => {
        const socket = created.socket as Session;
        wbotMessageListener(socket, companyId);
        wbotMonitor(socket, whatsapp, companyId);
      }
    });
  } catch (err) {
    Sentry.captureException(err);
    logger.error(err);
  }
};
